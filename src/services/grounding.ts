// Builds the LLM prompt for grounded generation from retrieved passages.
//
// The contract that kills hallucination: the system message tells the model to
// use ONLY the numbered sources and to say it doesn't know if they don't
// cover the request — never invent facts. Sources are deduped by URL and the
// total context is capped so we stay inside gpt-4o-mini's window cheaply.
//
// When `chunks` is empty (fresh DB / retrieval failure), we fall back to an
// un-grounded prompt so generation still works — this is what keeps the app
// alive before the corpus is backfilled and during pgvector outages.

import type { RetrievedChunk, GroundedPrompt, GroundedSource } from './rag.types';

// Cap the grounded context (~tokens) so the prompt fits gpt-4o-mini's window
// alongside the intent + output schema. Embeddings are 256-token chunks; with
// k=6 we'd be ~1536 tokens of context, well under budget. The cap trims the
// lowest-scoring chunks if a caller raises k.
const MAX_CONTEXT_TOKENS = 2000;
const APPROX_TOKENS_PER_CHAR = 0.25;

function approxTokens(text: string): number {
  return Math.ceil(text.length * APPROX_TOKENS_PER_CHAR);
}

/** Dedupe sources by URL (falling back to title for url-less chunks). */
function dedupeSources(chunks: RetrievedChunk[]): GroundedSource[] {
  const seen = new Set<string>();
  const out: GroundedSource[] = [];
  for (const c of chunks) {
    const key = c.sourceUrl ?? c.sourceTitle ?? c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: c.sourceTitle, url: c.sourceUrl });
  }
  return out;
}

/**
 * Build a grounded prompt. `intent` describes what to write, `outputSchema`
 * is the JSON shape the caller expects (kept identical to the pre-RAG prompts
 * so the parser downstream doesn't change).
 */
export function buildGroundedPrompt(
  intent: string,
  outputSchema: string,
  chunks: RetrievedChunk[],
): GroundedPrompt {
  // Sort by score desc so trimming drops the least-relevant first.
  const ranked = [...chunks].sort((a, b) => b.score - a.score);

  // Trim to the token budget.
  const kept: RetrievedChunk[] = [];
  let used = 0;
  for (const c of ranked) {
    const t = approxTokens(c.text);
    if (used + t > MAX_CONTEXT_TOKENS && kept.length > 0) break;
    kept.push(c);
    used += t;
  }

  const sources = dedupeSources(kept);

  if (kept.length === 0) {
    // Un-grounded fallback — same shape the generators used before RAG.
    return {
      system: 'You are a warm children\'s content writer. Output ONLY valid JSON.',
      user: `${intent}\n\nRespond with JSON matching this shape: ${outputSchema}`,
      sources: [],
    };
  }

  const sourcesBlock = kept
    .map((c, i) => {
      const cite = c.sourceTitle ? ` (${c.sourceTitle})` : '';
      return `[${i + 1}]${cite} ${c.text}`;
    })
    .join('\n\n');

  const sourcesList = sources
    .map((s, i) => `[${i + 1}] ${s.title ?? 'untitled'}${s.url ? ` — ${s.url}` : ''}`)
    .join('\n');

  const system =
    'You are a warm children\'s content writer for ages 2–8. You will be given ' +
    'numbered source passages. Use ONLY those sources to ground your answer. ' +
    'If the sources do not cover the request, say so plainly rather than ' +
    'inventing facts. Keep language simple, kind, and age-appropriate. ' +
    'Output ONLY valid JSON.';

  const user =
    `${intent}\n\n` +
    `Use the following sources (do not invent beyond them):\n\n${sourcesBlock}\n\n` +
    `Respond with JSON matching this shape: ${outputSchema}\n\n` +
    `Source list for attribution:\n${sourcesList}`;

  return { system, user, sources };
}

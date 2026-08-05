// Sentence-aware text chunker for RAG ingestion. Splits a long passage into
// overlapping chunks sized for embedding + retrieval (~256 tokens target,
// 40-token overlap), never breaking mid-word or mid-sentence when avoidable.
//
// Token counts use a cheap whitespace+heuristic estimator (≈1.3 tokens/word)
// instead of pulling in tiktoken — exact counts don't matter here, only that
// chunks land in a sane range for the embedding model's context window.

const TARGET_TOKENS = 256;
const OVERLAP_TOKENS = 40;
const TOKENS_PER_WORD = 1.3;

export interface Chunk {
  text: string;
  tokens: number;
}

/** Rough token estimate for a string. Whitespace + punctuation heuristic. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * TOKENS_PER_WORD));
}

/** Split text into sentences on terminal punctuation, keeping the punctuation. */
function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  // Match sentence-ending punctuation followed by space/end. Keep the delim.
  const matches = cleaned.match(/[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [cleaned];
}

/**
 * Chunk a passage into overlapping, sentence-aware pieces.
 *
 * Behaviour:
 * - Short text (≤ TARGET_TOKENS) → single chunk.
 * - Empty/whitespace input → [].
 * - Overlap is achieved by re-emitting the last few sentences of the previous
 *   chunk into the next, so retrieval can match a sentence that straddles a
 *   boundary.
 */
export function chunkText(
  text: string,
  opts: { targetTokens?: number; overlapTokens?: number } = {},
): Chunk[] {
  const target = opts.targetTokens ?? TARGET_TOKENS;
  const overlap = opts.overlapTokens ?? OVERLAP_TOKENS;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const joined = buffer.join(' ').trim();
    if (joined) chunks.push({ text: joined, tokens: estimateTokens(joined) });
    // Seed the next chunk with the trailing sentences for overlap.
    const overlapBuf: string[] = [];
    let overlapTokens = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      const s = buffer[i];
      const sTokens = estimateTokens(s);
      if (overlapTokens + sTokens > overlap && overlapBuf.length > 0) break;
      overlapBuf.unshift(s);
      overlapTokens += sTokens;
    }
    buffer = overlapBuf;
    bufferTokens = overlapTokens;
  };

  for (const sentence of sentences) {
    const sTokens = estimateTokens(sentence);
    // A single sentence larger than the target is emitted as its own chunk
    // (we don't split inside a sentence).
    if (sTokens > target && buffer.length === 0) {
      chunks.push({ text: sentence, tokens: sTokens });
      buffer = [];
      bufferTokens = 0;
      continue;
    }
    if (bufferTokens + sTokens > target && buffer.length > 0) {
      flush();
    }
    buffer.push(sentence);
    bufferTokens += sTokens;
  }
  flush();

  // Drop a trailing chunk that's just overlap of the previous one.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.text === prev.text) chunks.pop();
  }

  return chunks;
}

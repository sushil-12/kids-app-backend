// Data access for the RAG `document_chunks` table. The `embedding` column is a
// pgvector `vector(1536)` type Prisma can't bind, so all reads/writes of it go
// through raw SQL here (mirroring the raw-query pattern in content.repo.ts).
//
// All other columns are plain types and could use Prisma, but we keep the
// chunk write in one raw statement so the embedding + row land atomically.

import { Prisma } from '@prisma/client';
import { prisma } from './content.repo';
import { OpenAIService } from '../services/openai.service';
import type { Redis } from 'ioredis';
import { estimateTokens } from '../services/chunker';
import { createHash } from 'node:crypto';
import { getAllStoriesAndPoemsAndLessons } from './content.repo';
import type { RetrievedChunk } from '../services/rag.types';

export interface ChunkInput {
  kind: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  ageBand?: string | null;
  lang: string;
  topic?: string | null;
  text: string;
  contentHash: string;
  tokens: number;
}

/** Hash a chunk's text for content-addressed dedupe (matches OpenAIService.contentHash). */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** True if a chunk with this content hash already exists (skip re-embedding). */
export async function chunkHashExists(hash: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM document_chunks WHERE "contentHash" = ${hash}
  `;
  return (rows[0]?.count ?? BigInt(0)) > 0;
}

/** Insert one chunk with its embedding. Renders the vector as a pgvector literal. */
export async function insertChunk(c: ChunkInput, embedding: number[]): Promise<void> {
  const vectorLiteral = `[${embedding.join(',')}]`;
  // Use $executeRawUnsafe so we can interpolate the vector literal cleanly.
  // All other values are parameterized; the vector is a sanitized numeric list.
  await prisma.$executeRawUnsafe(
    `INSERT INTO document_chunks
       ("id", "kind", "sourceUrl", "sourceTitle", "ageBand", "lang", "topic",
        "text", "embedding", "contentHash", "tokens", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11, NOW())
     ON CONFLICT ("contentHash") DO NOTHING`,
    // generateId inline to avoid importing cuid into a raw call path
    randomId(),
    c.kind,
    c.sourceUrl ?? null,
    c.sourceTitle ?? null,
    c.ageBand ?? null,
    c.lang,
    c.topic ?? null,
    c.text,
    vectorLiteral,
    c.contentHash,
    c.tokens,
  );
}

/** Count chunks, optionally broken down by kind for admin stats. */
export async function countChunks(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM document_chunks
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function countChunksByKind(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ kind: string; count: bigint }[]>`
    SELECT kind, COUNT(*)::bigint AS count FROM document_chunks GROUP BY kind
  `;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = Number(r.count);
  return out;
}

/**
 * ANN search over the corpus. The query vector is rendered as a pgvector
 * literal; other filters are parameterized. Pre-filters by kind/ageBand/lang
 * BEFORE the ORDER BY so a junior-band query never pulls senior chunks.
 *
 * Returns chunks sorted by cosine similarity (closest first). Score is
 * `1 - cosine_distance`, i.e. 1 = identical.
 *
 * `queryVector` MUST be a sanitized number[] — only ever produced by
 * OpenAIService.embed, never user input.
 */
export async function searchChunks(
  queryVector: number[],
  filters: {
    kinds: string[] | null;
    ageBand: string | null;
    lang: string;
    k: number;
  },
): Promise<RetrievedChunk[]> {
  const vectorLiteral = `[${queryVector.join(',')}]`;
  // kinds is bound as a Postgres array via Prisma's tagged template.
  const kindArr = filters.kinds as unknown as Prisma.Sql;
  const rows = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT id, text, "sourceUrl", "sourceTitle",
           1 - (embedding <=> ${vectorLiteral}::vector) AS score
    FROM document_chunks
    WHERE (${filters.kinds === null} OR kind = ANY (${kindArr}::text[]))
      AND (${filters.ageBand === null} OR "ageBand" IS NULL OR "ageBand" = ${filters.ageBand})
      AND lang = ${filters.lang}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${filters.k}
  `;
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    sourceUrl: r.sourceUrl,
    sourceTitle: r.sourceTitle,
    score: Number(r.score),
  }));
}

/**
 * Backfill the corpus from existing Stories/Poems/AbcLessons. Idempotent via
 * contentHash — only new chunks get embedded. Returns embed/skip counts.
 */
export async function backfillCorpus(
  openai: OpenAIService,
  redis: Redis,
): Promise<{ embedded: number; skipped: number }> {
  void redis; // reserved for future cache use; OpenAIService already holds redis
  const { stories, poems, lessons } = await getAllStoriesAndPoemsAndLessons();

  let embedded = 0;
  let skipped = 0;

  type ToEmbed = { input: ChunkInput; text: string };
  const batch: ToEmbed[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const vectors = await openai.embed(batch.map((b) => b.text));
    for (let i = 0; i < batch.length; i++) {
      await insertChunk(batch[i].input, vectors[i]);
    }
    embedded += batch.length;
    batch.length = 0;
  };

  const push = (text: string, meta: Omit<ChunkInput, 'text' | 'contentHash' | 'tokens'>): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const input: ChunkInput = {
      ...meta,
      text: trimmed,
      contentHash: hashText(trimmed),
      tokens: estimateTokens(trimmed),
    };
    batch.push({ input, text: trimmed });
  };

  for (const s of stories) {
    push(s.body, {
      kind: 'story',
      sourceUrl: null,
      sourceTitle: s.title,
      ageBand: s.ageBand,
      lang: 'en',
    });
  }
  for (const p of poems) {
    push(p.lines, {
      kind: 'poem',
      sourceUrl: null,
      sourceTitle: p.title,
      ageBand: null,
      lang: 'en',
      topic: p.topic,
    });
  }
  for (const l of lessons) {
    push(l.miniStory, {
      kind: 'abc',
      sourceUrl: null,
      sourceTitle: `${l.letter} — ${l.word}`,
      ageBand: null,
      lang: 'en',
    });
  }

  // Filter out chunks whose hash already exists before embedding.
  const filtered: ToEmbed[] = [];
  for (const b of batch) {
    if (await chunkHashExists(b.input.contentHash)) {
      skipped += 1;
    } else {
      filtered.push(b);
    }
  }
  batch.length = 0;
  for (const f of filtered) batch.push(f);
  await flush();

  return { embedded, skipped };
}

// Cuid-style id is generated by the DB for other models, but raw INSERTs bypass
// Prisma's default(), so produce one here. Cheap, unique-enough for chunks.
function randomId(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

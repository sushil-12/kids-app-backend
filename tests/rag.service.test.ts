import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetrievedChunk } from '../src/services/rag.types';

// Mock the vector repo so retrieval never touches Postgres/pgvector.
vi.mock('../src/db/vector.repo', () => ({
  searchChunks: vi.fn(),
  insertChunk: vi.fn(),
  chunkHashExists: vi.fn(),
  countChunks: vi.fn(),
  countChunksByKind: vi.fn(),
  backfillCorpus: vi.fn(),
  hashText: vi.fn((s: string) => `hash-${s.length}`),
}));

import { RagService } from '../src/services/rag.service';
import * as vectorRepo from '../src/db/vector.repo';
import type { OpenAIService } from '../src/services/openai.service';
import type { Redis } from 'ioredis';

function makeOpenAIStub(vec = [0.1, 0.2, 0.3]): { openai: OpenAIService; embedOne: ReturnType<typeof vi.fn> } {
  const embedOne = vi.fn().mockResolvedValue(vec);
  return { openai: { embedOne } as unknown as OpenAIService, embedOne };
}

function makeRedisStub(getVal: string | null = null): Redis {
  return {
    get: vi.fn().mockResolvedValue(getVal),
    setex: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const sampleChunks: RetrievedChunk[] = [
  { id: 'c1', text: 'apples are fruit', sourceUrl: 'https://a', sourceTitle: 'A', score: 0.91 },
  { id: 'c2', text: 'bees make honey', sourceUrl: 'https://b', sourceTitle: 'B', score: 0.82 },
];

describe('RagService.retrieve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached chunks on a Redis hit without embedding or searching', async () => {
    const cached = JSON.stringify(sampleChunks);
    const redis = makeRedisStub(cached);
    const { openai, embedOne } = makeOpenAIStub();
    const rag = new RagService(openai, redis);

    const out = await rag.retrieve('apples', { kind: 'fact' });

    expect(out).toEqual(sampleChunks);
    expect(embedOne).not.toHaveBeenCalled();
    expect(vectorRepo.searchChunks).not.toHaveBeenCalled();
  });

  it('embeds + searches + caches on a cache miss', async () => {
    const redis = makeRedisStub(null);
    const { openai, embedOne } = makeOpenAIStub();
    vi.mocked(vectorRepo.searchChunks).mockResolvedValue(sampleChunks);
    const rag = new RagService(openai, redis);

    const out = await rag.retrieve('apples', { kind: 'fact', ageBand: 'junior', k: 5 });

    expect(embedOne).toHaveBeenCalledWith('apples');
    expect(vectorRepo.searchChunks).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      expect.objectContaining({ kinds: ['fact'], ageBand: 'junior', lang: 'en', k: 5 }),
    );
    expect(out).toEqual(sampleChunks);
    // Cached for an hour.
    expect((redis as unknown as { setex: ReturnType<typeof vi.fn> }).setex).toHaveBeenCalledWith(
      expect.any(String),
      3600,
      JSON.stringify(sampleChunks),
    );
  });

  it('returns [] (graceful fallback) when embedding throws', async () => {
    const redis = makeRedisStub(null);
    const embedOne = vi.fn().mockRejectedValue(new Error('openai down'));
    const openai = { embedOne } as unknown as OpenAIService;
    const rag = new RagService(openai, redis);

    const out = await rag.retrieve('apples', {});
    expect(out).toEqual([]);
    expect(vectorRepo.searchChunks).not.toHaveBeenCalled();
  });

  it('returns [] (graceful fallback) when vector search throws', async () => {
    const redis = makeRedisStub(null);
    const { openai } = makeOpenAIStub();
    vi.mocked(vectorRepo.searchChunks).mockRejectedValue(new Error('pgvector down'));
    const rag = new RagService(openai, redis);

    const out = await rag.retrieve('apples', {});
    expect(out).toEqual([]);
  });
});

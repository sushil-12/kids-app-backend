import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMBEDDING_DIM } from '../src/services/rag.types';

const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

import { OpenAIService, DailyLimitReachedException } from '../src/services/openai.service';
import type { Redis } from 'ioredis';

function makeVec(): number[] {
  return Array.from({ length: EMBEDDING_DIM }, (_, i) => (i % 7) / 10);
}

/** Redis stub with a key-addressable store so the content-addressed embed
 *  cache can be exercised realistically. */
function makeRedisStub(store: Map<string, string> = new Map()): Redis & {
  setex: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn((k: string) => store.get(k) ?? null),
    setex: vi.fn((k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    incr: vi.fn((k: string) => {
      const n = parseInt(store.get(k) ?? '0', 10) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(() => 1),
  } as unknown as Redis & {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
}

describe('OpenAIService.embed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: makeVec() }] });
  });

  it('embeds on a cache miss and caches the vector by content hash', async () => {
    const store = new Map<string, string>();
    const redis = makeRedisStub(store);
    const svc = new OpenAIService(redis as unknown as import('ioredis').default);

    const [vec] = await svc.embed(['hello world']);
    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    // The vector is cached under embed:vec:<hash>.
    const cachedKeys = [...store.keys()].filter((k) => k.startsWith('embed:vec:'));
    expect(cachedKeys).toHaveLength(1);
  });

  it('serves from cache on a repeat embed (no OpenAI call)', async () => {
    const store = new Map<string, string>();
    const redis = makeRedisStub(store);
    const svc = new OpenAIService(redis as unknown as import('ioredis').default);

    await svc.embed(['hello world']);
    await svc.embed(['hello world']); // same text → cache hit
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it('throws DailyLimitReachedException when the embed budget is spent', async () => {
    const store = new Map<string, string>([['embed:calls:' + new Date().toISOString().split('T')[0], '5000']]);
    const redis = makeRedisStub(store);
    const svc = new OpenAIService(redis as unknown as import('ioredis').default);

    await expect(svc.embed(['brand new text not in cache'])).rejects.toBeInstanceOf(
      DailyLimitReachedException,
    );
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });

  it('embedOne returns a single vector aligned to the input', async () => {
    const redis = makeRedisStub(new Map());
    const svc = new OpenAIService(redis as unknown as import('ioredis').default);
    const vec = await svc.embedOne('a single sentence');
    expect(vec).toHaveLength(EMBEDDING_DIM);
  });
});

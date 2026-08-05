import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyLimitReachedException } from '../src/services/openai.service';

// Mock the vector repo so the crawl embed path never touches Postgres.
vi.mock('../src/db/vector.repo', () => ({
  insertChunk: vi.fn().mockResolvedValue(undefined),
  chunkHashExists: vi.fn().mockResolvedValue(false),
  hashText: vi.fn((s: string) => `hash-${s.length}`),
}));

// Mock the crawler service (not used by embedCrawledText, but crawl.job imports it).
vi.mock('../src/services/crawler.service', () => ({ CrawlerService: vi.fn() }));

// Mock BullMQ so importing crawl.job doesn't try to connect to Redis.
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue({ id: 'j' }) })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    embeddings: { create: vi.fn() },
  })),
}));

import { embedCrawledText } from '../src/jobs/crawl.job';
import * as vectorRepo from '../src/db/vector.repo';
import { OpenAIService } from '../src/services/openai.service';
import type { Redis } from 'ioredis';

function makeRedisStub(): Redis {
  return {
    get: vi.fn().mockResolvedValue('0'),
    setex: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

describe('embedCrawledText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chunks, embeds, and inserts each chunk with corpus metadata', async () => {
    const redis = makeRedisStub();
    const openai = new OpenAIService(redis);
    // Stub embed to return distinct vectors per chunk.
    openai.embed = vi.fn().mockResolvedValue([[0.1], [0.2]]);

    const body = 'First sentence here. Second sentence here.';

    await embedCrawledText(openai, {
      url: 'https://src/page',
      title: 'Page Title',
      kind: 'story',
      body,
      ageBand: 'junior',
    });

    expect(openai.embed).toHaveBeenCalled();
    // insertChunk called once per chunk the chunker produced (≥1).
    expect(vectorRepo.insertChunk.mock.calls.length).toBeGreaterThanOrEqual(1);
    const firstCall = vectorRepo.insertChunk.mock.calls[0]?.[0] as {
      kind: string;
      sourceUrl: string;
      sourceTitle: string;
      ageBand: string;
    };
    expect(firstCall.kind).toBe('story');
    expect(firstCall.sourceUrl).toBe('https://src/page');
    expect(firstCall.sourceTitle).toBe('Page Title');
    expect(firstCall.ageBand).toBe('junior');
  });

  it('skips embedding when all chunks already exist', async () => {
    vi.mocked(vectorRepo.chunkHashExists).mockResolvedValue(true);
    const redis = makeRedisStub();
    const openai = new OpenAIService(redis);
    openai.embed = vi.fn();

    await embedCrawledText(openai, {
      url: 'https://src/page',
      title: 'Page Title',
      kind: 'poem',
      body: 'A poem line. Another poem line.',
      ageBand: null,
    });

    expect(openai.embed).not.toHaveBeenCalled();
    expect(vectorRepo.insertChunk).not.toHaveBeenCalled();
  });

  it('swallows DailyLimitReachedException (defers) instead of throwing', async () => {
    vi.mocked(vectorRepo.chunkHashExists).mockResolvedValue(false);
    const redis = makeRedisStub();
    const openai = new OpenAIService(redis);
    openai.embed = vi.fn().mockRejectedValue(new DailyLimitReachedException());

    await expect(
      embedCrawledText(openai, {
        url: 'https://src/page',
        title: 'Page Title',
        kind: 'abc',
        body: 'A lesson line. Another lesson line.',
        ageBand: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-limit errors', async () => {
    vi.mocked(vectorRepo.chunkHashExists).mockResolvedValue(false);
    const redis = makeRedisStub();
    const openai = new OpenAIService(redis);
    openai.embed = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(
      embedCrawledText(openai, {
        url: 'https://src/page',
        title: 'Page Title',
        kind: 'story',
        body: 'A story line. Another story line.',
        ageBand: 'senior',
      }),
    ).rejects.toThrow('network down');
  });
});

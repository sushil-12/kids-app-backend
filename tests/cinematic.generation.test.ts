import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CinematicStory } from '@prisma/client';
import type { RetrievedChunk } from '../src/services/rag.types';

vi.mock('../src/db/content.repo', () => ({
  createStory: vi.fn(),
  createPoem: vi.fn(),
  upsertAbcLesson: vi.fn(),
  createCinematicStory: vi.fn(),
}));

const retrieveMock = vi.fn();
vi.mock('../src/services/rag.service', () => ({
  RagService: vi.fn().mockImplementation(() => ({ retrieve: retrieveMock })),
}));

// The openai completion mock — each test queues raw JSON responses.
const completeMock = vi.fn();
vi.mock('../src/services/openai.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/openai.service')>();
  return {
    ...mod,
    OpenAIService: vi.fn().mockImplementation(() => ({ complete: completeMock })),
  };
});

import { ContentService } from '../src/services/content.service';
import * as repo from '../src/db/content.repo';

const chunks: RetrievedChunk[] = [
  {
    id: 'c1',
    text: 'The thirsty crow dropped pebbles into the pot to raise the water.',
    sourceUrl: 'https://tales.example/crow',
    sourceTitle: 'Panchatantra Tales',
    score: 0.91,
  },
];

function validDocJson(): string {
  return JSON.stringify({
    title: 'The Thirsty Crow',
    lang: 'en',
    ageBand: 'junior',
    category: 'Moral Stories',
    coverEmoji: '🐦‍⬛',
    music: 'forest',
    moral: 'Where there is a will, there is a way.',
    reward: { stars: 10, coins: 5, badgeStickerId: 'star' },
    scenes: [1, 2, 3].map((i) => ({
      id: i,
      title: `Scene ${i}`,
      minDuration: 8,
      background: 'hot_day',
      narration: 'The crow was thirsty.',
      camera: { effect: 'none' },
      props: [],
      characters: [{ id: 'crow', kind: 'crow', x: 0.5, y: 0.5, scale: 1, animation: 'fly' }],
      particles: [],
      interaction: null,
    })),
  });
}

function mockRedis(): unknown {
  return {
    get: vi.fn().mockResolvedValue('0'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    setex: vi.fn().mockResolvedValue('OK'),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

describe('ContentService.generateCinematicStory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveMock.mockResolvedValue(chunks);
    vi.mocked(repo.createCinematicStory).mockImplementation(
      async (data) => data as unknown as CinematicStory,
    );
  });

  it('persists a validated script unpublished with grounded sources', async () => {
    completeMock.mockResolvedValueOnce(validDocJson());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ContentService(mockRedis() as any);
    await service.generateCinematicStory('junior', 'en', '2026-07-11');

    expect(completeMock).toHaveBeenCalledTimes(1);
    const created = vi.mocked(repo.createCinematicStory).mock.calls[0][0];
    expect(created.published).toBe(false);
    expect(created.lang).toBe('en');
    expect(created.ageBand).toBe('junior');
    expect(created.date).toBe('2026-07-11');
    expect(created.source).toBe('openai-grounded');
    expect(created.slug).toMatch(/^the-thirsty-crow-en-/);
    expect(Array.isArray(created.scenes)).toBe(true);
    expect(created.sources).toEqual([{ title: 'Panchatantra Tales', url: 'https://tales.example/crow' }]);
  });

  it('asks the prompt for Hindi output when lang=hi', async () => {
    completeMock.mockResolvedValueOnce(validDocJson());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ContentService(mockRedis() as any);
    await service.generateCinematicStory('senior', 'hi', '2026-07-11');

    const [, user] = completeMock.mock.calls[0] as [string, string];
    expect(user).toContain('Hindi');
    const created = vi.mocked(repo.createCinematicStory).mock.calls[0][0];
    expect(created.lang).toBe('hi');
  });

  it('retries once on invalid output, then succeeds', async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ title: 'Broken', scenes: [] }))
      .mockResolvedValueOnce(validDocJson());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ContentService(mockRedis() as any);
    await service.generateCinematicStory('junior', 'en', '2026-07-11');

    expect(completeMock).toHaveBeenCalledTimes(2);
    const retryUser = (completeMock.mock.calls[1] as [string, string])[1];
    expect(retryUser).toContain('failed validation');
    expect(repo.createCinematicStory).toHaveBeenCalledTimes(1);
  });

  it('throws after two invalid outputs and persists nothing', async () => {
    completeMock.mockResolvedValue('not json at all');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ContentService(mockRedis() as any);
    await expect(service.generateCinematicStory('junior', 'en', '2026-07-11')).rejects.toThrow(
      /failed validation after retry/,
    );
    expect(repo.createCinematicStory).not.toHaveBeenCalled();
  });
});

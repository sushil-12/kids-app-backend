import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { CinematicStory } from '@prisma/client';

vi.mock('../src/db/content.repo', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
  getStoryForToday: vi.fn(),
  getOldestEvergreenStory: vi.fn(),
  getStoryById: vi.fn(),
  incrementStoryUsedCount: vi.fn().mockResolvedValue(undefined),
  getContentCounts: vi.fn(),
  createCrawlSource: vi.fn(),
  getAllCrawlSources: vi.fn(),
  getCinematicStoryForToday: vi.fn(),
  getCinematicStoryById: vi.fn(),
  incrementCinematicStoryUsedCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/jobs/queue', () => ({
  generateQueue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) },
  crawlQueue: { add: vi.fn().mockResolvedValue({ id: 'job-2' }) },
  queueConnection: {},
}));

import * as repo from '../src/db/content.repo';
import { generateQueue } from '../src/jobs/queue';
import { authPlugin } from '../src/plugins/auth';
import { storiesRoute } from '../src/routes/v1/stories';

const fakeCinematic: CinematicStory = {
  id: 'cine-1',
  slug: 'thirsty-crow-en',
  title: 'The Thirsty Crow',
  lang: 'en',
  ageBand: 'junior',
  category: 'Moral Stories',
  coverEmoji: '🐦‍⬛',
  music: 'forest',
  moral: 'Where there is a will, there is a way.',
  reward: { stars: 10, coins: 5, badgeStickerId: 'star' },
  scenes: [{ id: 1, title: 'A Hot Day' }],
  date: null,
  source: 'manual',
  sources: null,
  published: true,
  usedCount: 0,
  createdAt: new Date(),
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('redis', {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  });
  await app.register(authPlugin);
  await app.register(storiesRoute, { prefix: '/v1' });
  await app.ready();
  return app;
}

describe('Cinematic story routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/stories/cinematic/daily', () => {
    it('returns 401 without API key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/stories/cinematic/daily' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid ageBand or lang', async () => {
      const bad1 = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/daily?ageBand=toddler',
        headers: { 'x-api-key': 'test-api-key' },
      });
      expect(bad1.statusCode).toBe(400);

      const bad2 = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/daily?lang=fr',
        headers: { 'x-api-key': 'test-api-key' },
      });
      expect(bad2.statusCode).toBe(400);
    });

    it('serves the published story and bumps usedCount', async () => {
      vi.mocked(repo.getCinematicStoryForToday).mockResolvedValue(fakeCinematic);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/daily?ageBand=junior&lang=en',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string; scenes: unknown[]; reward: { stars: number } }>();
      expect(body.title).toBe('The Thirsty Crow');
      expect(body.scenes).toHaveLength(1);
      expect(body.reward.stars).toBe(10);
      expect(repo.incrementCinematicStoryUsedCount).toHaveBeenCalledWith('cine-1');
    });

    it('enqueues generation and returns 503 on a miss', async () => {
      vi.mocked(repo.getCinematicStoryForToday).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/daily?ageBand=senior&lang=hi',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(503);
      expect(generateQueue.add).toHaveBeenCalledWith(
        'generate-cinematic',
        expect.objectContaining({ type: 'cinematic-story', ageBand: 'senior', lang: 'hi' }),
      );
    });
  });

  describe('GET /v1/stories/cinematic/:id', () => {
    it('returns the story by id when published', async () => {
      vi.mocked(repo.getCinematicStoryById).mockResolvedValue(fakeCinematic);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/thirsty-crow-en',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ slug: string }>().slug).toBe('thirsty-crow-en');
    });

    it('hides unpublished stories', async () => {
      vi.mocked(repo.getCinematicStoryById).mockResolvedValue({
        ...fakeCinematic,
        published: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/cinematic/cine-1',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

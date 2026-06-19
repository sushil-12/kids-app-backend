import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { Story, Poem, AbcLesson } from '@prisma/client';

vi.mock('../src/db/content.repo', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
  getStoryForToday: vi.fn(),
  getOldestEvergreenStory: vi.fn(),
  incrementStoryUsedCount: vi.fn().mockResolvedValue(undefined),
  getPoem: vi.fn(),
  incrementPoemUsedCount: vi.fn().mockResolvedValue(undefined),
  getAbcLesson: vi.fn(),
  getContentCounts: vi.fn(),
  createCrawlSource: vi.fn(),
}));

vi.mock('../src/jobs/queue', () => ({
  generateQueue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) },
  crawlQueue: { add: vi.fn().mockResolvedValue({ id: 'job-2' }) },
  queueConnection: {},
}));

vi.mock('../src/services/content.service', () => ({
  ContentService: vi.fn().mockImplementation(() => ({
    generatePoem: vi.fn(),
    generateAbcLesson: vi.fn(),
  })),
}));

import * as repo from '../src/db/content.repo';
import { authPlugin } from '../src/plugins/auth';
import { healthRoute } from '../src/routes/v1/health';
import { storiesRoute } from '../src/routes/v1/stories';
import { poemsRoute } from '../src/routes/v1/poems';
import { abcRoute } from '../src/routes/v1/abc';

function makeRedisStub(): Record<string, unknown> {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const redisStub = makeRedisStub();

  // Manually decorate redis
  app.decorate('redis', redisStub);
  await app.register(authPlugin);
  await app.register(healthRoute);
  await app.register(storiesRoute, { prefix: '/v1' });
  await app.register(poemsRoute, { prefix: '/v1' });
  await app.register(abcRoute, { prefix: '/v1' });

  await app.ready();
  return app;
}

describe('Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns 200 ok when db and redis are healthy', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ status: string }>();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /v1/stories/daily', () => {
    it('returns 401 without API key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/stories/daily' });
      expect(response.statusCode).toBe(401);
    });

    it('returns story from DB on cache miss', async () => {
      const fakeStory: Story = {
        id: 'story-abc',
        ageBand: 'junior',
        title: 'A Nice Story',
        body: 'Once there was a nice story.',
        moral: 'Be nice.',
        emoji: '📖',
        source: 'manual',
        date: '2026-06-19',
        usedCount: 0,
        createdAt: new Date(),
      };

      vi.mocked(repo.getStoryForToday).mockResolvedValue(fakeStory);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/daily?ageBand=junior',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe('A Nice Story');
    });

    it('returns 400 for invalid ageBand', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/daily?ageBand=toddler',
        headers: { 'x-api-key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('falls back to evergreen story when no story for today', async () => {
      vi.mocked(repo.getStoryForToday).mockResolvedValue(null);
      const evergreenStory: Story = {
        id: 'story-evergreen',
        ageBand: 'junior',
        title: 'Evergreen Story',
        body: 'An evergreen story.',
        moral: 'Timeless.',
        emoji: '🌲',
        source: 'manual',
        date: null,
        usedCount: 5,
        createdAt: new Date(),
      };
      vi.mocked(repo.getOldestEvergreenStory).mockResolvedValue(evergreenStory);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/daily?ageBand=junior',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe('Evergreen Story');
    });

    it('returns 503 when no story and no evergreen fallback', async () => {
      vi.mocked(repo.getStoryForToday).mockResolvedValue(null);
      vi.mocked(repo.getOldestEvergreenStory).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/stories/daily?ageBand=junior',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('GET /v1/poems', () => {
    it('returns 401 without API key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/poems' });
      expect(response.statusCode).toBe(401);
    });

    it('returns poem from DB', async () => {
      const fakePoem: Poem = {
        id: 'poem-1',
        topic: 'Animals',
        title: 'The Cat',
        lines: 'A cat sat on a mat.\nIt wore a tiny hat.',
        emoji: '🐱',
        source: 'manual',
        usedCount: 0,
        createdAt: new Date(),
      };

      vi.mocked(repo.getPoem).mockResolvedValue(fakePoem);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/poems?topic=Animals',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe('The Cat');
    });

    it('returns 400 for invalid topic', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/poems?topic=InvalidTopic',
        headers: { 'x-api-key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /v1/abc/:letter', () => {
    it('returns 401 without API key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/abc/A' });
      expect(response.statusCode).toBe(401);
    });

    it('returns ABC lesson from DB', async () => {
      const fakeLesson: AbcLesson = {
        id: 'abc-1',
        letter: 'A',
        word: 'Apple',
        emoji: '🍎',
        phonics: 'Say ah',
        miniStory: 'Amy found an apple.',
        source: 'manual',
        updatedAt: new Date(),
      };

      vi.mocked(repo.getAbcLesson).mockResolvedValue(fakeLesson);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/abc/a',
        headers: { 'x-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ letter: string; word: string }>();
      expect(body.letter).toBe('A');
      expect(body.word).toBe('Apple');
    });

    it('returns 400 for invalid letter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/abc/AB',
        headers: { 'x-api-key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});

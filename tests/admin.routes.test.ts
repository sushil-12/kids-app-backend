import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { Story, Poem, AbcLesson } from '@prisma/client';

vi.mock('../src/db/content.repo', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
  listStories: vi.fn(),
  deleteStory: vi.fn(),
  updateStory: vi.fn(),
  listPoems: vi.fn(),
  deletePoem: vi.fn(),
  updatePoem: vi.fn(),
  listAbcLessons: vi.fn(),
  deleteAbcLesson: vi.fn(),
  updateAbcLesson: vi.fn(),
  getPendingCrawlSources: vi.fn(),
}));

vi.mock('../src/jobs/queue', () => ({
  generateQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getRepeatableJobs: vi.fn().mockResolvedValue([
      { id: 'repeat:pre-generate-stories:0', name: 'pre-generate-stories', repeat: { pattern: '0 2 * * *' }, next: Date.now() + 1000, data: { type: 'pre-generate-stories' } },
    ]),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 0 }),
  },
  crawlQueue: { add: vi.fn().mockResolvedValue({ id: 'job-2' }) },
  queueConnection: {},
}));

vi.mock('../src/services/content.service', () => ({
  ContentService: vi.fn().mockImplementation(() => ({
    generatePoem: vi.fn().mockResolvedValue({ id: 'poem-x', title: 'Test Poem', topic: 'Animals' }),
    generateAbcLesson: vi.fn().mockResolvedValue({ letter: 'A', word: 'Apple' }),
  })),
}));

import * as repo from '../src/db/content.repo';
import { generateQueue } from '../src/jobs/queue';
import { authPlugin } from '../src/plugins/auth';
import { adminRoute } from '../src/routes/v1/admin';
import { adminPageHtml } from '../src/routes/v1/admin.ui';

function makeRedisStub(): Record<string, unknown> {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('redis', makeRedisStub());
  await app.register(authPlugin);
  await app.register(adminRoute, { prefix: '/v1' });
  await app.ready();
  return app;
}

const ADMIN_KEY = 'test-admin-key';

function adminHeaders(): Record<string, string> {
  return { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };
}

describe('Admin routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/admin', () => {
    it('serves HTML without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toBe(adminPageHtml);
    });
  });

  describe('GET /v1/admin/stories', () => {
    it('returns 401 without admin key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/stories' });
      expect(response.statusCode).toBe(401);
    });

    it('returns items list with admin key', async () => {
      const fake: Story = {
        id: 's1', ageBand: 'junior', title: 'T', body: 'b', moral: 'm',
        emoji: 'e', source: 'manual', date: null, usedCount: 0, createdAt: new Date(),
      };
      vi.mocked(repo.listStories).mockResolvedValue([fake]);
      const response = await app.inject({
        method: 'GET', url: '/v1/admin/stories?ageBand=junior&limit=10',
        headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: Story[] }>();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe('s1');
      expect(repo.listStories).toHaveBeenCalledWith(expect.objectContaining({ ageBand: 'junior', limit: 10 }));
    });
  });

  describe('DELETE /v1/admin/stories/:id', () => {
    it('returns 401 without admin key', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/v1/admin/stories/s1' });
      expect(response.statusCode).toBe(401);
    });

    it('deletes and returns 200', async () => {
      vi.mocked(repo.deleteStory).mockResolvedValue(true);
      const response = await app.inject({
        method: 'DELETE', url: '/v1/admin/stories/s1', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(repo.deleteStory).toHaveBeenCalledWith('s1');
    });

    it('returns 404 when missing', async () => {
      vi.mocked(repo.deleteStory).mockResolvedValue(false);
      const response = await app.inject({
        method: 'DELETE', url: '/v1/admin/stories/missing', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /v1/admin/stories/:id', () => {
    it('updates fields and returns 200', async () => {
      vi.mocked(repo.updateStory).mockResolvedValue({
        ...({} as unknown as Story),
        id: 's1', ageBand: 'junior', title: 'New', body: 'b', moral: 'm',
        emoji: 'e', source: 'manual', date: null,
      });
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/stories/s1',
        headers: adminHeaders(), body: JSON.stringify({ title: 'New', date: null }),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe('New');
      expect(repo.updateStory).toHaveBeenCalledWith('s1', expect.objectContaining({ title: 'New', date: null }));
    });

    it('rejects invalid ageBand with 400', async () => {
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/stories/s1',
        headers: adminHeaders(), body: JSON.stringify({ ageBand: 'toddler' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when story missing', async () => {
      vi.mocked(repo.updateStory).mockResolvedValue(null);
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/stories/s1',
        headers: adminHeaders(), body: JSON.stringify({ title: 'x' }),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/admin/stories/generate', () => {
    it('rejects invalid body with 400', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/stories/generate',
        headers: adminHeaders(), body: JSON.stringify({ ageBand: 'toddler', date: '2026-07-04' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('enqueues a story job and returns 202', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/stories/generate',
        headers: adminHeaders(), body: JSON.stringify({ ageBand: 'junior', date: '2026-07-04' }),
      });
      expect(response.statusCode).toBe(202);
      const body = response.json<{ jobId: string }>();
      expect(body.jobId).toBe('job-1');
      expect(generateQueue.add).toHaveBeenCalledWith(
        'generate-story',
        { type: 'story', ageBand: 'junior', date: '2026-07-04' },
        expect.objectContaining({ jobId: expect.stringContaining('admin-story-junior-2026-07-04') }),
      );
    });
  });

  describe('GET /v1/admin/poems', () => {
    it('returns 401 without admin key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/poems' });
      expect(response.statusCode).toBe(401);
    });

    it('returns items list', async () => {
      const fake: Poem = {
        id: 'p1', topic: 'Animals', title: 'T', lines: 'l', emoji: 'e',
        source: 'manual', usedCount: 0, createdAt: new Date(),
      };
      vi.mocked(repo.listPoems).mockResolvedValue([fake]);
      const response = await app.inject({
        method: 'GET', url: '/v1/admin/poems?topic=Animals', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: Poem[] }>();
      expect(body.items[0].id).toBe('p1');
    });
  });

  describe('PATCH /v1/admin/poems/:id', () => {
    it('updates fields and returns 200', async () => {
      vi.mocked(repo.updatePoem).mockResolvedValue({
        ...({} as unknown as Poem),
        id: 'p1', topic: 'Animals', title: 'New', lines: 'l', emoji: 'e', source: 'manual',
      });
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/poems/p1',
        headers: adminHeaders(), body: JSON.stringify({ title: 'New' }),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ title: string }>();
      expect(body.title).toBe('New');
      expect(repo.updatePoem).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'New' }));
    });

    it('returns 404 when poem missing', async () => {
      vi.mocked(repo.updatePoem).mockResolvedValue(null);
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/poems/p1',
        headers: adminHeaders(), body: JSON.stringify({ title: 'x' }),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/admin/poems/generate', () => {
    it('rejects invalid topic with 400', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/poems/generate',
        headers: adminHeaders(), body: JSON.stringify({ topic: 'Invalid' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates poem synchronously and returns 201', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/poems/generate',
        headers: adminHeaders(), body: JSON.stringify({ topic: 'Animals' }),
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ poem: { id: string } }>();
      expect(body.poem.id).toBe('poem-x');
    });
  });

  describe('GET /v1/admin/abc', () => {
    it('returns 401 without admin key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/abc' });
      expect(response.statusCode).toBe(401);
    });

    it('returns all lessons sorted', async () => {
      const fake: AbcLesson = {
        id: 'a1', letter: 'A', word: 'Apple', emoji: '🍎',
        phonics: 'ah', miniStory: 's', source: 'manual', updatedAt: new Date(),
      };
      vi.mocked(repo.listAbcLessons).mockResolvedValue([fake]);
      const response = await app.inject({
        method: 'GET', url: '/v1/admin/abc', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: AbcLesson[] }>();
      expect(body.items[0].letter).toBe('A');
    });
  });

  describe('DELETE /v1/admin/abc/:letter', () => {
    it('deletes and returns 200', async () => {
      vi.mocked(repo.deleteAbcLesson).mockResolvedValue(true);
      const response = await app.inject({
        method: 'DELETE', url: '/v1/admin/abc/a', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(repo.deleteAbcLesson).toHaveBeenCalledWith('a');
    });

    it('returns 404 when missing', async () => {
      vi.mocked(repo.deleteAbcLesson).mockResolvedValue(false);
      const response = await app.inject({
        method: 'DELETE', url: '/v1/admin/abc/zz', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /v1/admin/abc/:letter', () => {
    it('updates fields and returns 200', async () => {
      vi.mocked(repo.updateAbcLesson).mockResolvedValue({
        ...({} as unknown as AbcLesson),
        id: 'a1', letter: 'A', word: 'Apple', emoji: '🍎',
        phonics: 'ah', miniStory: 's', source: 'manual',
      });
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/abc/A',
        headers: adminHeaders(), body: JSON.stringify({ word: 'Ant' }),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ word: string }>();
      expect(body.word).toBe('Apple');
      expect(repo.updateAbcLesson).toHaveBeenCalledWith('A', expect.objectContaining({ word: 'Ant' }));
    });

    it('returns 404 when lesson missing', async () => {
      vi.mocked(repo.updateAbcLesson).mockResolvedValue(null);
      const response = await app.inject({
        method: 'PATCH', url: '/v1/admin/abc/Q',
        headers: adminHeaders(), body: JSON.stringify({ word: 'x' }),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/admin/abc/generate', () => {
    it('rejects invalid letter with 400', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/abc/generate',
        headers: adminHeaders(), body: JSON.stringify({ letter: 'AB' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates lesson and returns 201', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/abc/generate',
        headers: adminHeaders(), body: JSON.stringify({ letter: 'a' }),
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ lesson: { letter: string } }>();
      expect(body.lesson.letter).toBe('A');
    });
  });

  describe('GET /v1/admin/jobs', () => {
    it('returns 401 without admin key', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/jobs' });
      expect(response.statusCode).toBe(401);
    });

    it('returns repeatable jobs and counts', async () => {
      const response = await app.inject({
        method: 'GET', url: '/v1/admin/jobs', headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ generate: unknown[]; crawl: unknown[]; counts: { generate: { waiting: number } } }>();
      expect(body.generate).toHaveLength(1);
      expect(body.crawl).toEqual([]);
      expect(body.counts.generate.waiting).toBe(2);
    });
  });

  describe('POST /v1/admin/jobs/trigger', () => {
    it('rejects unknown type with 400', async () => {
      const response = await app.inject({
        method: 'POST', url: '/v1/admin/jobs/trigger',
        headers: adminHeaders(), body: JSON.stringify({ type: 'bogus' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('enqueues each valid type and returns 202', async () => {
      const types = ['pre-generate-stories', 'pre-generate-poems', 'pre-generate-coloring', 'crawl-sweep', 'backfill-corpus'];
      for (const type of types) {
        const response = await app.inject({
          method: 'POST', url: '/v1/admin/jobs/trigger',
          headers: adminHeaders(), body: JSON.stringify({ type }),
        });
        expect(response.statusCode).toBe(202);
        const body = response.json<{ jobId: string }>();
        expect(body.jobId).toBe('job-1');
        expect(generateQueue.add).toHaveBeenCalledWith(type, { type }, expect.objectContaining({ jobId: expect.stringContaining(`admin-${type}`) }));
      }
    });
  });
});

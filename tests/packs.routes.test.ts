import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { ContentPack } from '@prisma/client';

vi.mock('../src/db/pack.repo', () => ({
  listPublishedPacks: vi.fn(),
  getPackBySlug: vi.fn(),
  getDailyPack: vi.fn(),
  incrementPackUsedCount: vi.fn().mockResolvedValue(undefined),
  getClipById: vi.fn(),
  upsertClip: vi.fn(),
}));

import * as repo from '../src/db/pack.repo';
import { authPlugin } from '../src/plugins/auth';
import { packsRoute } from '../src/routes/v1/packs';
import { mediaRoute } from '../src/routes/v1/media';

const API_KEY = 'test-api-key';

function pack(overrides: Partial<ContentPack> = {}): ContentPack {
  return {
    id: 'pack-1',
    slug: 'thirsty-crow',
    kind: 'story',
    schemaVersion: '3.0',
    title: { en: 'The Thirsty Crow', hi: 'प्यासा कौआ' },
    availableLangs: ['en', 'hi'],
    ageBand: 'junior',
    category: 'Moral Stories',
    concepts: ['patience'],
    moral: { en: 'Little by little.', hi: 'थोड़ा-थोड़ा।' },
    estimatedDuration: 180,
    cover: { emoji: '🐦‍⬛', image: 'img_cover', palette: ['#FFCC40'] },
    audio: { narrationSpeed: 1 },
    reward: { stars: 10, coins: 5, badgeStickerId: 'crow' },
    assetManifest: [{ id: 'img_cover', type: 'image', url: 'https://cdn.example.com/cover.png' }],
    moments: [{ id: 'm1' }, { id: 'm2' }],
    topic: null,
    letter: null,
    date: null,
    source: 'seed',
    published: true,
    usedCount: 0,
    version: 3,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  } as ContentPack;
}

function makeRedisStub(): Record<string, unknown> {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

let redis: Record<string, unknown>;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  redis = makeRedisStub();
  app.decorate('redis', redis);
  await app.register(authPlugin);
  await app.register(packsRoute, { prefix: '/v1' });
  await app.register(mediaRoute, { prefix: '/v1' });
  await app.ready();
  return app;
}

function headers(): Record<string, string> {
  return { 'x-api-key': API_KEY };
}

describe('Public pack routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a request with no api key', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/packs?kind=story' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a catalog of summaries, not whole packs', async () => {
    vi.mocked(repo.listPublishedPacks).mockResolvedValue([pack()]);

    const res = await app.inject({ method: 'GET', url: '/v1/packs?kind=story', headers: headers() });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.slug).toBe('thirsty-crow');
    // The cover's manifest id is resolved to a URL so a shelf tile needs no
    // second request.
    expect(item.coverUrl).toBe('https://cdn.example.com/cover.png');
    expect(item.minutes).toBe(3);
    expect(item.version).toBe(3);
    // Summaries must not carry the payload.
    expect(item.assetManifest).toBeUndefined();
    expect(Array.isArray(item.moments)).toBe(false);
  });

  it('rejects an unknown kind', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/packs?kind=songs', headers: headers() });
    expect(res.statusCode).toBe(400);
  });

  it('serves a pack bilingual so the in-player language pill is instant', async () => {
    vi.mocked(repo.getPackBySlug).mockResolvedValue(pack());

    const res = await app.inject({ method: 'GET', url: '/v1/packs/thirsty-crow', headers: headers() });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Record<string, unknown>;
    expect(body.title).toEqual({ en: 'The Thirsty Crow', hi: 'प्यासा कौआ' });
    expect(body.moments).toHaveLength(2);
    // The app caches by slug+version, so version must be on the wire.
    expect(body.version).toBe(3);
  });

  it('caches a served pack under its version', async () => {
    vi.mocked(repo.getPackBySlug).mockResolvedValue(pack());
    await app.inject({ method: 'GET', url: '/v1/packs/thirsty-crow', headers: headers() });
    expect(redis.setex).toHaveBeenCalledWith('pack:thirsty-crow:v3', 3600, expect.any(String));
  });

  it('hides an unpublished pack from the app', async () => {
    vi.mocked(repo.getPackBySlug).mockResolvedValue(pack({ published: false }));
    const res = await app.inject({ method: 'GET', url: '/v1/packs/thirsty-crow', headers: headers() });
    expect(res.statusCode).toBe(404);
  });

  it('returns 503 rather than a wrong pack when a daily pick is missing', async () => {
    vi.mocked(repo.getDailyPack).mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/packs/daily?kind=story&ageBand=junior',
      headers: headers(),
    });
    // The app falls back to its bundled offline pack on this.
    expect(res.statusCode).toBe(503);
  });

  it('counts a daily pick as used so rotation moves on', async () => {
    vi.mocked(repo.getDailyPack).mockResolvedValue(pack());
    const res = await app.inject({
      method: 'GET',
      url: '/v1/packs/daily?kind=story&ageBand=junior',
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.incrementPackUsedCount).toHaveBeenCalledWith('pack-1');
  });
});

describe('Narration media route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const clip = {
    id: 'clip-1',
    bytes: Buffer.from('fake-mp3-bytes'),
    mime: 'audio/mpeg',
  };

  it('serves a clip without an api key — the app streams the URL directly', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue(clip as never);
    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/clip-1.mp3' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    // Clips are immutable — an edited line produces a new id.
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.toString()).toBe('fake-mp3-bytes');
  });

  it('honours If-None-Match so a cached clip is not re-downloaded', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue(clip as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/narration/clip-1.mp3',
      headers: { 'if-none-match': '"clip-1"' },
    });
    expect(res.statusCode).toBe(304);
  });

  it('supports range requests so a player can seek', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue(clip as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/narration/clip-1.mp3',
      headers: { range: 'bytes=0-3' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-3/14');
    expect(res.rawPayload.toString()).toBe('fake');
  });

  it('404s an unknown clip', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/nope.mp3' });
    expect(res.statusCode).toBe(404);
  });
});

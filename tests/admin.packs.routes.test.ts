import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentPack } from '@prisma/client';

vi.mock('../src/db/pack.repo', () => ({
  listPacks: vi.fn(),
  getPackById: vi.fn(),
  createPack: vi.fn(),
  replacePack: vi.fn(),
  updatePackMeta: vi.fn(),
  setPackPublished: vi.fn(),
  deletePack: vi.fn(),
  listClipsForPack: vi.fn().mockResolvedValue([]),
  getClipById: vi.fn(),
  upsertClip: vi.fn(),
}));

vi.mock('../src/jobs/queue', () => ({
  generateQueue: { add: vi.fn().mockResolvedValue({ id: 'job-narrate-1' }) },
  crawlQueue: { add: vi.fn() },
  queueConnection: {},
}));

import * as repo from '../src/db/pack.repo';
import { generateQueue } from '../src/jobs/queue';
import { authPlugin } from '../src/plugins/auth';
import { adminPacksRoute } from '../src/routes/v1/admin.packs';

const ADMIN_KEY = 'test-admin-key';
const SEED_DIR = join(__dirname, '..', 'prisma', 'seed-data');

function crowDoc(): Record<string, unknown> {
  const raw = JSON.parse(
    readFileSync(join(SEED_DIR, 'pack_thirsty_crow.json'), 'utf8'),
  ) as Record<string, unknown>;
  raw.kind = 'story';
  return raw;
}

function crowRow(overrides: Partial<ContentPack> = {}): ContentPack {
  const doc = crowDoc();
  return {
    id: 'pack-1',
    slug: doc.slug,
    kind: 'story',
    schemaVersion: '3.0',
    title: doc.title,
    availableLangs: doc.availableLangs,
    ageBand: doc.ageBand,
    category: doc.category,
    concepts: doc.concepts,
    moral: doc.moral,
    estimatedDuration: doc.estimatedDuration,
    cover: doc.cover,
    audio: doc.audio,
    reward: doc.reward,
    assetManifest: doc.assetManifest,
    moments: doc.moments,
    topic: null,
    letter: null,
    date: null,
    source: 'seed',
    published: true,
    usedCount: 0,
    version: 2,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  } as ContentPack;
}

let redis: Record<string, unknown>;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  redis = {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
  app.decorate('redis', redis);
  await app.register(authPlugin);
  await app.register(adminPacksRoute, { prefix: '/v1' });
  await app.ready();
  return app;
}

function adminHeaders(): Record<string, string> {
  return { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };
}

describe('Admin pack routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(repo.listClipsForPack).mockResolvedValue([]);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('auth', () => {
    const routes: [string, string][] = [
      ['GET', '/v1/admin/packs'],
      ['GET', '/v1/admin/packs/pack-1'],
      ['POST', '/v1/admin/packs'],
      ['PUT', '/v1/admin/packs/pack-1'],
      ['PATCH', '/v1/admin/packs/pack-1'],
      ['PATCH', '/v1/admin/packs/pack-1/publish'],
      ['DELETE', '/v1/admin/packs/pack-1'],
      ['POST', '/v1/admin/packs/pack-1/moments/reorder'],
      ['POST', '/v1/admin/packs/pack-1/narrate'],
      ['GET', '/v1/admin/packs/pack-1/clips'],
      ['POST', '/v1/admin/packs/import'],
    ];

    it.each(routes)('%s %s returns 401 without the admin key', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  it('lists packs with the authoring state an editor triages by', async () => {
    vi.mocked(repo.listPacks).mockResolvedValue([crowRow()]);
    vi.mocked(repo.listClipsForPack).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` })) as never,
    );

    const res = await app.inject({ method: 'GET', url: '/v1/admin/packs', headers: adminHeaders() });
    expect(res.statusCode).toBe(200);

    const item = (res.json() as { items: Record<string, unknown>[] }).items[0];
    expect(item.id).toBe('pack-1');
    expect(item.published).toBe(true);
    expect(item.assets).toBe(9);
    expect(item.missingArt).toBe(0);
    expect(item.clips).toBe(6);
    // 8 moments × 2 languages.
    expect(item.expectedClips).toBe(16);
  });

  it('flags moments whose picture is missing so the list shows the gap', async () => {
    const row = crowRow();
    const moments = row.moments as Record<string, unknown>[];
    (moments[0].visual as Record<string, unknown>).asset = 'img_gone';

    vi.mocked(repo.listPacks).mockResolvedValue([row]);
    const res = await app.inject({ method: 'GET', url: '/v1/admin/packs', headers: adminHeaders() });
    expect((res.json() as { items: Record<string, unknown>[] }).items[0].missingArt).toBe(1);
  });

  it('saves a valid full document and bumps the cache version', async () => {
    const row = crowRow();
    vi.mocked(repo.getPackById).mockResolvedValue(row);
    vi.mocked(repo.replacePack).mockResolvedValue({ ...row, version: 3 });

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/packs/pack-1',
      headers: adminHeaders(),
      payload: crowDoc(),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.replacePack).toHaveBeenCalledOnce();
    // Cached copies are dropped so the edit is live on the next app fetch.
    expect(redis.del).toHaveBeenCalled();
  });

  it('refuses a save whose moment points at a missing picture', async () => {
    vi.mocked(repo.getPackById).mockResolvedValue(crowRow());

    const doc = crowDoc();
    const moments = doc.moments as Record<string, unknown>[];
    (moments[1].visual as Record<string, unknown>).asset = 'img_typo';

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/packs/pack-1',
      headers: adminHeaders(),
      payload: doc,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('img_typo');
    expect(repo.replacePack).not.toHaveBeenCalled();
  });

  it('never publishes as a side effect of a content save', async () => {
    const row = crowRow({ published: false });
    vi.mocked(repo.getPackById).mockResolvedValue(row);
    vi.mocked(repo.replacePack).mockResolvedValue(row);

    await app.inject({
      method: 'PUT',
      url: '/v1/admin/packs/pack-1',
      headers: adminHeaders(),
      payload: { ...crowDoc(), published: true },
    });

    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    expect(saved.published).toBe(false);
  });

  it('re-validates before publishing so a broken draft cannot go live', async () => {
    const row = crowRow({ published: false });
    const moments = row.moments as Record<string, unknown>[];
    (moments[0].visual as Record<string, unknown>).asset = 'img_missing';
    vi.mocked(repo.getPackById).mockResolvedValue(row);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/packs/pack-1/publish',
      headers: adminHeaders(),
      payload: { published: true },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.setPackPublished).not.toHaveBeenCalled();
  });

  it('lets a broken draft be UNpublished without re-validating', async () => {
    const row = crowRow();
    const moments = row.moments as Record<string, unknown>[];
    (moments[0].visual as Record<string, unknown>).asset = 'img_missing';
    vi.mocked(repo.getPackById).mockResolvedValue(row);
    vi.mocked(repo.setPackPublished).mockResolvedValue({ ...row, published: false });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/packs/pack-1/publish',
      headers: adminHeaders(),
      payload: { published: false },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reorders moments from an id list', async () => {
    const row = crowRow();
    vi.mocked(repo.getPackById).mockResolvedValue(row);
    vi.mocked(repo.replacePack).mockResolvedValue(row);

    const ids = (row.moments as Record<string, unknown>[]).map((m) => String(m.id));
    const swapped = [ids[1], ids[0], ...ids.slice(2)];

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/packs/pack-1/moments/reorder',
      headers: adminHeaders(),
      payload: { order: swapped },
    });
    expect(res.statusCode).toBe(200);

    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    const savedIds = (saved.moments as unknown as Record<string, unknown>[]).map((m) => String(m.id));
    expect(savedIds).toEqual(swapped);
  });

  it('rejects a reorder that would drop or duplicate a moment', async () => {
    const row = crowRow();
    vi.mocked(repo.getPackById).mockResolvedValue(row);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/packs/pack-1/moments/reorder',
      headers: adminHeaders(),
      payload: { order: ['m1', 'm2'] },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.replacePack).not.toHaveBeenCalled();
  });

  it('queues narration instead of holding the request open', async () => {
    vi.mocked(repo.getPackById).mockResolvedValue(crowRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/packs/pack-1/narrate',
      headers: adminHeaders(),
      payload: { langs: ['en'], force: true },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: 'job-narrate-1' });
    expect(generateQueue.add).toHaveBeenCalledWith(
      'narrate-pack',
      expect.objectContaining({ type: 'narrate-pack', packId: 'pack-1', langs: ['en'], force: true }),
      expect.anything(),
    );
  });

  it('imports a pasted pack unpublished, for review', async () => {
    vi.mocked(repo.getPackById).mockResolvedValue(null);
    vi.mocked(repo.createPack).mockResolvedValue(crowRow({ published: false }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/packs/import',
      headers: adminHeaders(),
      payload: crowDoc(),
    });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(repo.createPack).mock.calls[0][0].published).toBe(false);
  });

  it('refuses an import that would collide with an existing slug', async () => {
    vi.mocked(repo.getPackById).mockResolvedValue(crowRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/packs/import',
      headers: adminHeaders(),
      payload: crowDoc(),
    });
    expect(res.statusCode).toBe(409);
  });
});

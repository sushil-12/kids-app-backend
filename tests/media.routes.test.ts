import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../src/db/pack.repo', () => ({
  getClipById: vi.fn(),
  upsertClip: vi.fn(),
  createMediaAsset: vi.fn(),
  listMediaAssets: vi.fn(),
  getMediaAsset: vi.fn(),
  deleteMediaAsset: vi.fn(),
  packsUsingUrl: vi.fn().mockResolvedValue([]),
}));

const presignUpload = vi.fn();
const deleteObject = vi.fn();
const getNarration = vi.fn();
let canUpload = true;

vi.mock('../src/services/media.store', () => ({
  UPLOADABLE_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  mediaStore: {
    get canUpload() {
      return canUpload;
    },
    presignUpload: (...args: unknown[]) => presignUpload(...args),
    deleteObject: (...args: unknown[]) => deleteObject(...args),
    getNarration: (...args: unknown[]) => getNarration(...args),
    narrationUrl: (id: string) => `https://api.test.local/v1/media/narration/${id}.mp3`,
    putNarration: vi.fn(),
  },
}));

import * as repo from '../src/db/pack.repo';
import { authPlugin } from '../src/plugins/auth';
import { mediaRoute } from '../src/routes/v1/media';

const ADMIN = { 'x-admin-key': 'test-admin-key', 'Content-Type': 'application/json' };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin);
  await app.register(mediaRoute, { prefix: '/v1' });
  await app.ready();
  return app;
}

describe('Narration playback', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    canUpload = true;
    app = await buildApp();
  });
  afterEach(async () => app.close());

  it('serves an inline clip without an api key — the app streams it directly', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue({ id: 'c1', bytes: Buffer.from('abc') } as never);
    getNarration.mockResolvedValue({ bytes: Buffer.from('abc'), mime: 'audio/mpeg' });

    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/c1.mp3' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.toString()).toBe('abc');
  });

  it('redirects a bucket-backed clip to the CDN instead of proxying bytes', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue({
      id: 'c2',
      bytes: null,
      url: 'https://cdn.example.com/narration/abc.mp3',
    } as never);

    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/c2.mp3' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://cdn.example.com/narration/abc.mp3');
    // The bytes must not have been fetched just to redirect.
    expect(getNarration).not.toHaveBeenCalled();
  });

  it('still serves a clip recorded before S3 was switched on', async () => {
    // Inline bytes AND a url would be ambiguous; inline wins, because that
    // clip predates the bucket and its object may not exist.
    vi.mocked(repo.getClipById).mockResolvedValue({
      id: 'c3',
      bytes: Buffer.from('legacy'),
      url: null,
    } as never);
    getNarration.mockResolvedValue({ bytes: Buffer.from('legacy'), mime: 'audio/mpeg' });

    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/c3.mp3' });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('legacy');
  });

  it('404s an unknown clip', async () => {
    vi.mocked(repo.getClipById).mockResolvedValue(null);
    getNarration.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/v1/media/narration/nope.mp3' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Artwork uploads', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    canUpload = true;
    app = await buildApp();
  });
  afterEach(async () => app.close());

  it('requires the admin key on every upload route', async () => {
    for (const [method, url] of [
      ['GET', '/v1/admin/media/config'],
      ['POST', '/v1/admin/media/presign'],
      ['POST', '/v1/admin/media'],
      ['GET', '/v1/admin/media'],
      ['DELETE', '/v1/admin/media/x'],
    ] as [string, string][]) {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('tells the portal whether uploads are available', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/media/config', headers: ADMIN });
    expect(res.json()).toMatchObject({ uploadsEnabled: true, maxUploadMb: expect.any(Number) });
  });

  it('presigns a PUT the browser sends straight to S3', async () => {
    presignUpload.mockResolvedValue({
      uploadUrl: 'https://bucket.s3.amazonaws.com/key?sig=…',
      publicUrl: 'https://cdn.example.com/key.png',
      storageKey: 'brightmind/images/packs/key.png',
      expiresInSeconds: 900,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/presign',
      headers: ADMIN,
      payload: { filename: 'crow.png', mime: 'image/png', byteLength: 2048, folder: 'thirsty-crow' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ publicUrl: 'https://cdn.example.com/key.png' });
  });

  it('refuses a file type that is not an image', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/presign',
      headers: ADMIN,
      payload: { filename: 'x.exe', mime: 'application/x-msdownload', byteLength: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('refuses a file over the size cap before signing anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/presign',
      headers: ADMIN,
      payload: { filename: 'huge.png', mime: 'image/png', byteLength: 999 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(413);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('explains itself instead of failing silently when S3 is off', async () => {
    canUpload = false;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/media/presign',
      headers: ADMIN,
      payload: { filename: 'a.png', mime: 'image/png', byteLength: 10 },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('S3_BUCKET');
  });

  it('registers an upload so the picture joins the reusable library', async () => {
    vi.mocked(repo.createMediaAsset).mockResolvedValue({ id: 'a1' } as never);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      headers: ADMIN,
      payload: {
        storageKey: 'brightmind/images/packs/a.png',
        url: 'https://cdn.example.com/a.png',
        mime: 'image/png',
        byteLength: 1024,
        originalName: 'a.png',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(vi.mocked(repo.createMediaAsset).mock.calls[0][0].folder).toBe('packs');
  });

  it('refuses to delete a picture a pack still points at', async () => {
    vi.mocked(repo.getMediaAsset).mockResolvedValue({
      id: 'a1',
      url: 'https://cdn.example.com/a.png',
      storageKey: 'k',
    } as never);
    vi.mocked(repo.packsUsingUrl).mockResolvedValue([{ slug: 'thirsty-crow' }]);

    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/media/a1', headers: ADMIN });
    // A blank scene in front of a child is the thing this prevents.
    expect(res.statusCode).toBe(409);
    expect(res.json().packs).toEqual(['thirsty-crow']);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('deletes an in-use picture when explicitly forced', async () => {
    vi.mocked(repo.getMediaAsset).mockResolvedValue({
      id: 'a1',
      url: 'https://cdn.example.com/a.png',
      storageKey: 'k',
    } as never);
    vi.mocked(repo.packsUsingUrl).mockResolvedValue([{ slug: 'thirsty-crow' }]);
    vi.mocked(repo.deleteMediaAsset).mockResolvedValue(true);

    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/media/a1?force=true',
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    // Both the bucket object and the row go.
    expect(deleteObject).toHaveBeenCalledWith('k');
    expect(repo.deleteMediaAsset).toHaveBeenCalledWith('a1');
  });
});

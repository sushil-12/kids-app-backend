import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createMediaAsset,
  deleteMediaAsset,
  getClipById,
  getMediaAsset,
  listMediaAssets,
  packsUsingUrl,
} from '../../db/pack.repo';
import { mediaStore, UPLOADABLE_IMAGE_TYPES } from '../../services/media.store';
import { giphyService, GifImportRejected } from '../../services/giphy.service';
import { config } from '../../config';

// Media: serving recorded narration, and the artwork upload flow.
//
// ── Serving narration ────────────────────────────────────────────────────
// Deliberately UNAUTHENTICATED, unlike every other content route. These URLs
// are embedded inside packs and played by the app's audio player, which streams
// them directly and can't reliably attach an `x-api-key` header on either
// platform. Ids are cuids, so a clip URL is unguessable, and the payload is a
// few seconds of a children's story being read aloud — nothing personal, no
// per-child data, nothing that identifies a listener.
//
// Clips are immutable: editing a narration line produces a NEW clip (the
// content hash changes), so these can be cached forever by the app, by any CDN
// in front of this API, and by the on-device file cache.
//
// ── Uploading artwork ────────────────────────────────────────────────────
// Bytes never pass through this API. The portal asks for a presigned PUT and
// sends the file straight to S3, then registers the result here. That keeps a
// 15 MB illustration out of the server's memory entirely, and means an upload
// doesn't compete with request handling.

const IMMUTABLE = 'public, max-age=31536000, immutable';

const presignSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.enum(UPLOADABLE_IMAGE_TYPES),
  byteLength: z.number().int().positive(),
  folder: z.string().max(60).optional(),
});

const gifSearchSchema = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const gifImportSchema = z.object({
  /** The `importUrl` from a search result. Re-validated against the host
   *  allowlist in the service — this endpoint takes a URL, so it is never
   *  trusted just because it came back from our own search. */
  url: z.string().url(),
  /** Library name for the imported file. Defaults to Giphy's own slug. */
  name: z.string().min(1).max(200).optional(),
  folder: z.string().max(60).optional(),
});

const registerSchema = z.object({
  storageKey: z.string().min(1),
  url: z.string().url(),
  mime: z.string().min(1),
  byteLength: z.number().int().positive(),
  originalName: z.string().min(1).max(200),
  folder: z.string().max(60).optional(),
});

export const mediaRoute: FastifyPluginAsync = async (fastify) => {
  // ── Narration playback ──────────────────────────────────────────────────

  fastify.get<{ Params: { file: string } }>(
    '/media/narration/:file',
    async (request, reply) => {
      // The `.mp3` suffix is cosmetic — it's there so the URL looks like a file
      // to players and CDNs that sniff extensions.
      const id = request.params.file.replace(/\.mp3$/i, '');

      // A bucket-backed clip is redirected rather than proxied: the CDN should
      // serve the bytes, not this process. Packs published before S3 was
      // switched on still point here, which is exactly why the redirect exists.
      const clip = await getClipById(id);
      if (clip?.url && !clip.bytes) {
        return reply
          .headers({ 'cache-control': IMMUTABLE })
          .redirect(clip.url, 302);
      }

      const stored = await mediaStore.getNarration(id);
      if (!stored) return reply.code(404).send({ error: 'Clip not found' });

      const etag = `"${id}"`;
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).headers({ etag, 'cache-control': IMMUTABLE }).send();
      }

      const total = stored.bytes.length;
      const range = request.headers.range;

      // Range support so a player can seek without re-downloading the clip.
      if (typeof range === 'string') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? parseInt(match[2], 10) : total - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
            return reply.code(416).header('content-range', `bytes */${total}`).send();
          }
          const slice = stored.bytes.subarray(start, Math.min(end, total - 1) + 1);
          return reply
            .code(206)
            .headers({
              'content-type': stored.mime,
              'content-length': String(slice.length),
              'content-range': `bytes ${start}-${Math.min(end, total - 1)}/${total}`,
              'accept-ranges': 'bytes',
              'cache-control': IMMUTABLE,
              etag,
            })
            .send(slice);
        }
      }

      return reply
        .headers({
          'content-type': stored.mime,
          'content-length': String(total),
          'accept-ranges': 'bytes',
          'cache-control': IMMUTABLE,
          etag,
        })
        .send(stored.bytes);
    },
  );

  // ── Artwork uploads (admin) ─────────────────────────────────────────────

  /** Tells the portal whether to show an upload button or paste-a-URL only. */
  fastify.get(
    '/admin/media/config',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) =>
      reply.send({
        uploadsEnabled: mediaStore.canUpload,
        maxUploadMb: config.MEDIA_MAX_UPLOAD_MB,
        acceptedTypes: UPLOADABLE_IMAGE_TYPES,
        // Both must be true for the "Find a GIF" tab: a key to search with, and
        // somewhere to copy the result to.
        gifSearchEnabled: giphyService.isConfigured && mediaStore.canUpload,
        maxGifImportMb: config.GIF_MAX_IMPORT_MB,
      }),
  );

  // ── Animated art (admin) ────────────────────────────────────────────────
  // Searching Giphy and copying the picked clip into our own bucket. See
  // services/giphy.service.ts for why the boundary is an adult rather than
  // Giphy's own content rating, and why we never hotlink.

  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/admin/media/gif-search',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      if (!giphyService.isConfigured) {
        return reply.code(503).send({
          error: 'GIF search is off — set GIPHY_API_KEY, or upload an animated GIF instead.',
        });
      }
      const parsed = gifSearchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      try {
        const items = await giphyService.search(parsed.data.q, parsed.data.limit);
        return reply.send({ items });
      } catch (err) {
        // A search that fails upstream is not a server fault the admin can act
        // on; report it as an unavailable dependency, not a 500.
        request.log.error({ err }, 'giphy search failed');
        return reply.code(502).send({ error: 'Could not reach GIF search. Try again.' });
      }
    },
  );

  fastify.post<{ Body: Record<string, unknown> }>(
    '/admin/media/gif-import',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      if (!mediaStore.canUpload) {
        return reply.code(503).send({
          error:
            'Importing needs somewhere to store the file — set S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
        });
      }
      const parsed = gifImportSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      let downloaded: Awaited<ReturnType<typeof giphyService.fetchForImport>>;
      try {
        downloaded = await giphyService.fetchForImport(parsed.data.url);
      } catch (err) {
        // Every rejection here is something the admin chose — a wrong host, an
        // oversized clip — so it comes back as a readable 400, not a 500.
        if (err instanceof GifImportRejected) {
          return reply.code(400).send({ error: err.message });
        }
        request.log.error({ err }, 'gif import failed');
        return reply.code(502).send({ error: 'Could not download that clip. Try another.' });
      }

      const stored = await mediaStore.putImage({
        bytes: downloaded.bytes,
        mime: downloaded.mime,
        filename: parsed.data.name ?? downloaded.filename,
        folder: parsed.data.folder ?? 'rhymes',
      });

      // Registered like any uploaded picture, so it shows up in the same
      // library and the same delete-protection applies.
      const asset = await createMediaAsset({
        storageKey: stored.storageKey,
        url: stored.url,
        mime: stored.mime,
        byteLength: stored.byteLength,
        originalName: parsed.data.name ?? downloaded.filename,
        folder: parsed.data.folder ?? 'rhymes',
      });
      return reply.code(201).send(asset);
    },
  );

  fastify.post<{ Body: Record<string, unknown> }>(
    '/admin/media/presign',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      if (!mediaStore.canUpload) {
        return reply.code(503).send({
          error:
            'Uploads are off — set S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or paste an image URL instead.',
        });
      }

      const parsed = presignSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const maxBytes = config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024;
      if (parsed.data.byteLength > maxBytes) {
        return reply.code(413).send({
          error: `That file is larger than the ${config.MEDIA_MAX_UPLOAD_MB} MB limit.`,
        });
      }

      const signed = await mediaStore.presignUpload(parsed.data);
      return reply.send(signed);
    },
  );

  /** Called by the portal once the PUT to S3 succeeded, so the picture joins
   *  the reusable library. A failed upload simply never registers. */
  fastify.post<{ Body: Record<string, unknown> }>(
    '/admin/media',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const asset = await createMediaAsset({
        ...parsed.data,
        folder: parsed.data.folder ?? 'packs',
      });
      return reply.code(201).send(asset);
    },
  );

  fastify.get<{ Querystring: { folder?: string; search?: string; limit?: string } }>(
    '/admin/media',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const items = await listMediaAssets({
        folder: request.query.folder,
        search: request.query.search,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      });
      return reply.send({ items });
    },
  );

  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/admin/media/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const asset = await getMediaAsset(request.params.id);
      if (!asset) return reply.code(404).send({ error: 'Not found' });

      // Deleting a picture a published pack still points at would show children
      // a blank scene, so it takes a deliberate second attempt.
      if (request.query.force !== 'true') {
        const used = await packsUsingUrl(asset.url);
        if (used.length > 0) {
          return reply.code(409).send({
            error: `Still used by ${used.map((p) => p.slug).join(', ')}`,
            packs: used.map((p) => p.slug),
          });
        }
      }

      await mediaStore.deleteObject(asset.storageKey);
      await deleteMediaAsset(asset.id);
      return reply.send({ ok: true });
    },
  );
};

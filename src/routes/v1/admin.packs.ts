import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { ContentPack, Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  listPacks,
  getPackById,
  createPack,
  replacePack,
  updatePackMeta,
  setPackPublished,
  deletePack,
  listClipsForPack,
  ContentPackInput,
} from '../../db/pack.repo';
import { generateQueue } from '../../jobs/queue';
import { validatePack, PACK_KINDS, PACK_LANGS, PackDoc } from '../../services/pack.schema';
import { serializePack, serializePackAdminRow } from '../../services/pack.serialize';
import { mediaStore } from '../../services/media.store';
import { packCacheKey, catalogCacheKey } from './packs';

// Authoring API for content packs — the JSON surface behind the admin portal.
//
// The whole point of this file is that a non-engineer can change what children
// see: swap a picture (paste a new URL), reorder or reword a scene, and
// regenerate the voice-over, all without an app release.
//
// Two rules every write follows:
//   1. It is validated against src/services/pack.schema.ts. Content that would
//      render blank or crash the player is rejected here, in front of the
//      person who can fix it, not silently degraded in front of a child.
//   2. It bumps `version` and drops the Redis keys, so the edit is live on the
//      next app fetch rather than up to an hour later.
//
// Content writes always go through the full-document PUT so nothing bypasses
// validation; PATCH is metadata only.

/** Everything a moment/asset edit touches. Validated as a whole document. */
const packBodySchema = z.record(z.unknown());

const patchMetaSchema = z.object({
  ageBand: z.enum(['junior', 'senior']).optional(),
  category: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.string().min(1).optional(),
  published: z.boolean().optional(),
});

const publishSchema = z.object({ published: z.boolean() });

const reorderSchema = z.object({
  /** The moment ids in their new order. Must be a permutation of the pack's. */
  order: z.array(z.string().min(1)).min(1),
});

const narrateSchema = z.object({
  langs: z.array(z.enum(PACK_LANGS)).optional(),
  force: z.boolean().optional(),
  momentIds: z.array(z.string().min(1)).optional(),
});

const listQuerySchema = z.object({
  kind: z.enum(PACK_KINDS).optional(),
  ageBand: z.enum(['junior', 'senior']).optional(),
  published: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

/** Maps a validated document to the row shape, filling the same defaults the
 *  app applies when a field is absent so list views and filters aren't full of
 *  nulls. The moments/manifest go in verbatim — see pack.schema.ts. */
function toRow(doc: PackDoc, raw: Record<string, unknown>): ContentPackInput {
  return {
    slug: doc.slug,
    kind: doc.kind,
    schemaVersion: '3.0',
    title: raw.title as ContentPackInput['title'],
    availableLangs: (doc.availableLangs ?? ['en']) as ContentPackInput['availableLangs'],
    ageBand: doc.ageBand ?? 'junior',
    category: doc.category ?? 'Moral Stories',
    concepts: (doc.concepts ?? []) as ContentPackInput['concepts'],
    moral: (raw.moral ?? '') as ContentPackInput['moral'],
    estimatedDuration: doc.estimatedDuration ?? 150,
    cover: (raw.cover ?? { emoji: '📖' }) as ContentPackInput['cover'],
    audio: (raw.audio ?? {}) as ContentPackInput['audio'],
    reward: (raw.reward ?? { stars: 10, coins: 5, badgeStickerId: 'star' }) as ContentPackInput['reward'],
    assetManifest: (raw.assetManifest ?? []) as ContentPackInput['assetManifest'],
    moments: raw.moments as ContentPackInput['moments'],
    topic: doc.topic ?? null,
    letter: doc.letter ?? null,
    // Verbatim like moments/manifest — the app is the lenient reader, and the
    // clip URLs the narration job writes back live in here.
    letterSpec: (raw.letterSpec ?? Prisma.DbNull) as ContentPackInput['letterSpec'],
    date: doc.date ?? null,
    source: doc.source ?? 'manual',
    published: false,
  };
}

/** Drops every cached copy of a pack so an edit is visible immediately.
 *  The version bump alone would eventually do it, but the catalog is cached by
 *  kind+band, not by version, and would otherwise serve a stale cover for an
 *  hour. Cheap insurance on a low-write, high-read table. */
async function invalidate(fastify: FastifyInstance, pack: ContentPack): Promise<void> {
  const keys = [
    packCacheKey(pack.slug, pack.version),
    // The bumped version is what the app will ask for next; clear both so a
    // pre-bump read that raced this write can't leave a stale entry behind.
    packCacheKey(pack.slug, pack.version + 1),
    catalogCacheKey(pack.kind, pack.ageBand),
    catalogCacheKey(pack.kind, 'all'),
  ];
  await Promise.all(keys.map((k) => fastify.redis.del(k)));
}

async function adminRow(pack: ContentPack): Promise<Record<string, unknown>> {
  const clips = await listClipsForPack(pack.id);
  return serializePackAdminRow(pack, clips.length);
}

export const adminPacksRoute: FastifyPluginAsync = async (fastify) => {
  // --- List / read ---

  fastify.get<{ Querystring: Record<string, string> }>(
    '/admin/packs',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const q = parsed.data;

      const packs = await listPacks({
        kind: q.kind,
        ageBand: q.ageBand,
        published: q.published === undefined ? undefined : q.published === 'true',
        search: q.search,
        limit: q.limit,
        offset: q.offset,
      });
      const items = await Promise.all(packs.map(adminRow));
      return reply.send({ items });
    },
  );

  // The full document, for the editor. Unlike the public route this ignores
  // `published`, so a draft can be authored and previewed before it goes live.
  fastify.get<{ Params: { id: string } }>(
    '/admin/packs/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const pack = await getPackById(request.params.id);
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });
      const clips = await listClipsForPack(pack.id);
      return reply.send({
        ...serializePack(pack),
        published: pack.published,
        clips: clips.map((c) => ({
          id: c.id,
          momentId: c.momentId,
          lang: c.lang,
          kind: c.kind,
          bytes: c.byteLength,
          url: mediaStore.narrationUrl(c.id),
          createdAt: c.createdAt,
        })),
      });
    },
  );

  // --- Create / replace ---

  fastify.post<{ Body: Record<string, unknown> }>(
    '/admin/packs',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = packBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const result = validatePack(body.data);
      if (!result.ok) return reply.code(400).send({ error: result.errors });

      const existing = await getPackById(result.data.slug);
      if (existing) return reply.code(409).send({ error: `slug "${result.data.slug}" already exists` });

      const pack = await createPack(toRow(result.data, body.data));
      await invalidate(fastify, pack);
      return reply.code(201).send(await adminRow(pack));
    },
  );

  // Full-document save from the editor: moments, assets, metadata, all at once.
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/packs/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      const body = packBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const result = validatePack({ ...body.data, kind: body.data.kind ?? existing.kind });
      if (!result.ok) return reply.code(400).send({ error: result.errors });

      // Publishing is its own endpoint so a content save can never accidentally
      // push a half-finished draft live.
      const row = { ...toRow(result.data, body.data), published: existing.published };
      const pack = await replacePack(existing.id, row);
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });
      await invalidate(fastify, pack);
      return reply.send(await adminRow(pack));
    },
  );

  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/packs/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = patchMetaSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      const pack = await updatePackMeta(existing.id, parsed.data);
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });
      await invalidate(fastify, pack);
      return reply.send(await adminRow(pack));
    },
  );

  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/packs/:id/publish',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = publishSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      // Re-validate before going live: a pack can be saved as a draft with a
      // picture still missing, but it must be whole before children see it.
      if (parsed.data.published) {
        const check = validatePack(serializePack(existing));
        if (!check.ok) return reply.code(400).send({ error: check.errors });
      }

      const pack = await setPackPublished(existing.id, parsed.data.published);
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });
      await invalidate(fastify, pack);
      return reply.send(await adminRow(pack));
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/admin/packs/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });
      await invalidate(fastify, existing);
      // Clips cascade with the pack (schema.prisma onDelete: Cascade).
      const ok = await deletePack(existing.id);
      if (!ok) return reply.code(404).send({ error: 'Pack not found' });
      return reply.send({ ok: true });
    },
  );

  // --- Moment reordering ---
  // A convenience over PUT for the editor's drag-to-reorder rail: it sends only
  // the new id order, so a reorder can't accidentally clobber a concurrent
  // narration write into the same moments.
  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/packs/:id/moments/reorder',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      const moments = Array.isArray(existing.moments)
        ? (existing.moments as Record<string, unknown>[])
        : [];
      const byId = new Map(moments.map((m) => [String(m.id ?? ''), m]));
      const { order } = parsed.data;

      if (order.length !== moments.length || order.some((id) => !byId.has(id))) {
        return reply.code(400).send({
          error: 'order must list every moment id in the pack exactly once',
        });
      }

      const doc = serializePack(existing);
      const next = { ...doc, moments: order.map((id) => byId.get(id)!) };
      const result = validatePack(next);
      if (!result.ok) return reply.code(400).send({ error: result.errors });

      const pack = await replacePack(existing.id, {
        ...toRow(result.data, next as Record<string, unknown>),
        published: existing.published,
      });
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });
      await invalidate(fastify, pack);
      return reply.send(await adminRow(pack));
    },
  );

  // --- Narration ---

  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/packs/:id/narrate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = narrateSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      // Queued, not awaited: a bilingual 8-moment story is 16 ElevenLabs calls
      // and can take minutes. The editor polls GET /admin/packs/:id/clips.
      const job = await generateQueue.add(
        'narrate-pack',
        { type: 'narrate-pack', packId: existing.id, ...parsed.data },
        { jobId: `narrate-${existing.slug}-${Date.now()}` },
      );
      return reply.code(202).send({ jobId: job.id });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/admin/packs/:id/clips',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const existing = await getPackById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Pack not found' });

      const clips = await listClipsForPack(existing.id);
      const moments = Array.isArray(existing.moments)
        ? (existing.moments as Record<string, unknown>[])
        : [];
      const langs = Array.isArray(existing.availableLangs)
        ? (existing.availableLangs as string[])
        : ['en'];

      return reply.send({
        items: clips.map((c) => ({
          id: c.id,
          momentId: c.momentId,
          lang: c.lang,
          kind: c.kind,
          bytes: c.byteLength,
          url: mediaStore.narrationUrl(c.id),
          createdAt: c.createdAt,
        })),
        expected: moments.length * langs.length,
      });
    },
  );

  // --- Import ---
  // Paste a v3 pack JSON (e.g. the bundled thirsty-crow sample, or a pack
  // exported from another environment). Lands unpublished for review.
  fastify.post<{ Body: Record<string, unknown> }>(
    '/admin/packs/import',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = packBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const doc = { kind: 'story', ...body.data, source: 'import' };
      const result = validatePack(doc);
      if (!result.ok) return reply.code(400).send({ error: result.errors });

      const existing = await getPackById(result.data.slug);
      if (existing) {
        return reply.code(409).send({
          error: `slug "${result.data.slug}" already exists — delete it first or change the slug`,
        });
      }

      const pack = await createPack(toRow(result.data, doc));
      await invalidate(fastify, pack);
      return reply.code(201).send(await adminRow(pack));
    },
  );
};

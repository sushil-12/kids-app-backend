import { FastifyPluginAsync } from 'fastify';
import {
  listPublishedPacks,
  getPackBySlug,
  getDailyPack,
  incrementPackUsedCount,
} from '../../db/pack.repo';
import { serializePack, serializePackSummary } from '../../services/pack.serialize';
import { PACK_KINDS, PACK_AGE_BANDS, PackKind } from '../../services/pack.schema';

// The app-facing content API. Every Learn screen — cinematic stories, poems,
// ABC letters — reads from here, so changing a picture or a scene in the admin
// portal reaches children without an app release.
//
// Cache policy: packs change rarely and are read constantly, so both endpoints
// cache in Redis for an hour keyed by the pack's `version`. Admin writes bump
// the version AND delete these keys (see admin.packs.ts), so an edit is live
// immediately rather than up to an hour later.

const CATALOG_TTL_SECONDS = 3600;
const PACK_TTL_SECONDS = 3600;

export function packCacheKey(slug: string, version: number): string {
  return `pack:${slug}:v${version}`;
}

export function catalogCacheKey(kind: string, ageBand: string): string {
  return `packs:${kind}:${ageBand}`;
}

function isKind(v: string): v is PackKind {
  return (PACK_KINDS as readonly string[]).includes(v);
}

export const packsRoute: FastifyPluginAsync = async (fastify) => {
  // Catalog for one Learn surface. The app builds its story shelf, poem topic
  // list and A–Z grid from this instead of hardcoded Dart lists.
  fastify.get<{ Querystring: { kind?: string; ageBand?: string } }>(
    '/packs',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const kind = request.query.kind ?? 'story';
      if (!isKind(kind)) {
        return reply.code(400).send({ error: `kind must be one of: ${PACK_KINDS.join(', ')}` });
      }
      // ABC and poems are age-agnostic; only stories are banded.
      const ageBand = request.query.ageBand;
      if (ageBand && !(PACK_AGE_BANDS as readonly string[]).includes(ageBand)) {
        return reply.code(400).send({ error: 'ageBand must be "junior" or "senior"' });
      }

      const cacheKey = catalogCacheKey(kind, ageBand ?? 'all');
      const cached = await fastify.redis.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached) as unknown);

      const packs = await listPublishedPacks({ kind, ageBand });
      const items = packs.map(serializePackSummary);
      // Letters ship in TEACHING order (s-a-t-p-i-n), not alphabetical: those
      // first six build more real three-letter words than any other six, so a
      // child blends a word on day one. The app offers A–Z as a display toggle,
      // and sorts by `glyph` itself for that — this is just the default shelf
      // order. 26–46 rows, so sorting here rather than in SQL is free and keeps
      // `order` inside letterSpec instead of forcing another column.
      if (kind === 'abc') {
        items.sort((a, b) => {
          const ao = typeof a.order === 'number' ? a.order : 99;
          const bo = typeof b.order === 'number' ? b.order : 99;
          return ao - bo || String(a.letter ?? '').localeCompare(String(b.letter ?? ''));
        });
      }
      const body = { items };
      await fastify.redis.setex(cacheKey, CATALOG_TTL_SECONDS, JSON.stringify(body));
      return reply.send(body);
    },
  );

  // Today's pick for a kind + band, least-used first. Unlike /stories/daily
  // this never enqueues generation — Learn packs are authored, not generated,
  // so a miss is a content gap an admin should see, and the app already has a
  // bundled offline pack to fall back on.
  fastify.get<{ Querystring: { kind?: string; ageBand?: string } }>(
    '/packs/daily',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const kind = request.query.kind ?? 'story';
      if (!isKind(kind)) {
        return reply.code(400).send({ error: `kind must be one of: ${PACK_KINDS.join(', ')}` });
      }
      const ageBand = request.query.ageBand ?? 'junior';
      if (!(PACK_AGE_BANDS as readonly string[]).includes(ageBand)) {
        return reply.code(400).send({ error: 'ageBand must be "junior" or "senior"' });
      }

      const pack = await getDailyPack(kind, ageBand);
      if (!pack) {
        return reply.code(503).send({ error: 'No pack available yet. Please try again shortly.' });
      }
      await incrementPackUsedCount(pack.id);
      return reply.send(serializePack(pack));
    },
  );

  // One pack, bilingual. The app passes its own language to the parser, so a
  // single cached document backs both languages and the in-player language
  // pill is instant.
  fastify.get<{ Params: { slug: string } }>(
    '/packs/:slug',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const pack = await getPackBySlug(request.params.slug);
      if (!pack || !pack.published) {
        return reply.code(404).send({ error: 'Pack not found' });
      }

      const cacheKey = packCacheKey(pack.slug, pack.version);
      const cached = await fastify.redis.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached) as unknown);

      const body = serializePack(pack);
      await fastify.redis.setex(cacheKey, PACK_TTL_SECONDS, JSON.stringify(body));
      return reply.send(body);
    },
  );
};

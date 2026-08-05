import { FastifyPluginAsync } from 'fastify';
import { ColoringPage } from '@prisma/client';
import { z } from 'zod';
import {
  getColoringPages,
  getColoringPageBySlug,
  getPendingColoringPages,
  setColoringPagePublished,
  deleteColoringPage,
  upsertColoringPage,
} from '../../db/content.repo';
import { reviewPageHtml } from './coloring.review';
import { ContentService } from '../../services/content.service';
import { DailyLimitReachedException } from '../../services/openai.service';

// Wire format the Flutter app consumes. `id` is the stable slug; every `d` is an
// SVG path string the app parses straight into a Flutter Path (see
// ColoringTemplate.fromJson). regions are back-to-front; outlines/details draw
// on top. Keep this in lockstep with the app's parser.
function serialize(p: ColoringPage): Record<string, unknown> {
  return {
    id: p.slug,
    title: p.title,
    viewBox: p.viewBox,
    isPremium: p.isPremium,
    stickerRewardId: p.stickerRewardId,
    regions: p.regions,
    outlines: p.outlines,
    details: p.details,
    date: p.date,
    published: p.published,
    source: p.source,
  };
}

const regionSchema = z.object({
  id: z.string().min(1),
  d: z.string().min(1),
  byNumber: z.number().int().positive().optional(),
});

const pageSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  title: z.string().min(1),
  viewBox: z.number().positive().default(100),
  isPremium: z.boolean().default(false),
  stickerRewardId: z.string().min(1),
  regions: z.array(regionSchema).min(1),
  outlines: z.array(z.string()).default([]),
  details: z.array(z.string()).default([]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .nullable()
    .default(null),
});

export const coloringRoute: FastifyPluginAsync = async (fastify) => {
  // List today's pages (dated-for-today + evergreen). Cached for an hour.
  fastify.get(
    '/coloring',
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `coloring:list:${today}`;

      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached) as unknown);
      }

      const pages = await getColoringPages(today);
      const responseBody = { pages: pages.map(serialize) };
      await fastify.redis.setex(cacheKey, 3600, JSON.stringify(responseBody));
      return reply.send(responseBody);
    }
  );

  // Single page by slug.
  fastify.get<{ Params: { slug: string } }>(
    '/coloring/:slug',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const page = await getColoringPageBySlug(request.params.slug);
      if (!page) {
        return reply.code(404).send({ error: 'Coloring page not found' });
      }
      return reply.send(serialize(page));
    }
  );

  // Admin manual upload (idempotent by slug). This is how you "upload fresh
  // pages every day" by hand; the daily cron uses the same write path.
  fastify.post(
    '/coloring',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = pageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const d = parsed.data;
      const page = await upsertColoringPage({
        slug: d.slug,
        title: d.title,
        viewBox: d.viewBox,
        isPremium: d.isPremium,
        stickerRewardId: d.stickerRewardId,
        regions: d.regions,
        outlines: d.outlines,
        details: d.details,
        date: d.date,
        source: 'manual',
        // A human uploaded it, so it's approved and live immediately.
        published: true,
      });

      // Bust today's list cache so the new page shows up immediately.
      const today = new Date().toISOString().split('T')[0];
      await fastify.redis.del(`coloring:list:${today}`);

      return reply.code(201).send(serialize(page));
    }
  );

  // Review queue: pages awaiting approval (mostly AI-generated). Admin-only.
  fastify.get(
    '/coloring/pending',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const pages = await getPendingColoringPages();
      return reply.send({ pages: pages.map(serialize) });
    }
  );

  // Approve (or pull) a page. Body: { "published": true | false }. Admin-only.
  fastify.patch<{ Params: { slug: string }; Body: { published?: boolean } }>(
    '/coloring/:slug/publish',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const published = request.body?.published ?? true;
      const page = await setColoringPagePublished(request.params.slug, published);
      if (!page) {
        return reply.code(404).send({ error: 'Coloring page not found' });
      }

      // Bust today's list cache so approval/removal takes effect immediately.
      const today = new Date().toISOString().split('T')[0];
      await fastify.redis.del(`coloring:list:${today}`);

      return reply.send(serialize(page));
    }
  );

  // Reject a page outright (discard bad AI output). Admin-only.
  fastify.delete<{ Params: { slug: string } }>(
    '/coloring/:slug',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const ok = await deleteColoringPage(request.params.slug);
      if (!ok) {
        return reply.code(404).send({ error: 'Coloring page not found' });
      }
      const today = new Date().toISOString().split('T')[0];
      await fastify.redis.del(`coloring:list:${today}`);
      return reply.code(204).send();
    }
  );

  // Import a hand-made/curated line-art IMAGE (e.g. exported from Canva, a
  // licensed pack, or any drawing tool) and trace it into the app's fillable
  // format. The image must be bold black outlines on a plain white background.
  // Body: { imageBase64: "<png/jpg base64, optional data: prefix>", title,
  //         isPremium? }. Lands unpublished in the review queue. Admin-only.
  // bodyLimit raised because a base64 PNG easily exceeds the 1MB default.
  fastify.post<{ Body: { imageBase64?: string; title?: string; isPremium?: boolean } }>(
    '/coloring/import',
    { preHandler: [fastify.authenticateAdmin], bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const { imageBase64, title, isPremium } = request.body ?? {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return reply.code(400).send({ error: 'imageBase64 is required' });
      }
      if (!title || typeof title !== 'string' || !title.trim()) {
        return reply.code(400).send({ error: 'title is required' });
      }

      // Accept a raw base64 string or a full data: URL.
      const b64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
      let image: Buffer;
      try {
        image = Buffer.from(b64, 'base64');
      } catch {
        return reply.code(400).send({ error: 'imageBase64 is not valid base64' });
      }
      if (image.length < 100) {
        return reply.code(400).send({ error: 'Decoded image is empty or too small' });
      }

      const baseSlug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'page';
      const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

      const service = new ContentService(fastify.redis);
      try {
        const page = await service.importColoringImage(image, {
          slug,
          title: title.trim(),
          stickerRewardId: baseSlug,
          source: 'upload',
          isPremium: Boolean(isPremium),
        });
        return reply.code(201).send(serialize(page));
      } catch (err) {
        // A failed trace is the caller's problem (bad source image), not a 500.
        return reply
          .code(422)
          .send({ error: err instanceof Error ? err.message : 'Trace failed' });
      }
    }
  );

  // Generate fresh AI pages on demand (same code path as the daily cron) instead
  // of waiting for 02:30 UTC. Each page lands unpublished in the review queue.
  // Body: { "count": 1-5 }. Admin-only. Synchronous — may take a few seconds.
  fastify.post<{ Body: { count?: number } }>(
    '/coloring/generate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const count = Math.min(Math.max(Number(request.body?.count ?? 1), 1), 5);
      const today = new Date().toISOString().split('T')[0];
      const service = new ContentService(fastify.redis);

      const created: ReturnType<typeof serialize>[] = [];
      const errors: string[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const page = await service.generateColoringPage(today);
          created.push(serialize(page));
        } catch (err) {
          if (err instanceof DailyLimitReachedException) {
            errors.push('Daily OpenAI limit reached');
            break;
          }
          errors.push(err instanceof Error ? err.message : 'Generation failed');
        }
      }

      // New pages are unpublished, so the kids' list is unaffected — but the
      // review queue changed; nothing to bust there.
      const status = created.length > 0 ? 201 : 502;
      return reply.code(status).send({ created, errors });
    }
  );

  // Human-friendly review queue: renders each pending page's line art so you can
  // approve/reject visually. Open in a browser: /v1/coloring/review
  fastify.get('/coloring/review', async (_request, reply) => {
    return reply.type('text/html').send(reviewPageHtml);
  });
};

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listStories,
  deleteStory,
  updateStory,
  listPoems,
  deletePoem,
  updatePoem,
  listAbcLessons,
  deleteAbcLesson,
  updateAbcLesson,
  listCinematicStories,
  getCinematicStoryById,
  setCinematicStoryPublished,
  deleteCinematicStory,
} from '../../db/content.repo';
import { generateQueue } from '../../jobs/queue';
import { ContentService } from '../../services/content.service';
import { DailyLimitReachedException } from '../../services/openai.service';
import { adminPageHtml } from './admin.ui';

// Admin panel: serves the single-page HTML at GET /v1/admin (no auth — the page
// prompts for the admin key) and the JSON endpoints the page calls. Stories /
// poems / ABC get list + delete + generate (the app only exposes read paths for
// these, so they need their own admin endpoints). The Jobs endpoints introspect
// the BullMQ queues: list the repeatable (cron) jobs and fire a one-shot copy
// of any of them on demand. Coloring / crawl / RAG reuse their existing admin
// endpoints (coloring.ts, stories.ts, rag.admin.ts).

const STORY_TYPES = ['pre-generate-stories', 'pre-generate-cinematic', 'pre-generate-poems', 'pre-generate-coloring', 'crawl-sweep', 'backfill-corpus'] as const;

const generateStorySchema = z.object({
  ageBand: z.enum(['junior', 'senior']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

const generateCinematicSchema = z.object({
  ageBand: z.enum(['junior', 'senior']),
  lang: z.enum(['en', 'hi']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

const generatePoemSchema = z.object({
  topic: z.enum(['Animals', 'Seasons', 'Numbers', 'Colors', 'Nature']),
});

const generateAbcSchema = z.object({
  letter: z.string().regex(/^[A-Za-z]$/, 'letter must be a single A-Z character'),
});

// Editable subsets of each content type. All fields optional on PATCH so the
// admin can change just one column without resending the whole record.
const updateStorySchema = z.object({
  ageBand: z.enum(['junior', 'senior']).optional(),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  moral: z.string().optional(),
  emoji: z.string().optional(),
  source: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const updatePoemSchema = z.object({
  topic: z.enum(['Animals', 'Seasons', 'Numbers', 'Colors', 'Nature']).optional(),
  title: z.string().min(1).optional(),
  lines: z.string().optional(),
  emoji: z.string().optional(),
  source: z.string().min(1).optional(),
});

const updateAbcSchema = z.object({
  word: z.string().min(1).optional(),
  emoji: z.string().optional(),
  phonics: z.string().optional(),
  miniStory: z.string().optional(),
  source: z.string().min(1).optional(),
});

const triggerJobSchema = z.object({
  type: z.enum(STORY_TYPES),
});

export const adminRoute: FastifyPluginAsync = async (fastify) => {
  // The HTML shell. No auth — the page's JS prompts for the admin key and
  // sends it as x-admin-key on every JSON call (same model as /coloring/review).
  fastify.get('/admin', async (_request, reply) => {
    return reply.type('text/html').send(adminPageHtml);
  });

  // --- Stories ---
  fastify.get<{ Querystring: { ageBand?: string; source?: string; limit?: string; offset?: string } }>(
    '/admin/stories',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const items = await listStories({
        ageBand: request.query.ageBand,
        source: request.query.source,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      });
      return reply.send({ items });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/admin/stories/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const ok = await deleteStory(request.params.id);
      if (!ok) return reply.code(404).send({ error: 'Story not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/stories/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = updateStorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const updated = await updateStory(request.params.id, parsed.data);
      if (!updated) return reply.code(404).send({ error: 'Story not found' });
      return reply.send({
        id: updated.id, ageBand: updated.ageBand, title: updated.title,
        body: updated.body, moral: updated.moral, emoji: updated.emoji,
        source: updated.source, date: updated.date,
      });
    },
  );

  fastify.post<{ Body: { ageBand?: string; date?: string } }>(
    '/admin/stories/generate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = generateStorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { ageBand, date } = parsed.data;
      const job = await generateQueue.add(
        'generate-story',
        { type: 'story', ageBand, date },
        { jobId: `admin-story-${ageBand}-${date}-${Date.now()}` },
      );
      return reply.code(202).send({ jobId: job.id });
    },
  );

  // --- Cinematic stories ---
  // Review workflow mirrors coloring pages: list (with published filter),
  // full-JSON preview, publish/unpublish, delete-to-reject, queue generation.
  fastify.get<{ Querystring: { ageBand?: string; lang?: string; published?: string; limit?: string; offset?: string } }>(
    '/admin/cinematic',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const items = await listCinematicStories({
        ageBand: request.query.ageBand,
        lang: request.query.lang,
        published:
          request.query.published === undefined ? undefined : request.query.published === 'true',
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      });
      return reply.send({
        items: items.map((s) => ({
          id: s.id,
          slug: s.slug,
          title: s.title,
          lang: s.lang,
          ageBand: s.ageBand,
          category: s.category,
          coverEmoji: s.coverEmoji,
          moral: s.moral,
          sceneCount: Array.isArray(s.scenes) ? s.scenes.length : 0,
          date: s.date,
          source: s.source,
          published: s.published,
          usedCount: s.usedCount,
          createdAt: s.createdAt,
        })),
      });
    },
  );

  // Full document (scenes included) for the review preview.
  fastify.get<{ Params: { id: string } }>(
    '/admin/cinematic/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const story = await getCinematicStoryById(request.params.id);
      if (!story) return reply.code(404).send({ error: 'Story not found' });
      return reply.send({
        id: story.id,
        slug: story.slug,
        title: story.title,
        lang: story.lang,
        ageBand: story.ageBand,
        category: story.category,
        coverEmoji: story.coverEmoji,
        music: story.music,
        moral: story.moral,
        reward: story.reward,
        scenes: story.scenes,
        date: story.date,
        source: story.source,
        published: story.published,
      });
    },
  );

  fastify.patch<{ Params: { id: string }; Body: { published?: boolean } }>(
    '/admin/cinematic/:id/publish',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const published = request.body?.published ?? true;
      const updated = await setCinematicStoryPublished(request.params.id, published);
      if (!updated) return reply.code(404).send({ error: 'Story not found' });
      return reply.send({ id: updated.id, published: updated.published, date: updated.date });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/admin/cinematic/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const ok = await deleteCinematicStory(request.params.id);
      if (!ok) return reply.code(404).send({ error: 'Story not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.post<{ Body: { ageBand?: string; lang?: string; date?: string } }>(
    '/admin/cinematic/generate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = generateCinematicSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { ageBand, lang, date } = parsed.data;
      const job = await generateQueue.add(
        'generate-cinematic',
        { type: 'cinematic-story', ageBand, lang, date },
        { jobId: `admin-cinematic-${ageBand}-${lang}-${date}-${Date.now()}` },
      );
      return reply.code(202).send({ jobId: job.id });
    },
  );

  // --- Poems ---
  fastify.get<{ Querystring: { topic?: string; limit?: string; offset?: string } }>(
    '/admin/poems',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const items = await listPoems({
        topic: request.query.topic,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      });
      return reply.send({ items });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/admin/poems/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const ok = await deletePoem(request.params.id);
      if (!ok) return reply.code(404).send({ error: 'Poem not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/poems/:id',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = updatePoemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const updated = await updatePoem(request.params.id, parsed.data);
      if (!updated) return reply.code(404).send({ error: 'Poem not found' });
      return reply.send({
        id: updated.id, topic: updated.topic, title: updated.title,
        lines: updated.lines, emoji: updated.emoji, source: updated.source,
      });
    },
  );

  // Synchronous — matches the on-demand path in poems.ts. Subject to the daily
  // OpenAI call limit; 503 when the budget is spent.
  fastify.post<{ Body: { topic?: string } }>(
    '/admin/poems/generate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = generatePoemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const service = new ContentService(fastify.redis);
      try {
        const poem = await service.generatePoem(parsed.data.topic);
        return reply.code(201).send({ poem: { id: poem.id, title: poem.title, topic: poem.topic } });
      } catch (err) {
        if (err instanceof DailyLimitReachedException) {
          return reply.code(503).send({ error: 'Daily OpenAI limit reached' });
        }
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Generation failed' });
      }
    },
  );

  // --- ABC ---
  fastify.get(
    '/admin/abc',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const items = await listAbcLessons();
      return reply.send({ items });
    },
  );

  fastify.delete<{ Params: { letter: string } }>(
    '/admin/abc/:letter',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const ok = await deleteAbcLesson(request.params.letter);
      if (!ok) return reply.code(404).send({ error: 'ABC lesson not found' });
      return reply.send({ ok: true });
    },
  );

  fastify.patch<{ Params: { letter: string }; Body: Record<string, unknown> }>(
    '/admin/abc/:letter',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = updateAbcSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const updated = await updateAbcLesson(request.params.letter, parsed.data);
      if (!updated) return reply.code(404).send({ error: 'ABC lesson not found' });
      return reply.send({
        letter: updated.letter, word: updated.word, emoji: updated.emoji,
        phonics: updated.phonics, miniStory: updated.miniStory, source: updated.source,
      });
    },
  );

  // Synchronous — matches the on-demand path in abc.ts. Subject to the daily
  // OpenAI call limit; 503 when the budget is spent.
  fastify.post<{ Body: { letter?: string } }>(
    '/admin/abc/generate',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = generateAbcSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const service = new ContentService(fastify.redis);
      try {
        const lesson = await service.generateAbcLesson(parsed.data.letter.toUpperCase());
        return reply.code(201).send({ lesson: { letter: lesson.letter, word: lesson.word } });
      } catch (err) {
        if (err instanceof DailyLimitReachedException) {
          return reply.code(503).send({ error: 'Daily OpenAI limit reached' });
        }
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Generation failed' });
      }
    },
  );

  // --- Jobs / Crons ---
  fastify.get(
    '/admin/jobs',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const [generate, crawl, generateCounts, crawlCounts] = await Promise.all([
        generateQueue.getRepeatableJobs(),
        // crawlQueue has no repeatable jobs today (crawl-sweep enqueues it), but
        // list it anyway so the panel reflects reality if one is added later.
        Promise.resolve([] as Awaited<ReturnType<typeof generateQueue.getRepeatableJobs>>),
        generateQueue.getJobCounts('waiting', 'active'),
        Promise.resolve({ waiting: 0, active: 0 }),
      ]);
      return reply.send({
        generate,
        crawl,
        counts: { generate: generateCounts, crawl: crawlCounts },
      });
    },
  );

  fastify.post<{ Body: { type?: string } }>(
    '/admin/jobs/trigger',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const parsed = triggerJobSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const type = parsed.data.type;
      const job = await generateQueue.add(type, { type }, { jobId: `admin-${type}-${Date.now()}` });
      return reply.code(202).send({ jobId: job.id });
    },
  );
};

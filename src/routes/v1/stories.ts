import { FastifyPluginAsync } from 'fastify';
import {
  getStoryForToday,
  getOldestEvergreenStory,
  incrementStoryUsedCount,
  getContentCounts,
  createCrawlSource,
  getAllCrawlSources,
  prisma,
} from '../../db/content.repo';
import { generateQueue, crawlQueue } from '../../jobs/queue';

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

export const storiesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { ageBand?: string } }>(
    '/stories/daily',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const ageBand = (request.query.ageBand ?? 'junior') as 'junior' | 'senior';
      if (!['junior', 'senior'].includes(ageBand)) {
        return reply.code(400).send({ error: 'ageBand must be "junior" or "senior"' });
      }

      const today = getTodayString();
      // const cacheKey = `story:${ageBand}:${today}`;

      // 1. Redis cache — disabled for now so every request returns a fresh,
      // randomized story. Re-enable (here + the setex below) to restore the
      // "one fixed story per day" daily-cache behavior.
      // const cached = await fastify.redis.get(cacheKey);
      // if (cached) {
      //   return reply.send(JSON.parse(cached) as unknown);
      // }

      // 2. DB lookup
      const story = await getStoryForToday(ageBand, today);

      if (story) {
        await incrementStoryUsedCount(story.id);
        // const ttl = getSecondsUntilMidnight();
        const responseBody = {
          id: story.id,
          title: story.title,
          story: story.body,
          moral: story.moral,
          emoji: story.emoji,
          source: story.source,
          generatedAt: story.createdAt,
        };
        // await fastify.redis.setex(cacheKey, ttl, JSON.stringify(responseBody));
        return reply.send(responseBody);
      }

      // 3. Enqueue generation + return placeholder
      await generateQueue.add('generate-story', { type: 'story', ageBand, date: today });

      const placeholder = await getOldestEvergreenStory(ageBand);
      if (!placeholder) {
        return reply.code(503).send({ error: 'No content available yet. Please try again shortly.' });
      }

      return reply.send({
        id: placeholder.id,
        title: placeholder.title,
        story: placeholder.body,
        moral: placeholder.moral,
        emoji: placeholder.emoji,
        source: placeholder.source,
        generatedAt: placeholder.createdAt,
      });
    }
  );

  // Admin stats route
  fastify.get('/stats', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const counts = await getContentCounts();
    const today = getTodayString();
    const openAiCallsToday = parseInt((await fastify.redis.get(`openai:calls:${today}`)) ?? '0', 10);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const crawledThisWeek = await prisma.story.count({
      where: { source: 'crawled', createdAt: { gte: sevenDaysAgo } },
    });

    return reply.send({
      ...counts,
      openAiCallsToday,
      crawledThisWeek,
    });
  });

  // Admin crawl trigger route. `mode` defaults to "index" so a pasted listing
  // page auto-discovers its article links; pass "page" to crawl a single article.
  fastify.post<{ Body: { url: string; contentType: string; mode?: string } }>(
    '/crawl/trigger',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { url, contentType } = request.body;
      const mode = request.body.mode === 'page' ? 'page' : 'index';
      if (!url || !['story', 'poem', 'abc'].includes(contentType)) {
        return reply.code(400).send({ error: 'Invalid url or contentType' });
      }

      const source = await createCrawlSource({
        url,
        contentType,
        mode,
        status: 'pending',
        discoveredFrom: null,
      });
      const job = await crawlQueue.add('crawl', { sourceId: source.id, url, contentType, mode });

      return reply.code(202).send({ jobId: job.id });
    }
  );

  // Admin crawl-sources listing — powers the in-app admin panel's status view.
  fastify.get('/crawl/sources', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const sources = await getAllCrawlSources();
    return reply.send(
      sources.map((s) => ({
        id: s.id,
        url: s.url,
        contentType: s.contentType,
        mode: s.mode,
        status: s.status,
        lastCrawled: s.lastCrawled,
        discoveredFrom: s.discoveredFrom,
      }))
    );
  });
};

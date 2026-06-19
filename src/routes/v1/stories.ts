import { FastifyPluginAsync } from 'fastify';
import {
  getStoryForToday,
  getOldestEvergreenStory,
  incrementStoryUsedCount,
  getContentCounts,
  createCrawlSource,
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
      const cacheKey = `story:${ageBand}:${today}`;

      // 1. Redis cache
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached) as unknown);
      }

      // 2. DB lookup
      const story = await getStoryForToday(ageBand, today);

      if (story) {
        await incrementStoryUsedCount(story.id);
        const ttl = getSecondsUntilMidnight();
        const responseBody = {
          id: story.id,
          title: story.title,
          story: story.body,
          moral: story.moral,
          emoji: story.emoji,
          source: story.source,
          generatedAt: story.createdAt,
        };
        await fastify.redis.setex(cacheKey, ttl, JSON.stringify(responseBody));
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

  // Admin crawl trigger route
  fastify.post<{ Body: { url: string; contentType: string } }>(
    '/crawl/trigger',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { url, contentType } = request.body;
      if (!url || !['story', 'poem', 'abc'].includes(contentType)) {
        return reply.code(400).send({ error: 'Invalid url or contentType' });
      }

      const source = await createCrawlSource({ url, contentType, status: 'pending' });
      const job = await crawlQueue.add('crawl', { sourceId: source.id, url, contentType });

      return reply.code(202).send({ jobId: job.id });
    }
  );
};

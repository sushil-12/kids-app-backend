import { FastifyPluginAsync } from 'fastify';
import { getPoem, incrementPoemUsedCount } from '../../db/content.repo';
import { ContentService } from '../../services/content.service';
import { DailyLimitReachedException } from '../../services/openai.service';

const VALID_TOPICS = ['Animals', 'Seasons', 'Numbers', 'Colors', 'Nature'];

export const poemsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { topic?: string } }>(
    '/poems',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const topic = request.query.topic ?? 'Animals';
      if (!VALID_TOPICS.includes(topic)) {
        return reply.code(400).send({ error: `topic must be one of: ${VALID_TOPICS.join(', ')}` });
      }

      const cacheKey = `poem:${topic}:latest`;

      // 1. Redis cache
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached) as unknown);
      }

      // 2. DB lookup
      const poem = await getPoem(topic);

      if (poem) {
        await incrementPoemUsedCount(poem.id);
        const responseBody = {
          id: poem.id,
          title: poem.title,
          poem: poem.lines,
          emoji: poem.emoji,
          topic: poem.topic,
          source: poem.source,
        };
        await fastify.redis.setex(cacheKey, 3600, JSON.stringify(responseBody));
        return reply.send(responseBody);
      }

      // 3. Generate synchronously
      try {
        const contentService = new ContentService(fastify.redis);
        const generated = await contentService.generatePoem(topic);
        const responseBody = {
          id: generated.id,
          title: generated.title,
          poem: generated.lines,
          emoji: generated.emoji,
          topic: generated.topic,
          source: generated.source,
        };
        await fastify.redis.setex(cacheKey, 3600, JSON.stringify(responseBody));
        return reply.send(responseBody);
      } catch (err) {
        if (err instanceof DailyLimitReachedException) {
          return reply.code(503).send({ error: 'Content generation unavailable. Daily limit reached.' });
        }
        throw err;
      }
    }
  );
};

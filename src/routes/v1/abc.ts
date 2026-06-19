import { FastifyPluginAsync } from 'fastify';
import { getAbcLesson } from '../../db/content.repo';
import { ContentService } from '../../services/content.service';
import { DailyLimitReachedException } from '../../services/openai.service';

export const abcRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { letter: string } }>(
    '/abc/:letter',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const letter = request.params.letter.toUpperCase();
      if (!/^[A-Z]$/.test(letter)) {
        return reply.code(400).send({ error: 'letter must be a single A-Z character' });
      }

      const cacheKey = `abc:${letter}`;

      // 1. Redis cache
      const cached = await fastify.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached) as unknown);
      }

      // 2. DB lookup
      const lesson = await getAbcLesson(letter);

      if (lesson) {
        const responseBody = {
          letter: lesson.letter,
          word: lesson.word,
          emoji: lesson.emoji,
          phonics: lesson.phonics,
          miniStory: lesson.miniStory,
          source: lesson.source,
        };
        await fastify.redis.setex(cacheKey, 86400, JSON.stringify(responseBody));
        return reply.send(responseBody);
      }

      // 3. Generate synchronously
      try {
        const contentService = new ContentService(fastify.redis);
        const generated = await contentService.generateAbcLesson(letter);
        const responseBody = {
          letter: generated.letter,
          word: generated.word,
          emoji: generated.emoji,
          phonics: generated.phonics,
          miniStory: generated.miniStory,
          source: generated.source,
        };
        await fastify.redis.setex(cacheKey, 86400, JSON.stringify(responseBody));
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

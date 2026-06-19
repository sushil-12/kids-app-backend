import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db/content.repo';

export const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    try {
      await fastify.redis.ping();
    } catch {
      redisStatus = 'error';
    }

    const status = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded';
    return reply.code(status === 'ok' ? 200 : 503).send({ status, db: dbStatus, redis: redisStatus });
  });
};

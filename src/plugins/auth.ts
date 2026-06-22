import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPluginFn: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'];
    // if (!apiKey || apiKey !== config.API_KEY) {
    //   reply.code(401).send({ error: 'Unauthorized' });
    // }
  });

  fastify.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = request.headers['x-admin-key'];
    // if (!adminKey || adminKey !== config.ADMIN_API_KEY) {
    //   reply.code(401).send({ error: 'Unauthorized' });
    // }
  });
};

export const authPlugin = fp(authPluginFn);

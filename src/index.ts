import Fastify from 'fastify';
import { config } from './config';
import { authPlugin } from './plugins/auth';
import { redisPlugin } from './plugins/redis';
import { healthRoute } from './routes/v1/health';
import { storiesRoute } from './routes/v1/stories';
import { poemsRoute } from './routes/v1/poems';
import { abcRoute } from './routes/v1/abc';
import { setupScheduledJobs } from './jobs/generate.job';
import { setupCrawlWorker } from './jobs/crawl.job';
import { prisma } from './db/content.repo';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: { colorize: true },
    } : undefined,
  },
});

async function start(): Promise<void> {
  await app.register(redisPlugin);
  await app.register(authPlugin);

  await app.register(healthRoute);
  await app.register(storiesRoute, { prefix: '/v1' });
  await app.register(poemsRoute, { prefix: '/v1' });
  await app.register(abcRoute, { prefix: '/v1' });

  if (config.NODE_ENV !== 'test') {
    setupScheduledJobs();
    setupCrawlWorker();
  }

  const gracefulShutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down gracefully');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();

export { app };

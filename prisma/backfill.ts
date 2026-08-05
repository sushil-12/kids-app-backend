// One-shot corpus backfill. Run after `db:seed` (or any time you want to
// (re)embed the existing Stories/Poems/AbcLessons into the RAG corpus):
//
//   npx tsx --env-file=.env prisma/backfill.ts
//
// Idempotent via contentHash — only new chunks get embedded. Uses the same
// backfillCorpus() the admin endpoint /v1/rag/backfill and the cron worker use,
// so behaviour is identical regardless of how you trigger it.

import { PrismaClient } from '@prisma/client';
import { OpenAIService } from '../src/services/openai.service';
import Redis from 'ioredis';
import { backfillCorpus } from '../src/db/vector.repo';

// backfillCorpus uses the shared `prisma` singleton from content.repo, which is
// fine. We only need a redis connection for the OpenAI service's embed cache.
async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const openai = new OpenAIService(redis);
  try {
    console.log('Backfilling RAG corpus from existing content...');
    const stats = await backfillCorpus(openai, redis);
    console.log('Backfill complete:', stats);
  } finally {
    await redis.quit();
    await new PrismaClient().$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-shot demo of the full grounded-generation flow. Runs the real
// RagService + grounding + OpenAI completion against your live corpus, and
// prints what was retrieved and what was generated. Costs one OpenAI call.
//
//   npx tsx --env-file=.env prisma/demo-grounded.ts
//
// Safe to re-run; each run creates a new grounded Story row in the DB so you
// can inspect it in Prisma Studio or via GET /v1/stories/:id/sources.

import Redis from 'ioredis';
import { OpenAIService } from '../src/services/openai.service';
import { RagService } from '../src/services/rag.service';
import { buildGroundedPrompt } from '../src/services/grounding';
import { ContentService } from '../src/services/content.service';

async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const openai = new OpenAIService(redis);
  const rag = new RagService(openai, redis);

  const ageBand = 'junior' as const;
  const today = new Date().toISOString().split('T')[0] ?? '';
  const intent = `Write a warm, gentle bedtime story for ${ageBand} kids (date: ${today}). 6-8 sentences, a clear moral, kid-friendly.`;

  console.log('\n=== 1. RAG retrieval (top passages from your corpus) ===');
  const chunks = await rag.retrieve(intent, { kind: ['story', 'fact'], ageBand });
  if (chunks.length === 0) {
    console.log('  (no chunks returned — corpus may be empty or retrieval fell back)');
  }
  for (const c of chunks) {
    console.log(
      `  [score=${c.score.toFixed(3)}] ${c.sourceTitle ?? '(no title)'} — ${c.text.slice(0, 120)}...`,
    );
  }

  console.log('\n=== 2. Grounded prompt built for the LLM ===');
  const { system, user, sources } = buildGroundedPrompt(
    intent,
    '{title, story: "6-8 sentences", moral: "1 sentence", emoji}',
    chunks,
  );
  console.log('  system:', system.slice(0, 160) + '...');
  console.log('  user prompt length:', user.length, 'chars');
  console.log('  sources to attribute:', sources);

  console.log('\n=== 3. Generating the grounded story via ContentService ===');
  const svc = new ContentService(redis);
  const story = await svc.generateStory(ageBand, today);
  console.log('  id:     ', story.id);
  console.log('  title:  ', story.title);
  console.log('  emoji:  ', story.emoji);
  console.log('  moral:  ', story.moral);
  console.log('  source: ', story.source, '(openai-grounded = RAG was used)');
  console.log('  body:   ', story.body);
  console.log('  sources:', story.sources);

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { Worker } from 'bullmq';
import { queueConnection } from './queue';
import { CrawlerService } from '../services/crawler.service';
import { OpenAIService, DailyLimitReachedException } from '../services/openai.service';
import {
  createStory,
  createPoem,
  upsertAbcLesson,
  updateCrawlSource,
  upsertDiscoveredPage,
} from '../db/content.repo';
import { crawlQueue } from './queue';
import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.LOG_LEVEL });

export function setupCrawlWorker(): void {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const crawlerService = new CrawlerService();
  const openaiService = new OpenAIService(redis);

  const worker = new Worker(
    'crawl',
    async (job) => {
      const { sourceId, url, contentType, mode } = job.data as {
        sourceId: string;
        url: string;
        contentType: 'story' | 'poem' | 'abc';
        mode?: 'index' | 'page';
      };

      logger.info({ url, contentType, mode: mode ?? 'page' }, 'Starting crawl job');

      // Index roots: discover article links and enqueue each as its own page
      // crawl. This is what lets the backend fill the library on its own —
      // operators add a trusted root once, not every article URL.
      if (mode === 'index') {
        const found = await crawlerService.discoverLinks(url);
        let queued = 0;
        for (const link of found) {
          const newId = await upsertDiscoveredPage({
            url: link,
            contentType,
            discoveredFrom: url,
          });
          if (newId) {
            await crawlQueue.add('crawl', {
              sourceId: newId,
              url: link,
              contentType,
              mode: 'page',
            });
            queued += 1;
          }
        }
        await updateCrawlSource(sourceId, { status: 'success', lastCrawled: new Date() });
        logger.info({ url, found: found.length, queued }, 'Index discovery complete');
        return;
      }

      const crawled = await crawlerService.fetchAndParse(url);
      if (!crawled) {
        await updateCrawlSource(sourceId, { status: 'failed' });
        return;
      }

      try {
        const schemaHint =
          contentType === 'story'
            ? '{title, story: "6-8 sentences", moral: "1 sentence", emoji, ageBand: "junior or senior"}'
            : contentType === 'poem'
            ? '{title, poem: "lines joined by \\n", emoji, topic}'
            : '{letter, word, emoji, phonics: "short tip", miniStory: "2-3 sentences"}';

        const transformPrompt = `Transform this raw children's educational text into structured JSON matching this schema: ${schemaHint}. Clean it up, make it age-appropriate for young children. Output ONLY valid JSON.`;
        // The first ~1200 chars carry the lead of a kids' page — enough to transform,
        // while cutting input tokens vs. the previous 2000.
        const userContent = `Title: ${crawled.title}\n\nContent: ${crawled.body.slice(0, 1200)}`;

        // Match the per-type output budgets used for direct generation.
        const maxTokens = contentType === 'story' ? 350 : contentType === 'poem' ? 140 : 160;
        const raw = await openaiService.complete(transformPrompt, userContent, maxTokens);
        const parsed = JSON.parse(raw) as Record<string, string>;

        if (contentType === 'story') {
          await createStory({
            ageBand: parsed['ageBand'] ?? 'junior',
            title: parsed['title'] ?? '',
            body: parsed['story'] ?? '',
            moral: parsed['moral'] ?? '',
            emoji: parsed['emoji'] ?? '📖',
            source: 'crawled',
            date: null,
          });
        } else if (contentType === 'poem') {
          await createPoem({
            topic: parsed['topic'] ?? 'Nature',
            title: parsed['title'] ?? '',
            lines: parsed['poem'] ?? '',
            emoji: parsed['emoji'] ?? '🌟',
            source: 'crawled',
          });
        } else if (contentType === 'abc') {
          await upsertAbcLesson({
            letter: (parsed['letter'] ?? 'A').toUpperCase(),
            word: parsed['word'] ?? '',
            emoji: parsed['emoji'] ?? '📝',
            phonics: parsed['phonics'] ?? '',
            miniStory: parsed['miniStory'] ?? '',
            source: 'crawled',
          });
        }

        await updateCrawlSource(sourceId, {
          status: 'success',
          lastCrawled: new Date(),
        });

        logger.info({ url, contentType }, 'Crawl job completed successfully');
      } catch (err) {
        if (err instanceof DailyLimitReachedException) {
          logger.warn({ url }, 'Daily OpenAI limit reached, deferring crawl transform');
          await updateCrawlSource(sourceId, { status: 'pending' });
          return;
        }
        logger.error({ url, err }, 'Crawl transform failed');
        await updateCrawlSource(sourceId, { status: 'failed' });
        throw err;
      }
    },
    { connection: queueConnection }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Crawl job failed');
  });
}

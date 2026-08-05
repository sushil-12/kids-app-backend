import { Worker } from 'bullmq';
import { queueConnection, generateQueue, crawlQueue } from './queue';
import { ContentService } from '../services/content.service';
import { DailyLimitReachedException } from '../services/openai.service';
import {
  NarrationService,
  NarrationBudgetException,
  NarrationUnavailableException,
} from '../services/narration.service';
import { getStoryExistsForDate, getPoemCountByTopic, getPendingCrawlSources, getColoringPageCountForDate, getCinematicStoryExists } from '../db/content.repo';
import { backfillCorpus } from '../db/vector.repo';
import { OpenAIService } from '../services/openai.service';
import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';


const logger = pino({ level: config.LOG_LEVEL });

const AGE_BANDS = ['junior', 'senior'] as const;
const CINEMATIC_LANGS = ['en', 'hi'] as const;
const POEM_TOPICS = ['Animals', 'Seasons', 'Numbers', 'Colors', 'Nature'] as const;
const MIN_POEMS_PER_TOPIC = 5;
const COLORING_PAGES_PER_DAY = 2;

export function setupScheduledJobs(): void {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const contentService = new ContentService(redis);
  const narrationService = new NarrationService(redis);

  // Pre-generate stories at 02:00 UTC daily
  generateQueue.add(
    'pre-generate-stories',
    { type: 'pre-generate-stories' },
    {
      repeat: { pattern: '0 2 * * *' },
      jobId: 'pre-generate-stories',
    }
  );

  // Pre-generate cinematic stories at 02:15 UTC daily (one per ageBand × lang;
  // they land unpublished so this fills the review queue, not the app).
  generateQueue.add(
    'pre-generate-cinematic',
    { type: 'pre-generate-cinematic' },
    {
      repeat: { pattern: '15 2 * * *' },
      jobId: 'pre-generate-cinematic',
    }
  );

  // Pre-generate poems weekly (Sunday 03:00 UTC)
  generateQueue.add(
    'pre-generate-poems',
    { type: 'pre-generate-poems' },
    {
      repeat: { pattern: '0 3 * * 0' },
      jobId: 'pre-generate-poems',
    }
  );

  // Pre-generate fresh coloring pages at 02:30 UTC daily
  generateQueue.add(
    'pre-generate-coloring',
    { type: 'pre-generate-coloring' },
    {
      repeat: { pattern: '30 2 * * *' },
      jobId: 'pre-generate-coloring',
    }
  );

  // Crawl sweep every 4 hours (crawl-first policy: keep the library topped up so the
  // app rarely needs an on-demand OpenAI generation).
  generateQueue.add(
    'crawl-sweep',
    { type: 'crawl-sweep' },
    {
      repeat: { pattern: '0 */4 * * *' },
      jobId: 'crawl-sweep',
    }
  );

  const worker = new Worker(
    'generate',
    async (job) => {
      const { type, ageBand, lang, date, packId, langs, force, momentIds } = job.data as {
        type: string;
        ageBand?: 'junior' | 'senior';
        lang?: 'en' | 'hi';
        date?: string;
        packId?: string;
        langs?: ('en' | 'hi')[];
        force?: boolean;
        momentIds?: string[];
      };

      // Recording a pack's narration can take minutes (one ElevenLabs call per
      // moment per language), so the admin route enqueues it and polls instead
      // of holding a request open. The result is returned as the job's value so
      // the editor can show generated/skipped/failed counts.
      if (type === 'narrate-pack' && packId) {
        try {
          const result = await narrationService.generateForPack(packId, { langs, force, momentIds });
          logger.info({ packId, ...result, clips: result.clips.length }, 'Narrated pack');
          return result;
        } catch (err) {
          if (err instanceof NarrationUnavailableException) {
            logger.warn({ packId }, 'ELEVENLABS_API_KEY not set — narration skipped');
            return;
          }
          if (err instanceof NarrationBudgetException) {
            logger.warn({ packId, used: err.used, limit: err.limit }, 'Narration character budget reached');
            return;
          }
          throw err;
        }
      }

      if (type === 'cinematic-story' && ageBand && date) {
        const storyLang = lang ?? 'en';
        logger.info({ ageBand, lang: storyLang, date }, 'Generating cinematic story on-demand');
        try {
          await contentService.generateCinematicStory(ageBand, storyLang, date);
        } catch (err) {
          if (err instanceof DailyLimitReachedException) {
            logger.warn('Daily limit reached, skipping cinematic story generation');
            return;
          }
          throw err;
        }
      } else if (type === 'pre-generate-cinematic') {
        const today = new Date().toISOString().split('T')[0];
        outer: for (const band of AGE_BANDS) {
          for (const l of CINEMATIC_LANGS) {
            const exists = await getCinematicStoryExists(band, l, today);
            if (exists) continue;
            try {
              await contentService.generateCinematicStory(band, l, today);
              logger.info({ band, lang: l, today }, 'Pre-generated cinematic story');
            } catch (err) {
              if (err instanceof DailyLimitReachedException) {
                logger.warn('Daily limit reached during cinematic pre-generation');
                break outer;
              }
              logger.error({ err, band, lang: l }, 'Failed to pre-generate cinematic story');
            }
          }
        }
      } else if (type === 'story' && ageBand && date) {
        logger.info({ ageBand, date }, 'Generating story on-demand');
        try {
          await contentService.generateStory(ageBand, date);
        } catch (err) {
          if (err instanceof DailyLimitReachedException) {
            logger.warn('Daily limit reached, skipping story generation');
            return;
          }
          throw err;
        }
      } else if (type === 'pre-generate-stories') {
        const today = new Date().toISOString().split('T')[0];
        for (const band of AGE_BANDS) {
          const exists = await getStoryExistsForDate(band, today);
          if (!exists) {
            try {
              await contentService.generateStory(band, today);
              logger.info({ band, today }, 'Pre-generated story');
            } catch (err) {
              if (err instanceof DailyLimitReachedException) {
                logger.warn('Daily limit reached during pre-generation');
                break;
              }
              logger.error({ err, band }, 'Failed to pre-generate story');
            }
          }
        }
      } else if (type === 'pre-generate-poems') {
        for (const topic of POEM_TOPICS) {
          const count = await getPoemCountByTopic(topic);
          const needed = MIN_POEMS_PER_TOPIC - count;
          for (let i = 0; i < needed; i++) {
            try {
              await contentService.generatePoem(topic);
              logger.info({ topic }, 'Pre-generated poem');
            } catch (err) {
              if (err instanceof DailyLimitReachedException) {
                logger.warn('Daily limit reached during poem pre-generation');
                break;
              }
              logger.error({ err, topic }, 'Failed to pre-generate poem');
            }
          }
        }
      } else if (type === 'pre-generate-coloring') {
        const today = new Date().toISOString().split('T')[0];
        const existing = await getColoringPageCountForDate(today);
        const needed = COLORING_PAGES_PER_DAY - existing;
        for (let i = 0; i < needed; i++) {
          try {
            await contentService.generateColoringPage(today);
            logger.info({ today }, 'Pre-generated coloring page');
          } catch (err) {
            if (err instanceof DailyLimitReachedException) {
              logger.warn('Daily limit reached during coloring pre-generation');
              break;
            }
            logger.error({ err }, 'Failed to pre-generate coloring page');
          }
        }
      } else if (type === 'crawl-sweep') {
        const sources = await getPendingCrawlSources(25);
        for (const source of sources) {
          await crawlQueue.add('crawl', {
            sourceId: source.id,
            url: source.url,
            contentType: source.contentType,
            mode: source.mode,
          });
        }
        logger.info({ count: sources.length }, 'Enqueued crawl jobs');
      } else if (type === 'backfill-corpus') {
        const redisConn = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
        const openaiService = new OpenAIService(redisConn);
        try {
          const stats = await backfillCorpus(openaiService, redisConn);
          logger.info(stats, 'Corpus backfill complete');
        } catch (err) {
          if (err instanceof DailyLimitReachedException) {
            logger.warn('Embed limit reached during backfill');
          } else {
            logger.error({ err }, 'Backfill failed');
          }
        } finally {
          await redisConn.quit();
        }
      }
    },
    { connection: queueConnection }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Generate job failed');
  });
}

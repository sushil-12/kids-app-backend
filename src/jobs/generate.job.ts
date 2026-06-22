import { Worker } from 'bullmq';
import { queueConnection, generateQueue, crawlQueue } from './queue';
import { ContentService } from '../services/content.service';
import { DailyLimitReachedException } from '../services/openai.service';
import { getStoryExistsForDate, getPoemCountByTopic, getPendingCrawlSources } from '../db/content.repo';
import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';


const logger = pino({ level: config.LOG_LEVEL });

const AGE_BANDS = ['junior', 'senior'] as const;
const POEM_TOPICS = ['Animals', 'Seasons', 'Numbers', 'Colors', 'Nature'] as const;
const MIN_POEMS_PER_TOPIC = 5;

export function setupScheduledJobs(): void {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const contentService = new ContentService(redis);

  // Pre-generate stories at 02:00 UTC daily
  generateQueue.add(
    'pre-generate-stories',
    { type: 'pre-generate-stories' },
    {
      repeat: { pattern: '0 2 * * *' },
      jobId: 'pre-generate-stories',
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
      const { type, ageBand, date } = job.data as {
        type: string;
        ageBand?: 'junior' | 'senior';
        date?: string;
      };

      if (type === 'story' && ageBand && date) {
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
      }
    },
    { connection: queueConnection }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Generate job failed');
  });
}

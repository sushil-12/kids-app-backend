import { Queue, QueueOptions } from 'bullmq';
import { config } from '../config';

// BullMQ bundles its own ioredis internally. Pass a connection options object
// (not an external Redis instance) to avoid type incompatibility between the
// two ioredis versions.
const connectionOptions = {
  host: (() => {
    try {
      return new URL(config.REDIS_URL).hostname;
    } catch {
      return 'localhost';
    }
  })(),
  port: (() => {
    try {
      return parseInt(new URL(config.REDIS_URL).port || '6379', 10);
    } catch {
      return 6379;
    }
  })(),
  maxRetriesPerRequest: null as null,
};

const defaultQueueOptions: QueueOptions = {
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
};

export const generateQueue = new Queue('generate', defaultQueueOptions);
export const crawlQueue = new Queue('crawl', defaultQueueOptions);

export { connectionOptions as queueConnection };

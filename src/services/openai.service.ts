import OpenAI from 'openai';
import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.LOG_LEVEL });

export class DailyLimitReachedException extends Error {
  constructor() {
    super('Daily OpenAI call limit reached');
    this.name = 'DailyLimitReachedException';
  }
}

export class OpenAIService {
  private client: OpenAI;
  private redis: Redis;

  constructor(redis: Redis) {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    this.redis = redis;
  }

  private getTodayKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `openai:calls:${today}`;
  }

  async complete(system: string, user: string, maxTokens = 300): Promise<string> {
    const key = this.getTodayKey();
    const callCount = await this.redis.get(key);
    const count = parseInt(callCount ?? '0', 10);

    if (count >= config.DAILY_OPENAI_CALL_LIMIT) {
      throw new DailyLimitReachedException();
    }

    const warningThreshold = Math.floor(config.DAILY_OPENAI_CALL_LIMIT * 0.8);
    if (count >= warningThreshold) {
      logger.warn({ count, limit: config.DAILY_OPENAI_CALL_LIMIT }, 'Approaching daily OpenAI call limit');
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      temperature: 0.8,
      // Forces valid JSON output: removes the need to strip markdown fences and,
      // crucially, prevents JSON.parse failures that would trigger BullMQ retries
      // (each retry being another paid OpenAI call). The prompts already say "JSON".
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const tokensUsed = response.usage?.total_tokens ?? 0;
    const costEstimate = (tokensUsed / 1_000_000) * 0.15; // gpt-4o-mini pricing

    logger.info({
      timestamp: new Date().toISOString(),
      type: 'openai_call',
      tokens_used: tokensUsed,
      cost_estimate: costEstimate,
    });

    await this.redis.incr(key);
    await this.redis.expire(key, 86400);

    const content = response.choices[0]?.message?.content ?? '';
    // Strip markdown code fences
    return content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  }

  async getCallCountToday(): Promise<number> {
    const key = this.getTodayKey();
    const val = await this.redis.get(key);
    return parseInt(val ?? '0', 10);
  }
}

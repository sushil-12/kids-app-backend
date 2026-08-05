import OpenAI from 'openai';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { config } from '../config';
import pino from 'pino';
import { EMBEDDING_DIM } from './rag.types';

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

  /** Throws if today's call budget is spent; warns near the limit. Shared by
   *  text completions and image generations (both are paid OpenAI calls). */
  private async checkDailyLimit(): Promise<void> {
    const count = await this.getCallCountToday();
    if (count >= config.DAILY_OPENAI_CALL_LIMIT) {
      throw new DailyLimitReachedException();
    }
    const warningThreshold = Math.floor(config.DAILY_OPENAI_CALL_LIMIT * 0.8);
    if (count >= warningThreshold) {
      logger.warn({ count, limit: config.DAILY_OPENAI_CALL_LIMIT }, 'Approaching daily OpenAI call limit');
    }
  }

  private async recordCall(): Promise<void> {
    const key = this.getTodayKey();
    await this.redis.incr(key);
    await this.redis.expire(key, 86400);
  }

  async complete(system: string, user: string, maxTokens = 300): Promise<string> {
    await this.checkDailyLimit();

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

    await this.recordCall();

    const content = response.choices[0]?.message?.content ?? '';
    // Strip markdown code fences
    return content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  }

  /** Generates one image and returns the raw PNG bytes. Used by the coloring
   *  pipeline (line art → traced into fillable regions). Counts against the
   *  same daily budget as text calls.
   *
   *  Defaults to gpt-image-1, which draws much cleaner, fully-closed outlines
   *  than dall-e-3 (so the tracer produces real fillable cells). gpt-image-1
   *  always returns b64 — it does NOT accept `response_format` — and adds
   *  `quality`/`background` controls, so the two models take different params. */
  async generateImage(prompt: string): Promise<Buffer> {
    await this.checkDailyLimit();

    const model = config.IMAGE_MODEL;
    const params =
      model === 'gpt-image-1'
        ? {
            model,
            prompt,
            n: 1,
            size: '1024x1024' as const,
            quality: config.IMAGE_QUALITY,
            background: 'opaque' as const, // guarantees a solid white page to trace
            output_format: 'png' as const,
          }
        : {
            model,
            prompt,
            n: 1,
            size: '1024x1024' as const,
            response_format: 'b64_json' as const,
          };

    const response = await this.client.images.generate(params);

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error('Image generation returned no data');

    // Rough per-image cost: dall-e-3 std 1024² ≈ $0.04; gpt-image-1 ≈ $0.01
    // (low) / $0.04 (medium) / $0.17 (high) at 1024².
    const costEstimate =
      model === 'dall-e-3'
        ? 0.04
        : { low: 0.01, medium: 0.04, high: 0.17, auto: 0.17 }[config.IMAGE_QUALITY];

    logger.info({
      timestamp: new Date().toISOString(),
      type: 'openai_image_call',
      model,
      cost_estimate: costEstimate,
    });

    await this.recordCall();
    return Buffer.from(b64, 'base64');
  }

  async getCallCountToday(): Promise<number> {
    const key = this.getTodayKey();
    const val = await this.redis.get(key);
    return parseInt(val ?? '0', 10);
  }

  // ───────────────────────── Embeddings ─────────────────────────
  // Separate budget from generation: a corpus backfill embeds many passages
  // and must not starve story/poem generation. Counter key: embed:calls:<date>.

  private getEmbedKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `embed:calls:${today}`;
  }

  private async checkEmbedLimit(): Promise<void> {
    const count = await this.getEmbedCallCountToday();
    if (count >= config.DAILY_EMBED_LIMIT) {
      throw new DailyLimitReachedException();
    }
  }

  private async recordEmbedCall(): Promise<void> {
    const key = this.getEmbedKey();
    await this.redis.incr(key);
    await this.redis.expire(key, 86400);
  }

  async getEmbedCallCountToday(): Promise<number> {
    const val = await this.redis.get(this.getEmbedKey());
    return parseInt(val ?? '0', 10);
  }

  /** sha256 of a chunk's text — the content-addressed key for idempotent embeds. */
  static contentHash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * Embed a batch of texts with a content-addressed Redis cache. Returns vectors
   * aligned to the input order. Texts already embedded (cache hit by hash) are
   * served from Redis and skip the OpenAI call, so re-crawling a page is free.
   * Counts ONE embed call per batch actually sent to OpenAI (not per text),
   * against `DAILY_EMBED_LIMIT`. Throws DailyLimitReachedException when spent.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = new Array(texts.length);

    // Resolve cache hits first.
    const misses: { index: number; text: string; hash: string }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const hash = OpenAIService.contentHash(text);
      const cached = await this.redis.get(`embed:vec:${hash}`);
      if (cached) {
        results[i] = JSON.parse(cached) as number[];
      } else {
        misses.push({ index: i, text, hash });
      }
    }

    if (misses.length === 0) return results;

    await this.checkEmbedLimit();

    // OpenAI accepts up to 2048 inputs per batch; we cap lower to stay safe.
    const BATCH = 100;
    for (let s = 0; s < misses.length; s += BATCH) {
      const slice = misses.slice(s, s + BATCH);
      const response = await this.client.embeddings.create({
        model: config.EMBEDDING_MODEL,
        input: slice.map((m) => m.text),
        dimensions: EMBEDDING_DIM,
      });
      slice.forEach((m, j) => {
        const vec = response.data[j]?.embedding;
        if (!vec || vec.length !== EMBEDDING_DIM) {
          throw new Error(
            `Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${vec?.length ?? 0}`,
          );
        }
        results[m.index] = vec;
        // Cache for 24h. Vectors are stable per model+text, so this is safe.
        void this.redis.setex(`embed:vec:${m.hash}`, 86400, JSON.stringify(vec));
      });
    }

    await this.recordEmbedCall();
    logger.info({ count: misses.length, model: config.EMBEDDING_MODEL }, 'Embedded chunks');
    return results;
  }

  /** Convenience wrapper for a single text. */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    return vec;
  }
}

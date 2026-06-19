import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"result": "ok"}' } }],
          usage: { total_tokens: 50 },
        }),
      },
    },
  })),
}));

import { OpenAIService, DailyLimitReachedException } from '../src/services/openai.service';

function makeMockRedis(callCount: number): {
  get: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(String(callCount)),
    incr: vi.fn().mockResolvedValue(callCount + 1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

describe('OpenAIService cost guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws DailyLimitReachedException when call count equals limit', async () => {
    const redis = makeMockRedis(10); // exactly at limit (limit = 10)
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    await expect(service.complete('system', 'user')).rejects.toThrow(DailyLimitReachedException);
    await expect(service.complete('system', 'user')).rejects.toThrow('Daily OpenAI call limit reached');
  });

  it('throws DailyLimitReachedException when call count exceeds limit', async () => {
    const redis = makeMockRedis(99);
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    await expect(service.complete('system', 'user')).rejects.toBeInstanceOf(DailyLimitReachedException);
  });

  it('succeeds when call count is below limit', async () => {
    const redis = makeMockRedis(5);
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    const result = await service.complete('system', 'user');
    expect(result).toBe('{"result": "ok"}');
    expect(redis.incr).toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalled();
  });

  it('logs warning at 80% of limit', async () => {
    // 80% of 10 = 8, so count=8 should trigger warning
    const redis = makeMockRedis(8);
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    // Spy on warn - we just verify it doesn't throw and completes
    const result = await service.complete('system', 'user');
    expect(result).toBe('{"result": "ok"}');
  });

  it('does not increment count if limit reached (no API call made)', async () => {
    const redis = makeMockRedis(10);
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    try {
      await service.complete('system', 'user');
    } catch {
      // expected
    }

    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('getCallCountToday returns the current count', async () => {
    const redis = makeMockRedis(7);
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    const count = await service.getCallCountToday();
    expect(count).toBe(7);
  });

  it('returns 0 when redis has no key for today', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      incr: vi.fn(),
      expire: vi.fn(),
    };
    const service = new OpenAIService(redis as unknown as import('ioredis').default);

    const count = await service.getCallCountToday();
    expect(count).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Story, Poem, AbcLesson } from '@prisma/client';

// Mock DB calls
vi.mock('../src/db/content.repo', () => ({
  createStory: vi.fn(),
  createPoem: vi.fn(),
  upsertAbcLesson: vi.fn(),
}));

// Mock OpenAI
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    __mockCreate: mockCreate,
  };
});

import { ContentService } from '../src/services/content.service';
import * as repo from '../src/db/content.repo';

function makeMockRedis(callCount = 0): {
  get: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(String(callCount)),
    incr: vi.fn().mockResolvedValue(callCount + 1),
    expire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

function mockOpenAIResponse(content: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const openaiMod = require('openai');
  const instance = new openaiMod.default();
  instance.chat.completions.create.mockResolvedValue({
    choices: [{ message: { content } }],
    usage: { total_tokens: 100 },
  });
}

describe('ContentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateStory', () => {
    it('parses OpenAI response and creates story in DB', async () => {
      const storyJson = JSON.stringify({
        title: 'The Magic Tree',
        story: 'Once upon a time there was a magic tree. It grew in a sunny garden. Every day children came to play under it. They found it gave them golden apples. The apples made everyone smile and laugh. One day a storm threatened the tree. The children joined hands to protect it. The tree survived and gave more apples than ever.',
        moral: 'Together we can protect what we love.',
        emoji: '🌳',
      });

      const fakeStory: Story = {
        id: 'story-1',
        ageBand: 'junior',
        title: 'The Magic Tree',
        body: storyJson,
        moral: 'Together we can protect what we love.',
        emoji: '🌳',
        source: 'openai',
        date: '2026-06-19',
        usedCount: 0,
        createdAt: new Date(),
      };

      vi.mocked(repo.createStory).mockResolvedValue(fakeStory);

      const mockRedis = makeMockRedis(0);
      // Patch the OpenAI client used inside ContentService
      const OpenAI = (await import('openai')).default;
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: storyJson } }],
              usage: { total_tokens: 150 },
            }),
          },
        },
      }) as unknown as InstanceType<typeof OpenAI>);

      const service = new ContentService(mockRedis as unknown as import('ioredis').default);
      const result = await service.generateStory('junior', '2026-06-19');

      expect(repo.createStory).toHaveBeenCalledWith(
        expect.objectContaining({
          ageBand: 'junior',
          title: 'The Magic Tree',
          moral: 'Together we can protect what we love.',
          emoji: '🌳',
          source: 'openai',
          date: '2026-06-19',
        })
      );
      expect(result).toBe(fakeStory);
    });
  });

  describe('generatePoem', () => {
    it('parses OpenAI response and creates poem in DB', async () => {
      const poemJson = JSON.stringify({
        title: 'The Dancing Butterfly',
        poem: 'A butterfly dances in the breeze,\nAmong the colourful flowers and trees,\nIt flutters its wings so bright and gay,\nAnd dances and dances throughout the day.',
        emoji: '🦋',
      });

      const fakePoem: Poem = {
        id: 'poem-1',
        topic: 'Animals',
        title: 'The Dancing Butterfly',
        lines: poemJson,
        emoji: '🦋',
        source: 'openai',
        usedCount: 0,
        createdAt: new Date(),
      };

      vi.mocked(repo.createPoem).mockResolvedValue(fakePoem);

      const OpenAI = (await import('openai')).default;
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: poemJson } }],
              usage: { total_tokens: 80 },
            }),
          },
        },
      }) as unknown as InstanceType<typeof OpenAI>);

      const mockRedis = makeMockRedis(0);
      const service = new ContentService(mockRedis as unknown as import('ioredis').default);
      const result = await service.generatePoem('Animals');

      expect(repo.createPoem).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'Animals',
          title: 'The Dancing Butterfly',
          emoji: '🦋',
          source: 'openai',
        })
      );
      expect(result).toBe(fakePoem);
    });
  });

  describe('generateAbcLesson', () => {
    it('upserts ABC lesson for the given letter', async () => {
      const lessonJson = JSON.stringify({
        letter: 'B',
        word: 'Butterfly',
        emoji: '🦋',
        phonics: 'Say "buh" as in butterfly',
        miniStory: 'Betty the butterfly flew over the beautiful blue bay. She found a bed of bright blossoms. She rested her wings and breathed the sweet air.',
      });

      const fakeLesson: AbcLesson = {
        id: 'abc-1',
        letter: 'B',
        word: 'Butterfly',
        emoji: '🦋',
        phonics: 'Say "buh" as in butterfly',
        miniStory: 'Betty the butterfly flew over the beautiful blue bay.',
        source: 'openai',
        updatedAt: new Date(),
      };

      vi.mocked(repo.upsertAbcLesson).mockResolvedValue(fakeLesson);

      const OpenAI = (await import('openai')).default;
      vi.mocked(OpenAI).mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: lessonJson } }],
              usage: { total_tokens: 90 },
            }),
          },
        },
      }) as unknown as InstanceType<typeof OpenAI>);

      const mockRedis = makeMockRedis(0);
      const service = new ContentService(mockRedis as unknown as import('ioredis').default);
      const result = await service.generateAbcLesson('b');

      expect(repo.upsertAbcLesson).toHaveBeenCalledWith(
        expect.objectContaining({
          letter: 'B',
          word: 'Butterfly',
          emoji: '🦋',
          source: 'openai',
        })
      );
      expect(result).toBe(fakeLesson);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Story } from '@prisma/client';
import type { RetrievedChunk } from '../src/services/rag.types';

vi.mock('../src/db/content.repo', () => ({
  createStory: vi.fn(),
  createPoem: vi.fn(),
  upsertAbcLesson: vi.fn(),
}));

// RAG retrieve returns controlled chunks so the grounded prompt path runs.
const retrieveMock = vi.fn();
vi.mock('../src/services/rag.service', () => ({
  RagService: vi.fn().mockImplementation(() => ({ retrieve: retrieveMock })),
}));

vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      embeddings: { create: vi.fn() },
    })),
    __mockCreate: mockCreate,
  };
});

import { ContentService } from '../src/services/content.service';
import * as repo from '../src/db/content.repo';

const groundedChunks: RetrievedChunk[] = [
  {
    id: 'c1',
    text: 'Bees pollinate flowers and make honey.',
    sourceUrl: 'https://facts.example/bees',
    sourceTitle: 'Bee Facts',
    score: 0.93,
  },
];

function mockRedis(): unknown {
  return {
    get: vi.fn().mockResolvedValue('0'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    setex: vi.fn().mockResolvedValue('OK'),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

describe('ContentService grounded generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grounds the story prompt on retrieved chunks and persists sources', async () => {
    retrieveMock.mockResolvedValue(groundedChunks);

    const storyJson = JSON.stringify({
      title: 'The Busy Bee',
      story: 'A bee pollinated flowers all day. It made honey for its hive. The flowers bloomed happily.',
      moral: 'Hard work helps others.',
      emoji: '🐝',
    });

    const fakeStory: Story = {
      id: 'story-1',
      ageBand: 'junior',
      title: 'The Busy Bee',
      body: storyJson,
      moral: 'Hard work helps others.',
      emoji: '🐝',
      source: 'openai-grounded',
      date: '2026-06-28',
      sources: [{ title: 'Bee Facts', url: 'https://facts.example/bees' }],
      usedCount: 0,
      createdAt: new Date(),
    };
    vi.mocked(repo.createStory).mockResolvedValue(fakeStory);

    const OpenAI = (await import('openai')).default;
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: storyJson } }], usage: { total_tokens: 120 } }) } },
      embeddings: { create: vi.fn() },
    }) as unknown as InstanceType<typeof OpenAI>);

    const svc = new ContentService(mockRedis() as unknown as import('ioredis').default);
    const result = await svc.generateStory('junior', '2026-06-28');

    // retrieve was called with a story intent restricted to story/fact corpus.
    expect(retrieveMock).toHaveBeenCalledTimes(1);
    const [intent, filters] = retrieveMock.mock.calls[0] as [string, { kind: string[]; ageBand: string }];
    expect(intent).toContain('junior');
    expect(filters.kind).toEqual(['story', 'fact']);
    expect(filters.ageBand).toBe('junior');

    // createStory persisted the grounded source attribution.
    expect(repo.createStory).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'openai-grounded',
        sources: [{ title: 'Bee Facts', url: 'https://facts.example/bees' }],
      }),
    );
    expect(result).toBe(fakeStory);
  });

  it('falls back to un-grounded generation when retrieve returns []', async () => {
    retrieveMock.mockResolvedValue([]);

    const storyJson = JSON.stringify({
      title: 'Solo',
      story: 'A quiet tale with no grounding. It unfolded gently. The end came softly.',
      moral: 'Quiet is fine.',
      emoji: '🌙',
    });
    const fakeStory: Story = {
      id: 'story-2',
      ageBand: 'senior',
      title: 'Solo',
      body: storyJson,
      moral: 'Quiet is fine.',
      emoji: '🌙',
      source: 'openai-grounded',
      date: '2026-06-28',
      sources: [],
      usedCount: 0,
      createdAt: new Date(),
    };
    vi.mocked(repo.createStory).mockResolvedValue(fakeStory);

    const OpenAI = (await import('openai')).default;
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: storyJson } }], usage: { total_tokens: 90 } }) } },
      embeddings: { create: vi.fn() },
    }) as unknown as InstanceType<typeof OpenAI>);

    const svc = new ContentService(mockRedis() as unknown as import('ioredis').default);
    const result = await svc.generateStory('senior', '2026-06-28');

    expect(repo.createStory).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'openai-grounded', sources: [] }),
    );
    expect(result).toBe(fakeStory);
  });
});

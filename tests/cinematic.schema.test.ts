import { describe, it, expect } from 'vitest';
import { cinematicStorySchema } from '../src/services/cinematic.schema';
import { cinematicSeedStories } from '../prisma/cinematic-seed';

// A minimal valid document builders can tweak per test.
function validDoc(): Record<string, unknown> {
  return {
    title: 'The Thirsty Crow',
    lang: 'en',
    ageBand: 'junior',
    category: 'Moral Stories',
    coverEmoji: '🐦‍⬛',
    music: 'forest',
    moral: 'Where there is a will, there is a way.',
    reward: { stars: 10, coins: 5, badgeStickerId: 'star' },
    scenes: [
      {
        id: 1,
        title: 'A Hot Day',
        minDuration: 8,
        background: 'hot_day',
        narration: 'It was a very hot day.',
        camera: { effect: 'zoom_in' },
        props: [{ id: 'sun', kind: 'sun', x: 0.8, y: 0.2, scale: 1 }],
        characters: [{ id: 'crow', kind: 'crow', x: 0.4, y: 0.5, scale: 1, animation: 'fly' }],
        particles: ['sun_rays'],
        interaction: { type: 'tap', target: 'sun', hint: 'Touch the sun!', sound: 'chime' },
      },
      {
        id: 2,
        title: 'The Pot',
        minDuration: 8,
        background: 'village',
        narration: 'The crow found a pot.',
        camera: { effect: 'none' },
        props: [{ id: 'pot', kind: 'pot', x: 0.6, y: 0.75, scale: 1 }],
        characters: [{ id: 'crow', kind: 'crow', x: 0.3, y: 0.4, scale: 1, animation: 'idle' }],
        particles: [],
        interaction: { type: 'drag', target: 'crow', dropZone: 'pot', hint: 'Drag the crow!', sound: 'plop' },
      },
      {
        id: 3,
        title: 'The End',
        minDuration: 8,
        background: 'sky',
        narration: 'Where there is a will, there is a way.',
        camera: { effect: 'zoom_out' },
        props: [],
        characters: [{ id: 'crow', kind: 'crow', x: 0.5, y: 0.4, scale: 1, animation: 'fly' }],
        particles: ['birds'],
        interaction: null,
      },
    ],
  };
}

describe('cinematicStorySchema', () => {
  it('accepts a valid document', () => {
    const result = cinematicStorySchema.safeParse(validDoc());
    expect(result.success).toBe(true);
  });

  it('accepts both bundled seed stories (the contract with the app)', () => {
    for (const story of cinematicSeedStories) {
      const result = cinematicStorySchema.safeParse({
        title: story.title,
        lang: story.lang,
        ageBand: story.ageBand,
        category: story.category,
        coverEmoji: story.coverEmoji,
        music: story.music,
        moral: story.moral,
        reward: story.reward,
        scenes: story.scenes,
      });
      expect(result.success, `seed ${story.slug} failed: ${JSON.stringify(result.success ? '' : result.error.issues)}`).toBe(true);
    }
  });

  it('applies defaults for optional staging fields', () => {
    const doc = validDoc();
    const scenes = doc['scenes'] as Record<string, unknown>[];
    delete scenes[2]['camera'];
    delete scenes[2]['minDuration'];
    delete scenes[2]['particles'];
    const result = cinematicStorySchema.parse(doc);
    expect(result.scenes[2].camera.effect).toBe('none');
    expect(result.scenes[2].minDuration).toBe(8);
    expect(result.scenes[2].particles).toEqual([]);
  });

  it('rejects unknown background / kind enums', () => {
    const doc = validDoc();
    (doc['scenes'] as Record<string, unknown>[])[0]['background'] = 'beach';
    expect(cinematicStorySchema.safeParse(doc).success).toBe(false);

    const doc2 = validDoc();
    ((doc2['scenes'] as Record<string, unknown>[])[0]['characters'] as Record<string, unknown>[])[0]['kind'] = 'dinosaur';
    expect(cinematicStorySchema.safeParse(doc2).success).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    const doc = validDoc();
    ((doc['scenes'] as Record<string, unknown>[])[0]['props'] as Record<string, unknown>[])[0]['x'] = 1.4;
    expect(cinematicStorySchema.safeParse(doc).success).toBe(false);
  });

  it('rejects an interaction target that is not staged in the scene', () => {
    const doc = validDoc();
    ((doc['scenes'] as Record<string, unknown>[])[0]['interaction'] as Record<string, unknown>)['target'] = 'moon';
    const result = cinematicStorySchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects a drag interaction without a dropZone', () => {
    const doc = validDoc();
    delete ((doc['scenes'] as Record<string, unknown>[])[1]['interaction'] as Record<string, unknown>)['dropZone'];
    expect(cinematicStorySchema.safeParse(doc).success).toBe(false);
  });

  it('rejects a drag dropZone that is not staged in the scene', () => {
    const doc = validDoc();
    ((doc['scenes'] as Record<string, unknown>[])[1]['interaction'] as Record<string, unknown>)['dropZone'] = 'well';
    expect(cinematicStorySchema.safeParse(doc).success).toBe(false);
  });

  it('rejects too few scenes', () => {
    const doc = validDoc();
    doc['scenes'] = (doc['scenes'] as unknown[]).slice(0, 2);
    expect(cinematicStorySchema.safeParse(doc).success).toBe(false);
  });
});

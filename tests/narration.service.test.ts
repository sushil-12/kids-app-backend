import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Redis from 'ioredis';

vi.mock('../src/db/pack.repo', () => ({
  getPackById: vi.fn(),
  findClip: vi.fn(),
  upsertClip: vi.fn(),
  replacePack: vi.fn(),
  // Returns the storage keys it removed, so the caller can clear the bucket.
  deleteOrphanClips: vi.fn().mockResolvedValue([]),
  getClipById: vi.fn(),
}));

const deleteObject = vi.fn();

// The store is exercised on its own in media.store.test.ts; here we only care
// that the service persists through it and cleans up after itself.
vi.mock('../src/services/media.store', () => ({
  UPLOADABLE_IMAGE_TYPES: ['image/png'],
  mediaStore: {
    canUpload: false,
    narrationUrl: (id: string) => `https://api.test.local/v1/media/narration/${id}.mp3`,
    // Stands in for the Postgres store: writes the row, hands back its URL.
    // Resolved at call time, not in this factory — a factory runs before the
    // module graph settles and would capture a different mock instance.
    async putNarration(input: unknown) {
      const { upsertClip } = await import('../src/db/pack.repo');
      const clip = await upsertClip(input as Parameters<typeof upsertClip>[0]);
      return { id: clip.id, url: `https://api.test.local/v1/media/narration/${clip.id}.mp3` };
    },
    getNarration: vi.fn(),
    presignUpload: vi.fn(),
    deleteObject: (...args: unknown[]) => deleteObject(...args),
  },
}));

import * as repo from '../src/db/pack.repo';
import {
  NarrationService,
  NarrationBudgetException,
  marksFrom,
  type ElevenAlignment,
} from '../src/services/narration.service';

// A two-moment bilingual pack: 4 narration clips, plus a gate prompt on m2.
function pack(): Record<string, unknown> {
  return {
    id: 'pack-1',
    slug: 'thirsty-crow',
    kind: 'story',
    schemaVersion: '3.0',
    title: { en: 'The Thirsty Crow', hi: 'प्यासा कौआ' },
    availableLangs: ['en', 'hi'],
    ageBand: 'junior',
    category: 'Moral Stories',
    concepts: [],
    moral: { en: 'Little by little.', hi: 'थोड़ा-थोड़ा।' },
    estimatedDuration: 60,
    cover: { emoji: '🐦‍⬛' },
    audio: {},
    reward: { stars: 10 },
    assetManifest: [],
    moments: [
      { id: 'm1', title: 'One', narration: { text: { en: 'Hello', hi: 'नमस्ते' } } },
      {
        id: 'm2',
        title: 'Two',
        narration: { text: { en: 'Goodbye', hi: 'अलविदा' } },
        softGate: { mode: 'soft_gate', prompt: { en: 'Tap!', hi: 'छुओ!' } },
      },
    ],
    topic: null,
    letter: null,
    date: null,
    source: 'seed',
    published: true,
    usedCount: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function redisStub(used = 0): Redis {
  let counter = used;
  return {
    get: vi.fn(async () => String(counter)),
    incrby: vi.fn(async (_k: string, n: number) => {
      counter += n;
      return counter;
    }),
    expire: vi.fn(async () => 1),
  } as unknown as Redis;
}

/** Character-level alignment in the shape ElevenLabs returns it, for whatever
 *  text the caller sent — one character, one start/end time, 100ms apart. */
function alignmentFor(text: string): Record<string, unknown> {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.1),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1),
  };
}

/** The /with-timestamps response: base64 audio plus the alignment block. */
function elevenResponse(text: string, bytes = 'mp3'): Record<string, unknown> {
  return {
    ok: true,
    json: async () => ({
      audio_base64: Buffer.from(bytes).toString('base64'),
      alignment: alignmentFor(text),
    }),
  };
}

function mockElevenLabs(bytes = 'mp3'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const text = String(
        (JSON.parse(init?.body ?? '{}') as { text?: string }).text ?? '',
      );
      return elevenResponse(text, bytes);
    }),
  );
}

describe('NarrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(repo.getPackById).mockResolvedValue(pack() as never);
    vi.mocked(repo.findClip).mockResolvedValue(null);
    vi.mocked(repo.upsertClip).mockImplementation(
      async (data) => ({ id: `clip-${data.momentId}-${data.lang}-${data.kind}`, ...data }) as never,
    );
    vi.mocked(repo.replacePack).mockResolvedValue(null);
  });

  it('records one clip per moment per language, plus soft-gate prompts', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());

    const result = await service.generateForPack('pack-1');

    // 2 moments × 2 langs = 4 narration clips, + 2 gate prompts on m2.
    expect(result.generated).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.clips.filter((c) => c.kind === 'gate')).toHaveLength(2);
  });

  it('uses the Hindi voice for Hindi text', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1', { langs: ['hi'] });

    const hindiCall = vi.mocked(repo.upsertClip).mock.calls.find((c) => c[0].lang === 'hi');
    expect(hindiCall?.[0].voiceId).toBe(process.env['ELEVEN_VOICE_HI'] ?? '21m00Tcm4TlvDq8ikWAM');
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body.text).toBe('नमस्ते');
    expect(body.model_id).toBe('eleven_multilingual_v2');
  });

  it('skips a clip whose text has not changed — regenerating is free', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());

    // First run to learn what hash the unchanged text produces.
    await service.generateForPack('pack-1', { langs: ['en'] });
    const hashes = new Map(
      vi.mocked(repo.upsertClip).mock.calls.map((c) => [
        `${c[0].momentId}:${c[0].kind}`,
        c[0].contentHash,
      ]),
    );

    vi.clearAllMocks();
    mockElevenLabs();
    vi.mocked(repo.getPackById).mockResolvedValue(pack() as never);
    vi.mocked(repo.findClip).mockImplementation(
      async (_p, momentId, _l, kind) =>
        ({ id: 'existing', contentHash: hashes.get(`${momentId}:${kind}`) }) as never,
    );

    const second = await service.generateForPack('pack-1', { langs: ['en'] });
    expect(second.generated).toBe(0);
    expect(second.skipped).toBe(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-records everything when force is set', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    vi.mocked(repo.findClip).mockResolvedValue({ id: 'x', contentHash: 'anything' } as never);

    const result = await service.generateForPack('pack-1', { langs: ['en'], force: true });
    expect(result.generated).toBe(3);
  });

  it('records only the requested moments', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());

    const result = await service.generateForPack('pack-1', { langs: ['en'], momentIds: ['m1'] });
    expect(result.generated).toBe(1);
    expect(result.clips[0].momentId).toBe('m1');
  });

  it('writes clip URLs back into the pack as a bilingual map', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1');

    expect(repo.replacePack).toHaveBeenCalledOnce();
    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    const moments = saved.moments as unknown as Record<string, unknown>[];
    const audio = (moments[0].narration as Record<string, unknown>).audio as Record<string, string>;
    // Both languages in one document — the app collapses it like any text node.
    expect(audio.en).toContain('/v1/media/narration/');
    expect(audio.hi).toContain('/v1/media/narration/');
    expect(audio.en).not.toBe(audio.hi);
  });

  it('stops the run when the daily character budget is spent', async () => {
    mockElevenLabs();
    // The limit is 1000 chars in tests/setup.ts.
    const service = new NarrationService(redisStub(999));

    await expect(service.generateForPack('pack-1')).rejects.toBeInstanceOf(NarrationBudgetException);
  });

  it('reports a failed clip and keeps going — one bad line is not fatal', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return { ok: false, status: 429, text: async () => 'rate limited' };
        return elevenResponse('Hello');
      }),
    );

    const service = new NarrationService(redisStub());
    const result = await service.generateForPack('pack-1', { langs: ['en'] });

    expect(result.failed).toBe(1);
    expect(result.generated).toBe(2);
    expect(result.errors[0]).toContain('429');
  });

  it('drops clips for moments that no longer exist', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1', { langs: ['en'] });

    expect(repo.deleteOrphanClips).toHaveBeenCalledWith('pack-1', ['m1', 'm2']);
  });

  it('clears the bucket objects of orphaned clips, not just their rows', async () => {
    mockElevenLabs();
    // A scene was deleted in the editor; its audio must not linger in storage.
    vi.mocked(repo.deleteOrphanClips).mockResolvedValue([
      'brightmind/narration/aaa.mp3',
      'brightmind/narration/bbb.mp3',
    ]);

    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1', { langs: ['en'] });

    expect(deleteObject).toHaveBeenCalledWith('brightmind/narration/aaa.mp3');
    expect(deleteObject).toHaveBeenCalledWith('brightmind/narration/bbb.mp3');
  });

  it('reuses a stored clip’s own URL when skipping it, not a rebuilt one', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());

    // First pass to learn the hashes an unchanged pack produces.
    await service.generateForPack('pack-1', { langs: ['en'] });
    const hashes = new Map(
      vi.mocked(repo.upsertClip).mock.calls.map((c) => [
        `${c[0].momentId}:${c[0].kind}`,
        c[0].contentHash,
      ]),
    );

    vi.clearAllMocks();
    mockElevenLabs();
    vi.mocked(repo.getPackById).mockResolvedValue(pack() as never);
    vi.mocked(repo.deleteOrphanClips).mockResolvedValue([]);
    // A clip already in the bucket carries its CDN link.
    vi.mocked(repo.findClip).mockImplementation(
      async (_p, momentId, _l, kind) =>
        ({
          id: 'existing',
          contentHash: hashes.get(`${momentId}:${kind}`),
          url: `https://cdn.example.com/${momentId}.mp3`,
        }) as never,
    );

    await service.generateForPack('pack-1', { langs: ['en'] });

    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    const moments = saved.moments as unknown as Record<string, unknown>[];
    const audio = (moments[0].narration as Record<string, unknown>).audio as Record<string, string>;
    // Not the /v1/media/... fallback — the pack keeps pointing at the CDN.
    expect(audio.en).toBe('https://cdn.example.com/m1.mp3');
  });

  it('writes word timings into the pack so a rhyme can highlight along', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1', { langs: ['en'] });

    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    const moments = saved.moments as unknown as Record<string, unknown>[];
    const narration = moments[0].narration as Record<string, unknown>;

    // "Hello" is one word, and the stub times characters 100ms apart.
    expect((narration.marks as Record<string, unknown>).en).toEqual([{ w: 'Hello', t: 0 }]);
    expect((narration.audioDurationMs as Record<string, number>).en).toBe(500);
  });

  it('keeps a skipped clip’s timings — a free re-run must not go silent', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());

    await service.generateForPack('pack-1', { langs: ['en'] });
    const hashes = new Map(
      vi.mocked(repo.upsertClip).mock.calls.map((c) => [
        `${c[0].momentId}:${c[0].kind}`,
        c[0].contentHash,
      ]),
    );

    vi.clearAllMocks();
    mockElevenLabs();
    vi.mocked(repo.getPackById).mockResolvedValue(pack() as never);
    vi.mocked(repo.deleteOrphanClips).mockResolvedValue([]);
    // The stored row carries the marks recorded on the first run.
    vi.mocked(repo.findClip).mockImplementation(
      async (_p, momentId, _l, kind) =>
        ({
          id: 'existing',
          contentHash: hashes.get(`${momentId}:${kind}`),
          url: `https://cdn.example.com/${momentId}.mp3`,
          marks: [{ w: 'Hello', t: 0 }],
          durationMs: 500,
        }) as never,
    );

    const second = await service.generateForPack('pack-1', { langs: ['en'] });
    expect(second.generated).toBe(0);

    const saved = vi.mocked(repo.replacePack).mock.calls[0][1];
    const moments = saved.moments as unknown as Record<string, unknown>[];
    const narration = moments[0].narration as Record<string, unknown>;
    expect((narration.marks as Record<string, unknown>).en).toEqual([{ w: 'Hello', t: 0 }]);
  });

  it('persists the timings on the clip row, not only in the pack', async () => {
    mockElevenLabs();
    const service = new NarrationService(redisStub());
    await service.generateForPack('pack-1', { langs: ['en'], momentIds: ['m1'] });

    const call = vi.mocked(repo.upsertClip).mock.calls[0][0];
    expect(call.marks).toEqual([{ w: 'Hello', t: 0 }]);
    expect(call.durationMs).toBe(500);
  });

  it('still stores the audio when the API reports no alignment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ audio_base64: Buffer.from('mp3').toString('base64') }),
      })),
    );

    const service = new NarrationService(redisStub());
    const result = await service.generateForPack('pack-1', { langs: ['en'], momentIds: ['m1'] });

    // A clip with no marks narrates fine; the player highlights whole lines.
    expect(result.generated).toBe(1);
    expect(vi.mocked(repo.upsertClip).mock.calls[0][0].marks).toEqual([]);
  });
});

describe('marksFrom', () => {
  const align = (text: string, step = 0.1): ElevenAlignment => {
    const characters = [...text];
    return {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * step),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * step),
    };
  };

  it('emits one mark per word, timed to the word’s first character', () => {
    expect(marksFrom(align('a bee'))).toEqual([
      { w: 'a', t: 0 },
      { w: 'bee', t: 0.2 },
    ]);
  });

  it('keeps punctuation attached to its word — the verse prints it', () => {
    // "Buzz, bee!" — the highlight should cover the word as it appears.
    expect(marksFrom(align('Buzz, bee!')).map((m) => m.w)).toEqual(['Buzz,', 'bee!']);
  });

  it('drops tokens that are only punctuation', () => {
    // An em-dash between clauses is not a word a child follows.
    expect(marksFrom(align('up — down')).map((m) => m.w)).toEqual(['up', 'down']);
  });

  it('treats newlines as word boundaries, so verse lines split', () => {
    expect(marksFrom(align('one\ntwo')).map((m) => m.w)).toEqual(['one', 'two']);
  });

  it('handles Devanagari — a Hindi rhyme highlights like an English one', () => {
    expect(marksFrom(align('मछली जल')).map((m) => m.w)).toEqual(['मछली', 'जल']);
  });

  it('returns nothing rather than throwing when the alignment is absent', () => {
    expect(marksFrom(undefined)).toEqual([]);
    expect(marksFrom(null)).toEqual([]);
    expect(marksFrom({ characters: [] } as unknown as ElevenAlignment)).toEqual([]);
  });
});

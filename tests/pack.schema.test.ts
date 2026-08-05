import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePack, pickLang } from '../src/services/pack.schema';
import { abcPack } from '../prisma/seed.packs';
import { rhymePack, rhymePacks, type SeedRhyme } from '../prisma/seed.rhymes';

// The pack schema is the contract with the Flutter player. These tests pin the
// two things that matter most: the real reference pack must keep validating
// (so a schema tweak can't silently orphan shipped content), and the failures
// that would reach a child as a blank screen must actually be failures.

const SEED_DIR = join(__dirname, '..', 'prisma', 'seed-data');

function thirstyCrow(): Record<string, unknown> {
  const raw = JSON.parse(
    readFileSync(join(SEED_DIR, 'pack_thirsty_crow.json'), 'utf8'),
  ) as Record<string, unknown>;
  raw.kind = 'story';
  return raw;
}

const fallbacks = JSON.parse(
  readFileSync(join(SEED_DIR, 'learn-fallbacks.json'), 'utf8'),
) as {
  abcLessons: { letter: string; word: string; wordHi: string; emoji: string; phonics: string; miniStory: string }[];
};

/** A minimal valid rhyme, for the poem-rule tests to bend one field at a time. */
function seedRhyme(overrides: Partial<SeedRhyme> = {}): SeedRhyme {
  return {
    title: 'Twinkle, Twinkle, Little Star',
    topic: 'Nature',
    emoji: '⭐',
    mood: 'calm',
    source: 'folk',
    stanzas: [['Twinkle, twinkle, little star,', 'How I wonder what you are!']],
    ...overrides,
  };
}

describe('pack schema — the reference pack', () => {
  it('validates the shipped Thirsty Crow pack unchanged', () => {
    const result = validatePack(thirstyCrow());
    expect(result.ok ? null : result.errors).toBeNull();
  });

  it('keeps every field the app reads, so a stored pack round-trips', () => {
    const raw = thirstyCrow();
    const result = validatePack(raw);
    if (!result.ok) throw new Error('expected valid');

    expect(result.data.slug).toBe('thirsty-crow');
    expect(result.data.availableLangs).toEqual(['en', 'hi']);
    expect(result.data.moments).toHaveLength(8);
    expect(result.data.assetManifest).toHaveLength(9);
    // Every moment in the reference pack is image-backed.
    expect(result.data.moments.every((m) => m.visual?.primary === 'image')).toBe(true);
  });
});

describe('pack schema — content that would break the player', () => {
  it('rejects a moment pointing at an asset id that is not in the manifest', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    (moments[2].visual as Record<string, unknown>).asset = 'img_does_not_exist';

    const result = validatePack(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('img_does_not_exist');
  });

  it('rejects a cover pointing at a missing asset id', () => {
    const raw = thirstyCrow();
    (raw.cover as Record<string, unknown>).image = 'nope';
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects an image moment with no asset at all', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    delete (moments[0].visual as Record<string, unknown>).asset;
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects duplicate moment ids, which would collide narration clips', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    moments[1].id = moments[0].id;
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects a cue aimed at something not staged in the moment', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    (moments[0].cues as Record<string, unknown>[])[0].target = 'ghost';
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects a non-https asset url', () => {
    const raw = thirstyCrow();
    (raw.assetManifest as Record<string, unknown>[])[0].url = 'http://insecure.example.com/a.png';
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects an unknown cue type instead of silently dropping the beat', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    (moments[0].cues as Record<string, unknown>[])[0].type = 'teleport';
    expect(validatePack(raw).ok).toBe(false);
  });

  it('rejects a pack that advertises Hindi but has an English-only moment', () => {
    const raw = thirstyCrow();
    const moments = raw.moments as Record<string, unknown>[];
    (moments[3].narration as Record<string, unknown>).text = 'English only now';
    const result = validatePack(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('Hindi');
  });

  it('requires a topic on poems and a letter on ABC packs', () => {
    const poem = rhymePack(seedRhyme(), 'en');
    delete poem.topic;
    expect(validatePack(poem).ok).toBe(false);

    const abc = abcPack(fallbacks.abcLessons[0]);
    delete abc.letter;
    expect(validatePack(abc).ok).toBe(false);
  });
});

// A rhyme is not a story with shorter lines. These pin the three rules that
// keep the sing-along player from being handed something it cannot lay out.
describe('pack schema — rhyme rules', () => {
  it('accepts a monolingual Hindi rhyme with plain-string text', () => {
    const doc = rhymePack(
      seedRhyme({
        title: 'मछली जल की रानी है',
        // Devanagari has no ASCII form, so the address is authored, not derived.
        slug: 'machhli-jal-ki-rani',
        topic: 'Animals',
        emoji: '🐟',
        stanzas: [['मछली जल की रानी है,', 'जीवन उसका पानी है।']],
      }),
      'hi',
    );
    const result = validatePack(doc);
    // The bilingual "every language needs text" rule must not fire here: there
    // is no second language to fall back from, so the text is Hindi, full stop.
    expect(result.ok ? null : result.errors).toBeNull();
  });

  it('rejects a poem that claims two languages', () => {
    const doc = rhymePack(seedRhyme(), 'en');
    doc.availableLangs = ['en', 'hi'];
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('ONE language');
  });

  it('rejects a poem whose text is a per-language map', () => {
    const doc = rhymePack(seedRhyme(), 'en');
    // The shape every OTHER pack field is allowed to use — and exactly what a
    // translated rhyme would look like.
    doc.title = { en: 'Twinkle', hi: 'टिमटिम' };
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('plain string');
  });

  it('rejects a poem with no lyric lines', () => {
    const doc = rhymePack(seedRhyme(), 'en');
    for (const moment of doc.moments as Record<string, unknown>[]) {
      delete moment.verse;
    }
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('lyric lines');
  });

  it('speaks exactly the lines it prints', () => {
    const doc = rhymePack(seedRhyme(), 'en');
    const moment = (doc.moments as Record<string, unknown>[])[0];
    const narration = moment.narration as { text: string };
    // Same words, one spoken line — so the word timings the narration job
    // produces line up with the verse on screen.
    expect(narration.text).toBe((moment.verse as string[]).join(' '));
  });

  it('allows an animated GIF as a moment picture', () => {
    const doc = rhymePack(seedRhyme(), 'en');
    doc.assetManifest = [
      {
        id: 'star-loop',
        type: 'gif',
        url: 'https://cdn.example.com/star.webp',
        loop: true,
        durationMs: 1800,
        width: 480,
        height: 480,
      },
    ];
    const moment = (doc.moments as Record<string, unknown>[])[0];
    moment.visual = { primary: 'image', asset: 'star-loop' };

    const result = validatePack(doc);
    expect(result.ok ? null : result.errors).toBeNull();
  });
});

describe('pack schema — the seeded migration of hardcoded app content', () => {
  it('turns all 26 ABC lessons into valid packs', () => {
    expect(fallbacks.abcLessons).toHaveLength(26);
    for (const lesson of fallbacks.abcLessons) {
      const result = validatePack(abcPack(lesson));
      expect(result.ok ? null : { letter: lesson.letter, errors: result.errors }).toBeNull();
    }
  });

  it('turns every seeded rhyme into a valid pack', () => {
    const docs = rhymePacks();
    for (const doc of docs) {
      const result = validatePack(doc);
      expect(result.ok ? null : { slug: doc.slug, errors: result.errors }).toBeNull();
    }
  });

  it('gives every rhyme a unique slug across both languages', () => {
    const slugs = rhymePacks().map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('leaves no topic with a single lonely tile', () => {
    // The bug this whole surface exists to fix: a shelf that renders one card
    // and a screen of empty space. Fewer than two rhymes in a topic means the
    // grid looks broken, so a thin topic is a content bug to catch here.
    const counts = new Map<string, number>();
    for (const doc of rhymePacks()) {
      const key = `${(doc.availableLangs as string[])[0]}/${String(doc.topic)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const thin = [...counts.entries()].filter(([, n]) => n < 2);
    expect(thin).toEqual([]);
  });

  it('preserves the Hindi word that only existed in AbcLesson.wordHi', () => {
    const lesson = fallbacks.abcLessons.find((l) => l.letter === 'A');
    if (!lesson) throw new Error('letter A missing from the extracted fallbacks');
    const doc = abcPack(lesson);
    const firstMoment = (doc.moments as Record<string, unknown>[])[0];
    expect(pickLang(firstMoment.title, 'hi')).toContain(lesson.wordHi);
  });
});

// The letter card is what a child actually touches on the ABC screen, so these
// pin the authoring mistakes that would reach them as a blank tile, a silent
// button, or — worst — a wrong letter sound.
describe('pack schema — the ABC letter card', () => {
  /** A valid letter pack, ready to be broken one field at a time. */
  const letterDoc = (): Record<string, unknown> =>
    abcPack(fallbacks.abcLessons.find((l) => l.letter === 'A')!);

  const spec = (doc: Record<string, unknown>): Record<string, unknown> =>
    doc.letterSpec as Record<string, unknown>;

  const words = (doc: Record<string, unknown>): Record<string, unknown>[] =>
    spec(doc).words as Record<string, unknown>[];

  it('gives every seeded letter a card with real words, a name and a sound', () => {
    for (const lesson of fallbacks.abcLessons) {
      const s = spec(abcPack(lesson));
      expect(s, `letter ${lesson.letter} has no letterSpec`).toBeTruthy();
      expect((s.words as unknown[]).length).toBeGreaterThanOrEqual(3);
      expect(pickLang((s.name as Record<string, unknown>).text, 'en')).not.toBe('');
      expect(pickLang((s.phoneme as Record<string, unknown>).say, 'en')).not.toBe('');
    }
  });

  it('rejects an ABC pack with no letter card at all', () => {
    const doc = letterDoc();
    delete doc.letterSpec;
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('letterSpec');
  });

  // A letter is a card, not a timeline: the glyph, its sound and its pictures
  // are the whole lesson, and the cinematic behind "Watch the story!" is an
  // extra. Requiring a scene forced every letter through the story editor and
  // made someone pick the weather and camera drift for the letter A.
  it('accepts a letter with no scenes at all', () => {
    const doc = letterDoc();
    doc.moments = [];
    expect(validatePack(doc).ok).toBe(true);
  });

  it('still requires a scene on a story, which IS its timeline', () => {
    const doc = thirstyCrow();
    doc.moments = [];
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('at least one scene');
  });

  // The app shows 3 word tiles and puts the rest behind "See more", so
  // authoring past 3 fills a second screen rather than crowding the first.
  it('allows a fuller picture set than fits on the card', () => {
    const doc = letterDoc();
    const extra = Array.from({ length: 9 }, (_, i) => ({
      id: `extra_${i}`,
      text: `word${i}`,
      emoji: '🍎',
    }));
    spec(doc).words = [...words(doc).slice(0, 3), ...extra];
    expect((spec(doc).words as unknown[]).length).toBe(12);
    expect(validatePack(doc).ok).toBe(true);
  });

  it('rejects a word picture that is not in the manifest', () => {
    const doc = letterDoc();
    words(doc)[0].image = 'img_nope';
    expect(validatePack(doc).ok).toBe(false);
  });

  it('rejects duplicate word ids, which would collide narration clips', () => {
    const doc = letterDoc();
    words(doc)[1].id = words(doc)[0].id;
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('duplicate word id');
  });

  it('rejects a word with neither a picture nor an emoji — a blank tap target', () => {
    const doc = letterDoc();
    delete words(doc)[0].emoji;
    expect(validatePack(doc).ok).toBe(false);
  });

  it('rejects a glyph that disagrees with the pack it is filed under', () => {
    const doc = letterDoc();
    (spec(doc).glyph as Record<string, unknown>).upper = 'B';
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('does not match');
  });

  it('insists latin letters carry both cases — they are taught as a pair', () => {
    const doc = letterDoc();
    delete (spec(doc).glyph as Record<string, unknown>).lower;
    expect(validatePack(doc).ok).toBe(false);
  });

  it('rejects Hindi in availableLangs when a word has no Hindi text', () => {
    const doc = letterDoc();
    doc.availableLangs = ['en', 'hi'];
    delete (words(doc)[0].text as Record<string, unknown>).hi;
    const result = validatePack(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain('Hindi');
  });

  // A letter sound is the one asset a voice engine must never improvise: reading
  // the glyph yields the letter NAME or a schwa ("buh"), and schwa-contaminated
  // sounds break blending later. So the sound is authored, and it is never the
  // letter itself.
  it('never lets the spoken sound be the bare glyph', () => {
    for (const lesson of fallbacks.abcLessons) {
      const s = spec(abcPack(lesson));
      const say = pickLang((s.phoneme as Record<string, unknown>).say, 'en');
      const upper = (s.glyph as Record<string, string>).upper;
      expect(say, `letter ${upper} would be read as its own name`).not.toBe(upper);
      expect(say).not.toBe(upper.toLowerCase());
      expect(say.endsWith('uh'), `letter ${upper} has a schwa in "${say}"`).toBe(false);
    }
  });

  it('teaches letters in s-a-t-p-i-n order, not alphabetically', () => {
    const byOrder = fallbacks.abcLessons
      .map((l) => spec(abcPack(l)))
      .sort((a, b) => (a.order as number) - (b.order as number))
      .map((s) => (s.glyph as Record<string, string>).upper);
    expect(byOrder.slice(0, 6).join('')).toBe('SATPIN');
    // Every letter has a distinct slot, so the guided path is a total order.
    expect(new Set(byOrder).size).toBe(26);
  });
});

describe('pickLang', () => {
  it('collapses a bilingual node like the Dart parser does', () => {
    expect(pickLang({ en: 'Hello', hi: 'नमस्ते' }, 'hi')).toBe('नमस्ते');
    expect(pickLang({ en: 'Hello', hi: 'नमस्ते' }, 'en')).toBe('Hello');
    // Falls back to English when the language is missing, never to blank.
    expect(pickLang({ en: 'Hello' }, 'hi')).toBe('Hello');
    expect(pickLang('plain', 'hi')).toBe('plain');
    expect(pickLang(undefined, 'en')).toBe('');
  });
});

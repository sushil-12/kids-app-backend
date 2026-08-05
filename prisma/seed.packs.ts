import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { validatePack } from '../src/services/pack.schema';
import { rhymePacks } from './seed.rhymes';

// Seeds the content-pack library with everything that used to be hardcoded in
// the Flutter app:
//
//   • The Thirsty Crow — the reference cinematic story, previously a bundled
//     JSON asset (backend_samples/cinematic_story_v3_thirsty_crow.json).
//   • 26 ABC letters — previously `LearnFallbacks` in
//     lib/src/features/learn/data/learn_content.dart, extracted verbatim into
//     seed-data/learn-fallbacks.json so nothing was retyped or lost.
//   • The rhyme library — built by seed.rhymes.ts from its own files. It used
//     to be five poems chopped into couplets here; see that file for why a
//     rhyme needs a different shape from a story.
//
// Everything lands PUBLISHED so the app behaves exactly as it did before the
// move; admins then enrich each pack with pictures and recorded narration.
//
// On language: the crow is genuinely bilingual and stays that way. The ABC
// content only ever existed in English, so those packs are seeded
// `availableLangs: ["en"]` rather than inventing Hindi text. The one piece of
// Hindi that did exist — `AbcLesson.wordHi` — is preserved as the bilingual
// title of each letter's first moment. An admin adds Hindi narration in the
// portal and flips availableLangs; the pack validator then enforces that every
// moment actually has Hindi before it can be published.
//
// Rhymes are the deliberate exception: they are never bilingual. English and
// Hindi rhymes are separate packs, because rhyme does not survive translation.

const prisma = new PrismaClient();
const SEED_DIR = join(__dirname, 'seed-data');

interface AbcLesson {
  letter: string;
  word: string;
  wordHi: string;
  emoji: string;
  phonics: string;
  miniStory: string;
}

/** One row of seed-data/alphabet-latin.json — the letter CARD, as distinct from
 *  the letter's mini-story. See that file's `_readme` for the selection rules
 *  behind the words and the phoneme `say` strings. */
interface AlphabetEntry {
  letter: string;
  order: number;
  glyph: { upper: string; lower: string };
  name: { en: string; hi?: string };
  phoneme: { ipa?: string; say: { en: string; hi?: string } };
  articulation?: { en: string; hi?: string };
  words: {
    id: string;
    en: string;
    hi?: string;
    emoji: string;
    sentence?: { en: string; hi?: string };
  }[];
}

const alphabetLatin = (
  JSON.parse(readFileSync(join(SEED_DIR, 'alphabet-latin.json'), 'utf8')) as {
    letters: AlphabetEntry[];
  }
).letters;

const alphabetByLetter = new Map<string, AlphabetEntry>(
  alphabetLatin.map((entry) => [entry.letter.toUpperCase(), entry]),
);

/** The alphabet row → the pack's `letterSpec`.
 *
 *  Shapes differ on purpose: the seed file is flat and pleasant to hand-edit
 *  (`"en": "apple", "hi": "सेब"`), the wire is the bilingual `{ en, hi }` maps
 *  every other pack field uses. `audio` is deliberately absent — clip URLs are
 *  written by the narration job, never seeded. */
function letterSpecOf(entry: AlphabetEntry): Record<string, unknown> {
  const bilingual = (en: string, hi?: string): Record<string, string> =>
    hi ? { en, hi } : { en };

  return {
    script: 'latin',
    order: entry.order,
    // Copied, not aliased: the dataset is loaded once at module scope, so
    // handing out the same `glyph` object would let one pack's edit reach every
    // other pack built from the same letter.
    glyph: { upper: entry.glyph.upper, lower: entry.glyph.lower },
    name: { text: bilingual(entry.name.en, entry.name.hi) },
    phoneme: {
      ...(entry.phoneme.ipa ? { ipa: entry.phoneme.ipa } : {}),
      say: bilingual(entry.phoneme.say.en, entry.phoneme.say.hi),
    },
    ...(entry.articulation
      ? { articulation: bilingual(entry.articulation.en, entry.articulation.hi) }
      : {}),
    words: entry.words.map((word) => ({
      id: word.id,
      text: bilingual(word.en, word.hi),
      emoji: word.emoji,
      ...(word.sentence ? { sentence: bilingual(word.sentence.en, word.sentence.hi) } : {}),
    })),
  };
}

/** Kebab-cases a title into a stable slug ("The Busy Bee" → "the-busy-bee"). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A moment with no picture yet: it renders from the vector fallback, which is
 *  why a freshly seeded pack is fully playable before anyone uploads art. */
function vectorMoment(opts: {
  id: string;
  title: unknown;
  narration: unknown;
  job: string;
  mood: string;
  minDuration: number;
}): Record<string, unknown> {
  return {
    id: opts.id,
    title: opts.title,
    job: opts.job,
    minDuration: opts.minDuration,
    narration: { text: opts.narration, granularity: 'sentence' },
    visual: { primary: 'vector' },
    vectorFallback: { background: 'sky', cast: [], layers: [], particles: [] },
    mood: opts.mood,
    timeOfDay: 'morning',
    weather: 'clear',
    lighting: 'warm',
    transition: { in: { type: 'fade', duration: 0.6 }, out: { type: 'dissolve', duration: 0.6 } },
    cues: [],
  };
}

/** Rough read-aloud time: ~11 characters per second at the narration speed the
 *  app uses, floored so a very short pack still gets a sensible duration. */
function estimateSeconds(texts: string[]): number {
  const chars = texts.join(' ').length;
  return Math.max(20, Math.round(chars / 11));
}

export function abcPack(lesson: AbcLesson): Record<string, unknown> {
  const letter = lesson.letter.toUpperCase();
  const intro = `${letter} is for ${lesson.word}. ${lesson.phonics}.`;
  // The card comes from alphabet-latin.json, the mini-story from the app's old
  // LearnFallbacks — two datasets because they answer two questions: what a
  // letter TEACHES (name, sound, words, pictures) versus the little tale behind
  // the "Watch the story!" button. Joined here by letter.
  const entry = alphabetByLetter.get(letter);
  return {
    schemaVersion: '3.0',
    slug: `abc-${letter.toLowerCase()}`,
    kind: 'abc',
    letter,
    ...(entry ? { letterSpec: letterSpecOf(entry) } : {}),
    title: { en: `${letter} is for ${lesson.word}`, hi: `${letter} से ${lesson.wordHi}` },
    availableLangs: ['en'],
    ageBand: 'junior',
    category: 'ABC Time',
    concepts: ['letters', 'phonics'],
    moral: `${letter} says its sound in ${lesson.word}.`,
    estimatedDuration: estimateSeconds([intro, lesson.miniStory]),
    cover: { emoji: lesson.emoji, palette: ['#FFCC40', '#2EBDB5'] },
    audio: {
      music: { track: 'playful', volume: 0.3, loop: true },
      narrationSpeed: 1,
    },
    reward: { stars: 5, coins: 2, badgeStickerId: 'star' },
    assetManifest: [],
    moments: [
      vectorMoment({
        id: 'm1',
        // The Hindi word survives here even though the narration is English —
        // see the note at the top of this file.
        title: { en: `${letter} is for ${lesson.word}`, hi: `${letter} से ${lesson.wordHi}` },
        narration: intro,
        job: 'establish',
        mood: 'cheerful',
        minDuration: 8,
      }),
      vectorMoment({
        id: 'm2',
        title: `${lesson.word} story`,
        narration: lesson.miniStory,
        job: 'payoff',
        mood: 'cheerful',
        minDuration: 10,
      }),
    ],
    date: null,
    source: 'seed',
  };
}

/** Validates then upserts. A pack that fails validation is reported and skipped
 *  rather than aborting the run — one bad row shouldn't cost you the other 31. */
async function upsert(doc: Record<string, unknown>): Promise<boolean> {
  const result = validatePack(doc);
  if (!result.ok) {
    console.error(`  ✗ ${String(doc.slug)}:`, JSON.stringify(result.errors.fieldErrors));
    return false;
  }
  const d = result.data;
  const data = {
    slug: d.slug,
    kind: d.kind,
    schemaVersion: '3.0',
    title: doc.title as Prisma.InputJsonValue,
    availableLangs: (d.availableLangs ?? ['en']) as Prisma.InputJsonValue,
    ageBand: d.ageBand ?? 'junior',
    category: d.category ?? 'Moral Stories',
    concepts: (d.concepts ?? []) as Prisma.InputJsonValue,
    moral: (doc.moral ?? '') as Prisma.InputJsonValue,
    estimatedDuration: d.estimatedDuration ?? 150,
    cover: (doc.cover ?? { emoji: '📖' }) as Prisma.InputJsonValue,
    audio: (doc.audio ?? {}) as Prisma.InputJsonValue,
    reward: (doc.reward ?? { stars: 10, coins: 5, badgeStickerId: 'star' }) as Prisma.InputJsonValue,
    assetManifest: (doc.assetManifest ?? []) as Prisma.InputJsonValue,
    moments: doc.moments as Prisma.InputJsonValue,
    topic: d.topic ?? null,
    letter: d.letter ?? null,
    letterSpec: (doc.letterSpec ?? Prisma.DbNull) as Prisma.InputJsonValue,
    date: d.date ?? null,
    source: d.source ?? 'seed',
    published: true,
  };
  await prisma.contentPack.upsert({
    where: { slug: d.slug },
    update: data,
    create: data,
  });
  return true;
}

export async function seedPacks(): Promise<void> {
  console.log('Seeding content packs...');

  const crow = JSON.parse(
    readFileSync(join(SEED_DIR, 'pack_thirsty_crow.json'), 'utf8'),
  ) as Record<string, unknown>;
  crow.kind = 'story';
  crow.source = 'seed';

  const fallbacks = JSON.parse(
    readFileSync(join(SEED_DIR, 'learn-fallbacks.json'), 'utf8'),
  ) as { abcLessons: AbcLesson[] };

  // Rhymes come from their own files and their own builder — see seed.rhymes.ts
  // for why they are no longer derived from the app's five hardcoded poems.
  const rhymes = rhymePacks();

  const docs: Record<string, unknown>[] = [
    crow,
    ...fallbacks.abcLessons.map(abcPack),
    ...rhymes,
  ];

  let ok = 0;
  for (const doc of docs) {
    if (await upsert(doc)) ok += 1;
  }
  console.log(
    `  ${ok}/${docs.length} packs seeded (1 story, ${fallbacks.abcLessons.length} abc, ${rhymes.length} rhymes)`,
  );
}

// Runnable on its own: `npx tsx --env-file=.env prisma/seed.packs.ts`
if (require.main === module) {
  seedPacks()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}

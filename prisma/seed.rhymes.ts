import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Builds rhyme (kind: "poem") content packs from prisma/seed-data/rhymes.*.json.
//
// This replaces the old `poemPack()` in seed.packs.ts, which derived a pack from
// the five poems hardcoded in the Flutter app by chopping the text into
// couplets. That produced packs the story player could read aloud but nothing
// could SING: no lyric lines, no per-stanza picture slot, and — because the
// text was one prose blob — no way to lay a verse out as a verse.
//
// Two rules a rhyme pack must satisfy (both enforced by validatePoem in
// src/services/pack.schema.ts, so this seeder can't quietly break them):
//
//   1. MONOLINGUAL. English and Hindi rhymes are separate packs from separate
//      files, never two languages of one document. मछली जल की रानी है is not a
//      translation of anything — it is its own poem, with its own tile.
//   2. Every moment carries `verse`: the printed lines. `narration.text` is the
//      same lines joined, which is what gets recorded and hashed, so narration
//      and content-hash idempotency behave exactly as they do for stories.
//
// A seeded rhyme has no artwork. It is fully playable anyway — the vector
// fallback renders and the app falls back to on-device TTS — and an admin then
// adds a picture or an animated GIF per stanza and presses "Record voice".

const SEED_DIR = join(__dirname, 'seed-data');

export interface SeedRhyme {
  title: string;
  /** Required when the title has no ASCII form (Devanagari), optional
   *  otherwise. See `slugFor` for why this is not derived from position. */
  slug?: string;
  topic: string;
  emoji: string;
  mood: string;
  /** "folk" = traditional, public domain. "original" = written for this app. */
  source: string;
  /** One entry per stanza; each inner entry is one printed line. */
  stanzas: string[][];
}

interface RhymeFile {
  lang: string;
  rhymes: SeedRhyme[];
}

/** Palette per topic, so a shelf of rhymes doesn't read as one purple wall.
 *  All values are from the app's AppColors — no new hues. */
const TOPIC_PALETTES: Record<string, string[]> = {
  Animals: ['#2EBDB5', '#FFCC40'],
  Seasons: ['#8C73F2', '#2EBDB5'],
  Numbers: ['#414FE0', '#FFCC40'],
  Colors: ['#FF7361', '#8C73F2'],
  Nature: ['#2EBDB5', '#FFCC40'],
  Body: ['#FF7361', '#FFCC40'],
  Family: ['#8C73F2', '#FF7361'],
  Food: ['#FFCC40', '#FF7361'],
  Vehicles: ['#414FE0', '#2EBDB5'],
  Bedtime: ['#8C73F2', '#414FE0'],
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The pack's stable address.
 *
 * A slug is an address, not a label — it ends up in URLs, in the app's Hive
 * cache keys, and in the offline fallback that has to resolve the same content
 * without a backend. So it must not move.
 *
 * English titles kebab-case cleanly. Devanagari has no ASCII form, so those
 * rhymes carry an explicit `slug` in the seed file. Numbering them by position
 * would have been less typing and quietly wrong: inserting one rhyme would
 * renumber every rhyme after it, silently repointing cached packs and
 * offline fallbacks at the wrong poem.
 */
export function slugFor(rhyme: SeedRhyme, lang: string): string {
  const explicit = rhyme.slug ?? slugify(rhyme.title);
  if (!explicit) {
    throw new Error(
      `"${rhyme.title}" has no ASCII slug — add an explicit "slug" to the seed file`,
    );
  }
  return `rhyme-${lang}-${explicit}`;
}

/** Read-aloud estimate: ~11 characters a second, the same rate seed.packs.ts
 *  uses, but floored per stanza because a rhyme is read slower than prose. */
function estimateSeconds(stanzas: string[][]): number {
  const chars = stanzas.flat().join(' ').length;
  return Math.max(20, Math.round(chars / 9));
}

/** How long one stanza holds the screen before auto-advancing. Recorded
 *  narration overrides this — the moment waits for the clip — so it only
 *  matters on the TTS and silent paths. */
function stanzaSeconds(lines: string[]): number {
  return Math.max(5, Math.round(lines.join(' ').length / 9));
}

/**
 * One stanza → one moment.
 *
 * `visual.primary` is "vector" because a fresh rhyme has no art: that is the
 * one kind the app can always render. An admin swapping in a picture changes
 * this to "image" and points `visual.asset` at a manifest id — including an
 * animated GIF, which is the same "image" path as far as the player is
 * concerned.
 */
function stanzaMoment(
  rhyme: SeedRhyme,
  lines: string[],
  index: number,
  total: number,
): Record<string, unknown> {
  return {
    id: `s${index + 1}`,
    title: `${rhyme.title} ${index + 1}`,
    job: index === 0 ? 'establish' : index === total - 1 ? 'catharsis' : 'journey',
    minDuration: stanzaSeconds(lines),
    // The printed verse. `narration.text` below is the same words as one
    // spoken line — one clip, one set of word timings, laid out as N lines.
    verse: lines,
    narration: { text: lines.join(' '), granularity: 'word' },
    visual: { primary: 'vector' },
    vectorFallback: { background: 'sky', cast: [], layers: [], particles: [] },
    mood: rhyme.mood,
    timeOfDay: rhyme.mood === 'sleepy' ? 'night' : 'morning',
    weather: 'clear',
    lighting: rhyme.mood === 'sleepy' ? 'moonlit' : 'warm',
    // Slow cross-dissolves: a rhyme should feel like turning a page, not
    // cutting between shots.
    transition: { in: { type: 'dissolve', duration: 0.7 }, out: { type: 'dissolve', duration: 0.7 } },
    cues: [],
  };
}

export function rhymePack(rhyme: SeedRhyme, lang: string): Record<string, unknown> {
  return {
    schemaVersion: '3.0',
    slug: slugFor(rhyme, lang),
    kind: 'poem',
    topic: rhyme.topic,
    title: rhyme.title,
    // Exactly one language — a poem is not a translation of another poem.
    availableLangs: [lang],
    ageBand: 'junior',
    category: 'Rhymes',
    concepts: ['rhyme', rhyme.topic.toLowerCase()],
    moral: rhyme.title,
    estimatedDuration: estimateSeconds(rhyme.stanzas),
    cover: {
      emoji: rhyme.emoji,
      palette: TOPIC_PALETTES[rhyme.topic] ?? ['#8C73F2', '#FFCC40'],
    },
    audio: {
      // Sleepy rhymes get the night bed; everything else stays gently playful.
      music: {
        track: rhyme.mood === 'sleepy' ? 'night' : 'calm',
        volume: 0.25,
        loop: true,
      },
      narrationSpeed: 1,
      // The flag the app branches on to open the sing-along player instead of
      // the cinematic story player.
      singAlong: true,
    },
    reward: { stars: 5, coins: 2, badgeStickerId: 'star' },
    assetManifest: [],
    moments: rhyme.stanzas.map((lines, i) =>
      stanzaMoment(rhyme, lines, i, rhyme.stanzas.length),
    ),
    date: null,
    source: rhyme.source === 'original' ? 'original' : 'folk',
  };
}

/** Every rhyme pack across both language files. */
export function rhymePacks(): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const file of ['rhymes.en.json', 'rhymes.hi.json']) {
    const parsed = JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as RhymeFile;
    for (const rhyme of parsed.rhymes) {
      docs.push(rhymePack(rhyme, parsed.lang));
    }
  }
  return docs;
}

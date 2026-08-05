import type { LetterSpec, Moment, PackKind } from './types';

// Starting points for "New story / poem / letter".
//
// A new pack is deliberately born VALID and playable: one vector moment with
// real narration text. That way you can save it, hear it, and publish it before
// you have any artwork, and then add pictures moment by moment.

export function blankMoment(id: string, title = 'New scene'): Moment {
  return {
    id,
    title,
    job: 'establish',
    minDuration: 8,
    narration: { text: 'Once upon a time…', granularity: 'sentence' },
    visual: { primary: 'vector' },
    vectorFallback: { background: 'sky', cast: [], layers: [], particles: [] },
    mood: 'calm',
    timeOfDay: 'morning',
    weather: 'clear',
    lighting: 'warm',
    transition: {
      in: { type: 'fade', duration: 0.6 },
      out: { type: 'dissolve', duration: 0.6 },
    },
    cues: [],
  };
}

// ── Letter defaults ────────────────────────────────────────────────────────
//
// Mirrors prisma/seed-data/alphabet-latin.json, so a letter authored by hand in
// the portal starts from the same vetted content as a seeded one. The choices
// here are the pedagogically load-bearing part and are NOT arbitrary:
//
//   order    s-a-t-p-i-n first (Jolly Phonics), not A–Z — those six letters
//            build more real three-letter words than any other six, so a child
//            blends an actual word on day one.
//   say      what the voice engine is handed for the letter SOUND. Continuants
//            are held ("sss", "mmm"), stops are clipped ("t-t-t"). Never the
//            bare glyph, which reads as the letter name or a schwa.
//   words    primary sound only (no C-for-circle), no initial blends (no "tree"
//            for T), no coarticulation traps ("ant" nasalises the vowel).
//
// Change a word and you are editing curriculum — keep to those rules.
const LATIN_LETTERS: Record<
  string,
  { order: number; name: string; ipa: string; say: string; words: { id: string; text: string; emoji: string }[] }
> = {
  S: { order: 1, name: 'ess', ipa: '/s/', say: 'sss', words: [{ id: 'sun', text: 'sun', emoji: '☀️' }, { id: 'sock', text: 'sock', emoji: '🧦' }, { id: 'seal', text: 'seal', emoji: '🦭' }] },
  A: { order: 2, name: 'ay', ipa: '/æ/', say: 'aaa', words: [{ id: 'apple', text: 'apple', emoji: '🍎' }, { id: 'alligator', text: 'alligator', emoji: '🐊' }, { id: 'astronaut', text: 'astronaut', emoji: '👨‍🚀' }] },
  T: { order: 3, name: 'tee', ipa: '/t/', say: 't-t-t', words: [{ id: 'tiger', text: 'tiger', emoji: '🐯' }, { id: 'teeth', text: 'teeth', emoji: '🦷' }, { id: 'tent', text: 'tent', emoji: '⛺' }] },
  P: { order: 4, name: 'pee', ipa: '/p/', say: 'p-p-p', words: [{ id: 'pig', text: 'pig', emoji: '🐷' }, { id: 'pen', text: 'pen', emoji: '🖊️' }, { id: 'pot', text: 'pot', emoji: '🍲' }] },
  I: { order: 5, name: 'eye', ipa: '/ɪ/', say: 'ihh', words: [{ id: 'igloo', text: 'igloo', emoji: '🛖' }, { id: 'insect', text: 'insect', emoji: '🐛' }, { id: 'ink', text: 'ink', emoji: '🖋️' }] },
  N: { order: 6, name: 'en', ipa: '/n/', say: 'nnn', words: [{ id: 'net', text: 'net', emoji: '🥅' }, { id: 'nose', text: 'nose', emoji: '👃' }, { id: 'nest', text: 'nest', emoji: '🪺' }] },
  C: { order: 7, name: 'see', ipa: '/k/', say: 'k-k-k', words: [{ id: 'cat', text: 'cat', emoji: '🐱' }, { id: 'cup', text: 'cup', emoji: '🥤' }, { id: 'cow', text: 'cow', emoji: '🐮' }] },
  K: { order: 8, name: 'kay', ipa: '/k/', say: 'k-k-k', words: [{ id: 'key', text: 'key', emoji: '🔑' }, { id: 'kite', text: 'kite', emoji: '🪁' }, { id: 'king', text: 'king', emoji: '🤴' }] },
  E: { order: 9, name: 'ee', ipa: '/ɛ/', say: 'ehh', words: [{ id: 'egg', text: 'egg', emoji: '🥚' }, { id: 'exit', text: 'exit', emoji: '🚪' }, { id: 'elbow', text: 'elbow', emoji: '💪' }] },
  H: { order: 10, name: 'aitch', ipa: '/h/', say: 'h-h-h', words: [{ id: 'hat', text: 'hat', emoji: '🎩' }, { id: 'hen', text: 'hen', emoji: '🐔' }, { id: 'house', text: 'house', emoji: '🏠' }] },
  R: { order: 11, name: 'ar', ipa: '/r/', say: 'rrr', words: [{ id: 'rain', text: 'rain', emoji: '🌧️' }, { id: 'ring', text: 'ring', emoji: '💍' }, { id: 'rocket', text: 'rocket', emoji: '🚀' }] },
  M: { order: 12, name: 'em', ipa: '/m/', say: 'mmm', words: [{ id: 'map', text: 'map', emoji: '🗺️' }, { id: 'moon', text: 'moon', emoji: '🌙' }, { id: 'mouse', text: 'mouse', emoji: '🐭' }] },
  D: { order: 13, name: 'dee', ipa: '/d/', say: 'd-d-d', words: [{ id: 'dog', text: 'dog', emoji: '🐶' }, { id: 'duck', text: 'duck', emoji: '🦆' }, { id: 'doll', text: 'doll', emoji: '🪆' }] },
  G: { order: 14, name: 'jee', ipa: '/ɡ/', say: 'g-g-g', words: [{ id: 'goat', text: 'goat', emoji: '🐐' }, { id: 'girl', text: 'girl', emoji: '👧' }, { id: 'guitar', text: 'guitar', emoji: '🎸' }] },
  O: { order: 15, name: 'oh', ipa: '/ɒ/', say: 'ohh', words: [{ id: 'octopus', text: 'octopus', emoji: '🐙' }, { id: 'otter', text: 'otter', emoji: '🦦' }, { id: 'ox', text: 'ox', emoji: '🐂' }] },
  U: { order: 16, name: 'you', ipa: '/ʌ/', say: 'uhh', words: [{ id: 'up', text: 'up', emoji: '⬆️' }, { id: 'under', text: 'under', emoji: '⬇️' }, { id: 'umbrella', text: 'umbrella', emoji: '☂️' }] },
  L: { order: 17, name: 'el', ipa: '/l/', say: 'lll', words: [{ id: 'leg', text: 'leg', emoji: '🦵' }, { id: 'lion', text: 'lion', emoji: '🦁' }, { id: 'leaf', text: 'leaf', emoji: '🍃' }] },
  F: { order: 18, name: 'ef', ipa: '/f/', say: 'fff', words: [{ id: 'fish', text: 'fish', emoji: '🐟' }, { id: 'fan', text: 'fan', emoji: '🪭' }, { id: 'fox', text: 'fox', emoji: '🦊' }] },
  B: { order: 19, name: 'bee', ipa: '/b/', say: 'b-b-b', words: [{ id: 'ball', text: 'ball', emoji: '⚽' }, { id: 'bed', text: 'bed', emoji: '🛏️' }, { id: 'bus', text: 'bus', emoji: '🚌' }] },
  J: { order: 20, name: 'jay', ipa: '/dʒ/', say: 'j-j-j', words: [{ id: 'jam', text: 'jam', emoji: '🍯' }, { id: 'jug', text: 'jug', emoji: '🫗' }, { id: 'jet', text: 'jet', emoji: '✈️' }] },
  Z: { order: 21, name: 'zee', ipa: '/z/', say: 'zzz', words: [{ id: 'zebra', text: 'zebra', emoji: '🦓' }, { id: 'zip', text: 'zip', emoji: '🤐' }, { id: 'zoo', text: 'zoo', emoji: '🎪' }] },
  W: { order: 22, name: 'double-u', ipa: '/w/', say: 'w-w-w', words: [{ id: 'web', text: 'web', emoji: '🕸️' }, { id: 'wig', text: 'wig', emoji: '💇' }, { id: 'wall', text: 'wall', emoji: '🧱' }] },
  V: { order: 23, name: 'vee', ipa: '/v/', say: 'vvv', words: [{ id: 'van', text: 'van', emoji: '🚐' }, { id: 'vet', text: 'vet', emoji: '👩‍⚕️' }, { id: 'violin', text: 'violin', emoji: '🎻' }] },
  Y: { order: 24, name: 'wy', ipa: '/j/', say: 'y-y-y', words: [{ id: 'yak', text: 'yak', emoji: '🐃' }, { id: 'yoyo', text: 'yo-yo', emoji: '🪀' }, { id: 'yarn', text: 'yarn', emoji: '🧶' }] },
  X: { order: 25, name: 'ex', ipa: '/ks/', say: 'ks', words: [{ id: 'box', text: 'box', emoji: '📦' }, { id: 'six', text: 'six', emoji: '6️⃣' }, { id: 'fox', text: 'fox', emoji: '🦊' }] },
  Q: { order: 26, name: 'cue', ipa: '/kw/', say: 'kw', words: [{ id: 'queen', text: 'queen', emoji: '👑' }, { id: 'quilt', text: 'quilt', emoji: '🧵' }, { id: 'quill', text: 'quill', emoji: '🪶' }] },
};

/** A ready-to-save letter card. Falls back to a bare, still-valid spec for a
 *  glyph we have no defaults for, so switching the Letter dropdown never lands
 *  you on an unsavable pack. */
export function blankLetterSpec(letter: string): LetterSpec {
  const upper = letter.toUpperCase();
  const preset = LATIN_LETTERS[upper];
  return {
    script: 'latin',
    order: preset?.order ?? 99,
    glyph: { upper, lower: upper.toLowerCase() },
    name: { text: preset?.name ?? upper },
    phoneme: { ipa: preset?.ipa, say: preset?.say ?? upper.toLowerCase() },
    words: (preset?.words ?? [{ id: 'word_1', text: upper.toLowerCase(), emoji: '❓' }]).map((w) => ({
      id: w.id,
      text: w.text,
      emoji: w.emoji,
    })),
  };
}

/** A slug that won't collide, so "New story" twice in a row works. */
function draftSlug(kind: PackKind): string {
  const stamp = Date.now().toString(36);
  return `${kind}-draft-${stamp}`;
}

export function newPackTemplate(kind: PackKind): Record<string, unknown> {
  const base = {
    schemaVersion: '3.0',
    slug: draftSlug(kind),
    kind,
    title: 'Untitled',
    availableLangs: ['en'],
    ageBand: 'junior',
    concepts: [],
    moral: '',
    estimatedDuration: 60,
    audio: { music: { track: 'calm', volume: 0.3, loop: true }, narrationSpeed: 1 },
    reward: { stars: 5, coins: 2, badgeStickerId: 'star' },
    assetManifest: [],
    moments: [blankMoment('m1')],
    date: null,
    source: 'manual',
  };

  switch (kind) {
    case 'poem':
      return {
        ...base,
        category: 'Poems',
        // The validator requires a topic on poems; pick one now, change it in
        // the editor.
        topic: 'Animals',
        cover: { emoji: '📜', palette: ['#8C73F2', '#FFCC40'] },
      };
    case 'abc':
      return {
        ...base,
        category: 'ABC Time',
        letter: 'A',
        cover: { emoji: '🔤', palette: ['#FFCC40', '#2EBDB5'] },
        // A letter is a card, not a timeline. It starts with NO scenes — the
        // cinematic behind "Watch the story!" is opt-in, added from the editor
        // when someone actually wants one.
        moments: [],
        letterSpec: blankLetterSpec('A'),
      };
    case 'story':
    default:
      return {
        ...base,
        category: 'Moral Stories',
        cover: { emoji: '📖', palette: ['#FFCC40', '#2EBDB5'] },
      };
  }
}

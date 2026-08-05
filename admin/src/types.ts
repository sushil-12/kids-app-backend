// Wire types for the admin API.
//
// Mirrors src/services/pack.schema.ts (the zod contract) and pack.serialize.ts
// (the row shapes). Kept deliberately loose where the schema is loose — text is
// `LangText`, cues are a union — so the editor can round-trip a document it
// doesn't fully understand rather than silently dropping fields on save.

export type PackKind = 'story' | 'poem' | 'abc';
export type Lang = 'en' | 'hi';

/** A string, or a bilingual `{ en, hi }` map. */
export type LangText = string | { en: string; hi?: string };

export const PACK_KINDS: PackKind[] = ['story', 'poem', 'abc'];
export const LANGS: Lang[] = ['en', 'hi'];

export const MOMENT_JOBS = [
  'cover',
  'establish',
  'journey',
  'discovery',
  'struggle',
  'idea',
  'agency',
  'payoff',
  'catharsis',
  'moral',
] as const;

export const VISUAL_KINDS = ['image', 'video', 'interactive', 'vector'] as const;
// 'gif' is an animated image — the player treats it exactly like 'image', but
// naming it groups motion art in the library and tells the player to leave its
// own Ken-Burns drift off.
export const ASSET_TYPES = ['image', 'gif', 'video', 'rive', 'lottie', 'audio', 'sprite'] as const;
export const MOODS = [
  'cheerful',
  'calm',
  'tense',
  'triumphant',
  'tender',
  'sleepy',
  'mysterious',
] as const;
export const TIMES_OF_DAY = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'] as const;
export const WEATHER = ['clear', 'cloudy', 'rain', 'snow', 'windy', 'fog'] as const;
export const LIGHTING = ['warm', 'cool', 'golden', 'moonlit', 'overcast'] as const;
export const MUSIC_TRACKS = ['forest', 'calm', 'playful', 'night'] as const;
export const SFX_NAMES = ['pop', 'plop', 'chime', 'flip', 'wobble', 'win', 'tap'] as const;
export const CUE_TYPES = [
  'dialogue',
  'character',
  'prop',
  'camera',
  'sfx',
  'music',
  'ambient',
  'hold',
  'caption',
  'interaction',
] as const;
export const POEM_TOPICS = [
  'Animals',
  'Seasons',
  'Numbers',
  'Colors',
  'Nature',
  'Body',
  'Family',
  'Food',
  'Vehicles',
  'Bedtime',
] as const;
export const AGE_BANDS = ['junior', 'senior'] as const;

export interface StoryAsset {
  id: string;
  type: (typeof ASSET_TYPES)[number];
  url?: string;
  assetPath?: string;
  bytes?: number;
  v?: number;
  width?: number;
  height?: number;
  /** Animated art only: one loop's length, and whether it repeats. */
  durationMs?: number;
  loop?: boolean;
}

/** Word start times inside a narration clip, written by the narration job from
 *  ElevenLabs' character alignment. Never hand-authored. */
export interface WordMark {
  w: string;
  t: number;
}

export interface Cue {
  type: (typeof CUE_TYPES)[number];
  t: number;
  target?: string;
  action?: string;
  sound?: string;
  volume?: number;
  duration?: number;
  text?: LangText;
  speaker?: string;
  track?: string;
  bed?: string;
  trigger?: string;
  reaction?: string;
  optional?: boolean;
  [key: string]: unknown;
}

export interface Moment {
  id: string;
  title: LangText;
  job?: (typeof MOMENT_JOBS)[number];
  narration: {
    text: LangText;
    granularity?: string;
    audio?: LangText;
    /** Per-language for a bilingual pack, a bare list for a monolingual one. */
    marks?: WordMark[] | Record<string, WordMark[]>;
    audioDurationMs?: number | Record<string, number>;
  };
  /** Rhymes only: the stanza's printed lines. `narration.text` is the same
   *  words joined, which is what gets recorded — so editing the verse and
   *  forgetting the narration would put the highlight out of step. The rhyme
   *  editor keeps them in sync for you. */
  verse?: LangText[];
  minDuration?: number;
  visual?: {
    primary: (typeof VISUAL_KINDS)[number];
    asset?: string;
    poster?: string;
    overlayAnimation?: string;
    maxVideoSeconds?: number;
  };
  softGate?: {
    mode: 'optional' | 'soft_gate';
    prompt?: LangText;
    successThreshold?: number;
    timeoutAutoPlay?: number;
    autoStepSeconds?: number;
    reactionSound?: string;
  };
  vectorFallback?: {
    background?: string;
    cast?: { id: string; kind: string; x: number; y: number; [k: string]: unknown }[];
    layers?: { z: number; props?: { id: string; kind: string; x: number; y: number }[] }[];
    particles?: string[];
  };
  mood?: (typeof MOODS)[number];
  timeOfDay?: (typeof TIMES_OF_DAY)[number];
  weather?: (typeof WEATHER)[number];
  lighting?: (typeof LIGHTING)[number];
  camera?: {
    from?: { target?: string; zoom?: number; offset?: [number, number] };
    to?: { target?: string; zoom?: number; offset?: [number, number] };
    duration?: number;
    ease?: string;
    startAt?: number;
  };
  audio?: { music?: { track: string; volume?: number }; ambience?: { bed: string; volume?: number } };
  transition?: { in?: { type: string; duration?: number }; out?: { type: string; duration?: number } };
  cues?: Cue[];
  learningObjective?: string;
  [key: string]: unknown;
}

// ── Letter lesson (abc packs) ──────────────────────────────────────────────
//
// A letter is a card, not a timeline: a glyph, the sound it makes, and a set of
// pictures a child taps in any order. That is the whole of it — which is why it
// lives here rather than being reverse-engineered out of `moments`.

export const LETTER_SCRIPTS = ['latin', 'devanagari'] as const;

/** Recorded clip URLs, one per language. Written by the narration job, never
 *  typed in — the editor shows these read-only. */
export interface LetterAudio {
  en?: string;
  hi?: string;
}

/** One exemplar word: the picture a child taps to hear the letter in a word. */
export interface LetterWord {
  /** Stable within the letter — clips are keyed `word-<id>`, so renaming one
   *  orphans its recording. Lowercase letters, digits and underscores. */
  id: string;
  text: LangText;
  /** Manifest id of the word's picture. */
  image?: string;
  /** Shown until a picture exists, and offline. */
  emoji?: string;
  /** "An apple a day keeps the doctor away." — the letter in connected text. */
  sentence?: LangText;
  audio?: LetterAudio;
  sentenceAudio?: LetterAudio;
}

export interface LetterSpec {
  script: (typeof LETTER_SCRIPTS)[number];
  order: number;
  glyph: { upper: string; lower?: string };
  /** The letter's NAME ("ay"), taught alongside the sound, never merged. */
  name: { text: LangText; audio?: LetterAudio };
  phoneme: {
    /** Display only, never spoken. "/æ/" */
    ipa?: string;
    /** The only thing the voice engine is handed for the letter sound: hold
     *  continuants ("mmmm", "sss"), clip stops ("t", "p"). Never the glyph —
     *  that gets you the letter name or a schwa, which breaks blending later. */
    say: LangText;
    audio?: LetterAudio;
  };
  articulation?: LangText;
  mnemonicImage?: string;
  words: LetterWord[];
}

/** The app shows this many word tiles on the card; the rest go behind
 *  "See more". Mirrors the app's own cut so the editor can show you where the
 *  fold lands while you author. */
export const LETTER_WORDS_ON_CARD = 3;
export const LETTER_WORDS_MAX = 12;

/** The full editable document, as returned by GET /v1/admin/packs/:id. */
export interface Pack {
  schemaVersion: string;
  id: string;
  slug: string;
  kind: PackKind;
  title: LangText;
  availableLangs: Lang[];
  ageBand: (typeof AGE_BANDS)[number];
  category: string;
  concepts: string[];
  moral: LangText;
  estimatedDuration: number;
  cover: { emoji: string; image?: string; palette?: string[] };
  audio: {
    music?: { track: string; volume?: number; loop?: boolean };
    ambience?: { bed: string; volume?: number; loop?: boolean };
    voicePack?: LangText;
    narrationSpeed?: number;
    /** Rhymes: play in the app's sing-along player rather than the story one. */
    singAlong?: boolean;
    song?: string;
  };
  reward: { stars?: number; coins?: number; badgeStickerId?: string };
  assetManifest: StoryAsset[];
  moments: Moment[];
  topic?: string;
  letter?: string;
  /** abc packs only, and required on them — the letter card itself. */
  letterSpec?: LetterSpec;
  date: string | null;
  source: string;
  version: number;
  published: boolean;
  clips?: Clip[];
}

/** A picture we host, uploaded through the portal. Reusable across packs. */
export interface MediaAsset {
  id: string;
  storageKey: string;
  url: string;
  mime: string;
  byteLength: number;
  originalName: string;
  folder: string;
  createdAt: string;
}

export interface MediaConfig {
  /** False when S3 isn't configured — the portal then offers paste-a-URL only. */
  uploadsEnabled: boolean;
  maxUploadMb: number;
  acceptedTypes: string[];
  /** True only when there is both a GIPHY key to search with and somewhere to
   *  copy the result to. */
  gifSearchEnabled?: boolean;
  maxGifImportMb?: number;
}

/** One GIF search hit. `importUrl` is what a click copies into our bucket —
 *  the app never loads anything straight from Giphy. */
export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  importUrl: string;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface Clip {
  id: string;
  momentId: string;
  lang: Lang;
  kind: 'narration' | 'gate';
  bytes: number;
  url: string;
  createdAt: string;
}

/** A row in the pack list — the summary plus authoring state. */
export interface PackRow {
  id: string;
  slug: string;
  kind: PackKind;
  title: LangText;
  titleEn: string;
  emoji: string;
  coverUrl: string | null;
  minutes: number;
  langs: Lang[];
  ageBand: string;
  moments: number;
  topic?: string;
  letter?: string;
  version: number;
  published: boolean;
  date: string | null;
  source: string;
  usedCount: number;
  updatedAt: string;
  assets: number;
  missingArt: number;
  clips: number;
  expectedClips: number;
}

// ── LangText helpers ───────────────────────────────────────────────────────

export function textFor(value: LangText | undefined, lang: Lang): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return lang === 'en' ? value : '';
  return value[lang] ?? '';
}

/**
 * Writes one language back into a text node.
 *
 * Collapses to a plain string when only English is present, so a
 * single-language pack stays a simple document instead of accumulating
 * `{ en: "..." }` wrappers everywhere. Clearing Hindi removes the key rather
 * than storing `""` — the pack validator rejects empty language values, and an
 * empty string would otherwise silently become blank narration.
 */
export function setText(value: LangText | undefined, lang: Lang, next: string): LangText {
  const en = lang === 'en' ? next : textFor(value, 'en');
  const hi = lang === 'hi' ? next : textFor(value, 'hi');
  if (!hi) return en;
  return { en, hi };
}

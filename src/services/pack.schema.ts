// The content-pack wire format (schema v3) + its zod validator.
//
// A pack is the playable document behind EVERY Learn screen — cinematic
// stories, poems and ABC letters are the same shape, so there is one schema,
// one admin editor and one player in the app.
//
// Two properties make a pack manageable without an app release:
//
//   assetManifest — [{ id, type, url }] of externally hosted pictures. Moments
//                   reference an asset BY ID, so swapping a picture is a single
//                   URL edit and every moment pointing at it follows.
//   moments       — the ordered scene list: primary visual, narration, timed
//                   cues, camera move, and a guaranteed vector fallback so a
//                   pack still plays with no network and no pictures at all.
//
// Text fields are BILINGUAL: wherever a string is expected the wire may instead
// carry `{ "en": "...", "hi": "..." }`. We store and serve those maps verbatim;
// the app collapses them at parse time (CinematicStoryV3.fromJson(json, lang:)),
// which is why one cached document can serve the in-player EN ⇄ हिन्दी pill.
//
// ── The contract with the app ──────────────────────────────────────────────
// Every enum below mirrors the `wire` strings in
//   brightmind_kids/lib/src/features/learn/data/cinematic_story_v3.dart
//   brightmind_kids/lib/src/features/learn/data/cinematic_story_v2.dart  (reused types)
//   brightmind_kids/lib/src/features/learn/data/cinematic_story.dart     (shared enums)
// Add new vocabulary in BOTH places. The app is the LENIENT reader — it applies
// its own defaults and silently skips vocabulary it doesn't know — so this
// validator is deliberately the STRICT one: authoring mistakes must fail here,
// at save time, in front of the person who can fix them, rather than degrade
// silently in front of a child.
//
// Because the app is lenient, `validatePack` never rewrites the document: the
// repo stores the caller's JSON verbatim so an admin's authoring intent (and
// byte-for-byte round-tripping of imported packs) survives. Every optional
// field below is `.optional()`, never `.default()`, for exactly that reason.

import { z } from 'zod';
import {
  SCENE_BACKGROUNDS,
  PROP_KINDS,
  CHARACTER_KINDS,
  PARTICLE_KINDS,
  MUSIC_TRACKS,
} from './cinematic.schema';

/** Which Learn surface a pack feeds. */
export const PACK_KINDS = ['story', 'poem', 'abc'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const PACK_LANGS = ['en', 'hi'] as const;
export type PackLang = (typeof PACK_LANGS)[number];

export const PACK_AGE_BANDS = ['junior', 'senior'] as const;

/** Poem topics the app's Learn hub offers.
 *
 * Deliberately a CLOSED list rather than a free-text field: the app renders one
 * localized label + icon per topic (`poemTopic<Name>` in the ARBs), so a topic
 * the app has never heard of would reach a child as a raw English wire string
 * on a Hindi shelf. Adding a topic means adding it here AND in both ARBs. */
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

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as readonly string[];

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

export const MOMENT_VISUAL_KINDS = ['image', 'video', 'interactive', 'vector'] as const;
export const INTERACTION_MODES = ['optional', 'soft_gate'] as const;
// 'gif' is an image as far as the player is concerned — Flutter decodes animated
// GIF/WebP through the same image pipeline — but naming it lets the media
// library group motion art and lets the player skip its Ken-Burns drift, which
// on an already-moving still reads as two animations fighting.
export const STORY_ASSET_TYPES = [
  'image',
  'gif',
  'video',
  'rive',
  'lottie',
  'audio',
  'sprite',
] as const;

export const SCENE_MOODS = [
  'cheerful',
  'calm',
  'tense',
  'triumphant',
  'tender',
  'sleepy',
  'mysterious',
] as const;

export const SCENE_TIMES_OF_DAY = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'] as const;
export const SCENE_WEATHER = ['clear', 'cloudy', 'rain', 'snow', 'windy', 'fog'] as const;
export const SCENE_LIGHTING = ['warm', 'cool', 'golden', 'moonlit', 'overcast'] as const;

export const EMOTIONS = [
  'neutral',
  'happy',
  'proud',
  'worried',
  'sad',
  'scared',
  'kind',
  'sleepy',
  'surprised',
  'determined',
] as const;

export const CHARACTER_ACTIONS = [
  'idle',
  'fly',
  'hop',
  'walk',
  'run',
  'bounce',
  'jump',
  'laugh',
  'cry',
  'sleep',
  'nod',
  'shake',
  'fall',
  'celebrate',
] as const;

export const TRANSITION_TYPES = [
  'cut',
  'fade',
  'dissolve',
  'slide',
  'iris_in',
  'iris_out',
  'whip_pan',
  'page_turn',
] as const;

export const CAMERA_EASES = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInOutSine',
  'easeOutBack',
] as const;

export const HOTSPOT_TRIGGERS = ['tap', 'drag'] as const;

/** SFX names the app has bundled (AudioService's Sfx enum). */
export const SFX_NAMES = ['pop', 'plop', 'chime', 'flip', 'wobble', 'win', 'tap'] as const;

// ── Bilingual text ─────────────────────────────────────────────────────────

/** A bilingual text node. `.strict()` matters: the app only collapses a map
 *  whose keys are ALL language codes, so an extra key would reach the Dart
 *  parser as a Map where a String is expected and blow up at runtime. */
const langMap = z
  .object({
    en: z.string().min(1),
    hi: z.string().min(1).optional(),
  })
  .strict();

/** A string or a bilingual map. Legacy single-language packs use the string. */
const langText = z.union([z.string().min(1), langMap]);

/** Same, but allowed to be empty (captions, optional prompts). */
const langTextLoose = z.union([
  z.string(),
  z.object({ en: z.string(), hi: z.string().optional() }).strict(),
]);

export type LangText = z.infer<typeof langText>;

/** Collapses a bilingual node to one language — the TS mirror of the Dart
 *  `_resolveLang`. Used by the narration service to pick the text to speak and
 *  by the catalog endpoint to build summaries. */
export function pickLang(value: unknown, lang: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const m = value as Record<string, unknown>;
    const hit = m[lang] ?? m.en;
    if (typeof hit === 'string') return hit;
  }
  return '';
}

// ── Primitives ─────────────────────────────────────────────────────────────

const relCoord = z.number().min(0).max(1);
const scale = z.number().min(0.1).max(5);
/** Ken-Burns drift / camera offset — [dx, dy] in fractions of the stage. */
const offsetPair = z.tuple([z.number(), z.number()]);

const assetSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(STORY_ASSET_TYPES),
    // Externally hosted media. Admins paste the URL; we never upload or proxy
    // pictures, so https is required — the app's image cache refuses cleartext
    // on both platforms anyway.
    url: z.string().url().startsWith('https://').optional(),
    // Bundled Flutter asset path, for media that ships with the app.
    assetPath: z.string().min(1).optional(),
    bytes: z.number().int().min(0).optional(),
    v: z.number().int().min(1).optional(),
    // Intrinsic size, so a shelf tile can reserve the right box before the
    // bytes land. Optional — the media library fills these in on import.
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    // Animated art only: how long one loop runs, and whether it should repeat.
    durationMs: z.number().int().min(0).optional(),
    loop: z.boolean().optional(),
  })
  .refine((a) => Boolean(a.url ?? a.assetPath), {
    message: 'an asset needs either a url or an assetPath',
  });

const cameraKeyframeSchema = z.object({
  target: z.string().min(1).optional(),
  zoom: z.number().min(0.5).max(4).optional(),
  offset: offsetPair.optional(),
});

const cameraSchema = z.object({
  from: cameraKeyframeSchema.optional(),
  to: cameraKeyframeSchema.optional(),
  duration: z.number().min(0).max(60).optional(),
  ease: z.enum(CAMERA_EASES).optional(),
  startAt: z.number().min(0).max(60).optional(),
});

const propSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PROP_KINDS),
  x: relCoord,
  y: relCoord,
  scale: scale.optional(),
});

const castMemberSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(CHARACTER_KINDS),
  x: relCoord,
  y: relCoord,
  scale: scale.optional(),
  facing: z.enum(['left', 'right']).optional(),
  emotion: z.enum(EMOTIONS).optional(),
  // Optional asset-manifest id (a Rive/sprite). Null → emoji/vector render.
  asset: z.string().min(1).optional(),
  entrance: z
    .object({
      from: z.enum(['left', 'right', 'top', 'bottom']),
      at: z.number().min(0),
    })
    .optional(),
});

const stageLayerSchema = z.object({
  z: z.number().int(),
  props: z.array(propSchema).max(12).optional(),
});

/** The offline baseline. Every moment has one, so a pack with no pictures —
 *  or a child with no network — still gets a staged, animated scene. */
const vectorFallbackSchema = z.object({
  background: z.enum(SCENE_BACKGROUNDS).optional(),
  cast: z.array(castMemberSchema).max(6).optional(),
  layers: z.array(stageLayerSchema).max(6).optional(),
  particles: z.array(z.enum(PARTICLE_KINDS)).max(4).optional(),
});

const narrationSchema = z.object({
  text: langText,
  // Word-level timings for read-along / sing-along highlighting: `w` is the
  // word, `t` its start time in seconds within this moment's clip. Written by
  // the narration job from ElevenLabs' character alignment, not hand-authored —
  // but bilingual packs need one list per language, hence the map form.
  marks: z
    .union([
      z.array(z.object({ w: z.string(), t: z.number().min(0) })),
      z.record(z.string(), z.array(z.object({ w: z.string(), t: z.number().min(0) }))),
    ])
    .optional(),
  granularity: z.enum(['word', 'sentence']).optional(),
  /** Clip length in ms, per language. Lets the player size a progress bar
   *  before the audio has loaded. */
  audioDurationMs: z.union([z.number().int().min(0), z.record(z.string(), z.number().int().min(0))]).optional(),
  // Recorded voice-over: a bundled path relative to assets/audio/, or an
  // absolute URL. The narration job writes a bilingual map of
  // /v1/media/narration/… URLs here, which the app collapses to the playing
  // language like any other text node.
  audio: langText.optional(),
});

const musicBedSchema = z.object({
  track: z.enum(MUSIC_TRACKS),
  volume: z.number().min(0).max(1).optional(),
  loop: z.boolean().optional(),
});

// The ambience bed is a free-form name on purpose: unknown beds simply play
// nothing in the app, so authors can reference art that hasn't shipped yet.
const ambienceBedSchema = z.object({
  bed: z.string().min(1),
  volume: z.number().min(0).max(1).optional(),
  loop: z.boolean().optional(),
});

const sceneAudioSchema = z.object({
  music: musicBedSchema.optional(),
  ambience: ambienceBedSchema.optional(),
});

const transitionSpecSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  duration: z.number().min(0).max(5).optional(),
});

const transitionSchema = z.object({
  in: transitionSpecSchema.optional(),
  out: transitionSpecSchema.optional(),
});

// ── Cues (the timeline) ────────────────────────────────────────────────────
// Discriminated on `type`. The app returns null for unknown cue types and skips
// them; we reject them instead, so a typo surfaces at save time rather than
// quietly deleting a beat from the story.

const cueBase = { t: z.number().min(0).max(600) };

const cueSchema = z.discriminatedUnion('type', [
  z.object({
    ...cueBase,
    type: z.literal('dialogue'),
    speaker: z.string().min(1),
    text: langText,
    emotion: z.enum(EMOTIONS).optional(),
    duckMusicDb: z.number().min(-60).max(0).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('character'),
    target: z.string().min(1),
    action: z.enum(CHARACTER_ACTIONS),
  }),
  z.object({
    ...cueBase,
    type: z.literal('prop'),
    target: z.string().min(1),
    action: z.string().min(1).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('camera'),
    move: cameraSchema.optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('sfx'),
    sound: z.enum(SFX_NAMES),
    volume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('music'),
    track: z.enum(MUSIC_TRACKS),
    volume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('ambient'),
    bed: z.string().min(1),
    volume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('hold'),
    duration: z.number().min(0).max(10).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('caption'),
    text: langTextLoose,
    duration: z.number().min(0).max(20).optional(),
  }),
  z.object({
    ...cueBase,
    type: z.literal('interaction'),
    target: z.string().min(1),
    trigger: z.enum(HOTSPOT_TRIGGERS).optional(),
    reaction: z.string().min(1).optional(),
    sound: z.string().min(1).optional(),
    optional: z.boolean().optional(),
    narrateOnMiss: z.boolean().optional(),
  }),
]);

// ── Moment ─────────────────────────────────────────────────────────────────

const visualSchema = z.object({
  primary: z.enum(MOMENT_VISUAL_KINDS),
  // Manifest id of the primary image/video/rive.
  asset: z.string().min(1).optional(),
  // Still shown while a video loads, or if the video is missing.
  poster: z.string().min(1).optional(),
  maxVideoSeconds: z.number().min(1).max(10).optional(),
  overlayAnimation: z.string().min(1).optional(),
});

/** Story-critical agency with a timeout rescue. There is no fail state: the
 *  engine auto-steps after `timeoutAutoPlay` seconds of inactivity, so a child
 *  who doesn't (or can't) interact still sees the story resolve. */
const softGateSchema = z.object({
  mode: z.enum(INTERACTION_MODES),
  prompt: langTextLoose.optional(),
  successThreshold: z.number().int().min(1).max(20).optional(),
  timeoutAutoPlay: z.number().min(1).max(60).optional(),
  autoStepSeconds: z.number().min(0.2).max(10).optional(),
  reactionSound: z.enum(SFX_NAMES).optional(),
});

const momentSchema = z.object({
  id: z.string().min(1),
  title: langText,
  job: z.enum(MOMENT_JOBS).optional(),
  narration: narrationSchema,
  /** Poems/rhymes: the stanza's lyric lines, as they should appear on screen,
   *  one array entry per printed line. `narration.text` stays the spoken blob
   *  (the lines joined) so narration, content hashing and the story player are
   *  completely unaffected — this field only exists so the rhyme player can lay
   *  the verse out as verse instead of reflowing a paragraph. */
  verse: z.array(langText).min(1).max(8).optional(),
  minDuration: z.number().min(1).max(120).optional(),
  visual: visualSchema.optional(),
  softGate: softGateSchema.optional(),
  vectorFallback: vectorFallbackSchema.optional(),
  mood: z.enum(SCENE_MOODS).optional(),
  timeOfDay: z.enum(SCENE_TIMES_OF_DAY).optional(),
  weather: z.enum(SCENE_WEATHER).optional(),
  lighting: z.enum(SCENE_LIGHTING).optional(),
  camera: cameraSchema.optional(),
  audio: sceneAudioSchema.optional(),
  transition: transitionSchema.optional(),
  cues: z.array(cueSchema).max(40).optional(),
  learningObjective: z.string().optional(),
});

export type PackMoment = z.infer<typeof momentSchema>;

// ── Letter lesson (ABC) ────────────────────────────────────────────────────
//
// A letter is NOT a story with two scenes. A story is a sequence you watch; a
// letter is a record you explore — name here, sound there, four pictures you can
// tap in any order, all of it replayable on demand. Encoding that as `moments`
// forced the app to reverse-engineer a card out of a timeline, so the teaching
// data lives here instead and `moments` keeps its real job: the optional
// "Watch the story!" cinematic behind the same pack.
//
// Modelled against a SCRIPT rather than against A–Z. English is 26 letters with
// two cases; Hindi is a 46-varna abugida (13 swar + 33 vyanjan) with no case and
// no 1:1 mapping to Latin letters, so "translate the labels" was never going to
// work. Same schema, same screen, different content.

export const LETTER_SCRIPTS = ['latin', 'devanagari'] as const;
export type LetterScript = (typeof LETTER_SCRIPTS)[number];

/** Recorded clip URLs, one per language — written by the narration job
 *  (writeClipUrls), never hand-authored. Absent until someone presses Record
 *  voice; the app falls back to on-device TTS meanwhile. */
const letterAudioSchema = z
  .object({
    en: z.string().url().optional(),
    hi: z.string().url().optional(),
  })
  .strict();

/** One exemplar word: the picture a child taps to hear the letter in a word.
 *
 *  Choosing these is the pedagogically load-bearing part, and the rules are
 *  documented on the dataset (prisma/seed-data/alphabet-latin.json) rather than
 *  enforceable here: primary sound only (no C-for-circle), no initial blends
 *  (no "tree" for T — a child cannot hear /t/ out of /tr/), no coarticulation
 *  traps ("ant" nasalizes the vowel, "umbrella" reads as "um"), concrete
 *  picturable nouns only. */
const letterWordSchema = z.object({
  // Stable within the letter: narration clips are keyed `word-<id>`, so
  // renaming an id silently orphans its recording. Lowercase, no spaces.
  id: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[a-z0-9_]+$/, 'word id must be lowercase letters, digits or underscores'),
  text: langText,
  // Manifest id of the word's picture.
  image: z.string().min(1).optional(),
  // Shown until a picture exists, and offline. Every word should have one, so
  // the screen is never empty on a fresh install.
  emoji: z.string().min(1).optional(),
  // "The apple is red." — puts the letter in connected text, spoken after the
  // word itself.
  sentence: langText.optional(),
  audio: letterAudioSchema.optional(),
  sentenceAudio: letterAudioSchema.optional(),
});

export type LetterWord = z.infer<typeof letterWordSchema>;

const letterSpecSchema = z
  .object({
    script: z.enum(LETTER_SCRIPTS),
    /** Teaching order — the guided path the app offers by default. Latin
     *  follows s-a-t-p-i-n (Jolly Phonics / Letterland): those six letters build
     *  more real three-letter words than any other six, so a child blends an
     *  actual word on day one instead of waiting out an alphabetical march to S.
     *  A–Z stays available as a display toggle. */
    order: z.number().int().min(0).max(99),
    glyph: z
      .object({
        upper: z.string().min(1).max(4),
        // Absent for scripts without case (Devanagari).
        lower: z.string().min(1).max(4).optional(),
      })
      .strict(),
    /** The letter's NAME ("ay", "bee"). Taught alongside the sound, never
     *  merged with it — most English letter names contain their own sound, which
     *  is why names bootstrap sounds rather than competing with them. */
    name: z.object({ text: langText, audio: letterAudioSchema.optional() }),
    phoneme: z.object({
      // Display only — never spoken. '/æ/'
      ipa: z.string().max(12).optional(),
      /** The ONLY thing a voice engine is ever handed for the letter sound.
       *
       *  Reading a bare glyph gets you the letter NAME or a schwa ("buh",
       *  "guh"), and a schwa-contaminated letter sound demonstrably breaks
       *  blending later — it is the single most-criticised defect in this app
       *  category. So the sound is authored, not derived: continuants are held
       *  ("mmmm", "sss", "fff"), stops are clipped ("t", "p", "k"). */
      say: langText,
      audio: letterAudioSchema.optional(),
    }),
    // "Open your mouth wide and say aaa" — a spoken articulation cue.
    articulation: langTextLoose.optional(),
    /** Manifest id of the letter's mnemonic picture, where the letter SHAPE is
     *  embedded in the object (Letterland / Zoo-phonics style) rather than sat
     *  next to it. Embedded mnemonics measurably beat letter-beside-picture for
     *  letter-sound retention. */
    mnemonicImage: z.string().min(1).optional(),
    /** The app shows the first 3 on the card — more than that outruns a
     *  three-year-old's attention — and puts the rest behind "See more", which
     *  opens the full picture grid for the letter. So authoring past 3 is not
     *  clutter: it is the second screen, and a repeat visit isn't identical.
     *  12 is a soft ceiling on how many good exemplars a letter really has. */
    words: z.array(letterWordSchema).min(1).max(12),
  })
  .strict();

export type LetterSpec = z.infer<typeof letterSpecSchema>;

/** One recordable line in a letter lesson.
 *
 *  `slot` lands in NarrationClip.momentId — that column is a free-form string
 *  and the row is unique on (pack, slot, lang, kind), so letter clips coexist
 *  with the pack's moment clips without a migration.
 *
 *  Lives here, in the shared contract module, so the narration job and the admin
 *  clip counter can never disagree about how many recordings a letter needs. */
export interface LetterClipSlot {
  slot: string;
  kind: 'letterName' | 'phoneme' | 'word' | 'sentence';
  text: LangText;
}

export function letterClipSlots(spec: LetterSpec): LetterClipSlot[] {
  const slots: LetterClipSlot[] = [
    { slot: 'letter-name', kind: 'letterName', text: spec.name.text },
    // NOTE: `phoneme.say`, never the glyph — see the field's comment.
    { slot: 'letter-phoneme', kind: 'phoneme', text: spec.phoneme.say },
  ];
  for (const word of spec.words) {
    slots.push({ slot: `word-${word.id}`, kind: 'word', text: word.text });
    if (word.sentence) {
      slots.push({ slot: `sentence-${word.id}`, kind: 'sentence', text: word.sentence });
    }
  }
  return slots;
}

/** Best-effort parse of a stored `letterSpec` JSON column. Returns null for a
 *  non-ABC pack or a spec that predates/violates the schema — callers treat
 *  that as "no letter card", never as an error. */
export function parseLetterSpec(value: unknown): LetterSpec | null {
  if (!value) return null;
  const parsed = letterSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ── Pack ───────────────────────────────────────────────────────────────────

const coverSchema = z.object({
  emoji: z.string().min(1),
  // Manifest id of the cover picture.
  image: z.string().min(1).optional(),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).max(6).optional(),
});

const storyAudioSchema = z.object({
  music: musicBedSchema.optional(),
  ambience: ambienceBedSchema.optional(),
  // Narrator identity. Bilingual packs carry one id per language.
  voicePack: langTextLoose.optional(),
  narrationSpeed: z.number().min(0.5).max(2).optional(),
  /** Rhymes: play this in the sing-along player, with the verse on screen and
   *  the current word highlighted, rather than as a narrated story. */
  singAlong: z.boolean().optional(),
  /** Manifest id of a full sung recording, when one exists. Reserved: nothing
   *  generates these yet, and the player falls back to the per-moment narration
   *  clips, which are the ones that carry word timings. */
  song: z.string().min(1).optional(),
});

const rewardSchema = z.object({
  stars: z.number().int().min(0).max(50).optional(),
  coins: z.number().int().min(0).max(20).optional(),
  badgeStickerId: z.string().min(1).optional(),
});

const packBodySchema = z.object({
  schemaVersion: z.literal('3.0').optional(),
  id: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase-kebab-case'),
  kind: z.enum(PACK_KINDS),
  title: langText,
  availableLangs: z.array(z.enum(PACK_LANGS)).min(1).optional(),
  ageBand: z.enum(PACK_AGE_BANDS).optional(),
  category: z.string().min(1).optional(),
  concepts: z.array(z.string().min(1)).max(10).optional(),
  moral: langTextLoose.optional(),
  estimatedDuration: z.number().int().min(5).max(1800).optional(),
  cover: coverSchema.optional(),
  audio: storyAudioSchema.optional(),
  reward: rewardSchema.optional(),
  artBibleRef: z.string().optional(),
  assetManifest: z.array(assetSchema).max(60).optional(),
  /** Empty is legal HERE so an abc pack can be a letter card and nothing else —
   *  the per-kind rules below still require at least one moment for a story and
   *  a poem, which are timelines by definition. A letter is a record you
   *  explore, so its cinematic is opt-in (see `validateAbc`). */
  moments: z.array(momentSchema).max(40),
  topic: z.enum(POEM_TOPICS).optional(),
  /** The glyph an ABC pack teaches. Deliberately NOT `/^[A-Z]$/` any more: a
   *  Devanagari varna ("क") is a letter too, and the per-script shape rules live
   *  in `validateAbc` where they can differ by script. */
  letter: z.string().min(1).max(4).optional(),
  letterSpec: letterSpecSchema.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  source: z.string().min(1).optional(),
});

/**
 * Rhyme-specific rules. A poem is NOT a story with shorter lines:
 *
 *  • It is **monolingual**. Rhyme, metre and wordplay do not survive
 *    translation, so "the Hindi version of Twinkle Twinkle" is not a thing —
 *    मछली जल की रानी है is its own poem, its own pack, its own shelf tile. A
 *    bilingual poem pack is always an authoring mistake, so we reject the
 *    `{ en, hi }` maps that are perfectly legal everywhere else.
 *  • It has **verse**. Without lyric lines the rhyme player has nothing to lay
 *    out and degrades to a paragraph, which is the experience we're replacing.
 */
function validatePoem(doc: z.infer<typeof packBodySchema>, ctx: z.RefinementCtx): void {
  const langs = doc.availableLangs ?? ['en'];
  if (langs.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableLangs'],
      message:
        'a poem is written in ONE language — publish the Hindi rhyme as its own pack rather than as a translation',
    });
  }

  const rejectMap = (value: unknown, path: (string | number)[]): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'poem text must be a plain string, not a per-language map',
    });
  };

  rejectMap(doc.title, ['title']);
  rejectMap(doc.moral, ['moral']);

  let versed = 0;
  doc.moments.forEach((moment, i) => {
    rejectMap(moment.title, ['moments', i, 'title']);
    rejectMap(moment.narration.text, ['moments', i, 'narration', 'text']);
    (moment.verse ?? []).forEach((line, li) => {
      rejectMap(line, ['moments', i, 'verse', li]);
    });
    if (moment.verse?.length) versed += 1;
  });

  if (versed === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['moments', 0, 'verse'],
      message: 'a poem needs its lyric lines — at least one moment must carry `verse`',
    });
  }
}

/**
 * Letter-specific rules.
 *
 * `requireAsset` is passed in rather than re-derived so a missing word picture
 * fails with exactly the same message as a missing moment picture — an admin
 * shouldn't have to learn two vocabularies for one mistake.
 */
function validateAbc(
  doc: z.infer<typeof packBodySchema>,
  ctx: z.RefinementCtx,
  requireAsset: (id: string | undefined, path: (string | number)[]) => void,
): void {
  if (!doc.letter) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['letter'], message: 'abc packs need a letter' });
  }

  const spec = doc.letterSpec;
  if (!spec) {
    // Without this the app has nothing to render but a glyph — which is the
    // screen this schema exists to replace.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['letterSpec'],
      message: 'abc packs need a letterSpec — the letter card has no words, sound or pictures without it',
    });
    return;
  }

  requireAsset(spec.mnemonicImage, ['letterSpec', 'mnemonicImage']);

  const seenWordIds = new Set<string>();
  spec.words.forEach((word, i) => {
    if (seenWordIds.has(word.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letterSpec', 'words', i, 'id'],
        message: `duplicate word id "${word.id}" — narration clips are keyed by it`,
      });
    }
    seenWordIds.add(word.id);
    requireAsset(word.image, ['letterSpec', 'words', i, 'image']);

    // A word with neither picture nor emoji renders as an empty tap target.
    if (!word.image && !word.emoji) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letterSpec', 'words', i, 'emoji'],
        message: 'a word needs a picture or an emoji — otherwise its tile is blank',
      });
    }
  });

  // Latin letters are cased and must agree with the pack's discriminator, or the
  // catalog would file "A" under a pack whose card teaches something else.
  if (spec.script === 'latin') {
    if (!/^[A-Z]$/.test(spec.glyph.upper)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letterSpec', 'glyph', 'upper'],
        message: 'a latin letter is a single A–Z capital',
      });
    } else if (doc.letter && doc.letter !== spec.glyph.upper) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letterSpec', 'glyph', 'upper'],
        message: `glyph "${spec.glyph.upper}" does not match the pack's letter "${doc.letter}"`,
      });
    }
    if (!spec.glyph.lower) {
      // Children learn the uppercase first and are ~16x more likely to know a
      // lowercase letter if they know its partner, so the pair is the unit.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['letterSpec', 'glyph', 'lower'],
        message: 'latin letters are taught as a pair — set the lowercase glyph too',
      });
    }
  } else if (doc.letter && doc.letter !== spec.glyph.upper) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['letterSpec', 'glyph', 'upper'],
      message: `glyph "${spec.glyph.upper}" does not match the pack's letter "${doc.letter}"`,
    });
  }

  // Same all-or-nothing rule as narration: a language the pack advertises must
  // be complete, or the language pill swaps a word to blank.
  if ((doc.availableLangs ?? ['en']).includes('hi')) {
    const needsHi = (value: unknown, path: (string | number)[]): void => {
      if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).hi) {
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'availableLangs includes "hi" but this text has no Hindi',
      });
    };
    needsHi(spec.name.text, ['letterSpec', 'name', 'text', 'hi']);
    needsHi(spec.phoneme.say, ['letterSpec', 'phoneme', 'say', 'hi']);
    spec.words.forEach((word, i) => needsHi(word.text, ['letterSpec', 'words', i, 'text', 'hi']));
  }
}

export const packSchema = packBodySchema.superRefine((doc, ctx) => {
  const assetIds = new Set((doc.assetManifest ?? []).map((a) => a.id));

  const requireAsset = (id: string | undefined, path: (string | number)[]): void => {
    if (!id || assetIds.has(id)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `"${id}" is not an id in assetManifest — the picture would not load`,
    });
  };

  // A cover or moment pointing at a missing manifest id is THE failure that
  // reaches a child as a blank screen. Catch it here, at save time.
  requireAsset(doc.cover?.image, ['cover', 'image']);

  const seenMomentIds = new Set<string>();
  doc.moments.forEach((moment, i) => {
    if (seenMomentIds.has(moment.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moments', i, 'id'],
        message: `duplicate moment id "${moment.id}" — narration clips are keyed by it`,
      });
    }
    seenMomentIds.add(moment.id);

    requireAsset(moment.visual?.asset, ['moments', i, 'visual', 'asset']);
    requireAsset(moment.visual?.poster, ['moments', i, 'visual', 'poster']);
    requireAsset(moment.visual?.overlayAnimation, ['moments', i, 'visual', 'overlayAnimation']);
    (moment.vectorFallback?.cast ?? []).forEach((c, ci) => {
      requireAsset(c.asset, ['moments', i, 'vectorFallback', 'cast', ci, 'asset']);
    });

    // An image/video moment with no asset silently downgrades to the vector
    // fallback in the app — usually not what the author meant.
    const primary = moment.visual?.primary;
    if ((primary === 'image' || primary === 'video') && !moment.visual?.asset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moments', i, 'visual', 'asset'],
        message: `visual.primary is "${primary}" but no asset is set`,
      });
    }

    // Cue targets must be staged in this moment's vector fallback, or the
    // fallback render has nothing to animate. 'stage' means the whole canvas.
    const stagedIds = new Set<string>(['stage']);
    (moment.vectorFallback?.cast ?? []).forEach((c) => stagedIds.add(c.id));
    (moment.vectorFallback?.layers ?? []).forEach((l) =>
      (l.props ?? []).forEach((p) => stagedIds.add(p.id)),
    );
    (moment.cues ?? []).forEach((cue, ci) => {
      if (!('target' in cue) || !cue.target) return;
      if (stagedIds.has(cue.target)) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moments', i, 'cues', ci, 'target'],
        message: `cue target "${cue.target}" is not staged in this moment's vectorFallback`,
      });
    });
  });

  // Kind-specific required discriminators, so the catalog endpoints can filter.
  if (doc.kind === 'poem' && !doc.topic) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['topic'], message: 'poem packs need a topic' });
  }
  // A story and a poem ARE their timeline — an empty one is an empty screen.
  // Only `abc` may go without, because its content lives in `letterSpec`.
  if (doc.kind !== 'abc' && doc.moments.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['moments'],
      message: `a ${doc.kind} pack needs at least one scene`,
    });
  }

  if (doc.kind === 'poem') validatePoem(doc, ctx);
  if (doc.kind === 'abc') validateAbc(doc, ctx, requireAsset);

  // Every language the pack advertises must actually have text, or the
  // in-player language pill would swap to blank narration.
  //
  // This is a rule about MULTILINGUAL packs specifically. A pack that offers
  // only Hindi has no pill to swap and no English to fall back from: its text
  // is a plain Hindi string, exactly as it should be. Requiring a `.hi` key
  // there would demand `{ en: <Hindi>, hi: <Hindi> }` — the same words twice,
  // one of them under the wrong language. Monolingual Hindi rhymes are the
  // whole reason this distinction exists.
  const langs = doc.availableLangs ?? ['en'];
  if (langs.length > 1 && langs.includes('hi')) {
    doc.moments.forEach((moment, i) => {
      const t = moment.narration.text;
      if (typeof t === 'string' || !t.hi) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['moments', i, 'narration', 'text', 'hi'],
          message: 'availableLangs includes "hi" but this moment has no Hindi narration',
        });
      }
    });
  }
});

export type PackDoc = z.infer<typeof packSchema>;

export type PackValidation =
  | { ok: true; data: PackDoc }
  | { ok: false; errors: z.typeToFlattenedError<PackDoc> };

/** Validates a pack document. On success the caller should still persist the
 *  ORIGINAL input, not `data` — see the note at the top of this file. */
export function validatePack(input: unknown): PackValidation {
  const parsed = packSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: parsed.error.flatten() };
}

// The cinematic story wire format + its zod validator.
//
// A cinematic story is a playable script: ordered scenes, each with a
// background preset, positioned props/characters, particle effects, a camera
// move, narration text (spoken by on-device TTS in the app, shown as a
// subtitle) and at most one tap/drag interaction. Everything visual is a
// CLOSED ENUM the Flutter app knows how to render — the LLM writes the script,
// never the pixels — so stories need zero CDN assets and work offline.
//
// This schema is the contract with the app. The enum lists below are mirrored
// in brightmind_kids/lib/src/features/learn/data/cinematic_story.dart; add new
// vocabulary in BOTH places (the app degrades unknown values gracefully, but
// the whole point of validating here is that published content always renders).

import { z } from 'zod';

export const CINEMATIC_LANGS = ['en', 'hi'] as const;
export const CINEMATIC_AGE_BANDS = ['junior', 'senior'] as const;

export const SCENE_BACKGROUNDS = [
  'hot_day',
  'forest',
  'night',
  'pond',
  'village',
  'sky',
  'rain',
] as const;

export const PROP_KINDS = [
  'sun',
  'cloud',
  'tree',
  'pot',
  'pond',
  'house',
  'rock',
  'bush',
  'mountain',
  'flower',
  'star',
  'moon',
] as const;

export const CHARACTER_KINDS = [
  'crow',
  'rabbit',
  'turtle',
  'lion',
  'mouse',
  'elephant',
  'monkey',
  'dog',
  'cat',
  'bird',
] as const;

export const PARTICLE_KINDS = [
  'sun_rays',
  'wind',
  'birds',
  'leaves',
  'rain',
  'stars',
  'bubbles',
] as const;

export const CHARACTER_ANIMATIONS = ['idle', 'fly', 'hop', 'walk', 'bounce'] as const;

export const CAMERA_EFFECTS = ['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right'] as const;

export const MUSIC_TRACKS = ['forest', 'calm', 'playful', 'night'] as const;

export const INTERACTION_TYPES = ['tap', 'drag'] as const;

const relCoord = z.number().min(0).max(1);

const propSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PROP_KINDS),
  x: relCoord,
  y: relCoord,
  scale: z.number().min(0.3).max(3).default(1),
});

const characterSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(CHARACTER_KINDS),
  x: relCoord,
  y: relCoord,
  scale: z.number().min(0.3).max(3).default(1),
  animation: z.enum(CHARACTER_ANIMATIONS).default('idle'),
});

const interactionSchema = z.object({
  type: z.enum(INTERACTION_TYPES),
  // id of a prop or character in the same scene the child taps / drags.
  target: z.string().min(1),
  // drag only: id of the prop/character the target is dropped onto.
  dropZone: z.string().min(1).optional(),
  // Short spoken + shown hint, in the story's language ("सूरज को छुओ").
  hint: z.string().min(1),
  // SFX the app plays on success; matches the bundled Sfx names.
  sound: z.enum(['pop', 'plop', 'chime', 'flip', 'win', 'tap']).default('chime'),
});

const cameraSchema = z.object({
  effect: z.enum(CAMERA_EFFECTS).default('none'),
});

export const sceneSchema = z.object({
  id: z.number().int().min(1),
  title: z.string().min(1),
  // Seconds the scene stays up at minimum (narration may run longer).
  minDuration: z.number().min(2).max(30).default(8),
  background: z.enum(SCENE_BACKGROUNDS),
  // 1-2 sentences, spoken via TTS and shown as the subtitle.
  narration: z.string().min(1),
  camera: cameraSchema.default({ effect: 'none' }),
  props: z.array(propSchema).max(6).default([]),
  characters: z.array(characterSchema).max(4).default([]),
  particles: z.array(z.enum(PARTICLE_KINDS)).max(3).default([]),
  interaction: interactionSchema.nullish(),
});

export const rewardSchema = z.object({
  stars: z.number().int().min(1).max(20).default(10),
  coins: z.number().int().min(0).max(10).default(5),
  badgeStickerId: z.string().min(1).default('star'),
});

export const cinematicStorySchema = z
  .object({
    title: z.string().min(1),
    lang: z.enum(CINEMATIC_LANGS),
    ageBand: z.enum(CINEMATIC_AGE_BANDS),
    category: z.string().min(1).default('Moral Stories'),
    coverEmoji: z.string().min(1),
    music: z.enum(MUSIC_TRACKS).default('calm'),
    moral: z.string().min(1),
    reward: rewardSchema.default({}),
    scenes: z.array(sceneSchema).min(3).max(8),
  })
  .superRefine((doc, ctx) => {
    // Interaction targets must exist in their own scene, or the player would
    // wait forever on something the child can't touch.
    doc.scenes.forEach((scene, i) => {
      const ids = new Set([
        ...scene.props.map((p) => p.id),
        ...scene.characters.map((c) => c.id),
      ]);
      const inter = scene.interaction;
      if (!inter) return;
      if (!ids.has(inter.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'interaction', 'target'],
          message: `interaction.target "${inter.target}" is not a prop/character id in scene ${scene.id}`,
        });
      }
      if (inter.type === 'drag') {
        if (!inter.dropZone) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['scenes', i, 'interaction', 'dropZone'],
            message: 'drag interactions require a dropZone',
          });
        } else if (!ids.has(inter.dropZone)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['scenes', i, 'interaction', 'dropZone'],
            message: `interaction.dropZone "${inter.dropZone}" is not a prop/character id in scene ${scene.id}`,
          });
        }
      }
    });
  });

export type CinematicStoryDoc = z.infer<typeof cinematicStorySchema>;
export type CinematicScene = z.infer<typeof sceneSchema>;

/** The JSON shape passed to the LLM inside the grounded prompt. Kept compact —
 *  the full constraints live in this file's zod schema, which re-validates. */
export const CINEMATIC_OUTPUT_SHAPE =
  '{title, lang, ageBand, category, coverEmoji, music, moral, ' +
  'reward: {stars, coins, badgeStickerId}, ' +
  'scenes: [{id, title, minDuration, background, narration, ' +
  'camera: {effect}, props: [{id, kind, x, y, scale}], ' +
  'characters: [{id, kind, x, y, scale, animation}], particles, ' +
  'interaction: {type, target, dropZone?, hint, sound} | null}]}';

/** Staging rules embedded in the generation prompt so the model writes scripts
 *  the renderer can actually stage. */
export function buildCinematicVocabularyPrompt(): string {
  return [
    'You are writing a CINEMATIC SCENE SCRIPT for a kids app that renders it with a fixed visual vocabulary. Follow these rules exactly:',
    `- background must be one of: ${SCENE_BACKGROUNDS.join(', ')}`,
    `- prop kind must be one of: ${PROP_KINDS.join(', ')}`,
    `- character kind must be one of: ${CHARACTER_KINDS.join(', ')}`,
    `- particles must be from: ${PARTICLE_KINDS.join(', ')} (max 3 per scene)`,
    `- character animation must be one of: ${CHARACTER_ANIMATIONS.join(', ')}`,
    `- camera.effect must be one of: ${CAMERA_EFFECTS.join(', ')}`,
    `- music must be one of: ${MUSIC_TRACKS.join(', ')}`,
    '- 4 to 6 scenes. Each scene: 1-2 short sentences of narration, 1-3 characters, 1-4 props, x/y are fractions of the screen (0..1, y grows downward; keep characters between y 0.4 and 0.8).',
    '- At most ONE interaction per scene, and at most 2 interactions in the whole story. interaction.target (and dropZone for drag) MUST be the id of a prop or character placed in that same scene. The hint is a short instruction a 4-year-old understands, written in the story language.',
    '- The final scene has no interaction and its narration states the moral warmly.',
    '- Every id is a short lowercase slug (e.g. "crow", "pot", "sun").',
    '- reward: stars 5-15, coins 3-8, badgeStickerId a short slug.',
  ].join('\n');
}

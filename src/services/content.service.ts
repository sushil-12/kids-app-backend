import Redis from 'ioredis';
import { Story, Poem, AbcLesson, ColoringPage, CinematicStory, Prisma } from '@prisma/client';
import { OpenAIService } from './openai.service';
import { RagService } from './rag.service';
import { buildGroundedPrompt } from './grounding';
import { imageToColoringPage } from './coloring.trace';
import {
  cinematicStorySchema,
  buildCinematicVocabularyPrompt,
  CINEMATIC_OUTPUT_SHAPE,
  type CinematicStoryDoc,
} from './cinematic.schema';
import {
  createStory,
  createPoem,
  upsertAbcLesson,
  upsertColoringPage,
  createCinematicStory,
} from '../db/content.repo';

// Subjects the daily coloring page is drawn from. Picked server-side so the
// image prompt is concrete (one subject per call).
const COLORING_SUBJECTS = [
  'Baby Dinosaur',
  'Panda',
  'Lion Cub',
  'Elephant',
  'Bunny',
  'Fox',
  'Turtle',
  'Dolphin',
  'Fire Truck',
  'Monster Truck',
  'Excavator',
  'Tractor',
  'Rocket',
  'Train',
  'Unicorn',
  'Dragon',
  'Princess Castle',
  'Pirate Ship',
  'Bee',
  'Butterfly',
  'Hot Air Balloon',
  'Robot',
  'Birthday Cake',
  'Ice Cream',
  'Christmas Tree',
] as const;

export class ContentService {
  private openai: OpenAIService;
  private redis: Redis;
  private rag: RagService;

  constructor(redis: Redis) {
    this.openai = new OpenAIService(redis);
    this.redis = redis;
    this.rag = new RagService(this.openai, redis);
  }

  async generateStory(ageBand: 'junior' | 'senior', date: string): Promise<Story> {
    const intent = `Write a warm, gentle bedtime story for ${ageBand} kids (age band, date: ${date}). 6-8 sentences, a clear moral, kid-friendly.`;
    const chunks = await this.rag.retrieve(intent, { kind: ['story', 'fact'], ageBand });
    const { system, user, sources } = buildGroundedPrompt(
      intent,
      '{title, story: "6-8 sentences", moral: "1 sentence", emoji}',
      chunks,
    );

    const raw = await this.openai.complete(system, user, 420);
    const parsed = JSON.parse(raw) as { title: string; story: string; moral: string; emoji: string };

    return createStory({
      ageBand,
      title: parsed.title,
      body: parsed.story,
      moral: parsed.moral,
      emoji: parsed.emoji,
      source: 'openai-grounded',
      date,
      sources: sources as unknown as Prisma.InputJsonValue,
    });
  }

  // Generates a full cinematic scene script (see cinematic.schema.ts for the
  // format). The LLM writes the SCRIPT only — every visual is a closed enum
  // the app renders locally, so no image/audio generation happens here. Output
  // is zod-validated (one retry on invalid JSON) and lands UNPUBLISHED for
  // admin review, same as AI coloring pages. RAG grounding reuses the English
  // story corpus; for lang=hi the prompt instructs Hindi output.
  async generateCinematicStory(
    ageBand: 'junior' | 'senior',
    lang: 'en' | 'hi',
    date: string,
  ): Promise<CinematicStory> {
    const langName = lang === 'hi' ? 'Hindi (Devanagari script)' : 'English';
    const intent =
      `Write an interactive cinematic story for ${ageBand} kids (date: ${date}). ` +
      `All text (title, narration, hints, moral, scene titles) must be in ${langName}. ` +
      `A classic-style moral tale (like Panchatantra / Aesop) with a gentle, warm tone.\n\n` +
      buildCinematicVocabularyPrompt() +
      `\n\nSet "lang" to "${lang}" and "ageBand" to "${ageBand}".`;

    const chunks = await this.rag.retrieve(intent, { kind: ['story', 'fact'], ageBand });
    const { system, user, sources } = buildGroundedPrompt(intent, CINEMATIC_OUTPUT_SHAPE, chunks);

    let doc = await this.completeCinematic(system, user);
    if (!doc.success) {
      // One retry with the validation errors appended — scene scripts are the
      // most structured thing we ask the model for, so a nudge usually fixes it.
      const retryUser =
        `${user}\n\nYour previous output failed validation with these errors, fix them and output the corrected JSON only:\n${doc.error}`;
      doc = await this.completeCinematic(system, retryUser);
      if (!doc.success) {
        throw new Error(`Cinematic story failed validation after retry: ${doc.error}`);
      }
    }

    const story = doc.data;
    const baseSlug = story.title
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'story';
    const slug = `${baseSlug}-${lang}-${Math.random().toString(36).slice(2, 6)}`;

    return createCinematicStory({
      slug,
      title: story.title,
      lang,
      ageBand,
      category: story.category,
      coverEmoji: story.coverEmoji,
      music: story.music,
      moral: story.moral,
      reward: story.reward as unknown as Prisma.InputJsonValue,
      scenes: story.scenes as unknown as Prisma.InputJsonValue,
      date,
      source: 'openai-grounded',
      sources: sources as unknown as Prisma.InputJsonValue,
      published: false,
    });
  }

  private async completeCinematic(
    system: string,
    user: string,
  ): Promise<{ success: true; data: CinematicStoryDoc } | { success: false; error: string }> {
    const raw = await this.openai.complete(system, user, 2400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { success: false, error: 'output was not valid JSON' };
    }
    const result = cinematicStorySchema.safeParse(parsed);
    if (!result.success) {
      return {
        success: false,
        error: JSON.stringify(result.error.flatten().fieldErrors).slice(0, 800),
      };
    }
    return { success: true, data: result.data };
  }

  async generatePoem(topic: string): Promise<Poem> {
    const intent = `Write a 4-line rhyming children's poem about '${topic}' for ages 5-6. Simple, playful, kid-friendly.`;
    const chunks = await this.rag.retrieve(intent, { kind: ['poem', 'fact'], topic });
    const { system, user, sources } = buildGroundedPrompt(
      intent,
      '{title, poem: "lines joined by \\n", emoji}',
      chunks,
    );

    const raw = await this.openai.complete(system, user, 180);
    const parsed = JSON.parse(raw) as { title: string; poem: string; emoji: string };

    return createPoem({
      topic,
      title: parsed.title,
      lines: parsed.poem,
      emoji: parsed.emoji,
      source: 'openai-grounded',
      sources: sources as unknown as Prisma.InputJsonValue,
    });
  }

  async generateAbcLesson(letter: string): Promise<AbcLesson> {
    const upperLetter = letter.toUpperCase();
    const intent = `Write an ABC phonics lesson for the letter '${upperLetter}' for young children. A word, its phonics, and a 2-3 sentence mini story.`;
    const chunks = await this.rag.retrieve(intent, { kind: ['abc', 'fact'] });
    const { system, user, sources } = buildGroundedPrompt(
      intent,
      '{letter, word, emoji, phonics: "short tip", miniStory: "2-3 sentences"}',
      chunks,
    );

    const raw = await this.openai.complete(system, user, 200);
    const parsed = JSON.parse(raw) as {
      letter: string;
      word: string;
      emoji: string;
      phonics: string;
      miniStory: string;
    };

    return upsertAbcLesson({
      letter: upperLetter,
      word: parsed.word,
      emoji: parsed.emoji,
      phonics: parsed.phonics,
      miniStory: parsed.miniStory,
      source: 'openai-grounded',
      sources: sources as unknown as Prisma.InputJsonValue,
    });
  }

  // Generates one coloring page from a DALL·E-3 line-art image, then traces it
  // into the app's vector format (see coloring.trace.ts). Text models can't draw
  // recognizable SVG geometry by hand, so we let an image model draw the picture
  // and derive the fillable regions (the white cells a child taps) from it. The
  // page still lands UNPUBLISHED in the review queue — tracing quality varies,
  // so a human approves each one via GET /v1/coloring/review.
  async generateColoringPage(date: string): Promise<ColoringPage> {
    const subject =
      COLORING_SUBJECTS[Math.floor(Math.random() * COLORING_SUBJECTS.length)];
    const baseSlug = subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    // Unique suffix so two pages of the same subject don't overwrite each other
    // (upsert is keyed by slug) and re-generations always queue a fresh page.
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const prompt =
      `Children's coloring book page: a cute, friendly cartoon ${subject} for kids aged 2 to 8. ` +
      `Pure line art — uniform bold black outlines on a plain white background, like a printable coloring sheet. ` +
      `One single subject, centered, filling most of the page, with large simple shapes and big open areas to color inside. ` +
      `Every outline must be a smooth, continuous, fully-closed loop so each shape is its own enclosed region. ` +
      `Absolutely no color, no gray, no fill, no shading, no gradients, no crosshatching, no stippling, no fine texture, no patterns inside shapes, no background scenery, no text or watermark. ` +
      `Flat 2D, thick even line weight, high contrast, clean simple coloring-book style.`;

    const image = await this.openai.generateImage(prompt);

    return this.importColoringImage(image, {
      slug,
      title: `Friendly ${subject}`,
      stickerRewardId: baseSlug,
      date,
      source: 'openai',
    });
  }

  // Traces any black-on-white line-art IMAGE into the app's fillable-region
  // format and queues it UNPUBLISHED for human review. This is the shared write
  // path for both AI generation (above) and manual uploads (e.g. art exported
  // from Canva, a licensed pack, or any drawing tool) via POST /v1/coloring/import.
  // The source just has to be clean line art — bold black outlines, white
  // background, no fills/shading — or the trace won't find real cells.
  async importColoringImage(
    image: Buffer,
    opts: {
      slug: string;
      title: string;
      stickerRewardId: string;
      date?: string | null;
      source?: string;
      isPremium?: boolean;
    }
  ): Promise<ColoringPage> {
    const art = await imageToColoringPage(image);

    // A usable page needs the background plus a few real fillable cells and the
    // traced line art. Otherwise the trace failed — reject so review stays clean.
    // For SVG input, we're more lenient since paths are explicitly authored.
    const isSvg = image.length > 0 && 
      (image.toString('utf8', 0, 100).includes('<svg') || 
       image.toString('utf8', 0, 100).includes('<?xml'));
    
    if (isSvg) {
      // SVG: require at least 1 fillable region (excluding background) + some outline/detail
      const fillableRegions = art.regions.filter(r => r.id !== 'background').length;
      if (fillableRegions < 1) {
        throw new Error(
          'SVG has no fillable regions. Each fillable area must be its own closed ' +
          '<path> (or <rect>/<circle>/<ellipse>/<polygon>) with fill="white" or no fill attribute.'
        );
      }
      if (art.outlines.length === 0 && art.details.length === 0) {
        throw new Error(
          'SVG has no outlines or details. Add stroke-only paths for the line art ' +
          '(stroke="black", fill="none" or class="outline").'
        );
      }
    } else {
      // Raster (PNG/JPEG): strict checks for trace quality
      if (art.regions.length < 4 || art.details.length === 0) {
        throw new Error(
          'Traced coloring page has too few regions — the image needs bold, ' +
          'fully-closed black outlines on a plain white background.'
        );
      }
    }

    return upsertColoringPage({
      slug: opts.slug,
      title: opts.title,
      viewBox: 100,
      isPremium: opts.isPremium ?? false,
      stickerRewardId: opts.stickerRewardId,
      regions: art.regions as unknown as Prisma.InputJsonValue,
      outlines: art.outlines,
      details: art.details,
      date: opts.date ?? null,
      source: opts.source ?? 'upload',
      published: false,
    });
  }

  getOpenAIService(): OpenAIService {
    return this.openai;
  }
}

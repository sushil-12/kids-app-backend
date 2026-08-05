import { z } from 'zod';

/** An optional setting that treats "" as unset.
 *
 *  Docker Compose expands an unset variable to an empty string, so
 *  `S3_BUCKET: ${S3_BUCKET:-}` arrives as `""` rather than absent. Without this
 *  the container would refuse to boot over a variable nobody set on purpose.
 *  Validation still applies to real values. */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  OPENAI_API_KEY: z.string().min(1),
  API_KEY: z.string().min(1),
  ADMIN_API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DAILY_OPENAI_CALL_LIMIT: z.coerce.number().default(50),
  // Embedding budget is separate from generation so a corpus backfill can't
  // starve story/poem generation. Embeddings are ~$0.02/1M tokens — cheap —
  // but still gated to avoid runaway backfill costs.
  DAILY_EMBED_LIMIT: z.coerce.number().default(500),
  // OpenAI embedding model. text-embedding-3-small = 1536 dims (matches the
  // vector(1536) column in schema.prisma). Switching to -large changes the
  // dimensionality and requires a re-embed migration.
  EMBEDDING_MODEL: z
    .enum(['text-embedding-3-small', 'text-embedding-3-large'])
    .default('text-embedding-3-small'),
  // How many passages RAGService.retrieve returns by default.
  RAG_TOP_K: z.coerce.number().default(6),
  // Image model for coloring-page generation. gpt-image-1 produces far cleaner,
  // fully-closed line art than dall-e-3 and follows the prompt much better.
  // Override to 'dall-e-3' if your OpenAI org isn't verified for gpt-image-1.
  IMAGE_MODEL: z.enum(['gpt-image-1', 'dall-e-3']).default('gpt-image-1'),
  // gpt-image-1 only. 'high' = crispest outlines (best trace), 'medium' = cheaper.
  IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).default('high'),
  // Absolute origin this API is reachable at. Baked into the narration-clip
  // URLs stored inside content packs, so it must be what the APP can reach —
  // not localhost — in any non-dev environment.
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  // ── Media storage (S3) ───────────────────────────────────────────────────
  // Where pack artwork and recorded narration live. All four must be set for
  // S3 to switch on; with any of them missing the backend falls back to
  // storing narration in Postgres and to paste-a-URL-only artwork, so a dev
  // machine works with no cloud credentials at all.
  S3_BUCKET: optionalEnv(z.string().min(1)),
  S3_REGION: z.string().min(1).default('ap-southeast-2'),
  AWS_ACCESS_KEY_ID: optionalEnv(z.string().min(1)),
  AWS_SECRET_ACCESS_KEY: optionalEnv(z.string().min(1)),
  // CloudFront (or any CDN) origin in front of the bucket. Without it, objects
  // are addressed by their virtual-hosted S3 URL. This value ends up inside
  // published packs, so changing it later doesn't rewrite existing content —
  // point the new CDN at the same bucket instead.
  S3_PUBLIC_BASE_URL: optionalEnv(
    z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, '')),
  ),
  // Key namespace inside the bucket, so a shared bucket stays tidy.
  S3_KEY_PREFIX: z
    .string()
    .default('brightmind')
    .transform((v) => v.replace(/^\/+|\/+$/g, '')),
  // Cap for a single artwork upload. Presigned uploads go straight from the
  // browser to S3, so this is enforced in the signature, not by our memory.
  MEDIA_MAX_UPLOAD_MB: z.coerce.number().default(15),
  // ElevenLabs recorded narration. Optional: without a key the narration
  // endpoints return 503 and packs simply play with on-device TTS instead.
  // An empty value is treated as unset, so `ELEVENLABS_API_KEY=` in a .env or
  // an unset docker-compose variable disables narration rather than failing boot.
  ELEVENLABS_API_KEY: optionalEnv(z.string().min(1)),
  // Voice ids per language. The default is ElevenLabs' "Rachel" — fine for
  // English, a placeholder for Hindi; pick a native Hindi voice in production.
  ELEVEN_VOICE_EN: z.string().min(1).default('21m00Tcm4TlvDq8ikWAM'),
  ELEVEN_VOICE_HI: z.string().min(1).default('21m00Tcm4TlvDq8ikWAM'),
  // Characters/day cap. ElevenLabs bills per character and a runaway
  // "regenerate everything" click on a big library is expensive, so the
  // narration service refuses past this the same way OpenAI calls are capped.
  ELEVENLABS_DAILY_CHAR_LIMIT: z.coerce.number().default(20000),
  // Animated art for rhymes. ADMIN-SIDE ONLY: the portal searches Giphy, an
  // adult approves a clip, and we copy it into our own bucket. The app never
  // sees this key and never talks to Giphy — their own g-rating filter is
  // documented as leaky, so a human is the filter, not the API parameter.
  // Optional: without a key the search tab is hidden and admins upload art.
  GIPHY_API_KEY: optionalEnv(z.string().min(1)),
  // Cap for one imported clip. Unlike presigned uploads these bytes pass
  // through this process, and a rhyme wants a small looping picture, not a
  // 30-second reaction video.
  GIF_MAX_IMPORT_MB: z.coerce.number().default(3),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/** True when every credential S3 needs is present. Everything media-related
 *  branches on this rather than testing individual keys, so there is one
 *  definition of "S3 is on" and no half-configured state. */
export function isS3Configured(env: Env): boolean {
  return Boolean(
    env.S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY,
  );
}

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

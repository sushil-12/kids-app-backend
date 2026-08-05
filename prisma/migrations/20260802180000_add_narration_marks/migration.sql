-- Narration clips carry their word timings.
--
-- Sing-along highlighting needs to know when each word is spoken. ElevenLabs
-- returns that alignment as part of the same synthesis call
-- (/text-to-speech/:voice/with-timestamps), so the timings cost nothing extra —
-- but only on the call that actually synthesises.
--
-- Regenerating a pack SKIPS every clip whose text hash is unchanged, which is
-- the whole point of the content-hash design. Without somewhere to keep them,
-- those skipped clips would come back with no marks and the karaoke would go
-- dead on the second run. So the marks live next to the audio they belong to,
-- and a skipped clip restores its timings from here.
--
-- Both columns are nullable and additive: clips recorded before this migration
-- keep serving, and the app degrades to line-level highlighting for them.
ALTER TABLE "narration_clips" ADD COLUMN "marks" JSONB;
ALTER TABLE "narration_clips" ADD COLUMN "durationMs" INTEGER;

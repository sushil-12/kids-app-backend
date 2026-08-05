-- CreateTable
CREATE TABLE "content_packs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '3.0',
    "title" JSONB NOT NULL,
    "availableLangs" JSONB NOT NULL DEFAULT '["en"]',
    "ageBand" TEXT NOT NULL DEFAULT 'junior',
    "category" TEXT NOT NULL DEFAULT 'Moral Stories',
    "concepts" JSONB NOT NULL DEFAULT '[]',
    "moral" JSONB NOT NULL,
    "estimatedDuration" INTEGER NOT NULL DEFAULT 150,
    "cover" JSONB NOT NULL,
    "audio" JSONB NOT NULL,
    "reward" JSONB NOT NULL,
    "assetManifest" JSONB NOT NULL DEFAULT '[]',
    "moments" JSONB NOT NULL,
    "topic" TEXT,
    "letter" TEXT,
    "date" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narration_clips" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "momentId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'narration',
    "mime" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "bytes" BYTEA NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narration_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_packs_slug_key" ON "content_packs"("slug");

-- CreateIndex
CREATE INDEX "content_packs_kind_published_ageBand_idx" ON "content_packs"("kind", "published", "ageBand");

-- CreateIndex
CREATE INDEX "content_packs_kind_topic_idx" ON "content_packs"("kind", "topic");

-- CreateIndex
CREATE INDEX "content_packs_kind_letter_idx" ON "content_packs"("kind", "letter");

-- CreateIndex
CREATE INDEX "narration_clips_contentHash_idx" ON "narration_clips"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "narration_clips_packId_momentId_lang_kind_key" ON "narration_clips"("packId", "momentId", "lang", "kind");

-- AddForeignKey
ALTER TABLE "narration_clips" ADD CONSTRAINT "narration_clips_packId_fkey" FOREIGN KEY ("packId") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

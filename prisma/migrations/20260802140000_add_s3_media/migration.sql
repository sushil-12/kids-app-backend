-- Narration clips can now live in object storage instead of inline in Postgres.
-- `bytes` becomes nullable so an S3-backed clip carries only its key + URL;
-- clips recorded before S3 was switched on keep their inline bytes and keep
-- serving, so enabling the bucket never orphans existing audio.
ALTER TABLE "narration_clips" ALTER COLUMN "bytes" DROP NOT NULL;
ALTER TABLE "narration_clips" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "narration_clips" ADD COLUMN "url" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'packs',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_folder_createdAt_idx" ON "media_assets"("folder", "createdAt");

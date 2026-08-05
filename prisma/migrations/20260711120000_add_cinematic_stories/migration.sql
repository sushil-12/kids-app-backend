-- CreateTable
CREATE TABLE "cinematic_stories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "ageBand" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Moral Stories',
    "coverEmoji" TEXT NOT NULL,
    "music" TEXT NOT NULL DEFAULT 'calm',
    "moral" TEXT NOT NULL,
    "reward" JSONB NOT NULL,
    "scenes" JSONB NOT NULL,
    "date" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sources" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cinematic_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cinematic_stories_slug_key" ON "cinematic_stories"("slug");

-- CreateIndex
CREATE INDEX "cinematic_stories_ageBand_lang_published_idx" ON "cinematic_stories"("ageBand", "lang", "published");

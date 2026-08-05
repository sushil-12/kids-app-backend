-- CreateTable
CREATE TABLE "coloring_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewBox" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "stickerRewardId" TEXT NOT NULL,
    "regions" JSONB NOT NULL,
    "outlines" JSONB NOT NULL,
    "details" JSONB NOT NULL DEFAULT '[]',
    "date" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coloring_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coloring_pages_slug_key" ON "coloring_pages"("slug");

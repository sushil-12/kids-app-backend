-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "ageBand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "moral" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" TEXT,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poems" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lines" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abc_lessons" (
    "id" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "phonics" TEXT NOT NULL,
    "miniStory" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abc_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_sources" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "lastCrawled" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "crawl_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "abc_lessons_letter_key" ON "abc_lessons"("letter");

-- CreateIndex
CREATE UNIQUE INDEX "crawl_sources_url_key" ON "crawl_sources"("url");

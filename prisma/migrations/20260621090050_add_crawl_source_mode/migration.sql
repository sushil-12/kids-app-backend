-- AlterTable
ALTER TABLE "crawl_sources" ADD COLUMN     "discoveredFrom" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'page';

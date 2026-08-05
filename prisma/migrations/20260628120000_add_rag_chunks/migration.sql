-- RAG retrieval corpus (pgvector). Prisma can't declare the `vector` type or
-- HNSW index, so the table is created here by hand and mirrored as
-- `Unsupported("vector(1536)")` in schema.prisma. Embeddings are 1536-dim
-- (text-embedding-3-small); switching models requires a re-embed migration.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "ageBand" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "topic" TEXT,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),
    "contentHash" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_contentHash_key" ON "document_chunks"("contentHash");
CREATE INDEX "document_chunks_kind_ageBand_lang_idx" ON "document_chunks"("kind", "ageBand", "lang");
-- HNSW approximate-nearest-neighbour index for cosine similarity retrieval.
CREATE INDEX "document_chunks_embedding_hnsw_idx"
    ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Provenance columns for grounded generation on the three content tables.
ALTER TABLE "stories" ADD COLUMN "sources" JSONB;
ALTER TABLE "poems" ADD COLUMN "sources" JSONB;
ALTER TABLE "abc_lessons" ADD COLUMN "sources" JSONB;

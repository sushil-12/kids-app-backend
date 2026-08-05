// Shared types for the RAG layer. Kept in one place so the retrieval service
// and the grounding prompt builder can reference the same shapes without a
// circular import.

export interface RetrievedChunk {
  id: string;
  text: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  /** Cosine similarity to the query (1 = closest). */
  score: number;
}

export interface RetrieveFilters {
  /** Restrict to corpus kind(s): "story" | "poem" | "abc" | "fact". */
  kind?: string | string[];
  ageBand?: 'junior' | 'senior';
  lang?: string;
  topic?: string;
  k?: number;
}

export interface GroundedSource {
  title: string | null;
  url: string | null;
}

export interface GroundedPrompt {
  system: string;
  user: string;
  sources: GroundedSource[];
}

// Embedding dimensionality. MUST match the `vector(1536)` column in
// schema.prisma and the EMBEDDING_MODEL default (text-embedding-3-small).
export const EMBEDDING_DIM = 1536;

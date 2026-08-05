// Retrieval-Augmented Generation retrieval layer. Given a natural-language
// intent, embeds it and returns the top-k most similar grounded passages from
// the `document_chunks` corpus, pre-filtered by kind/ageBand/lang.
//
// Two safety properties:
//  1. Redis cache (rag:q:<hash>) — identical queries are free.
//  2. Graceful fallback — any failure (pgvector down, empty corpus, embed
//     error) returns [] instead of throwing. Callers (ContentService) fall
//     back to an un-grounded prompt, so the app never breaks because of RAG.

import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { OpenAIService } from './openai.service';
import { searchChunks } from '../db/vector.repo';
import type { RetrievedChunk, RetrieveFilters } from './rag.types';
import pino from 'pino';

const logger = pino({ level: config.LOG_LEVEL });

export class RagService {
  constructor(private openai: OpenAIService, private redis: Redis) {}

  /**
   * Retrieve top-k passages relevant to `query`. Returns [] on any failure
   * (see file header) so generation degrades gracefully to un-grounded.
   */
  async retrieve(query: string, filters: RetrieveFilters = {}): Promise<RetrievedChunk[]> {
    const k = filters.k ?? config.RAG_TOP_K;
    const lang = filters.lang ?? 'en';
    const kinds = filters.kind
      ? Array.isArray(filters.kind)
        ? filters.kind
        : [filters.kind]
      : null;
    const ageBand = filters.ageBand ?? null;

    const cacheKey = this.cacheKey(query, { kinds, ageBand, lang, k });
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as RetrievedChunk[];
    } catch (err) {
      logger.warn({ err }, 'RAG cache read failed, proceeding to search');
    }

    let queryVec: number[];
    try {
      queryVec = await this.openai.embedOne(query);
    } catch (err) {
      logger.warn({ err }, 'RAG query embedding failed — returning no context');
      return [];
    }

    let chunks: RetrievedChunk[];
    try {
      chunks = await searchChunks(queryVec, { kinds, ageBand, lang, k });
    } catch (err) {
      logger.warn({ err }, 'RAG vector search failed — returning no context');
      return [];
    }

    try {
      await this.redis.setex(cacheKey, 3600, JSON.stringify(chunks));
    } catch (err) {
      logger.warn({ err }, 'RAG cache write failed (non-fatal)');
    }

    return chunks;
  }

  private cacheKey(
    query: string,
    f: { kinds: string[] | null; ageBand: string | null; lang: string; k: number },
  ): string {
    const payload = JSON.stringify({ query, ...f });
    const h = createHash('sha256').update(payload).digest('hex').slice(0, 24);
    return `rag:q:${h}`;
  }
}

import { FastifyPluginAsync } from 'fastify';
import { generateQueue } from '../../jobs/queue';
import { OpenAIService } from '../../services/openai.service';
import { RagService } from '../../services/rag.service';
import { countChunks, countChunksByKind } from '../../db/vector.repo';

// Admin-only RAG management: trigger a corpus backfill, inspect corpus stats,
// and debug retrieval (top-k chunks for a query — no LLM call). All behind
// authenticateAdmin. The backfill job is the same code path the cron would use
// if scheduled; it's also the one-shot way to populate the corpus after a
// fresh migrate.
export const ragAdminRoute: FastifyPluginAsync = async (fastify) => {
  // Enqueue a one-shot corpus backfill. Idempotent (contentHash dedupe), so
  // safe to fire repeatedly. Returns 202 + jobId.
  fastify.post(
    '/rag/backfill',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const job = await generateQueue.add(
        'backfill-corpus',
        { type: 'backfill-corpus' },
        { jobId: `backfill-${Date.now()}` },
      );
      return reply.code(202).send({ jobId: job.id });
    },
  );

  // Corpus size + per-kind breakdown + today's embed call count.
  fastify.get(
    '/rag/stats',
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const [total, byKind, embedCallsToday] = await Promise.all([
        countChunks(),
        countChunksByKind(),
        new OpenAIService(fastify.redis).getEmbedCallCountToday(),
      ]);
      return reply.send({ total, byKind, embedCallsToday });
    },
  );

  // Debug retrieval: returns the top-k chunks a query would ground on, with
  // scores + source attribution. No LLM call — just embedding + ANN search.
  fastify.get<{ Querystring: { q?: string; k?: string; kind?: string; ageBand?: string } }>(
    '/rag/search',
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const q = (request.query.q ?? '').trim();
      if (!q) {
        return reply.code(400).send({ error: 'q query parameter is required' });
      }
      const k = Math.min(Math.max(Number(request.query.k ?? 6), 1), 20);
      const kind = request.query.kind;
      const rag = new RagService(new OpenAIService(fastify.redis), fastify.redis);
      const chunks = await rag.retrieve(q, {
        k,
        kind: kind ? kind.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        ageBand:
          request.query.ageBand === 'junior' || request.query.ageBand === 'senior'
            ? request.query.ageBand
            : undefined,
      });
      return reply.send({ query: q, chunks });
    },
  );
};

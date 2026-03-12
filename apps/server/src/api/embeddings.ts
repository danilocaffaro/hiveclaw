/**
 * api/embeddings.ts — Embedding management endpoints
 *
 * - POST /embeddings/search — hybrid search (FTS5 + vector)
 * - GET /embeddings/status — embedding coverage stats
 * - POST /embeddings/backfill — trigger background embedding of unembedded messages
 */

import type { FastifyInstance } from 'fastify';
import {
  loadVecExtension,
  initEmbeddingTables,
  generateEmbedding,
  storeEmbedding,
  hybridSearch,
  vectorSearch,
  getEmbeddingDimensions,
  type EmbeddingConfig,
} from '../engine/embeddings.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

let vecLoaded = false;

function ensureVec(db: ReturnType<typeof getDb>, dimensions: number): void {
  if (!vecLoaded) {
    try {
      loadVecExtension(db);
      initEmbeddingTables(db, dimensions);
      vecLoaded = true;
    } catch (err) {
      logger.error('[Embeddings] Failed to load sqlite-vec: %s', (err as Error).message);
      throw err;
    }
  }
}

export function registerEmbeddingRoutes(app: FastifyInstance): void {
  const db = getDb();

  // POST /embeddings/search — hybrid or vector-only search
  app.post<{
    Body: {
      query: string;
      session_id?: string;
      limit?: number;
      mode?: 'hybrid' | 'vector' | 'fts';
      provider_id: string;
      base_url?: string;
      api_key?: string;
      model?: string;
    };
  }>('/embeddings/search', async (req, reply) => {
    try {
      const { query, session_id, limit = 10, mode = 'hybrid' } = req.body;
      const model = req.body.model ?? 'text-embedding-3-small';
      const dimensions = getEmbeddingDimensions(model);

      ensureVec(db, dimensions);

      if (mode === 'fts') {
        // FTS-only (no embedding needed)
        const ftsRows = db.prepare(
          'SELECT rowid, rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?'
        ).all(query, limit);
        return { data: ftsRows };
      }

      // Generate query embedding
      const config: EmbeddingConfig = {
        providerId: req.body.provider_id,
        baseUrl: req.body.base_url ?? 'https://api.openai.com',
        apiKey: req.body.api_key ?? '',
        model,
        dimensions,
      };

      const { embedding: queryEmb } = await generateEmbedding(query, config);

      if (mode === 'vector') {
        const results = vectorSearch(db, queryEmb, limit, session_id);
        return { data: results };
      }

      // Hybrid (default)
      const results = hybridSearch(db, query, queryEmb, limit, session_id);
      return { data: results };
    } catch (err) {
      logger.error('[Embeddings] Search error: %s', (err as Error).message);
      return reply.status(500).send({ error: { code: 'EMBEDDING_ERROR', message: (err as Error).message } });
    }
  });

  // GET /embeddings/status — stats on embedding coverage
  app.get('/embeddings/status', async (_req, reply) => {
    try {
      const totalMessages = (db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;

      let embeddedCount = 0;
      let embeddingModel = 'none';
      try {
        const statusRow = db.prepare('SELECT COUNT(*) as cnt FROM embedding_status').get() as { cnt: number } | undefined;
        embeddedCount = statusRow?.cnt ?? 0;
        const modelRow = db.prepare('SELECT model FROM embedding_status LIMIT 1').get() as { model: string } | undefined;
        embeddingModel = modelRow?.model ?? 'none';
      } catch {
        // Intentional: embedding_status table may not exist on fresh installs
      }

      return {
        data: {
          total_messages: totalMessages,
          embedded_count: embeddedCount,
          coverage_pct: totalMessages > 0 ? Math.round((embeddedCount / totalMessages) * 100) : 0,
          embedding_model: embeddingModel,
          vec_loaded: vecLoaded,
        },
      };
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: (err as Error).message } });
    }
  });

  // POST /embeddings/backfill — embed unembedded messages in background
  app.post<{
    Body: {
      provider_id: string;
      base_url?: string;
      api_key?: string;
      model?: string;
      batch_size?: number;
    };
  }>('/embeddings/backfill', async (req, reply) => {
    try {
      const model = req.body.model ?? 'text-embedding-3-small';
      const dimensions = getEmbeddingDimensions(model);
      const batchSize = req.body.batch_size ?? 50;

      ensureVec(db, dimensions);

      const config: EmbeddingConfig = {
        providerId: req.body.provider_id,
        baseUrl: req.body.base_url ?? 'https://api.openai.com',
        apiKey: req.body.api_key ?? '',
        model,
        dimensions,
      };

      // Find unembedded messages
      const unembedded = db.prepare(`
        SELECT m.id, m.content
        FROM messages m
        LEFT JOIN embedding_status es ON m.id = es.message_id
        WHERE es.message_id IS NULL
          AND m.role IN ('user', 'assistant')
          AND LENGTH(m.content) > 10
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(batchSize) as Array<{ id: string; content: string }>;

      if (unembedded.length === 0) {
        return { data: { embedded: 0, message: 'All messages already embedded' } };
      }

      // Embed in background (fire-and-forget)
      let embedded = 0;
      void (async () => {
        for (const msg of unembedded) {
          try {
            const text = msg.content.slice(0, 8000);
            const result = await generateEmbedding(text, config);
            storeEmbedding(db, msg.id, result.embedding, model, dimensions);
            embedded++;
          } catch (err) {
            logger.warn('[Embeddings] Failed to embed %s: %s', msg.id, (err as Error).message);
          }
        }
        logger.info('[Embeddings] Backfill complete: %d/%d embedded', embedded, unembedded.length);
      })();

      return {
        data: {
          queued: unembedded.length,
          message: `Embedding ${unembedded.length} messages in background`,
        },
      };
    } catch (err) {
      return reply.status(500).send({ error: { code: 'EMBEDDING_ERROR', message: (err as Error).message } });
    }
  });
}

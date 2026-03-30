/**
 * engine/embeddings.ts — Embedding generation + sqlite-vec integration
 *
 * Supports:
 *   - OpenAI API (text-embedding-3-small, 1536 dims)
 *   - Ollama (nomic-embed-text, 768 dims)
 *   - Any OpenAI-compatible endpoint
 *
 * Vector storage uses sqlite-vec (vec0 virtual table).
 * Embedding model is auto-selected from user's available providers.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { logger } from '../lib/logger.js';
import { resolveProviderBaseUrl } from '../config/defaults.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingResult {
  embedding: Float32Array;
  model: string;
  tokensUsed: number;
}

// ─── Known Embedding Models ─────────────────────────────────────────────────────

export const EMBEDDING_MODELS: Record<string, { dimensions: number; costPer1M: number }> = {
  'text-embedding-3-small': { dimensions: 1536, costPer1M: 0.02 },
  'text-embedding-3-large': { dimensions: 3072, costPer1M: 0.13 },
  'text-embedding-ada-002': { dimensions: 1536, costPer1M: 0.10 },
  'nomic-embed-text':       { dimensions: 768,  costPer1M: 0 },
  'mxbai-embed-large':      { dimensions: 1024, costPer1M: 0 },
  'all-minilm':             { dimensions: 384,  costPer1M: 0 },
  'snowflake-arctic-embed': { dimensions: 1024, costPer1M: 0 },
};

/**
 * Get dimensions for a model, defaulting to 1536.
 */
export function getEmbeddingDimensions(model: string): number {
  for (const [key, info] of Object.entries(EMBEDDING_MODELS)) {
    if (model.toLowerCase().includes(key.toLowerCase())) return info.dimensions;
  }
  return 1536; // safe default
}

// ─── Fallback Chain ─────────────────────────────────────────────────────────────

/**
 * Resolve an ordered embedding provider chain.
 * Priority:
 *   1. User's explicitly configured provider (if it has an apiKey or is keyless)
 *   2. Ollama on localhost (always appended as free fallback)
 *
 * Callers should pass the result to generateEmbeddingWithFallback().
 */
export function resolveEmbeddingChain(userConfig?: Partial<EmbeddingConfig>): EmbeddingConfig[] {
  const chain: EmbeddingConfig[] = [];

  // 1. User's configured provider
  if (userConfig && (userConfig.apiKey || userConfig.providerId === 'ollama')) {
    chain.push({
      providerId: userConfig.providerId ?? 'openai',
      baseUrl: userConfig.baseUrl ?? resolveProviderBaseUrl(userConfig.providerId ?? 'openai'),
      apiKey: userConfig.apiKey ?? '',
      model: userConfig.model ?? 'text-embedding-3-small',
      dimensions: userConfig.dimensions ?? getEmbeddingDimensions(userConfig.model ?? 'text-embedding-3-small'),
    });
  }

  // 2. Ollama fallback (always try localhost — it's free)
  // Skip if the user's explicit config already IS Ollama
  const alreadyHasOllama = chain.some(c => c.providerId === 'ollama');
  if (!alreadyHasOllama) {
    chain.push({
      providerId: 'ollama',
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
      apiKey: '',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  }

  return chain;
}

/**
 * Generate embedding with automatic fallback across providers.
 * Tries each config in order; logs warnings on failure and moves to next.
 * Throws only when ALL providers have been exhausted.
 */
export async function generateEmbeddingWithFallback(
  text: string,
  configs: EmbeddingConfig[],
): Promise<EmbeddingResult> {
  let lastError: Error | undefined;
  for (const config of configs) {
    try {
      return await generateEmbedding(text, config);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        '[Embeddings] Provider %s (%s) failed, trying next: %s',
        config.providerId,
        config.model,
        lastError.message,
      );
    }
  }
  throw new Error(
    `All embedding providers failed (${configs.length} tried). Last error: ${lastError?.message ?? 'unknown'}`,
  );
}

/**
 * Health check: test whether a single embedding provider is reachable.
 * Returns true if a trivial embedding succeeds, false otherwise.
 */
export async function checkEmbeddingHealth(config: EmbeddingConfig): Promise<boolean> {
  try {
    await generateEmbedding('health check', config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Startup diagnostic: test every provider in the chain and log availability.
 * Returns the list of healthy configs (may be empty).
 */
export async function checkEmbeddingChainHealth(
  chain: EmbeddingConfig[],
): Promise<EmbeddingConfig[]> {
  const healthy: EmbeddingConfig[] = [];
  for (const config of chain) {
    const ok = await checkEmbeddingHealth(config);
    if (ok) {
      logger.info('[Embeddings] ✅ %s (%s) — available', config.providerId, config.model);
      healthy.push(config);
    } else {
      logger.warn('[Embeddings] ❌ %s (%s) — unavailable', config.providerId, config.model);
    }
  }
  if (healthy.length === 0) {
    logger.warn('[Embeddings] ⚠️  No embedding providers available — vector search will be disabled');
  } else {
    logger.info('[Embeddings] %d/%d provider(s) healthy', healthy.length, chain.length);
  }
  return healthy;
}

// ─── Embedding Generation ───────────────────────────────────────────────────────

/**
 * Generate embedding for text using OpenAI-compatible API.
 * Works with OpenAI, Ollama (/api/embeddings), and any compat endpoint.
 *
 * Prefer generateEmbeddingWithFallback() for production use.
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const isOllama = config.providerId === 'ollama' || config.baseUrl.includes('11434');

  if (isOllama) {
    return generateOllamaEmbedding(text, config);
  }

  // OpenAI-compatible
  const url = `${config.baseUrl}/v1/embeddings`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      input: text.slice(0, 8000), // Truncate to safe token limit
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens: number };
  };

  return {
    embedding: new Float32Array(json.data[0].embedding),
    model: config.model,
    tokensUsed: json.usage?.total_tokens ?? 0,
  };
}

async function generateOllamaEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const url = `${config.baseUrl}/api/embeddings`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama embedding error ${res.status}`);
  }

  const json = await res.json() as { embedding: number[] };
  return {
    embedding: new Float32Array(json.embedding),
    model: config.model,
    tokensUsed: 0,
  };
}

// ─── sqlite-vec Integration ─────────────────────────────────────────────────────

/**
 * Load sqlite-vec extension into a better-sqlite3 database.
 * Must be called once before using vec0 tables.
 */
export function loadVecExtension(db: Database.Database): void {
  sqliteVec.load(db);
  logger.info('[Embeddings] sqlite-vec extension loaded');
}

/**
 * Initialize the message_embeddings virtual table.
 * Uses vec0 — Alex Garcia's vector search for SQLite.
 */
export function initEmbeddingTables(db: Database.Database, dimensions: number): void {
  // vec0 virtual table for message embeddings
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS message_embeddings USING vec0(
      message_id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    );
  `);

  // Track which messages have been embedded (for incremental backfill)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_status (
      message_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.info('[Embeddings] Tables initialized (dims=%d)', dimensions);
}

/**
 * Store an embedding for a message.
 */
export function storeEmbedding(
  db: Database.Database,
  messageId: string,
  embedding: Float32Array,
  model: string,
  dimensions: number,
): void {
  // Insert into vec0
  db.prepare(
    'INSERT OR REPLACE INTO message_embeddings (message_id, embedding) VALUES (?, ?)'
  ).run(messageId, Buffer.from(embedding.buffer));

  // Track status
  db.prepare(
    'INSERT OR REPLACE INTO embedding_status (message_id, model, dimensions) VALUES (?, ?, ?)'
  ).run(messageId, model, dimensions);
}

/**
 * Search for similar messages by vector similarity.
 * Returns top-K results ordered by distance (ascending = most similar).
 */
export function vectorSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number = 10,
  sessionId?: string,
): Array<{ messageId: string; distance: number; content: string; role: string; createdAt: string }> {
  // vec0 KNN search
  const vecResults = db.prepare(`
    SELECT message_id, distance
    FROM message_embeddings
    WHERE embedding MATCH ?
      AND k = ?
    ORDER BY distance
  `).all(Buffer.from(queryEmbedding.buffer), limit * 2) as Array<{ message_id: string; distance: number }>;

  if (vecResults.length === 0) return [];

  // Join with messages table for content
  const ids = vecResults.map(r => r.message_id);
  const placeholders = ids.map(() => '?').join(',');
  const distMap = new Map(vecResults.map(r => [r.message_id, r.distance]));

  let query = `SELECT id, content, role, session_id, created_at FROM messages WHERE id IN (${placeholders})`;
  const params: unknown[] = [...ids];

  if (sessionId) {
    query = `SELECT id, content, role, session_id, created_at FROM messages WHERE id IN (${placeholders}) AND session_id = ?`;
    params.push(sessionId);
  }

  const rows = db.prepare(query).all(...params) as Array<{
    id: string; content: string; role: string; session_id: string; created_at: string;
  }>;

  return rows
    .map(r => ({
      messageId: r.id,
      distance: distMap.get(r.id) ?? 999,
      content: r.content,
      role: r.role,
      createdAt: r.created_at,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// ─── Hybrid Search (FTS5 + Vector via RRF) ──────────────────────────────────────

/**
 * Hybrid search using Reciprocal Rank Fusion.
 * 1. FTS5 keyword search (top 50)
 * 2. Vector similarity search (top 50)
 * 3. Merge via RRF scoring
 */
export function hybridSearch(
  db: Database.Database,
  query: string,
  queryEmbedding: Float32Array,
  limit: number = 10,
  sessionId?: string,
): Array<{ messageId: string; score: number; content: string; role: string; createdAt: string }> {
  const K = 60; // RRF constant

  // FTS5 results
  let ftsQuery = `SELECT rowid, rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT 50`;
  const ftsRows = db.prepare(ftsQuery).all(query) as Array<{ rowid: number; rank: number }>;

  // Vector results
  const vecRows = db.prepare(`
    SELECT message_id, distance
    FROM message_embeddings
    WHERE embedding MATCH ?
      AND k = 50
    ORDER BY distance
  `).all(Buffer.from(queryEmbedding.buffer)) as Array<{ message_id: string; distance: number }>;

  // Map FTS rowid → message_id
  const ftsMessageIds = new Map<string, number>(); // messageId → fts rank position
  if (ftsRows.length > 0) {
    const rowids = ftsRows.map(r => r.rowid);
    const placeholders = rowids.map(() => '?').join(',');
    const idRows = db.prepare(
      `SELECT id, rowid FROM messages WHERE rowid IN (${placeholders})`
    ).all(...rowids) as Array<{ id: string; rowid: number }>;
    const rowidToId = new Map(idRows.map(r => [r.rowid, r.id]));
    ftsRows.forEach((r, i) => {
      const id = rowidToId.get(r.rowid);
      if (id) ftsMessageIds.set(id, i + 1);
    });
  }

  // Vec rank positions
  const vecRankMap = new Map<string, number>();
  vecRows.forEach((r, i) => vecRankMap.set(r.message_id, i + 1));

  // Collect all unique message IDs
  const allIds = new Set([...ftsMessageIds.keys(), ...vecRankMap.keys()]);

  // Compute RRF scores
  const scored: Array<{ messageId: string; score: number }> = [];
  for (const id of allIds) {
    const ftsRank = ftsMessageIds.get(id);
    const vecRank = vecRankMap.get(id);
    const ftsScore = ftsRank ? 1 / (K + ftsRank) : 0;
    const vecScore = vecRank ? 1 / (K + vecRank) : 0;
    scored.push({ messageId: id, score: ftsScore + vecScore });
  }

  scored.sort((a, b) => b.score - a.score);
  const topIds = scored.slice(0, limit);

  if (topIds.length === 0) return [];

  // Fetch message content
  const placeholders = topIds.map(() => '?').join(',');
  const scoreMap = new Map(topIds.map(r => [r.messageId, r.score]));

  let contentQuery = `SELECT id, content, role, session_id, created_at FROM messages WHERE id IN (${placeholders})`;
  const params: unknown[] = topIds.map(r => r.messageId);
  if (sessionId) {
    contentQuery += ' AND session_id = ?';
    params.push(sessionId);
  }

  const rows = db.prepare(contentQuery).all(...params) as Array<{
    id: string; content: string; role: string; session_id: string; created_at: string;
  }>;

  return rows
    .map(r => ({
      messageId: r.id,
      score: scoreMap.get(r.id) ?? 0,
      content: r.content,
      role: r.role,
      createdAt: r.created_at,
    }))
    .sort((a, b) => b.score - a.score);
}

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initEmbeddingTables, loadVecExtension, storeEmbedding, vectorSearch, getEmbeddingDimensions } from '../engine/embeddings.js';

describe('Embeddings — sqlite-vec', () => {
  let db: Database.Database;
  const DIMS = 4; // tiny dimensions for testing

  beforeEach(() => {
    db = new Database(':memory:');

    // Create messages table (needed for joins)
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Load sqlite-vec
    loadVecExtension(db);
    initEmbeddingTables(db, DIMS);
  });

  it('should load sqlite-vec extension', () => {
    const version = db.prepare("SELECT vec_version() as v").get() as { v: string };
    expect(version.v).toBeTruthy();
  });

  it('should create embedding tables', () => {
    // Check embedding_status table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_status'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe('embedding_status');
  });

  it('should store and retrieve embeddings', () => {
    // Insert a test message
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)")
      .run('msg1', 'sess1', 'user', 'Hello world test message');

    // Store embedding
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    storeEmbedding(db, 'msg1', embedding, 'test-model', DIMS);

    // Check status
    const status = db.prepare('SELECT * FROM embedding_status WHERE message_id = ?').get('msg1') as any;
    expect(status.model).toBe('test-model');
    expect(status.dimensions).toBe(DIMS);
  });

  it('should perform vector search', () => {
    // Insert messages + embeddings
    for (let i = 0; i < 5; i++) {
      const id = `msg${i}`;
      db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)")
        .run(id, 'sess1', 'user', `Message number ${i}`);

      // Embeddings with varying similarity to query
      const emb = new Float32Array([i * 0.1, i * 0.2, i * 0.3, i * 0.4]);
      storeEmbedding(db, id, emb, 'test', DIMS);
    }

    // Search with a query embedding close to msg4
    const query = new Float32Array([0.4, 0.8, 1.2, 1.6]);
    const results = vectorSearch(db, query, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should filter vector search by session', () => {
    // Two sessions
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)")
      .run('a1', 'sess-a', 'user', 'Session A message');
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)")
      .run('b1', 'sess-b', 'user', 'Session B message');

    storeEmbedding(db, 'a1', new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test', DIMS);
    storeEmbedding(db, 'b1', new Float32Array([0.5, 0.6, 0.7, 0.8]), 'test', DIMS);

    const results = vectorSearch(db, new Float32Array([0.1, 0.2, 0.3, 0.4]), 10, 'sess-a');
    // Should only return sess-a messages
    for (const r of results) {
      expect(r.messageId).toBe('a1');
    }
  });
});

describe('Embeddings — getEmbeddingDimensions', () => {
  it('should return known dimensions', () => {
    expect(getEmbeddingDimensions('text-embedding-3-small')).toBe(1536);
    expect(getEmbeddingDimensions('nomic-embed-text')).toBe(768);
    expect(getEmbeddingDimensions('all-minilm')).toBe(384);
  });

  it('should default to 1536 for unknown models', () => {
    expect(getEmbeddingDimensions('totally-unknown')).toBe(1536);
  });
});

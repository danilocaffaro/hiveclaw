import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

/**
 * Sprint H — Message-level CRUD operations.
 * F16: Edit message (15-minute window)
 * F17: Delete message
 * F18: Pin/unpin message
 */
export function registerMessageRoutes(app: FastifyInstance, db: Database) {
  // F16 — Edit message (only within 15 minutes of creation, user messages only)
  app.patch<{
    Params: { id: string };
    Body: { content: string };
  }>('/messages/:id', async (req, reply) => {
    const { id } = req.params;
    const { content } = req.body ?? {};

    if (!content || typeof content !== 'string') {
      return reply.status(400).send({ error: 'content required' });
    }

    const msg = db.prepare('SELECT id, role, created_at, session_id FROM messages WHERE id = ?').get(id) as {
      id: string; role: string; created_at: string; session_id: string;
    } | undefined;

    if (!msg) return reply.status(404).send({ error: 'Message not found' });
    if (msg.role !== 'user') return reply.status(403).send({ error: 'Can only edit your own messages' });

    // 15-minute edit window
    const createdAt = new Date(msg.created_at).getTime();
    const now = Date.now();
    if (now - createdAt > 15 * 60 * 1000) {
      return reply.status(403).send({ error: 'Edit window expired (15 minutes)' });
    }

    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);

    // Rebuild FTS
    try {
      db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`);
    } catch { /* FTS rebuild optional */ }

    return reply.send({ data: { id, content, edited: true } });
  });

  // F17 — Delete message
  app.delete<{
    Params: { id: string };
    Querystring: { mode?: 'soft' | 'hard' };
  }>('/messages/:id', async (req, reply) => {
    const { id } = req.params;
    const mode = req.query.mode ?? 'soft';

    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(id) as {
      id: string; session_id: string;
    } | undefined;

    if (!msg) return reply.status(404).send({ error: 'Message not found' });

    if (mode === 'hard') {
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    } else {
      // Soft delete: replace content
      db.prepare("UPDATE messages SET content = '[Message deleted]' WHERE id = ?").run(id);
    }

    // Rebuild FTS
    try {
      db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`);
    } catch { /* FTS rebuild optional */ }

    return reply.send({ data: { id, deleted: true, mode } });
  });

  // F18 — Pin/unpin message
  // Uses a simple `pinned_messages` table (session-level pins)
  app.post<{
    Params: { id: string };
  }>('/messages/:id/pin', async (req, reply) => {
    const { id } = req.params;

    // Ensure pinned_messages table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(id) as {
      id: string; session_id: string;
    } | undefined;

    if (!msg) return reply.status(404).send({ error: 'Message not found' });

    // Toggle pin
    const existing = db.prepare('SELECT message_id FROM pinned_messages WHERE message_id = ?').get(id);
    if (existing) {
      db.prepare('DELETE FROM pinned_messages WHERE message_id = ?').run(id);
      return reply.send({ data: { id, pinned: false } });
    } else {
      db.prepare('INSERT INTO pinned_messages (message_id, session_id) VALUES (?, ?)').run(id, msg.session_id);
      return reply.send({ data: { id, pinned: true } });
    }
  });

  // F19 — Star/bookmark message (cross-session saved messages)
  app.post<{ Params: { id: string } }>('/messages/:id/star', async (req, reply) => {
    const { id } = req.params;

    db.exec(`
      CREATE TABLE IF NOT EXISTS starred_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(id) as {
      id: string; session_id: string;
    } | undefined;
    if (!msg) return reply.status(404).send({ error: 'Message not found' });

    const existing = db.prepare('SELECT message_id FROM starred_messages WHERE message_id = ?').get(id);
    if (existing) {
      db.prepare('DELETE FROM starred_messages WHERE message_id = ?').run(id);
      return reply.send({ data: { id, starred: false } });
    } else {
      db.prepare('INSERT INTO starred_messages (message_id, session_id) VALUES (?, ?)').run(id, msg.session_id);
      return reply.send({ data: { id, starred: true } });
    }
  });

  // GET /starred — list all starred messages (Saved Messages view)
  app.get('/starred', async (_req, reply) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS starred_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    const rows = db.prepare(`
      SELECT m.id, m.session_id, m.role, m.content, m.created_at,
             m.agent_name, m.agent_emoji, s.title as session_title,
             sm.starred_at
      FROM starred_messages sm
      JOIN messages m ON m.id = sm.message_id
      LEFT JOIN sessions s ON s.id = m.session_id
      ORDER BY sm.starred_at DESC
      LIMIT 200
    `).all();

    return reply.send({ data: rows });
  });

  // Get pinned messages for a session
  app.get<{
    Params: { sessionId: string };
  }>('/sessions/:sessionId/pins', async (req, reply) => {
    const { sessionId } = req.params;

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    const pins = db.prepare(`
      SELECT m.id, m.role, m.content, m.created_at, m.agent_name, m.agent_emoji,
             p.pinned_at
      FROM pinned_messages p
      JOIN messages m ON m.id = p.message_id
      WHERE p.session_id = ?
      ORDER BY p.pinned_at DESC
    `).all(sessionId);

    return reply.send({ data: pins });
  });

  // ── K-1: Reactions ──────────────────────────────────────────────────────────

  // POST /messages/:id/reactions — toggle a reaction emoji
  app.post<{
    Params: { id: string };
    Body: { emoji: string; user_id?: string };
  }>('/messages/:id/reactions', async (req, reply) => {
    const { id } = req.params;
    const { emoji, user_id } = req.body ?? {};

    if (!emoji || typeof emoji !== 'string') {
      return reply.status(400).send({ error: 'emoji required' });
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        UNIQUE(message_id, emoji, user_id)
      )
    `);

    const msg = db.prepare('SELECT id FROM messages WHERE id = ?').get(id) as { id: string } | undefined;
    if (!msg) return reply.status(404).send({ error: 'Message not found' });

    const uid = user_id ?? 'user';
    const existing = db.prepare(
      'SELECT id FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?'
    ).get(id, emoji, uid) as { id: number } | undefined;

    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
      const remaining = db.prepare(
        'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
      ).all(id);
      return reply.send({ data: { message_id: id, action: 'removed', emoji, reactions: remaining } });
    } else {
      db.prepare(
        'INSERT INTO message_reactions (message_id, emoji, user_id) VALUES (?, ?, ?)'
      ).run(id, emoji, uid);
      const all = db.prepare(
        'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
      ).all(id);
      return reply.send({ data: { message_id: id, action: 'added', emoji, reactions: all } });
    }
  });

  // GET /messages/:id/reactions — list reactions for a message
  app.get<{ Params: { id: string } }>('/messages/:id/reactions', async (req, reply) => {
    const { id } = req.params;

    db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        UNIQUE(message_id, emoji, user_id)
      )
    `);

    const reactions = db.prepare(
      'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
    ).all(id);

    return reply.send({ data: reactions });
  });
}

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

/**
 * F11 — Full-text search across messages.
 * Uses the existing FTS5 index (messages_fts) for fast text search.
 */
export function registerSearchRoutes(app: FastifyInstance, db: Database) {
  app.get<{
    Querystring: {
      q: string;
      session_id?: string;
      limit?: string;
    };
  }>('/search/messages', async (req, reply) => {
    const { q, session_id, limit: limitStr } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'Query must be at least 2 characters' },
      });
    }

    const limit = Math.min(parseInt(limitStr ?? '20', 10) || 20, 100);

    try {
      // FTS5 search with snippet extraction
      // Escape special FTS5 characters to prevent syntax errors
      const safeQuery = q.trim().replace(/['"*()]/g, '');

      let sql: string;
      const params: (string | number)[] = [];

      if (session_id) {
        sql = `
          SELECT m.id, m.session_id, m.role, m.content, m.created_at,
                 m.agent_name, m.agent_emoji, m.sender_type,
                 snippet(messages_fts, 0, '<mark>', '</mark>', '...', 40) as snippet
          FROM messages_fts
          JOIN messages m ON messages_fts.rowid = m.rowid
          WHERE messages_fts MATCH ?
            AND m.session_id = ?
          ORDER BY rank
          LIMIT ?
        `;
        params.push(safeQuery, session_id, limit);
      } else {
        sql = `
          SELECT m.id, m.session_id, m.role, m.content, m.created_at,
                 m.agent_name, m.agent_emoji, m.sender_type,
                 snippet(messages_fts, 0, '<mark>', '</mark>', '...', 40) as snippet
          FROM messages_fts
          JOIN messages m ON messages_fts.rowid = m.rowid
          WHERE messages_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `;
        params.push(safeQuery, limit);
      }

      const results = db.prepare(sql).all(...params) as Array<{
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
        agent_name: string | null;
        agent_emoji: string | null;
        sender_type: string | null;
        snippet: string;
      }>;

      return reply.send({
        data: results.map((r) => ({
          id: r.id,
          sessionId: r.session_id,
          role: r.role,
          content: r.content,
          createdAt: r.created_at,
          agentName: r.agent_name,
          agentEmoji: r.agent_emoji,
          senderType: r.sender_type,
          snippet: r.snippet,
        })),
        total: results.length,
        query: q.trim(),
      });
    } catch (err) {
      // FTS5 query syntax errors should not crash the server
      const msg = (err as Error).message;
      if (msg.includes('fts5: syntax error') || msg.includes('no such table')) {
        return reply.send({ data: [], total: 0, query: q.trim(), note: 'FTS not available' });
      }
      throw err;
    }
  });
}

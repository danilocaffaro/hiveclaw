import { getDb } from './schema.js';
import { randomBytes } from 'crypto';

// ─── B054: Shared Links Repository ───────────────────────────────────────────

export interface SharedLink {
  id: string;
  token: string;
  agent_id: string;
  title: string;
  welcome_message: string;
  enabled: number;
  max_messages: number;
  expires_at: string | null;
  created_at: string;
}

function uuid(): string {
  return crypto.randomUUID?.() ?? randomBytes(16).toString('hex');
}

function shortToken(): string {
  return randomBytes(6).toString('base64url'); // 8 chars, URL-safe
}

export class SharedLinkRepository {
  private db = getDb();

  create(agentId: string, title?: string, welcomeMessage?: string, maxMessages?: number, expiresAt?: string): SharedLink {
    const id = uuid();
    const token = shortToken();
    this.db.prepare(`
      INSERT INTO shared_links (id, token, agent_id, title, welcome_message, max_messages, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, token, agentId, title ?? '', welcomeMessage ?? '', maxMessages ?? 100, expiresAt ?? null);
    return this.db.prepare('SELECT * FROM shared_links WHERE id = ?').get(id) as SharedLink; // safe: just inserted
  }

  findByToken(token: string): SharedLink | undefined {
    const link = this.db.prepare('SELECT * FROM shared_links WHERE token = ? AND enabled = 1').get(token) as SharedLink | undefined;
    if (link?.expires_at && new Date(link.expires_at) < new Date()) return undefined;
    return link;
  }

  findById(id: string): SharedLink | undefined {
    return this.db.prepare('SELECT * FROM shared_links WHERE id = ?').get(id) as SharedLink | undefined;
  }

  list(): SharedLink[] {
    return this.db.prepare('SELECT * FROM shared_links ORDER BY created_at DESC').all() as SharedLink[];
  }

  listByAgent(agentId: string): SharedLink[] {
    return this.db.prepare('SELECT * FROM shared_links WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as SharedLink[];
  }

  disable(id: string): void {
    this.db.prepare('UPDATE shared_links SET enabled = 0 WHERE id = ?').run(id);
  }

  enable(id: string): void {
    this.db.prepare('UPDATE shared_links SET enabled = 1 WHERE id = ?').run(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM shared_links WHERE id = ?').run(id);
  }
}

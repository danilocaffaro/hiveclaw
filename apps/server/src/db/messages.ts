import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type SenderType = 'human' | 'agent' | 'external_agent';

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  agent_id: string;
  sender_type: SenderType;
  content: string; // JSON stringified array of content blocks
  tokens_input: number;
  tokens_output: number;
  cost: number;
  created_at: string;
}

export class MessageRepository {
  constructor(private db: Database.Database) {}

  insert(msg: {
    session_id: string;
    role: string;
    agent_id?: string;
    sender_type?: SenderType;
    content: string;
  }): MessageRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, agent_id, sender_type, content) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, msg.session_id, msg.role, msg.agent_id ?? '', msg.sender_type ?? 'human', msg.content);
    return this.getById(id)!;
  }

  getById(id: string): MessageRow | undefined {
    return this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as
      | MessageRow
      | undefined;
  }

  getBySession(sessionId: string, limit = 100, offset = 0): MessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?`
      )
      .all(sessionId, limit, offset) as MessageRow[];
  }

  getLastBySession(sessionId: string): MessageRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId) as MessageRow | undefined;
  }
}

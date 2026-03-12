import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  avatarUrl: string | null;
  apiKey: string | null;
  createdAt: string;
  lastLogin: string | null;
}

interface RawRow {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  avatar_url: string | null;
  api_key: string | null;
  created_at: string;
  last_login: string | null;
}

function toUser(row: RawRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as User['role'],
    avatarUrl: row.avatar_url,
    apiKey: row.api_key,
    createdAt: row.created_at,
    lastLogin: row.last_login,
  };
}

export class UserRepository {
  constructor(private db: Database.Database) {}

  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as RawRow[];
    return rows.map(toUser);
  }

  /** Get the first owner user without scanning full table (PERF-01) */
  getOwner(): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1").get() as RawRow | undefined;
    return row ? toUser(row) : undefined;
  }

  getById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawRow | undefined;
    return row ? toUser(row) : undefined;
  }

  getByEmail(email: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as RawRow | undefined;
    return row ? toUser(row) : undefined;
  }

  getByApiKey(key: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE api_key = ?')
      .get(key) as RawRow | undefined;
    return row ? toUser(row) : undefined;
  }

  create(data: Partial<User> & { name: string }): User {
    const id = data.id ?? randomUUID();
    const role = data.role ?? 'member';
    const apiKey = `sc_${randomUUID().replace(/-/g, '')}`;

    this.db
      .prepare(
        `INSERT INTO users (id, email, name, role, avatar_url, api_key, created_at, last_login)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      )
      .run(id, data.email ?? null, data.name, role, data.avatarUrl ?? null, apiKey, null);

    const created = this.getById(id);
    if (!created) throw new Error(`User '${id}' not found after insert`);
    return created;
  }

  update(id: string, patch: Partial<User>): User {
    const user = this.getById(id);
    if (!user) throw new Error(`User '${id}' not found`);

    const fields: string[] = [];
    const values: (string | null)[] = [];

    if (patch.email !== undefined) { fields.push('email = ?'); values.push(patch.email); }
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.role !== undefined) { fields.push('role = ?'); values.push(patch.role); }
    if (patch.avatarUrl !== undefined) { fields.push('avatar_url = ?'); values.push(patch.avatarUrl); }
    if (patch.lastLogin !== undefined) { fields.push('last_login = ?'); values.push(patch.lastLogin); }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = this.getById(id);
    if (!updated) throw new Error(`User '${id}' not found after update`);
    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  generateApiKey(userId: string): string {
    const user = this.getById(userId);
    if (!user) throw new Error(`User '${userId}' not found`);

    const newKey = `sc_${randomUUID().replace(/-/g, '')}`;
    this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newKey, userId);
    return newKey;
  }

  seedOwner(): void {
    const count = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
    ).cnt;
    if (count > 0) return;

    this.create({
      id: 'owner',
      name: 'Admin',
      email: null,
      role: 'owner',
    });
  }
}

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CredentialStatus = 'active' | 'invalid' | 'leaked' | 'expired' | 'unknown';

export interface Credential {
  id: string;
  key: string;           // e.g. "GEMINI_API_KEY"
  provider: string;      // e.g. "google", "openai", "anthropic"
  value: string;         // plaintext for now — encryption in Phase 2
  status: CredentialStatus;
  lastChecked: string | null;
  lastSuccess: string | null;
  checkEndpoint: string | null;
  usedBy: string[];      // agent IDs
  createdAt: string;
  updatedAt: string;
}

export interface CredentialCreateInput {
  key: string;
  provider: string;
  value: string;
  status?: CredentialStatus;
  checkEndpoint?: string;
  usedBy?: string[];
}

export interface CredentialUpdateInput {
  key?: string;
  provider?: string;
  value?: string;
  status?: CredentialStatus;
  checkEndpoint?: string;
  usedBy?: string[];
}

// ─── Row type (raw SQLite) ────────────────────────────────────────────────────

interface CredentialRow {
  id: string;
  key: string;
  provider: string;
  value: string;
  status: string;
  last_checked: string | null;
  last_success: string | null;
  check_endpoint: string | null;
  used_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class CredentialStoreRepository {
  constructor(private db: Database.Database) {}

  getAll(): Credential[] {
    const rows = this.db
      .prepare('SELECT * FROM credentials ORDER BY created_at DESC')
      .all() as CredentialRow[];
    return rows.map(this.toCredential);
  }

  getById(id: string): Credential | null {
    const row = this.db
      .prepare('SELECT * FROM credentials WHERE id = ?')
      .get(id) as CredentialRow | undefined;
    return row ? this.toCredential(row) : null;
  }

  getByKey(key: string): Credential | null {
    const row = this.db
      .prepare('SELECT * FROM credentials WHERE key = ?')
      .get(key) as CredentialRow | undefined;
    return row ? this.toCredential(row) : null;
  }

  create(input: CredentialCreateInput): Credential {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO credentials (id, key, provider, value, status, check_endpoint, used_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.key,
        input.provider,
        input.value,
        input.status ?? 'unknown',
        input.checkEndpoint ?? null,
        JSON.stringify(input.usedBy ?? []),
        now,
        now,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: CredentialUpdateInput): Credential | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: (string | null)[] = [];

    if (patch.key !== undefined) { fields.push('key = ?'); values.push(patch.key); }
    if (patch.provider !== undefined) { fields.push('provider = ?'); values.push(patch.provider); }
    if (patch.value !== undefined) { fields.push('value = ?'); values.push(patch.value); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.checkEndpoint !== undefined) { fields.push('check_endpoint = ?'); values.push(patch.checkEndpoint); }
    if (patch.usedBy !== undefined) { fields.push('used_by = ?'); values.push(JSON.stringify(patch.usedBy)); }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db
      .prepare(`UPDATE credentials SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM credentials WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  updateStatus(
    id: string,
    status: CredentialStatus,
    lastChecked?: string,
    lastSuccess?: string,
  ): Credential | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE credentials
        SET status = ?, last_checked = ?, last_success = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        status,
        lastChecked ?? now,
        lastSuccess ?? (status === 'active' ? now : existing.lastSuccess),
        now,
        id,
      );
    return this.getById(id)!;
  }

  private toCredential(row: CredentialRow): Credential {
    return {
      id: row.id,
      key: row.key,
      provider: row.provider,
      value: row.value,
      status: row.status as CredentialStatus,
      lastChecked: row.last_checked,
      lastSuccess: row.last_success,
      checkEndpoint: row.check_endpoint,
      usedBy: JSON.parse(row.used_by || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

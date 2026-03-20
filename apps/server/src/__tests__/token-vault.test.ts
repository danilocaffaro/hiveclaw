import { describe, it, expect } from 'vitest';
import { verifyPublicUrl } from '../engine/token-vault.js';

// ── Layer 3: verifyPublicUrl tests ─────────────────────────────────────────

describe('verifyPublicUrl', () => {
  it('should return ok=true for a valid public URL', async () => {
    const result = await verifyPublicUrl('https://api.github.com');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('should return ok=false for a 404 URL', async () => {
    const result = await verifyPublicUrl(
      'https://api.github.com/gists/0000000000000000000000000000000000000000',
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('should return ok=false for an unreachable host', async () => {
    const result = await verifyPublicUrl('http://192.0.2.1:1/nonexistent');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.reason).toContain('error');
  });

  it('should handle GitHub gist API 404 correctly', async () => {
    const result = await verifyPublicUrl(
      'https://api.github.com/gists/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(result.ok).toBe(false);
  });
});

// ── Layer 1: Token Vault CRUD (DB-level) ────────────────────────────────────

describe('Token Vault CRUD (via DB)', () => {
  // These tests use in-memory SQLite to validate schema + queries
  let db: ReturnType<typeof import('better-sqlite3')>;

  beforeAll(async () => {
    const Database = (await import('better-sqlite3')).default;
    db = new Database(':memory:');
    // Minimal schema for credential_vault
    db.exec(`
      CREATE TABLE credential_vault (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        service TEXT DEFAULT '',
        account TEXT DEFAULT '',
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        salt TEXT NOT NULL,
        scopes TEXT DEFAULT '',
        owner_agent_id TEXT DEFAULT NULL,
        expires_at TEXT,
        one_time INTEGER DEFAULT 0,
        used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_cred_vault_svc_acct
        ON credential_vault(service, account) WHERE account != '';
    `);
  });

  afterAll(() => {
    db?.close();
  });

  it('should insert a token entry', () => {
    const stmt = db.prepare(
      `INSERT INTO credential_vault (id, label, service, account, encrypted_value, iv, salt, scopes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run('test-1', 'GitHub Test', 'github', 'testuser', 'enc-val', 'iv-val', 'salt-val', 'gist,repo');

    const row = db
      .prepare(`SELECT * FROM credential_vault WHERE id = ?`)
      .get('test-1') as Record<string, unknown>;
    expect(row['service']).toBe('github');
    expect(row['account']).toBe('testuser');
    expect(row['scopes']).toBe('gist,repo');
  });

  it('should enforce unique service+account', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO credential_vault (id, label, service, account, encrypted_value, iv, salt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('test-2', 'Duplicate', 'github', 'testuser', 'enc2', 'iv2', 'salt2');
    }).toThrow();
  });

  it('should find by service+account', () => {
    const row = db
      .prepare(`SELECT id, account FROM credential_vault WHERE service = ? AND account = ?`)
      .get('github', 'testuser') as Record<string, unknown>;
    expect(row['id']).toBe('test-1');
    expect(row['account']).toBe('testuser');
  });

  it('should delete by id', () => {
    db.prepare(`DELETE FROM credential_vault WHERE id = ?`).run('test-1');
    const row = db
      .prepare(`SELECT * FROM credential_vault WHERE id = ?`)
      .get('test-1');
    expect(row).toBeUndefined();
  });

  it('should list only entries with non-empty account', () => {
    db.prepare(
      `INSERT INTO credential_vault (id, label, service, account, encrypted_value, iv, salt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('tv-1', 'GitHub', 'github', 'myacct', 'e', 'i', 's');
    db.prepare(
      `INSERT INTO credential_vault (id, label, service, account, encrypted_value, iv, salt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('legacy-1', 'OldCred', '', '', 'e', 'i', 's');

    const rows = db
      .prepare(`SELECT id FROM credential_vault WHERE service != '' AND account != ''`)
      .all() as Array<{ id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('tv-1');
  });
});

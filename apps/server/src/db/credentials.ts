import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../engine/credential-manager.js';
import type { CredentialRequest, VaultEntry } from '../engine/credential-manager.js';

// Re-export types for consumers
export type { CredentialRequest, VaultEntry };

// ─── Row types (raw SQLite rows) ──────────────────────────────────────────────
interface VaultRow {
  id: string;
  label: string;
  service: string;
  encrypted_value: string;
  iv: string;
  salt: string;
  expires_at: string | null;
  one_time: number;
  used: number;
  created_at: string;
  updated_at: string;
}

interface RequestRow {
  id: string;
  session_id: string;
  agent_id: string | null;
  label: string;
  service: string;
  reason: string;
  status: string;
  credential_id: string | null;
  one_time: number;
  save_to_vault: number;
  created_at: string;
  expires_at: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────
function rowToVaultEntry(row: VaultRow): VaultEntry {
  return {
    id: row.id,
    label: row.label,
    service: row.service,
    oneTime: row.one_time === 1,
    used: row.used === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
  };
}

function rowToRequest(row: RequestRow): CredentialRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id ?? null,
    label: row.label,
    service: row.service,
    reason: row.reason,
    status: row.status as CredentialRequest['status'],
    credentialId: row.credential_id ?? null,
    oneTime: row.one_time === 1,
    saveToVault: row.save_to_vault === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────
export class CredentialRepository {
  constructor(private db: Database.Database) {}

  // ── Vault operations ────────────────────────────────────────────────────────

  listVault(): VaultEntry[] {
    const rows = this.db
      .prepare(`SELECT id, label, service, expires_at, one_time, used, created_at, updated_at
                FROM credential_vault ORDER BY created_at DESC`)
      .all() as Array<VaultRow>;
    return rows.map(r => rowToVaultEntry({ ...r, encrypted_value: '', iv: '', salt: '' }));
  }

  getVaultEntry(id: string): VaultEntry | undefined {
    const row = this.db
      .prepare(`SELECT id, label, service, expires_at, one_time, used, created_at, updated_at
                FROM credential_vault WHERE id = ?`)
      .get(id) as VaultRow | undefined;
    if (!row) return undefined;
    return rowToVaultEntry({ ...row, encrypted_value: '', iv: '', salt: '' });
  }

  storeCredential(data: {
    label: string;
    service?: string;
    value: string;
    passphrase: string;
    oneTime?: boolean;
    expiresAt?: string;
  }): VaultEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const { encrypted, iv, salt } = encrypt(data.value, data.passphrase);

    this.db
      .prepare(
        `INSERT INTO credential_vault
           (id, label, service, encrypted_value, iv, salt, expires_at, one_time, used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        data.label,
        data.service ?? '',
        encrypted,
        iv,
        salt,
        data.expiresAt ?? null,
        data.oneTime !== false ? 1 : 0,
        now,
        now,
      );

    return this.getVaultEntry(id)!;
  }

  retrieveCredential(id: string, passphrase: string): string | null {
    // SEC-03: Use transaction to prevent TOCTOU race on one-time credentials
    const tx = this.db.transaction((credId: string, pp: string) => {
      const row = this.db
        .prepare(`SELECT * FROM credential_vault WHERE id = ?`)
        .get(credId) as VaultRow | undefined;

      if (!row) return null;

      // Expired check
      if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

      // One-time already used
      if (row.one_time === 1 && row.used === 1) return null;

      try {
        const plaintext = decrypt(row.encrypted_value, row.iv, row.salt, pp);

        // Mark as used if one-time (atomic with the read)
        if (row.one_time === 1) {
          this.db
            .prepare(`UPDATE credential_vault SET used = 1, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), credId);
        }

        return plaintext;
      } catch {
        return null; // wrong passphrase or corrupted data
      }
    });

    return tx(id, passphrase);
  }

  deleteVaultEntry(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM credential_vault WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  // ── Request operations ──────────────────────────────────────────────────────

  createRequest(data: {
    sessionId: string;
    agentId?: string;
    label: string;
    service?: string;
    reason?: string;
    oneTime?: boolean;
  }): CredentialRequest {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO credential_requests
           (id, session_id, agent_id, label, service, reason, status, one_time, save_to_vault, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
      )
      .run(
        id,
        data.sessionId,
        data.agentId ?? null,
        data.label,
        data.service ?? '',
        data.reason ?? '',
        data.oneTime !== false ? 1 : 0,
        now,
      );

    return this.getRequest(id)!;
  }

  getRequest(id: string): CredentialRequest | undefined {
    const row = this.db
      .prepare(`SELECT * FROM credential_requests WHERE id = ?`)
      .get(id) as RequestRow | undefined;
    if (!row) return undefined;
    return rowToRequest(row);
  }

  listRequests(filters?: { sessionId?: string; status?: string }): CredentialRequest[] {
    let query = `SELECT * FROM credential_requests WHERE 1=1`;
    const params: unknown[] = [];

    if (filters?.sessionId) {
      query += ` AND session_id = ?`;
      params.push(filters.sessionId);
    }
    if (filters?.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    query += ` ORDER BY created_at DESC`;
    const rows = this.db.prepare(query).all(...params) as RequestRow[];
    return rows.map(rowToRequest);
  }

  fulfillRequest(
    requestId: string,
    data: {
      value: string;
      passphrase: string;
      saveToVault: boolean;
    },
  ): CredentialRequest {
    const req = this.getRequest(requestId);
    if (!req) throw new Error(`Request not found: ${requestId}`);
    if (req.status !== 'pending') throw new Error(`Request is not pending: ${req.status}`);

    let credentialId: string | null = null;

    if (data.saveToVault) {
      // Store in vault (encrypted)
      const entry = this.storeCredential({
        label: req.label,
        service: req.service,
        value: data.value,
        passphrase: data.passphrase,
        oneTime: req.oneTime,
      });
      credentialId = entry.id;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE credential_requests
         SET status = 'provided', credential_id = ?, save_to_vault = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(credentialId, data.saveToVault ? 1 : 0, now, requestId);

    // Store the plaintext temporarily in a transient vault entry (one-time, no-save case)
    // so the agent can retrieve it exactly once via vault/:id/retrieve
    if (!data.saveToVault) {
      const entry = this.storeCredential({
        label: req.label,
        service: req.service,
        value: data.value,
        passphrase: data.passphrase,
        oneTime: true,
      });
      credentialId = entry.id;
      this.db
        .prepare(`UPDATE credential_requests SET credential_id = ? WHERE id = ?`)
        .run(credentialId, requestId);
    }

    return this.getRequest(requestId)!;
  }

  cancelRequest(id: string): CredentialRequest {
    const req = this.getRequest(id);
    if (!req) throw new Error(`Request not found: ${id}`);

    this.db
      .prepare(`UPDATE credential_requests SET status = 'cancelled' WHERE id = ?`)
      .run(id);

    return this.getRequest(id)!;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  cleanExpired(): number {
    const now = new Date().toISOString();

    // Mark expired requests
    const r1 = this.db
      .prepare(
        `UPDATE credential_requests SET status = 'expired'
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`,
      )
      .run(now);

    // Delete expired vault entries
    const r2 = this.db
      .prepare(`DELETE FROM credential_vault WHERE expires_at IS NOT NULL AND expires_at < ?`)
      .run(now);

    return (r1.changes ?? 0) + (r2.changes ?? 0);
  }
}

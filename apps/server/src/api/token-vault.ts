/**
 * Token Vault API — Layer 1
 * CRUD for named tokens in credential_vault with service+account indexing.
 *
 * Routes:
 *   GET    /api/token-vault          — list all (token masked)
 *   POST   /api/token-vault          — store a token
 *   DELETE /api/token-vault/:id      — remove a token
 *   GET    /api/token-vault/find     — find token by service+account (returns plaintext)
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { encrypt, decrypt } from '../engine/credential-manager.js';
import { randomUUID } from 'crypto';

export function registerTokenVaultRoutes(app: FastifyInstance, db: Database.Database) {
  const passphrase =
    process.env['HIVECLAW_VAULT_KEY'] ??
    process.env['SUPERCLAW_VAULT_KEY'] ??
    'default-hiveclaw-key';

  // GET /api/token-vault — list all tokens (masked)
  app.get('/token-vault', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, label, service, account, scopes, owner_agent_id, one_time, used, created_at
         FROM credential_vault
         WHERE service != '' AND account != ''
         ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return reply.send({
      data: rows.map(r => ({
        id: r['id'],
        label: r['label'],
        service: r['service'],
        account: r['account'],
        scopes: r['scopes'] ?? '',
        ownerAgentId: r['owner_agent_id'] ?? null,
        tokenPreview: `****${String(r['id']).slice(-4)}`,
        oneTime: r['one_time'] === 1,
        used: r['used'] === 1,
        createdAt: r['created_at'],
      })),
    });
  });

  // POST /api/token-vault — store a token
  app.post<{
    Body: {
      service: string;
      account: string;
      token: string;
      label?: string;
      scopes?: string;
      ownerAgentId?: string;
    };
  }>('/token-vault', async (req, reply) => {
    const { service, account, token, label, scopes, ownerAgentId } = req.body ?? {};

    if (!service?.trim() || !account?.trim() || !token?.trim()) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'service, account, and token are required' },
      });
    }

    const { encrypted, iv, salt } = encrypt(token, passphrase);
    const id = randomUUID();
    const now = new Date().toISOString();
    const labelValue = label ?? `${service}/${account}`;

    try {
      // Upsert: delete existing entry for this service+account, then insert fresh
      const upsert = db.transaction(() => {
        db.prepare(
          `DELETE FROM credential_vault WHERE service = ? AND account = ?`,
        ).run(service, account);
        db.prepare(
          `INSERT INTO credential_vault
             (id, label, service, account, encrypted_value, iv, salt, scopes, owner_agent_id, one_time, used, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        ).run(id, labelValue, service, account, encrypted, iv, salt, scopes ?? '', ownerAgentId ?? null, now, now);
      });
      upsert();

      return reply.status(201).send({ data: { id, service, account, label: labelValue } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // DELETE /api/token-vault/:id — remove a token
  app.delete<{ Params: { id: string } }>('/token-vault/:id', async (req, reply) => {
    const { id } = req.params;
    const result = db
      .prepare(`DELETE FROM credential_vault WHERE id = ? AND account != ''`)
      .run(id);

    if (result.changes === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }
    return reply.send({ data: { deleted: true, id } });
  });

  // GET /api/token-vault/find?service=github&account=danilocaffaro
  app.get<{ Querystring: { service: string; account: string } }>(
    '/token-vault/find',
    async (req, reply) => {
      const { service, account } = req.query;

      if (!service?.trim() || !account?.trim()) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'service and account query params are required' },
        });
      }

      const row = db
        .prepare(
          `SELECT id, label, service, account, encrypted_value, iv, salt, scopes
           FROM credential_vault
           WHERE service = ? AND account = ? AND used = 0
           LIMIT 1`,
        )
        .get(service, account) as Record<string, string> | undefined;

      if (!row) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `No token found for ${service}/${account}` },
        });
      }

      try {
        const token = decrypt(row['encrypted_value'], row['iv'], row['salt'], passphrase);
        return reply.send({
          data: {
            id: row['id'],
            service: row['service'],
            account: row['account'],
            scopes: row['scopes'] ?? '',
            token,
          },
        });
      } catch {
        return reply.status(500).send({
          error: { code: 'DECRYPT_ERROR', message: 'Failed to decrypt token' },
        });
      }
    },
  );
}

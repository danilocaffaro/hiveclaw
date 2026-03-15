import type { FastifyInstance } from 'fastify';
import type { CredentialRepository } from '../db/credentials.js';

export function registerCredentialRoutes(
  app: FastifyInstance,
  credentials: CredentialRepository,
) {
  // ── Agent-facing ────────────────────────────────────────────────────────────

  // POST /credentials/request — agent creates a credential request
  app.post<{
    Body: {
      sessionId: string;
      agentId?: string;
      label: string;
      service?: string;
      reason?: string;
      oneTime?: boolean;
    };
  }>('/credentials/request', async (req, reply) => {
    const { sessionId, agentId, label, service, reason, oneTime } = req.body;
    if (!sessionId?.trim()) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'sessionId is required' } });
    }
    if (!label?.trim()) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'label is required' } });
    }

    try {
      const creq = credentials.createRequest({
        sessionId,
        agentId,
        label,
        service,
        reason,
        oneTime,
      });
      return reply.status(201).send({ data: { requestId: creq.id, status: 'pending' } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // ── User-facing ─────────────────────────────────────────────────────────────

  // POST /credentials/provide — user fulfills a pending request
  app.post<{
    Body: {
      requestId: string;
      value: string;
      passphrase?: string;
      saveToVault?: boolean;
    };
  }>('/credentials/provide', async (req, reply) => {
    const { requestId, value, passphrase, saveToVault } = req.body;
    if (!requestId?.trim()) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'requestId is required' } });
    }
    if (!value) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'value is required' } });
    }

    try {
      const fulfilled = credentials.fulfillRequest(requestId, {
        value,
        passphrase: passphrase || process.env.HIVECLAW_VAULT_KEY || process.env.SUPERCLAW_VAULT_KEY || 'default-hiveclaw-key',
        saveToVault: saveToVault ?? false,
      });
      return { data: { status: fulfilled.status, savedToVault: saveToVault ?? false } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg.includes('not pending')) {
        return reply
          .status(409)
          .send({ error: { code: 'CONFLICT', message: msg } });
      }
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // GET /credentials/requests — list requests (filter by ?sessionId=&status=)
  app.get<{
    Querystring: { sessionId?: string; status?: string };
  }>('/credentials/requests', async (req) => {
    const { sessionId, status } = req.query;
    return { data: credentials.listRequests({ sessionId, status }) };
  });

  // GET /credentials/requests/:id — get request details
  app.get<{ Params: { id: string } }>('/credentials/requests/:id', async (req, reply) => {
    const creq = credentials.getRequest(req.params.id);
    if (!creq) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
    }
    return { data: creq };
  });

  // POST /credentials/requests/:id/cancel — cancel a request
  app.post<{ Params: { id: string } }>(
    '/credentials/requests/:id/cancel',
    async (req, reply) => {
      try {
        const creq = credentials.cancelRequest(req.params.id);
        return { data: creq };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('not found')) {
          return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
        }
        return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
      }
    },
  );

  // ── Vault management ────────────────────────────────────────────────────────

  // GET /credentials/vault — list saved credentials (NO values)
  app.get('/credentials/vault', async () => {
    return { data: credentials.listVault() };
  });

  // POST /credentials/vault — store credential directly
  app.post<{
    Body: {
      label: string;
      service?: string;
      value: string;
      passphrase: string;
      oneTime?: boolean;
      expiresAt?: string;
    };
  }>('/credentials/vault', async (req, reply) => {
    const { label, service, value, passphrase, oneTime, expiresAt } = req.body;
    if (!label?.trim()) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'label is required' } });
    }
    if (!value) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'value is required' } });
    }
    if (!passphrase) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'passphrase is required' } });
    }

    try {
      const entry = credentials.storeCredential({
        label,
        service,
        value,
        passphrase,
        oneTime,
        expiresAt,
      });
      return reply.status(201).send({ data: entry });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // GET /credentials/vault/:id — get vault entry metadata (no value)
  app.get<{ Params: { id: string } }>('/credentials/vault/:id', async (req, reply) => {
    const entry = credentials.getVaultEntry(req.params.id);
    if (!entry) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Vault entry not found' } });
    }
    return { data: entry };
  });

  // POST /credentials/vault/:id/retrieve — decrypt and return value
  app.post<{
    Params: { id: string };
    Body: { passphrase?: string };
  }>('/credentials/vault/:id/retrieve', async (req, reply) => {
    const passphrase = req.body?.passphrase || process.env.HIVECLAW_VAULT_KEY || process.env.SUPERCLAW_VAULT_KEY || 'default-hiveclaw-key';

    try {
      const value = credentials.retrieveCredential(req.params.id, passphrase);
      if (value === null) {
        return reply.status(410).send({
          error: {
            code: 'GONE',
            message:
              'Credential not available (expired, already used, or wrong passphrase)',
          },
        });
      }
      // Return value — this endpoint is for explicit secure retrieval only
      return { data: { value } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // DELETE /credentials/vault/:id — remove from vault
  app.delete<{ Params: { id: string } }>('/credentials/vault/:id', async (req, reply) => {
    const deleted = credentials.deleteVaultEntry(req.params.id);
    if (!deleted) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Vault entry not found' } });
    }
    return { data: { deleted: true } };
  });

  // ── Maintenance ─────────────────────────────────────────────────────────────

  // POST /credentials/cleanup — remove expired entries
  app.post('/credentials/cleanup', async () => {
    const removed = credentials.cleanExpired();
    return { data: { removed } };
  });
}

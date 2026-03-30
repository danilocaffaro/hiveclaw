import type { FastifyInstance } from 'fastify';
import type { CredentialStoreRepository, CredentialCreateInput, CredentialUpdateInput } from '../db/credential-store.js';
import { logger } from '../lib/logger.js';

// ── Value masking ─────────────────────────────────────────────────────────────
// Show first 4 + last 3 chars: "AIzaSy...JxE"
function maskValue(value: string): string {
  if (value.length <= 7) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

// ── Provider health check URLs ────────────────────────────────────────────────
const HEALTH_CHECK_URLS: Record<string, string> = {
  google: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/models',
};

async function checkCredentialHealth(
  provider: string,
  value: string,
): Promise<{ status: 'active' | 'invalid' | 'unknown'; error?: string; latencyMs: number }> {
  const start = Date.now();

  // Anthropic and unknown providers: no simple health check
  if (!HEALTH_CHECK_URLS[provider]) {
    return { status: 'unknown', latencyMs: Date.now() - start };
  }

  try {
    let url: string;
    const headers: Record<string, string> = {};

    if (provider === 'google') {
      url = `${HEALTH_CHECK_URLS[provider]}?key=${value}`;
    } else if (provider === 'openai') {
      url = HEALTH_CHECK_URLS[provider];
      headers['Authorization'] = `Bearer ${value}`;
    } else {
      return { status: 'unknown', latencyMs: Date.now() - start };
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      return { status: 'active', latencyMs };
    } else if (response.status === 401 || response.status === 403) {
      return { status: 'invalid', error: `HTTP ${response.status}`, latencyMs };
    } else {
      return { status: 'unknown', error: `HTTP ${response.status}`, latencyMs };
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unknown', error, latencyMs };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerCredentialStoreRoutes(
  app: FastifyInstance,
  credentialStore: CredentialStoreRepository,
) {
  // GET /api/credential-store — list all (values masked)
  app.get('/credential-store', async () => {
    const credentials = credentialStore.getAll();
    return {
      data: credentials.map((c) => ({
        ...c,
        value: maskValue(c.value),
      })),
    };
  });

  // GET /api/credential-store/:id — get one (value masked)
  app.get<{ Params: { id: string } }>('/credential-store/:id', async (req, reply) => {
    const credential = credentialStore.getById(req.params.id);
    if (!credential) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found' } });
    }
    return {
      data: {
        ...credential,
        value: maskValue(credential.value),
      },
    };
  });

  // POST /api/credential-store — create new (returns full value ONCE)
  app.post<{
    Body: CredentialCreateInput;
  }>('/credential-store', async (req, reply) => {
    const { key, provider, value, status, checkEndpoint, usedBy } = req.body;

    if (!key?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'key is required' } });
    }
    if (!provider?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'provider is required' } });
    }
    if (!value) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'value is required' } });
    }

    // Check for duplicate key
    const existing = credentialStore.getByKey(key);
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: `Credential with key "${key}" already exists` },
      });
    }

    try {
      const credential = credentialStore.create({
        key,
        provider,
        value,
        status,
        checkEndpoint,
        usedBy,
      });
      // Return full value on create (only time it's unmasked)
      return reply.status(201).send({ data: credential });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // PATCH /api/credential-store/:id — update
  app.patch<{
    Params: { id: string };
    Body: CredentialUpdateInput;
  }>('/credential-store/:id', async (req, reply) => {
    const credential = credentialStore.update(req.params.id, req.body);
    if (!credential) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found' } });
    }
    return {
      data: {
        ...credential,
        value: maskValue(credential.value),
      },
    };
  });

  // DELETE /api/credential-store/:id — delete
  app.delete<{ Params: { id: string } }>('/credential-store/:id', async (req, reply) => {
    const deleted = credentialStore.delete(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found' } });
    }
    return { data: { deleted: true } };
  });

  // POST /api/credential-store/:id/check — run health check
  app.post<{ Params: { id: string } }>('/credential-store/:id/check', async (req, reply) => {
    const credential = credentialStore.getById(req.params.id);
    if (!credential) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found' } });
    }

    const now = new Date().toISOString();
    const result = await checkCredentialHealth(credential.provider, credential.value);

    // Update status in DB
    const updated = credentialStore.updateStatus(
      credential.id,
      result.status,
      now,
      result.status === 'active' ? now : undefined,
    );

    logger.info(`[CredentialStore] Health check for ${credential.key}: ${result.status} (${result.latencyMs}ms)`);

    return {
      data: {
        credentialId: credential.id,
        key: credential.key,
        provider: credential.provider,
        status: result.status,
        checkedAt: now,
        latencyMs: result.latencyMs,
        error: result.error,
        credential: updated ? { ...updated, value: maskValue(updated.value) } : undefined,
      },
    };
  });
}

import type { FastifyInstance } from 'fastify';
import type { ProviderRepository, ModelConfig } from '../db/providers.js';
import { resolveProviderBaseUrl, PROVIDER_BASE_URLS } from '../config/defaults.js';

// ============================================================
// Minimal HTTP helper (no extra deps — uses Node fetch)
// ============================================================

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, { method: 'GET', headers });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function httpPost(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ============================================================
// Test connection implementations
// ============================================================

async function testAnthropic(apiKey: string): Promise<{ connected: boolean; message?: string }> {
  try {
    const url = resolveProviderBaseUrl('anthropic');
    const res = await httpPost(
      `${url}/v1/messages`,
      { model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    );
    if (res.ok || res.status === 400) {
      // 400 can happen with minimal payload but still means key is valid
      return { connected: true };
    }
    return { connected: false, message: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { connected: false, message: (err as Error).message };
  }
}

async function testOpenAI(apiKey: string, baseUrl = PROVIDER_BASE_URLS.openai): Promise<{ connected: boolean; message?: string }> {
  try {
    const res = await httpGet(`${baseUrl}/v1/models`, { Authorization: `Bearer ${apiKey}` });
    if (res.ok) return { connected: true };
    return { connected: false, message: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { connected: false, message: (err as Error).message };
  }
}

async function testOllama(baseUrl = PROVIDER_BASE_URLS.ollama): Promise<{ connected: boolean; message?: string }> {
  try {
    const res = await httpGet(`${baseUrl}/api/tags`);
    if (res.ok) return { connected: true };
    return { connected: false, message: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { connected: false, message: (err as Error).message };
  }
}

async function testGoogle(apiKey: string): Promise<{ connected: boolean; message?: string }> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
    const res = await httpPost(url, {
      contents: [{ parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1 },
    });
    if (res.ok || res.status === 400) {
      return { connected: true };
    }
    return { connected: false, message: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { connected: false, message: (err as Error).message };
  }
}

// ============================================================
// Route registration
// ============================================================

interface UpsertProviderBody {
  name?: string;
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  models?: ModelConfig[];
}

interface SetDefaultModelBody {
  providerId: string;
  modelId: string;
}

export function registerProviderRoutes(app: FastifyInstance, repo: ProviderRepository): void {

  // ----------------------------------------------------------
  // GET /config/providers — returns providers from DB
  // ----------------------------------------------------------
  app.get('/config/providers', async (_req, reply) => {
    try {
      const providers = repo.list();
      return reply.send({ data: providers });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });

  // ----------------------------------------------------------
  // GET /config/providers/:id — get single provider (masked key)
  // ----------------------------------------------------------
  app.get<{ Params: { id: string } }>('/config/providers/:id', async (req, reply) => {
    try {
      const provider = repo.get(req.params.id);
      if (!provider) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
      return reply.send(provider);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  });

  // ----------------------------------------------------------
  // PUT /config/providers/:id
  // ----------------------------------------------------------
  app.put<{ Params: { id: string }; Body: UpsertProviderBody }>(
    '/config/providers/:id',
    async (req, reply) => {
      try {
        const { id } = req.params;
        const body = req.body ?? {};

        const updated = repo.upsert({
          id,
          name: body.name,
          type: body.type,
          apiKey: body.apiKey,
          baseUrl: body.baseUrl,
          enabled: body.enabled,
          models: body.models,
        });

        return reply.send({ data: updated });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ----------------------------------------------------------
  // DELETE /config/providers/:id
  // ----------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/config/providers/:id', async (req, reply) => {
    try {
      const { id } = req.params;
      const deleted = repo.delete(id);
      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Provider '${id}' not found` },
        });
      }
      return reply.send({ data: { id, deleted: true } });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });

  // ----------------------------------------------------------
  // POST /config/providers/:id/test
  // ----------------------------------------------------------
  app.post<{ Params: { id: string } }>('/config/providers/:id/test', async (req, reply) => {
    try {
      const { id } = req.params;
      const provider = repo.getUnmasked(id);

      if (!provider) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Provider '${id}' not found` },
        });
      }

      let result: { connected: boolean; message?: string };

      switch (provider.type) {
        case 'anthropic': {
          if (!provider.rawApiKey) {
            return reply.send({ status: 'error', message: 'API key not configured' });
          }
          result = await testAnthropic(provider.rawApiKey);
          break;
        }
        case 'openai': {
          if (!provider.rawApiKey) {
            return reply.send({ status: 'error', message: 'API key not configured' });
          }
          result = await testOpenAI(provider.rawApiKey, provider.baseUrl);
          break;
        }
        case 'ollama': {
          result = await testOllama(provider.baseUrl ?? PROVIDER_BASE_URLS.ollama);
          break;
        }
        case 'google': {
          if (!provider.rawApiKey) {
            return reply.send({ status: 'error', message: 'API key not configured' });
          }
          result = await testGoogle(provider.rawApiKey);
          break;
        }
        case 'custom': {
          if (!provider.baseUrl) {
            return reply.send({ status: 'error', message: 'Base URL not configured' });
          }
          result = await testOpenAI(provider.rawApiKey ?? '', provider.baseUrl);
          break;
        }
        default: {
          return reply.send({ status: 'error', message: `Unknown provider type: ${provider.type}` });
        }
      }

      if (result.connected) {
        return reply.send({ status: 'connected' });
      } else {
        return reply.send({ status: 'error', message: result.message ?? 'Connection failed' });
      }
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });

  // ----------------------------------------------------------
  // GET /config/models
  // ----------------------------------------------------------
  app.get('/config/models', async (_req, reply) => {
    try {
      const models = repo.allModels();
      return reply.send({ data: models });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });

  // ----------------------------------------------------------
  // GET /config/models/default
  // ----------------------------------------------------------
  app.get('/config/models/default', async (_req, reply) => {
    try {
      const def = repo.getDefaultModel();
      if (!def) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'No default model configured' },
        });
      }
      return reply.send({ data: def });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });

  // ----------------------------------------------------------
  // PUT /config/models/default
  // ----------------------------------------------------------
  app.put<{ Body: SetDefaultModelBody }>('/config/models/default', async (req, reply) => {
    try {
      const { providerId, modelId } = req.body ?? {};

      if (!providerId || !modelId) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'providerId and modelId are required' },
        });
      }

      repo.setDefaultModel(providerId, modelId);
      return reply.send({ data: { providerId, modelId } });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  });
}

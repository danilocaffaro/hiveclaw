// ============================================================
// n8n Integration API
// Routes:
//   GET  /n8n/status          — connection status
//   GET  /n8n/workflows       — list n8n workflows
//   POST /n8n/workflows/:id/activate  — activate workflow
//   POST /n8n/trigger/:id     — trigger webhook workflow
//   PUT  /n8n/config          — save n8n URL + API key
//   GET  /n8n/config          — get n8n config (no secret)
// ============================================================

import { FastifyInstance } from 'fastify';
import { resolveApiKey } from '../config/resolve-api-key.js';

interface N8nConfig {
  url: string;
  apiKey: string;
}

// In-memory config (persisted to env or future DB)
// Note: resolveApiKey at module-load may not have credential store yet —
// falls back to process.env, which is the original behavior.
let n8nConfig: N8nConfig = {
  url: process.env.N8N_URL ?? 'http://localhost:5678',
  apiKey: resolveApiKey('N8N_API_KEY') ?? '',
};

async function n8nFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${n8nConfig.url}/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(n8nConfig.apiKey ? { 'X-N8N-API-KEY': n8nConfig.apiKey } : {}),
      ...(opts?.headers ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  return res;
}

export function registerN8nRoutes(app: FastifyInstance) {
  // ── GET /n8n/status ─────────────────────────────────────────────────────────
  app.get('/n8n/status', async (_req, reply) => {
    try {
      const res = await n8nFetch('/workflows?limit=1');
      if (res.ok) {
        const data = await res.json() as { data?: unknown[] };
        return reply.send({
          data: {
            connected: true,
            url: n8nConfig.url,
            hasApiKey: !!n8nConfig.apiKey,
            workflowCount: Array.isArray(data.data) ? data.data.length : 0,
          },
        });
      }
      return reply.send({ data: { connected: false, url: n8nConfig.url, error: `HTTP ${res.status}` } });
    } catch (err) {
      return reply.send({
        data: {
          connected: false,
          url: n8nConfig.url,
          hasApiKey: !!n8nConfig.apiKey,
          error: (err as Error).message,
        },
      });
    }
  });

  // ── GET /n8n/config ──────────────────────────────────────────────────────────
  app.get('/n8n/config', async (_req, reply) => {
    return reply.send({
      data: {
        url: n8nConfig.url,
        hasApiKey: !!n8nConfig.apiKey,
      },
    });
  });

  // ── PUT /n8n/config ──────────────────────────────────────────────────────────
  app.put<{ Body: { url?: string; apiKey?: string } }>('/n8n/config', async (req, reply) => {
    const { url, apiKey } = req.body ?? {};
    if (url) n8nConfig.url = url.replace(/\/$/, ''); // strip trailing slash
    if (apiKey !== undefined) n8nConfig.apiKey = apiKey;
    return reply.send({ data: { url: n8nConfig.url, hasApiKey: !!n8nConfig.apiKey } });
  });

  // ── GET /n8n/workflows ───────────────────────────────────────────────────────
  app.get('/n8n/workflows', async (_req, reply) => {
    try {
      const res = await n8nFetch('/workflows?limit=50');
      if (!res.ok) return reply.status(res.status).send({ error: { code: 'N8N_ERROR', message: `n8n returned ${res.status}` } });
      const data = await res.json() as { data?: unknown[] };
      return reply.send({ data: data.data ?? [] });
    } catch (err) {
      return reply.status(503).send({ error: { code: 'N8N_UNREACHABLE', message: `n8n unavailable: ${(err as Error).message}` } });
    }
  });

  // ── POST /n8n/workflows/:id/activate ────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/n8n/workflows/:id/activate', async (req, reply) => {
    try {
      const res = await n8nFetch(`/workflows/${req.params.id}/activate`, { method: 'POST' });
      if (!res.ok) return reply.status(res.status).send({ error: { code: 'N8N_ERROR', message: `n8n returned ${res.status}` } });
      const data = await res.json();
      return reply.send({ data });
    } catch (err) {
      return reply.status(503).send({ error: { code: 'N8N_UNREACHABLE', message: (err as Error).message } });
    }
  });

  // ── POST /n8n/trigger/:id ────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/n8n/trigger/:id', async (req, reply) => {
    try {
      // n8n webhook trigger — POST to webhook URL
      const webhookUrl = `${n8nConfig.url}/webhook/${req.params.id}`;
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(10000),
      });
      const responseText = await res.text();
      let responseData: unknown;
      try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }
      return reply.status(res.ok ? 200 : res.status).send({ data: responseData });
    } catch (err) {
      return reply.status(503).send({ error: { code: 'TRIGGER_FAILED', message: (err as Error).message } });
    }
  });
}

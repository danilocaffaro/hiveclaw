// Agents & Providers CRUD API
import type { FastifyInstance } from 'fastify';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent, listProviders, getProvider, createProvider, deleteProvider } from '../db/repos.js';

export function registerAgentRoutes(app: FastifyInstance) {
  // ── Agents ─────────────────────────────────────────────────────────────

  app.get('/api/agents', async () => {
    return { data: listAgents() };
  });

  app.get('/api/agents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const agent = getAgent(id);
    if (!agent) return { error: 'Not found' };
    return { data: agent };
  });

  app.post('/api/agents', async (req) => {
    const agent = createAgent(req.body as any);
    return { data: agent };
  });

  app.patch('/api/agents/:id', async (req) => {
    const { id } = req.params as { id: string };
    updateAgent(id, req.body as any);
    return { ok: true, data: getAgent(id) };
  });

  app.delete('/api/agents/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteAgent(id);
    return { ok: true };
  });

  // ── Providers ──────────────────────────────────────────────────────────

  app.get('/api/providers', async () => {
    const providers = listProviders();
    // Mask API keys in response
    return { data: providers.map(p => ({ ...p, api_key: p.api_key ? '••••' + p.api_key.slice(-4) : undefined })) };
  });

  app.post('/api/providers', async (req) => {
    const provider = createProvider(req.body as any);
    return { data: provider };
  });

  app.delete('/api/providers/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteProvider(id);
    return { ok: true };
  });
}

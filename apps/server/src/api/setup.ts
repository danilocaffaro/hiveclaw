import type { FastifyInstance } from 'fastify';
import type { ProviderRepository, ProviderConfig } from '../db/providers.js';
import { AgentRepository } from '../db/agents.js';
import { ProviderRepository as ProvRepo } from '../db/providers.js';
import { initDatabase } from '../db/index.js';
import { streamChat } from '../engine/chat-engine.js';
import { resolveProviderBaseUrl, resolveProviderType, PROVIDER_BASE_URLS } from '../config/defaults.js';

// ============================================================
// Setup API — First-run wizard endpoints
// ============================================================

function getDb() {
  return initDatabase();
}

/** Check if setup is needed: no providers with API keys + few agents */
function computeNeedsSetup(_providers: ProviderConfig[], _agentCount: number, db: ReturnType<typeof initDatabase>): boolean {
  // Setup is needed until the user explicitly completes the wizard
  // The wizard marks setup_complete=true at the end
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'setup_complete'`).get() as { value: string } | undefined;
  return row?.value !== 'true';
}

/** Test a provider's API key by making a minimal LLM call */
async function testProviderConnection(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ success: boolean; error?: string; models?: string[] }> {
  try {
    if (providerId === 'anthropic') {
      const url = resolveProviderBaseUrl('anthropic', baseUrl);
      const res = await fetch(`${url}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `API returned ${res.status}: ${body.slice(0, 200)}` };
      }
      return { success: true };
    }

    if (providerId === 'openai') {
      const url = resolveProviderBaseUrl('openai', baseUrl);
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `API returned ${res.status}: ${body.slice(0, 200)}` };
      }
      return { success: true };
    }

    if (providerId === 'ollama') {
      const url = resolveProviderBaseUrl('ollama', baseUrl);
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { success: false, error: `Ollama not reachable at ${url}` };
      return { success: true };
    }

    if (providerId === 'google') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `API returned ${res.status}: ${body.slice(0, 200)}` };
      }
      return { success: true };
    }

    // OpenAI-compatible providers (OpenRouter, DeepSeek, Groq, Mistral)
    const openaiCompatible: Record<string, { baseUrl: string; testModel: string; modelsEndpoint?: string }> = {
      'openrouter': { baseUrl: 'https://openrouter.ai/api', testModel: 'openai/gpt-4o-mini', modelsEndpoint: 'https://openrouter.ai/api/v1/models' },
      'deepseek': { baseUrl: 'https://api.deepseek.com', testModel: 'deepseek-chat' },
      'groq': { baseUrl: 'https://api.groq.com/openai', testModel: 'llama-3.3-70b-versatile' },
      'mistral': { baseUrl: 'https://api.mistral.ai', testModel: 'mistral-small-latest' },
    };

    const compat = openaiCompatible[providerId];
    if (compat) {
      const url = baseUrl || compat.baseUrl;
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: compat.testModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `API returned ${res.status}: ${body.slice(0, 200)}` };
      }
      return { success: true };
    }

    if (providerId === 'github-copilot') {
      // Try to load the Copilot token from OpenClaw credential cache
      try {
        const fs = await import('fs');
        const path = await import('path');
        const home = process.env.HOME || '/Users/AI';
        const tokenPath = path.join(home, '.openclaw', 'credentials', 'github-copilot.token.json');

        if (!fs.existsSync(tokenPath)) {
          return { success: false, error: 'GitHub Copilot token not found. Make sure you have GitHub CLI (gh) authenticated or OpenClaw with Copilot configured.' };
        }

        const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')) as { token?: string; expiresAt?: number };
        if (!data.token) {
          return { success: false, error: 'Copilot token file exists but is empty.' };
        }

        if (data.expiresAt && Date.now() > data.expiresAt - 60_000) {
          return { success: false, error: 'Copilot token has expired. Restart OpenClaw to refresh it.' };
        }

        // Actually test the API
        const testRes = await fetch('https://api.githubcopilot.com/models', {
          headers: {
            'Authorization': `Bearer ${data.token}`,
            'Copilot-Integration-Id': 'vscode-chat',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (!testRes.ok) {
          return { success: false, error: `Copilot API returned ${testRes.status}. Token may be expired.` };
        }

        const json = await testRes.json() as { data?: Array<{ id: string }> };
        const models = json.data?.map(m => m.id) ?? [];
        return { success: true, models };
      } catch (err) {
        return { success: false, error: `Copilot test failed: ${(err as Error).message}` };
      }
    }

    return { success: false, error: `Unknown provider: ${providerId}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================
// Route Registration
// ============================================================

export function registerSetupRoutes(
  app: FastifyInstance,
  providerRepo: ProviderRepository,
): void {
  const db = getDb();
  const agentRepo = new AgentRepository(db);

  // ── GET /setup/status ──────────────────────────────────────────────────────
  app.get('/setup/status', async () => {
    const providers = providerRepo.list();
    const agents = agentRepo.list();
    const needsSetup = computeNeedsSetup(providers, agents.length, db);

    return {
      data: {
        needsSetup,
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          status: p.status,
          models: p.models.map((m) => ({ id: m.id, name: m.name })),
        })),
        agentCount: agents.length,
      },
    };
  });

  // ── POST /setup/provider ───────────────────────────────────────────────────
  app.post<{
    Body: { providerId: string; apiKey: string; baseUrl?: string };
  }>('/setup/provider', async (req, reply) => {
    const { providerId, apiKey, baseUrl } = req.body ?? {};
    if (!providerId) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'providerId is required' },
      });
    }

    // For ollama and github-copilot, apiKey is optional
    if (providerId !== 'ollama' && providerId !== 'github-copilot' && !apiKey) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'apiKey is required' },
      });
    }

    // Test the connection
    const test = await testProviderConnection(providerId, apiKey, baseUrl);
    if (!test.success) {
      return reply.status(400).send({
        data: { success: false, error: test.error, models: [] },
      });
    }

    // Save the key to the provider
    const updated = providerRepo.upsert({
      id: providerId,
      apiKey: providerId !== 'ollama' && providerId !== 'github-copilot' ? apiKey : undefined,
      baseUrl,
    });

    // Use models from test if available (e.g. Copilot discovers its own models)
    const resolvedModels = test.models ?? updated.models.map((m) => m.id);

    return {
      data: {
        success: true,
        models: resolvedModels,
      },
    };
  });

  // ── POST /setup/agent ──────────────────────────────────────────────────────
  app.post<{
    Body: {
      name: string;
      emoji?: string;
      role: string;
      systemPrompt: string;
      providerId: string;
      modelId: string;
    };
  }>('/setup/agent', async (req, reply) => {
    const { name, role, systemPrompt, providerId, modelId, emoji } = req.body ?? {};
    if (!name || !role || !systemPrompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'name, role, and systemPrompt are required' },
      });
    }

    const agent = agentRepo.create({
      name,
      emoji: emoji ?? '🤖',
      role,
      systemPrompt,
      providerPreference: providerId,
      modelPreference: modelId,
    });

    return reply.status(201).send({ data: agent });
  });

  // ── POST /setup/test-chat ─────────────────────────────────────────────────
  app.post<{
    Body: { agentId: string; message: string };
  }>('/setup/test-chat', async (req, reply) => {
    const { agentId, message } = req.body ?? {};
    if (!agentId || !message) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'agentId and message are required' },
      });
    }

    const agent = agentRepo.getById(agentId);
    if (!agent) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Agent not found' },
      });
    }

    const providerId = agent.providerPreference || 'anthropic';
    const db2 = initDatabase();
    const provRepo = new ProvRepo(db2);
    const provConfig = provRepo.getUnmasked(providerId);
    if (!provConfig?.rawApiKey) {
      return reply.status(400).send({
        error: { code: 'PROVIDER_ERROR', message: `Provider '${providerId}' not configured or has no API key.` },
      });
    }

    try {
      const chunks: string[] = [];
      const firstModel = provConfig.models[0];
      const modelId = agent.modelPreference || (typeof firstModel === 'object' ? firstModel.id : firstModel) || '';
      const providerType = resolveProviderType(providerId, provConfig.type);
      const baseUrl = resolveProviderBaseUrl(providerId, provConfig.baseUrl);

      const msgs: import('../engine/chat-engine.js').ChatMessage[] = [];
      if (agent.systemPrompt) msgs.push({ role: 'system', content: agent.systemPrompt });
      msgs.push({ role: 'user', content: message });

      for await (const event of streamChat(msgs, {
        model: modelId,
        baseUrl,
        apiKey: provConfig.rawApiKey,
        providerType: providerType as 'openai' | 'anthropic',
        temperature: agent.temperature ?? 0.7,
        maxTokens: 256,
      })) {
        if (event.type === 'delta' && event.content) chunks.push(event.content);
        if (event.type === 'error') throw new Error(event.error);
      }

      return {
        data: {
          agentId,
          response: chunks.join(''),
        },
      };
    } catch (err) {
      return reply.status(500).send({
        error: { code: 'LLM_ERROR', message: (err as Error).message },
      });
    }
  });

  // ── POST /setup/complete ───────────────────────────────────────────────────
  app.post('/setup/complete', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`,
    ).run();

    return { data: { complete: true } };
  });
}

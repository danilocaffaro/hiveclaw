import type { FastifyInstance } from 'fastify';
import type { ProviderConfig } from '../db/providers.js';
import type { ProviderRepository } from '../db/providers.js';
import { getEngineService } from '../engine/engine-service.js';
// Setup API routes
import { streamChat } from '../engine/chat-engine.js';
import { resolveProviderBaseUrl, resolveProviderType, PROVIDER_BASE_URLS } from '../config/defaults.js';

// ============================================================
// Setup API — First-run wizard endpoints
// ============================================================

function getDb() {
  return getEngineService().db.getDb();
}

/** Check if setup is needed: no providers with API keys + few agents */
function computeNeedsSetup(_providers: ProviderConfig[], _agentCount: number, db: import('better-sqlite3').Database): boolean {
  // Setup is needed until the user explicitly completes the wizard
  // The wizard marks setup_complete=true at the end
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'setup_complete'`).get() as { value: string } | undefined;
  return row?.value !== 'true';
}

/** Convert model ID to human-readable name (e.g. "claude-sonnet-4.6" → "Claude Sonnet 4.6") */
function prettifyModelName(id: string): string {
  return id
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^claude-/i, 'Claude ')
    .replace(/^gemini-/i, 'Gemini ')
    .replace(/^grok-/i, 'Grok ')
    .replace(/^o(\d)/, 'o$1')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Gpt/g, 'GPT')
    .replace(/\bMini\b/g, 'Mini')
    .replace(/\bPro\b/g, 'Pro')
    .replace(/\bFlash\b/g, 'Flash')
    .replace(/\bPreview\b/g, 'Preview')
    .trim();
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
      const isOAuth = apiKey.includes('sk-ant-oat');
      const authHeaders: Record<string, string> = isOAuth
        ? { Authorization: `Bearer ${apiKey}`, 'anthropic-beta': 'oauth-2025-04-20' }
        : { 'x-api-key': apiKey };

      if (isOAuth) {
        // OAuth tokens (Claude Max/Pro): validate via a minimal chat call with Bearer auth
        const oauthRes = await fetch(`${url}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        if (!oauthRes.ok) {
          const body = await oauthRes.text();
          return { success: false, error: `OAuth validation failed (${oauthRes.status}): ${body.slice(0, 200)}` };
        }
        return {
          success: true,
          models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
        };
      }

      // Standard API key validation
      const res = await fetch(`${url}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
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
      // Discover available models
      try {
        const modelsRes = await fetch(`${url}/v1/models`, {
          headers: { ...authHeaders, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(10000),
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
          const chatModels = (modelsData.data ?? [])
            .map(m => m.id)
            .filter(id => !/-\d{8}$/.test(id)); // remove dated versions like claude-sonnet-4-5-20250514
          if (chatModels.length > 0) return { success: true, models: chatModels };
        }
      } catch { /* fallback */ }
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
      // Discover available models
      try {
        const modelsRes = await fetch(`${url}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
          const chatModels = (modelsData.data ?? [])
            .map(m => m.id)
            .filter(id =>
              !id.includes('embedding') && !id.includes('whisper') &&
              !id.includes('tts') && !id.includes('dall-e') &&
              !id.includes('moderation') && !id.includes('ada') &&
              !id.includes('babbage') && !id.includes('davinci') &&
              !/-\d{4}-\d{2}-\d{2}$/.test(id)
            );
          if (chatModels.length > 0) return { success: true, models: chatModels };
        }
      } catch { /* fallback */ }
      return { success: true };
    }

    if (providerId === 'ollama') {
      const url = resolveProviderBaseUrl('ollama', baseUrl);
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { success: false, error: `Ollama not reachable at ${url}` };
      // Fetch actually installed models
      try {
        const tagsData = await res.json() as { models?: Array<{ name: string }> };
        const installedModels = (tagsData.models ?? []).map(m => m.name);
        if (installedModels.length === 0) {
          return {
            success: false,
            error: 'Ollama is running but has no models installed. Run: ollama pull llama3.2 or ollama pull qwen2.5:7b',
          };
        }
        return { success: true, models: installedModels };
      } catch {
        return { success: true };
      }
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
      // Parse model list from the same response
      try {
        const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
        const chatModels = (data.models ?? [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''))
          .filter(id => !id.includes('embedding') && !id.includes('aqa') && !id.includes('bisimulation'));
        if (chatModels.length > 0) return { success: true, models: chatModels };
      } catch { /* fallback */ }
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

      // Discover available models from /v1/models endpoint
      const modelsUrl = compat.modelsEndpoint || `${url}/v1/models`;
      try {
        const modelsRes = await fetch(modelsUrl, {
          headers: { Authorization: `Bearer ${apiKey}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
          const allModels = (modelsData.data ?? []).map(m => m.id);
          const chatModels = allModels.filter(id =>
            !id.includes('embedding') && !id.includes('whisper') &&
            !id.includes('tts') && !id.includes('dall-e') &&
            !id.includes('moderation') && !id.includes('ada-002')
          );
          if (chatModels.length > 0) return { success: true, models: chatModels };
        }
      } catch { /* fallback — no model discovery */ }
      return { success: true };
    }

    // GitHub Copilot — verify GitHub OAuth token + discover available models
    if (providerId === 'github-copilot') {
      // The token from Device Flow is a GitHub OAuth token
      const ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'HiveClaw/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!ghRes.ok) {
        const body = await ghRes.text();
        return { success: false, error: `GitHub authentication failed (${ghRes.status}): ${body.slice(0, 200)}` };
      }

      // Exchange GitHub token for Copilot session token, then discover models
      try {
        const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
          headers: { Authorization: `token ${apiKey}`, 'Accept': 'application/json', 'User-Agent': 'HiveClaw/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json() as { token?: string };
          if (tokenData.token) {
            const modelsRes = await fetch('https://api.githubcopilot.com/models', {
              headers: {
                Authorization: `Bearer ${tokenData.token}`,
                'Accept': 'application/json',
                'Editor-Version': 'vscode/1.96.0',
                'Editor-Plugin-Version': 'copilot/1.0.0',
                'Copilot-Integration-Id': 'vscode-chat',
              },
              signal: AbortSignal.timeout(10000),
            });
            if (modelsRes.ok) {
              const modelsData = await modelsRes.json() as Array<{ id: string; name?: string }> | { data?: Array<{ id: string; name?: string }> };
              const modelList = Array.isArray(modelsData) ? modelsData : (modelsData as { data?: Array<{ id: string }> }).data ?? [];
              // Filter out embedding/non-chat models, deduplicate, and remove dated versions
              const chatModels = [...new Set(
                modelList
                  .map(m => m.id)
                  .filter(id =>
                    !id.includes('embedding') &&
                    !id.includes('ada-002') &&
                    !/-\d{4}-\d{2}-\d{2}/.test(id) && // remove dated versions like gpt-4o-2024-08-06
                    !id.includes('-0613') && // remove old dated suffix
                    !id.includes('-0125') &&
                    id !== 'gpt-3.5-turbo'  // too old
                  )
              )];
              if (chatModels.length > 0) {
                return { success: true, models: chatModels };
              }
            }
          }
        }
      } catch { /* Fallback to defaults if model discovery fails */ }
      return { success: true };
    }

    // Custom / generic OpenAI-compatible provider
    if (providerId === 'custom') {
      if (!baseUrl) return { success: false, error: 'Base URL is required for custom providers' };
      const url = baseUrl.replace(/\/+$/, '');
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
        signal: AbortSignal.timeout(10000),
      });
      // Accept 200 (success) or 404/model-not-found (means API works, model just differs)
      if (res.ok || res.status === 404) {
        return { success: true };
      }
      const body = await res.text();
      return { success: false, error: `API returned ${res.status}: ${body.slice(0, 200)}` };
    }

    return { success: false, error: `Unknown provider: ${providerId}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================
// GitHub Copilot — OAuth Device Flow
// ============================================================
// Uses VS Code's client ID (same one used by Copilot extensions)
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

async function startCopilotDeviceFlow(): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: 'copilot',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res.json() as Promise<{
    device_code: string; user_code: string;
    verification_uri: string; expires_in: number; interval: number;
  }>;
}

async function pollCopilotToken(deviceCode: string): Promise<{
  status: 'pending' | 'success' | 'expired' | 'error';
  token?: string;
  error?: string;
}> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { status: 'error', error: `GitHub returned ${res.status}` };
  const data = await res.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (data.access_token) {
    // Exchange GitHub token for Copilot API token
    try {
      const copilotRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (copilotRes.ok) {
        const copilotData = await copilotRes.json() as { token?: string; expires_at?: number };
        if (copilotData.token) {
          return { status: 'success', token: copilotData.token };
        }
      }
      // Fallback: use the GitHub OAuth token directly
      return { status: 'success', token: data.access_token };
    } catch {
      return { status: 'success', token: data.access_token };
    }
  }
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'pending' };
  if (data.error === 'expired_token') return { status: 'expired' };
  return { status: 'error', error: data.error_description || data.error || 'Unknown error' };
}

// ============================================================
// Route Registration
// ============================================================

export function registerSetupRoutes(
  app: FastifyInstance,
  providerRepo: ProviderRepository,
): void {
  const db = getDb();
  const agentRepo = getEngineService().db.agents(db);

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
    Body: { providerId: string; apiKey: string; baseUrl?: string; name?: string };
  }>('/setup/provider', async (req, reply) => {
    const { providerId, apiKey, baseUrl, name: customName } = req.body ?? {};
    if (!providerId) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'providerId is required' },
      });
    }

    // For ollama and custom providers (may have no key), apiKey is optional
    if (providerId !== 'ollama' && providerId !== 'custom' && providerId !== 'github-copilot' && !apiKey) {
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

    // Save the key to the provider — include discovered models so they're persisted
    const saveId = providerId === 'custom' && customName
      ? customName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : providerId;

    // Build ModelConfig[] from discovered model names (simple format for runtime-discovered models)
    // All modern LLMs support tool/function calling — mark capabilities accordingly.
    const discoveredModelConfigs = test.models?.map((m) => ({
      id: m, name: prettifyModelName(m), provider: saveId,
      contextWindow: 128000, maxOutput: 8192,
      costPerMInput: 0, costPerMOutput: 0, capabilities: ['text', 'tools'] as string[],
    }));

    const updated = providerRepo.upsert({
      id: saveId,
      name: customName || undefined,
      apiKey: providerId !== 'ollama' ? apiKey : undefined,
      baseUrl,
      // Persist discovered models so agent-runner can resolve them
      ...(discoveredModelConfigs ? { models: discoveredModelConfigs } : {}),
    });

    // Use models from test if available (discovered during API test)
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

    const providerId = agent.providerPreference || (() => {
      const connected = providerRepo.list().filter(p => p.status === 'connected');
      return connected[0]?.id ?? 'anthropic';
    })();
    const db2 = getDb();
    const provRepo = getEngineService().db.providers(db2);
    const provConfig = provRepo.getUnmasked(providerId);
    if (!provConfig) {
      return reply.status(400).send({
        error: { code: 'PROVIDER_ERROR', message: `Provider '${providerId}' not configured.` },
      });
    }

    // Resolve API key: from DB, or empty for keyless providers (Ollama, LM Studio)
    let apiKey = provConfig.rawApiKey || '';
    const isKeyless = providerId === 'ollama' || providerId === 'local' || providerId === 'lmstudio';
    if (!apiKey && !isKeyless) {
      return reply.status(400).send({
        error: { code: 'PROVIDER_ERROR', message: `Provider '${providerId}' has no API key configured.` },
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

      // GitHub Copilot: exchange OAuth token for Copilot session token
      let resolvedApiKey = apiKey;
      let resolvedBaseUrl = baseUrl;
      if (providerId === 'github-copilot' && apiKey) {
        try {
          const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Accept': 'application/json',
              'User-Agent': 'HiveClaw/1.0',
            },
            signal: AbortSignal.timeout(10000),
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as { token?: string; endpoints?: { api?: string } };
            if (tokenData.token) {
              resolvedApiKey = tokenData.token;
              if (tokenData.endpoints?.api) resolvedBaseUrl = tokenData.endpoints.api;
            }
          }
        } catch { /* fall through */ }
      }

      // Build extra headers for providers that need them
      const extraHeaders: Record<string, string> = {};
      if (providerId === 'github-copilot') {
        extraHeaders['Editor-Version'] = 'vscode/1.96.0';
        extraHeaders['Editor-Plugin-Version'] = 'copilot/1.0.0';
        extraHeaders['Copilot-Integration-Id'] = 'vscode-chat';
      }

      for await (const event of streamChat(msgs, {
        model: modelId,
        baseUrl: resolvedBaseUrl,
        apiKey: resolvedApiKey,
        providerType: providerType as 'openai' | 'anthropic',
        temperature: agent.temperature ?? 0.7,
        maxTokens: 256,
        extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
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

  // ── POST /setup/copilot/device-code — Start OAuth Device Flow ─────────────
  app.post('/setup/copilot/device-code', async (_req, reply) => {
    try {
      const flow = await startCopilotDeviceFlow();
      return reply.send({ data: flow });
    } catch (err) {
      return reply.status(500).send({
        error: { code: 'COPILOT_AUTH', message: (err as Error).message },
      });
    }
  });

  // ── POST /setup/copilot/poll — Poll for token ─────────────────────────────
  app.post<{ Body: { device_code: string } }>(
    '/setup/copilot/poll',
    async (req, reply) => {
      const { device_code } = req.body ?? {};
      if (!device_code) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'device_code is required' },
        });
      }
      try {
        const result = await pollCopilotToken(device_code);
        return reply.send({ data: result });
      } catch (err) {
        return reply.status(500).send({
          error: { code: 'COPILOT_AUTH', message: (err as Error).message },
        });
      }
    },
  );

  // ── POST /setup/complete ───────────────────────────────────────────────────
  app.post('/setup/complete', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('setup_complete', 'true', datetime('now'))`,
    ).run();

    return { data: { complete: true } };
  });
}

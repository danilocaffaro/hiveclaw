// Setup API — wizard flow
import type { FastifyInstance } from 'fastify';
import { isSetupComplete, completeSetup } from '../db/index.js';
import { createProvider, listProviders } from '../db/repos.js';
import { createAgent, listAgents } from '../db/repos.js';

// Provider presets for the wizard
const PROVIDER_PRESETS: Record<string, { name: string; type: string; baseUrl: string; defaultModels: string[] }> = {
  openai: {
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  },
  anthropic: {
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModels: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20250514'],
  },
  google: {
    name: 'Google',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  ollama: {
    name: 'Ollama (Local)',
    type: 'openai',
    baseUrl: 'http://localhost:11434',
    defaultModels: ['llama3.1:8b', 'qwen2.5:7b'],
  },
  openrouter: {
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api',
    defaultModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4o', 'google/gemini-2.5-flash'],
  },
};

export function registerSetupRoutes(app: FastifyInstance) {
  // Get setup status
  app.get('/api/setup/status', async () => {
    const done = isSetupComplete();
    const providers = listProviders();
    const agents = listAgents();
    
    let step: 'welcome' | 'provider' | 'agent' | 'done' = 'welcome';
    if (providers.length > 0 && agents.length === 0) step = 'agent';
    else if (providers.length > 0 && agents.length > 0) step = 'done';
    else if (!done) step = 'provider';
    
    return { setupComplete: done, step, providers: providers.length, agents: agents.length };
  });

  // Get provider presets
  app.get('/api/setup/presets', async () => {
    return { presets: PROVIDER_PRESETS };
  });

  // Verify API key with a provider
  app.post('/api/setup/verify-key', async (req) => {
    const { presetId, apiKey } = req.body as { presetId: string; apiKey?: string };
    const preset = PROVIDER_PRESETS[presetId];
    if (!preset) return { ok: false, error: 'Unknown provider' };

    // For Ollama, just check if server is reachable
    if (presetId === 'ollama') {
      try {
        const res = await fetch(`${preset.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as any;
          const models = (data.models ?? []).map((m: any) => m.name);
          return { ok: true, models: models.length > 0 ? models : preset.defaultModels };
        }
        return { ok: false, error: 'Ollama not reachable' };
      } catch {
        return { ok: false, error: 'Ollama not reachable at localhost:11434' };
      }
    }

    // For API-key providers, test with a simple request
    if (!apiKey) return { ok: false, error: 'API key required' };

    try {
      if (preset.type === 'anthropic') {
        const res = await fetch(`${preset.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok || res.status === 400) return { ok: true, models: preset.defaultModels }; // 400 = valid key, bad request
        if (res.status === 401) return { ok: false, error: 'Invalid API key' };
        return { ok: false, error: `API returned ${res.status}` };
      } else {
        // OpenAI-compatible: test with models endpoint
        const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}` };
        const res = await fetch(`${preset.baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const data = await res.json() as any;
          const models = (data.data ?? []).map((m: any) => m.id).slice(0, 20);
          return { ok: true, models: models.length > 0 ? models : preset.defaultModels };
        }
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key' };
        return { ok: true, models: preset.defaultModels }; // Some providers don't support /models
      }
    } catch (err: any) {
      return { ok: false, error: err.message ?? 'Connection failed' };
    }
  });

  // Save provider from wizard
  app.post('/api/setup/provider', async (req) => {
    const { presetId, apiKey, models } = req.body as { presetId: string; apiKey?: string; models?: string[] };
    const preset = PROVIDER_PRESETS[presetId];
    if (!preset) return { ok: false, error: 'Unknown provider' };

    const provider = createProvider({
      name: preset.name,
      type: preset.type,
      base_url: preset.baseUrl,
      api_key: apiKey,
      models: models ?? preset.defaultModels,
      enabled: true,
    });

    return { ok: true, provider };
  });

  // Save agent from wizard
  app.post('/api/setup/agent', async (req) => {
    const { name, emoji, specialty, providerId, model } = req.body as {
      name: string; emoji: string; specialty?: string; providerId: string; model: string;
    };

    const systemPrompts: Record<string, string> = {
      general: 'You are a helpful, knowledgeable, and friendly personal assistant. You help with any task the user needs — from answering questions to planning, writing, analysis, and problem-solving. Be concise but thorough.',
      coding: 'You are an expert software engineer. You write clean, efficient, well-documented code. You explain your reasoning. You consider edge cases and suggest best practices. When given a task, you break it down into steps.',
      research: 'You are an expert researcher and analyst. You gather information methodically, evaluate sources critically, synthesize findings clearly, and present actionable insights. You always cite your reasoning.',
      writing: 'You are a skilled writer and content creator. You adapt your tone and style to the audience. You write compelling, clear, and well-structured content. You help with everything from emails to articles to creative writing.',
    };

    const agent = createAgent({
      name,
      emoji: emoji || '🤖',
      system_prompt: systemPrompts[specialty ?? 'general'] ?? systemPrompts.general,
      provider_id: providerId,
      model,
    });

    // Mark setup complete
    completeSetup();

    return { ok: true, agent };
  });
}

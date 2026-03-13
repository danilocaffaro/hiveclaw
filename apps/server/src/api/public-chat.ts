import type { FastifyInstance } from 'fastify';
import { SharedLinkRepository } from '../db/shared-links.js';
import { logger } from '../lib/logger.js';
import { initDatabase, AgentRepository } from '../db/index.js';
import { ProviderRepository } from '../db/providers.js';
import { streamChat, type ChatMessage, type ChatOptions } from '../engine/chat-engine.js';
import {
  resolveProviderBaseUrl,
  resolveProviderType,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_SYSTEM_PROMPT,
} from '../config/defaults.js';
import type Database from 'better-sqlite3';

// ─── B054: Public Chat + Shared Links API ────────────────────────────────────
//
// Sprint 69 (Item 1.1): native-session-runner.ts has been deprecated.
// The three helpers (resolveAgent, buildChatMessages, runSession) were only
// used here and in the now-deleted squad-bridge-runner.ts. They are inlined
// below so public chat keeps working while the dead file is removed.

// Simple in-memory conversation store for public chats
const publicChatHistory = new Map<string, Array<{ role: string; content: string }>>();

// ─── Inlined from native-session-runner.ts (deprecated) ───────────────────────

interface ResolvedAgent {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  model: string;
  providerType: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

interface SessionRunnerConfig {
  db: Database.Database;
  agents: AgentRepository;
  providers: ProviderRepository;
}

/**
 * Resolve agent + provider config into streaming-ready options.
 * (Inlined from the former native-session-runner.ts)
 */
function resolveAgent(
  agentId: string,
  agents: AgentRepository,
  providers: ProviderRepository,
): ResolvedAgent | null {
  const agent = agents.getById(agentId);
  if (!agent) return null;

  const providerList = providers.list();
  const pref = agent.providerPreference || agent.modelPreference?.split('/')[0];
  const provider =
    providerList.find((p) => p.id === pref) ||
    providerList.find((p) => p.enabled) ||
    providerList[0];

  if (!provider) return null;

  const unmasked = providers.getUnmasked(provider.id);
  const apiKey = unmasked?.rawApiKey || undefined;

  const providerType = resolveProviderType(provider.id, provider.type);
  const baseUrl = resolveProviderBaseUrl(provider.id, provider.baseUrl);

  const firstModel = provider.models[0];
  const model =
    agent.modelPreference ||
    (typeof firstModel === 'string' ? firstModel : firstModel?.id) ||
    '';

  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji || '🤖',
    systemPrompt: agent.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    model,
    providerType,
    baseUrl,
    apiKey,
    temperature: agent.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: agent.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

/**
 * Build message history for LLM from DB messages.
 * (Inlined from the former native-session-runner.ts)
 */
function buildChatMessages(
  systemPrompt: string,
  dbMessages: Array<{ role: string; content: string }>,
  maxHistory = 50,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  const recent = dbMessages.slice(-maxHistory);
  for (const msg of recent) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

/**
 * Stream a chat response for an agent, yielding SSE-formatted data.
 * (Inlined from the former native-session-runner.ts)
 *
 * NOTE: This is the lightweight path for public (shared-link) chat.
 * It does NOT use tools, memory injection, or the agentic loop.
 * For full agent capabilities, use runAgent() from agent-runner.ts.
 */
async function* runSession(
  resolved: ResolvedAgent,
  messages: ChatMessage[],
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const opts: ChatOptions = {
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    providerType: resolved.providerType,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  };

  yield { type: 'message.start', agentId: resolved.id, agentName: resolved.name, agentEmoji: resolved.emoji };

  let fullContent = '';

  for await (const delta of streamChat(messages, opts)) {
    if (delta.type === 'delta' && delta.content) {
      fullContent += delta.content;
      yield { type: 'message.delta', text: delta.content, agentId: resolved.id };
    }
    if (delta.type === 'error') {
      yield { type: 'error', message: delta.error, agentId: resolved.id };
      return;
    }
    if (delta.type === 'done') {
      yield {
        type: 'message.finish',
        agentId: resolved.id,
        content: fullContent,
        tokensIn: delta.tokensIn ?? 0,
        tokensOut: delta.tokensOut ?? 0,
        model: resolved.model,
      };
    }
  }
}

// ─── Route registration ────────────────────────────────────────────────────────

export function registerPublicChatRoutes(app: FastifyInstance): void {
  const repo = new SharedLinkRepository();

  // ── Admin: CRUD for shared links ────────────────────────────────────────

  app.get('/shared-links', async () => {
    return { data: repo.list() };
  });

  app.get<{ Params: { agentId: string } }>('/shared-links/agent/:agentId', async (req) => {
    return { data: repo.listByAgent(req.params.agentId) };
  });

  app.post<{
    Body: {
      agentId: string;
      title?: string;
      welcomeMessage?: string;
      maxMessages?: number;
      expiresAt?: string;
    };
  }>('/shared-links', async (req) => {
    const { agentId, title, welcomeMessage, maxMessages, expiresAt } = req.body ?? ({} as Record<string, unknown>);
    if (!agentId) return { error: { code: 'VALIDATION', message: 'agentId required' } };
    const link = repo.create(agentId, title, welcomeMessage, maxMessages, expiresAt);
    return { data: link };
  });

  app.delete<{ Params: { id: string } }>('/shared-links/:id', async (req) => {
    repo.delete(req.params.id);
    return { data: { success: true } };
  });

  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>('/shared-links/:id/toggle', async (req) => {
    const { enabled } = req.body ?? {};
    if (enabled) repo.enable(req.params.id);
    else repo.disable(req.params.id);
    return { data: repo.findById(req.params.id) };
  });

  // ── Public: Guest chat (no auth required) ────────────────────────────────

  app.get<{ Params: { token: string } }>('/public/chat/:token', async (req, reply) => {
    const link = repo.findByToken(req.params.token);
    if (!link)
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Link not found or expired' } });

    const db = initDatabase();
    const agents = new AgentRepository(db);
    const agent = agents.getById(link.agent_id);
    const agentName = agent?.name ?? link.agent_id;
    const agentEmoji = agent?.emoji ?? '🤖';

    return {
      data: {
        title: link.title || agentName,
        agentName,
        agentEmoji,
        welcomeMessage: link.welcome_message,
      },
    };
  });

  // POST /public/chat/:token/message — send a message (streaming SSE)
  // Stricter limit: public endpoint, no auth required
  app.post<{ Params: { token: string }; Body: { content: string; guestId?: string } }>(
    '/public/chat/:token/message',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const link = repo.findByToken(req.params.token);
      if (!link)
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Link not found or expired' } });

      const { content, guestId } = req.body ?? {};
      if (!content?.trim())
        return reply
          .status(400)
          .send({ error: { code: 'VALIDATION', message: 'content required' } });

      const db = initDatabase();
      const agents = new AgentRepository(db);
      const providers = new ProviderRepository(db);
      const resolved = resolveAgent(link.agent_id, agents, providers);

      if (!resolved) {
        return reply.status(503).send({
          error: { code: 'NO_AGENT', message: 'Agent not configured or no provider available' },
        });
      }

      const historyKey = `public:${link.token}:${guestId ?? 'anon'}`;
      if (!publicChatHistory.has(historyKey)) {
        publicChatHistory.set(historyKey, []);
      }
      const history = publicChatHistory.get(historyKey)!;
      history.push({ role: 'user', content: content.trim() });

      const messages = buildChatMessages(resolved.systemPrompt, history);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        let fullResponse = '';
        for await (const event of runSession(resolved, messages)) {
          if (event.type === 'message.delta' && event.text) {
            fullResponse += event.text as string;
            reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text: event.text })}\n\n`);
          }
          if (event.type === 'message.finish') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          }
          if (event.type === 'error') {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'error', message: event.message })}\n\n`,
            );
          }
        }
        if (fullResponse) {
          history.push({ role: 'assistant', content: fullResponse });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Stream failed';
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      }

      reply.raw.end();
    },
  );
}

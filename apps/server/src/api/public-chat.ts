import type { FastifyInstance } from 'fastify';
import { SharedLinkRepository } from '../db/shared-links.js';
import { logger } from '../lib/logger.js';
import { initDatabase, AgentRepository } from '../db/index.js';
import { ProviderRepository } from '../db/providers.js';
import { resolveAgent, buildChatMessages, runSession } from '../engine/native-session-runner.js';

// ─── B054: Public Chat + Shared Links API ────────────────────────────────────

// Simple in-memory conversation store for public chats
const publicChatHistory = new Map<string, Array<{ role: string; content: string }>>();

export function registerPublicChatRoutes(app: FastifyInstance): void {
  const repo = new SharedLinkRepository();

  // ── Admin: CRUD for shared links ────────────────────────────────────────

  app.get('/shared-links', async () => {
    return { data: repo.list() };
  });

  app.get<{ Params: { agentId: string } }>('/shared-links/agent/:agentId', async (req) => {
    return { data: repo.listByAgent(req.params.agentId) };
  });

  app.post<{ Body: { agentId: string; title?: string; welcomeMessage?: string; maxMessages?: number; expiresAt?: string } }>(
    '/shared-links',
    async (req) => {
      const { agentId, title, welcomeMessage, maxMessages, expiresAt } = req.body ?? {} as Record<string, unknown>;
      if (!agentId) return { error: { code: 'VALIDATION', message: 'agentId required' } };
      const link = repo.create(agentId, title, welcomeMessage, maxMessages, expiresAt);
      return { data: link };
    },
  );

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
    if (!link) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Link not found or expired' } });

    // Get agent info from DB
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
  app.post<{ Params: { token: string }; Body: { content: string; guestId?: string } }>(
    '/public/chat/:token/message',
    async (req, reply) => {
      const link = repo.findByToken(req.params.token);
      if (!link) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Link not found or expired' } });

      const { content, guestId } = req.body ?? {};
      if (!content?.trim()) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'content required' } });

      // Resolve agent
      const db = initDatabase();
      const agents = new AgentRepository(db);
      const providers = new ProviderRepository(db);
      const resolved = resolveAgent(link.agent_id, agents, providers);

      if (!resolved) {
        return reply.status(503).send({ error: { code: 'NO_AGENT', message: 'Agent not configured or no provider available' } });
      }

      // Get or create conversation history for this guest
      const historyKey = `public:${link.token}:${guestId ?? 'anon'}`;
      if (!publicChatHistory.has(historyKey)) {
        publicChatHistory.set(historyKey, []);
      }
      const history = publicChatHistory.get(historyKey)!;
      history.push({ role: 'user', content: content.trim() });

      // Build messages
      const messages = buildChatMessages(resolved.systemPrompt, history);

      // SSE response
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
            fullResponse += event.text;
            reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text: event.text })}\n\n`);
          }
          if (event.type === 'message.finish') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          }
          if (event.type === 'error') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: event.message })}\n\n`);
          }
        }
        // Save assistant response to history
        if (fullResponse) {
          history.push({ role: 'assistant', content: fullResponse });
        }
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message ?? 'Stream failed' })}\n\n`);
      }

      reply.raw.end();
    },
  );
}

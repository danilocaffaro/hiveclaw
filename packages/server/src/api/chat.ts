// Chat API — SSE streaming + session management
import type { FastifyInstance } from 'fastify';
import { listSessions, createSession, getSession, updateSession, deleteSession, listMessages, createMessage, getAgent, getProvider } from '../db/repos.js';
import { chatStream } from '../llm/adapter.js';
import type { ChatMessage } from '../llm/adapter.js';

export function registerChatRoutes(app: FastifyInstance) {
  // ── Sessions ──────────────────────────────────────────────────────────

  app.get('/api/sessions', async () => {
    return { data: listSessions() };
  });

  app.post('/api/sessions', async (req) => {
    const { agentId } = (req.body as any) ?? {};
    const session = createSession(agentId);
    return { data: session };
  });

  app.patch('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { title } = req.body as { title: string };
    updateSession(id, title);
    return { ok: true };
  });

  app.delete('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteSession(id);
    return { ok: true };
  });

  // ── Messages ──────────────────────────────────────────────────────────

  app.get('/api/sessions/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    return { data: listMessages(id) };
  });

  // ── Chat (SSE streaming) ──────────────────────────────────────────────

  app.post('/api/chat', async (req, reply) => {
    const { sessionId, message, agentId } = req.body as { sessionId: string; message: string; agentId?: string };

    // Get or create session
    let session = getSession(sessionId);
    if (!session) {
      session = createSession(agentId);
    }

    // Get agent config
    const agent = agentId ? getAgent(agentId) : undefined;
    const provider = agent?.provider_id ? getProvider(agent.provider_id) : undefined;

    if (!provider) {
      return reply.code(400).send({ error: 'No provider configured. Complete setup first.' });
    }

    // Save user message
    createMessage({ session_id: session.id, role: 'user', content: message });

    // Build message history
    const history = listMessages(session.id);
    const chatMessages: ChatMessage[] = [];
    
    if (agent?.system_prompt) {
      chatMessages.push({ role: 'system', content: agent.system_prompt });
    }
    
    // Include recent history (last 50 messages to stay within context)
    const recentHistory = history.slice(-50);
    for (const msg of recentHistory) {
      chatMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }

    // Auto-title after first message
    if (history.length <= 1) {
      const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
      updateSession(session.id, title);
    }

    // Stream response via SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let fullResponse = '';
    
    try {
      // Send session info
      reply.raw.write(`data: ${JSON.stringify({ type: 'session', sessionId: session.id })}\n\n`);

      const stream = chatStream(chatMessages, {
        model: agent?.model ?? provider.models[0] ?? 'gpt-4o',
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
        providerType: provider.type,
        temperature: agent?.temperature ?? 0.7,
        maxTokens: agent?.max_tokens ?? 4096,
      });

      for await (const delta of stream) {
        fullResponse += delta;
        reply.raw.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      }

      // Save assistant message
      const assistantMsg = createMessage({
        session_id: session.id,
        role: 'assistant',
        content: fullResponse,
        model: agent?.model ?? provider.models[0],
      });

      reply.raw.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsg.id })}\n\n`);
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message ?? 'Stream failed' })}\n\n`);
    }

    reply.raw.end();
  });
}

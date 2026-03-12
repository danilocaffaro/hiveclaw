// ============================================================
// Sessions API — direct SessionManager integration (no bridge dependency)
// ============================================================
//
// NOTE: The bridge-based routes (openclaw-bridge.js) are preserved in bridge/
// for future OpenClaw integration.  These routes use SessionManager + runAgent
// so they work standalone, without the bridge.

import { EventEmitter } from 'events';
import type { FastifyInstance } from 'fastify';
import { getSessionManager } from '../engine/session-manager.js';
import { runAgent, serializeSSE } from '../engine/agent-runner.js';
import type { AgentConfig, SSEEvent } from '../engine/agent-runner.js';
import { runSquad } from '../engine/squad-runner.js';
import type { SquadConfig } from '../engine/squad-runner.js';
import { AgentRepository } from '../db/agents.js';
import { SquadRepository } from '../db/squads.js';
import { ProviderRepository } from '../db/providers.js';
import { initDatabase } from '../db/index.js';
import { SessionUsageRepository } from '../db/session-usage.js';
import { handoffSession } from '../engine/session-handoff.js';
import type { Agent } from '@superclaw/shared';

// ─── In-memory pub/sub for multi-listener SSE ──────────────────────────────────
//
// When POST /sessions/:id/message drives the agent loop it emits each SSEEvent
// here so that any open GET /sessions/:id/events connection also receives it.
export const sessionEvents = new EventEmitter();
sessionEvents.setMaxListeners(200);

// ─── Default agent config (used when no agent_id is provided / agent not found) ─
// Provider is resolved dynamically based on what's actually available

function getDefaultProviderId(): string {
  const db = initDatabase();
  const repo = new ProviderRepository(db);
  const available = repo.list().filter(p => p.status === 'connected');
  for (const preferred of ['anthropic', 'openai', 'github-copilot']) {
    if (available.some(p => p.id === preferred)) return preferred;
  }
  return available[0]?.id ?? 'anthropic';
}

function getDefaultModelId(providerId: string): string {
  const db = initDatabase();
  const repo = new ProviderRepository(db);
  const provider = repo.get(providerId);
  if (!provider || !provider.models.length) return 'auto'; // resolved at runtime
  const models = provider.models.map((m: { id: string }) => m.id);
  return models[0] ?? 'auto';
}

const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'id' | 'name'> = {
  systemPrompt: 'You are a helpful personal AI assistant. You can research, write, analyze data, plan, organize, and help with a wide range of tasks. Be concise, direct, and helpful.',
  providerId: 'auto', // resolved from user's first configured provider
  modelId: 'auto', // resolved from provider's first available model
  temperature: 0.7,
  maxTokens: 8192,
};

function agentRowToConfig(agent: Agent): AgentConfig {
  const resolvedProvider = (agent.providerPreference as string) || getDefaultProviderId();
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    systemPrompt: agent.systemPrompt ?? DEFAULT_AGENT_CONFIG.systemPrompt,
    providerId: resolvedProvider,
    modelId: (agent.modelPreference as string) || getDefaultModelId(resolvedProvider),
    temperature: (agent.temperature as number) ?? DEFAULT_AGENT_CONFIG.temperature,
    maxTokens: DEFAULT_AGENT_CONFIG.maxTokens,
    fallbackProviders: agent.fallbackProviders ?? [],
  };
}

// ─── Route registration ────────────────────────────────────────────────────────

export function registerSessionRoutes(app: FastifyInstance) {
  const sm = getSessionManager();
  const db = initDatabase();
  const agentRepo = new AgentRepository(db);
  const squadRepo = new SquadRepository(db);
  const usageRepo = new SessionUsageRepository(db);

  // ── GET /sessions ──────────────────────────────────────────────────────────
  app.get('/sessions', async (_req, reply) => {
    try {
      const sessions = sm.listSessions();
      return reply.send({ data: sessions });
    } catch (err) {
      return reply.status(500).send({
        error: { code: 'DB_ERROR', message: (err as Error).message },
      });
    }
  });

  // ── POST /sessions ─────────────────────────────────────────────────────────
  app.post<{
    Body: {
      title?: string;
      provider_id?: string;
      model_id?: string;
      agent_id?: string;
      mode?: string;
      squad_id?: string;
    };
  }>('/sessions', async (req, reply) => {
    try {
      const session = sm.createSession(req.body ?? {});
      return reply.status(201).send({ data: session });
    } catch (err) {
      return reply.status(500).send({
        error: { code: 'DB_ERROR', message: (err as Error).message },
      });
    }
  });

  // ── GET /sessions/:id ──────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    try {
      const data = sm.getSessionWithMessages(req.params.id);
      return reply.send({ data });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: msg } });
    }
  });

  // ── GET /sessions/:id/messages ─────────────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>('/sessions/:id/messages', async (req, reply) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;
    try {
      const messages = sm.getMessages(req.params.id, { limit, offset });
      return reply.send({ data: messages });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: msg } });
    }
  });

  // ── GET /sessions/:id/usage ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/sessions/:id/usage', async (req, reply) => {
    try {
      const session = sm.getSession(req.params.id);
      if (!session) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Session not found: ${req.params.id}` },
        });
      }
      const summary = usageRepo.getBySession(req.params.id);
      return reply.send({ data: summary });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: msg } });
    }
  });

  // ── PATCH /sessions/:id ────────────────────────────────────────────────────
  app.patch<{
    Params: { id: string };
    Body: Partial<{ title: string; provider_id: string; model_id: string; agent_id: string; mode: string; squad_id: string }>;
  }>('/sessions/:id', async (req, reply) => {
    try {
      const { id } = req.params;
      const updates = req.body ?? {};
      const updated = sm.updateSession(id, updates);
      // Broadcast session.updated so open SSE connections reflect the change
      sessionEvents.emit(`session:${id}`, {
        event: 'session.updated',
        data: { sessionId: id, ...updates },
      });
      return reply.send({ data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: msg } });
    }
  });

  // ── DELETE /sessions/:id ───────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    try {
      sm.deleteSession(req.params.id);
      return reply.status(204).send();
    } catch (err) {
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: (err as Error).message } });
    }
  });

  // ── POST /sessions/:id/compact ─────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/sessions/:id/compact', async (req, reply) => {
    try {
      sm.compactSession(req.params.id);
      return reply.send({ data: { ok: true } });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      return reply.status(500).send({ error: { code: 'DB_ERROR', message: msg } });
    }
  });

  // ── POST /sessions/:id/handoff ──────────────────────────────────────────────
  //
  // Transfer a session from its current agent to another agent, preserving
  // conversation context.  A system message is injected and the message bus
  // notifies the receiving agent.
  app.post<{
    Params: { id: string };
    Body: { toAgentId: string; reason?: string; contextSummary?: string };
  }>('/sessions/:id/handoff', async (req, reply) => {
    const { toAgentId, reason, contextSummary } = req.body ?? {};
    if (!toAgentId) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'toAgentId is required' },
      });
    }

    // Look up the session to get the current agent_id as fromAgentId
    const session = sm.getSession(req.params.id);
    if (!session) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Session not found: ${req.params.id}` },
      });
    }

    const fromAgentId = session.agent_id;
    if (!fromAgentId) {
      return reply.status(400).send({
        error: { code: 'HANDOFF_FAILED', message: 'Session has no current agent assigned' },
      });
    }

    const result = handoffSession({
      sessionId: req.params.id,
      fromAgentId,
      toAgentId,
      reason,
      contextSummary,
    });

    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'HANDOFF_FAILED', message: result.message },
      });
    }

    return { data: result };
  });

  // ── POST /sessions/:id/message ─────────────────────────────────────────────
  //
  // This is the CRITICAL endpoint: accepts a user message, runs the agent loop,
  // and streams SSE events back to the caller.  Named events are used so the
  // frontend EventSource listeners fire correctly.
  //
  // Simultaneously emits each event on `sessionEvents` so that any open
  // GET /sessions/:id/events connections also receive the stream.
  app.post<{
    Params: { id: string };
    Body: { content: string; agent_id?: string };
  }>('/sessions/:id/message', async (req, reply) => {
    const { id } = req.params;
    const { content, agent_id } = req.body ?? {};

    if (!content || typeof content !== 'string' || content.trim() === '') {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: '`content` is required and must be a non-empty string' },
      });
    }

    // Verify session exists before starting
    const sessionRow = sm.getSession(id);
    if (!sessionRow) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Session not found: ${id}` } });
    }

    // Resolve agent config
    let agentConfig: AgentConfig;
    const agentId = agent_id ?? sessionRow.agent_id;
    if (agentId) {
      const agentRow = agentRepo.getById(agentId);
      agentConfig = agentRow
        ? agentRowToConfig(agentRow)
        : { id: agentId, name: 'SuperClaw', ...DEFAULT_AGENT_CONFIG, providerId: getDefaultProviderId(), modelId: getDefaultModelId(getDefaultProviderId()) };
    } else {
      const defaultPid = getDefaultProviderId();
      agentConfig = { id: 'default', name: 'SuperClaw', ...DEFAULT_AGENT_CONFIG, providerId: defaultPid, modelId: getDefaultModelId(defaultPid) };
    }

    // ── Squad routing ──────────────────────────────────────────────────────────
    // When the session has a squad_id, delegate to the squad runner instead of
    // the single-agent runner.
    if (sessionRow.squad_id) {
      const squadRow = squadRepo.getById(sessionRow.squad_id);
      if (squadRow) {
        const squadAgents = ((squadRow.agentIds ?? []) as string[])
          .map((aid: string) => agentRepo.getById(aid))
          .filter((a): a is Agent => a !== null)
          .map((a: Agent) => agentRowToConfig(a));

        // Map shared Squad routing strategies to squad-runner strategies.
        // 'auto' → 'specialist', 'manual' → 'sequential', unknown → 'round-robin'
        const strategyMap: Record<string, SquadConfig['routingStrategy']> = {
          'auto':         'specialist',
          'round-robin':  'round-robin',
          'manual':       'sequential',
          'specialist':   'specialist',
          'debate':       'debate',
          'sequential':   'sequential',
        };
        const routingStrategy: SquadConfig['routingStrategy'] =
          strategyMap[squadRow.routingStrategy] ?? 'round-robin';

        // Inject squad context into each agent's system prompt so they know
        // about the squad, its members, and the routing strategy.
        const squadContextBlock = [
          `\n\n--- Squad Context ---`,
          `You are part of the "${squadRow.name}" squad (id: ${squadRow.id}).`,
          `Routing strategy: ${routingStrategy}.`,
          `Squad members (${squadAgents.length}):`,
          ...squadAgents.map((a) => `  - ${a.emoji ?? '🤖'} ${a.name} (${a.id.slice(0, 8)}): role=${(a as AgentConfig & { role?: string }).role ?? 'agent'}`),
          `You may refer to other squad members by name when relevant.`,
          `--- End Squad Context ---`,
        ].join('\n');

        const squadAgentsWithContext = (squadAgents.length > 0 ? squadAgents : [agentConfig])
          .map((a) => ({ ...a, systemPrompt: a.systemPrompt + squadContextBlock }));

        const squadConfig: SquadConfig = {
          id: squadRow.id,
          name: squadRow.name,
          agents: squadAgentsWithContext,
          routingStrategy,
          debateEnabled: squadRow.debateEnabled ?? false,
          maxDebateRounds: 3,
        };

        // Set SSE response headers
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        });

        const emit = (event: SSEEvent) => {
          const wire = serializeSSE(event);
          reply.raw.write(wire);
          sessionEvents.emit(`session:${id}`, event);
        };

        try {
          for await (const event of runSquad(id, content.trim(), squadConfig)) {
            emit(event);
          }
        } catch (err) {
          emit({ event: 'error', data: { message: (err as Error).message, code: 'SQUAD_ERROR' } });
        }

        reply.raw.end();
        return; // Don't fall through to single-agent
      }
    }

    // Set SSE response headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    // Emit helper — writes named SSE event to this response AND pub/sub
    const emit = (event: SSEEvent) => {
      const wire = serializeSSE(event);
      reply.raw.write(wire);
      // Broadcast to /events subscribers
      sessionEvents.emit(`session:${id}`, event);
    };

    try {
      for await (const event of runAgent(id, content.trim(), agentConfig)) {
        emit(event);
      }
    } catch (err) {
      const errEvent: SSEEvent = {
        event: 'error',
        data: { message: (err as Error).message, code: 'AGENT_ERROR' },
      };
      emit(errEvent);
    }

    reply.raw.end();
  });

  // ── GET /sessions/:id/events ───────────────────────────────────────────────
  //
  // Persistent SSE connection.  Subscribes to sessionEvents pub/sub so that
  // when POST /sessions/:id/message runs the agent, all events are forwarded here.
  app.get<{ Params: { id: string } }>('/sessions/:id/events', async (req, reply) => {
    const { id } = req.params;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    // Initial connection event (generic `data:` — not a named event type the frontend uses)
    reply.raw.write(`:ok\n\n`);

    const listener = (event: SSEEvent) => {
      reply.raw.write(serializeSSE(event));
    };

    sessionEvents.on(`session:${id}`, listener);

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      reply.raw.write(`:heartbeat\n\n`);
    }, 15_000);

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      sessionEvents.off(`session:${id}`, listener);
    });

    // Keep the connection open until the client disconnects
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
      req.raw.on('error', resolve);
    });
  });
}

// ============================================================
// Sessions API — direct SessionManager integration
// ============================================================
//
// These routes handle session CRUD and real-time streaming (SSE)
// using the native engine. No external dependencies needed.

import { EventEmitter } from 'events';
import type { FastifyInstance } from 'fastify';
import { getEngineService } from '../engine/engine-service.js';
import type { AgentConfig, SSEEvent, SquadConfig } from '../engine/engine-service.js';
import { AgentRepository } from '../db/agents.js';
import { SquadRepository } from '../db/squads.js';
import { ProviderRepository } from '../db/providers.js';
import { initDatabase } from '../db/index.js';
import { SessionUsageRepository } from '../db/session-usage.js';
import type { Agent } from '@hiveclaw/shared';
import { ExternalAgentRepository } from '../db/external-agents.js';
import { SquadMemberRepository } from '../db/squad-members.js';
import { broadcastSSE } from './sse.js';

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
  for (const preferred of ['anthropic', 'openai', 'google', 'openrouter', 'github-copilot', 'deepseek', 'groq', 'mistral']) {
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
  const isShadow = (agent as unknown as Record<string, unknown>).is_shadow === 1;
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    systemPrompt: agent.systemPrompt ?? DEFAULT_AGENT_CONFIG.systemPrompt,
    providerId: resolvedProvider,
    modelId: (agent.modelPreference as string) || getDefaultModelId(resolvedProvider),
    temperature: (agent.temperature as number) ?? DEFAULT_AGENT_CONFIG.temperature,
    maxTokens: DEFAULT_AGENT_CONFIG.maxTokens,
    maxToolIterations: (agent as unknown as Record<string, unknown>).max_tool_iterations as number | undefined,
    skills: agent.skills ?? [],
    fallbackProviders: agent.fallbackProviders ?? [],
    engineVersion: agent.engineVersion ?? 1,
    isShadow,
    federationLinkId: isShadow ? (agent as unknown as Record<string, unknown>).federation_link_id as string : undefined,
    remoteAgentId: isShadow ? (agent as unknown as Record<string, unknown>).remote_agent_id as string : undefined,
  };
}

// ─── Route registration ────────────────────────────────────────────────────────

export function registerSessionRoutes(app: FastifyInstance) {
  const sm = getEngineService().sessions.getManager();
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
      agentId?: string; // camelCase alias — normalised to agent_id below
      mode?: string;
      squad_id?: string;
      squadId?: string; // camelCase alias — normalised to squad_id below
    };
  }>('/sessions', async (req, reply) => {
    try {
      const body = req.body ?? {};
      // Normalise camelCase → snake_case so frontend sending agentId/squadId still works
      const normalised = {
        ...body,
        agent_id: body.agent_id ?? body.agentId ?? '',
        squad_id: body.squad_id ?? body.squadId ?? '',
      };
      const session = sm.createSession(normalised);
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

  // ── GET /sessions/:id/context-usage ──────────────────────────────────────────
  // B27: Context usage meter — returns tokens used, context window, cost, etc.
  app.get<{ Params: { id: string } }>('/sessions/:id/context-usage', async (req, reply) => {
    try {
      const session = sm.getSession(req.params.id);
      if (!session) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Session not found: ${req.params.id}` },
        });
      }

      // 1. Get usage summary (tokens + cost)
      const summary = usageRepo.getBySession(req.params.id);

      // 2. Get message count
      const messages = sm.getMessages(req.params.id, { limit: 100_000 });
      const messageCount = messages.length;

      // 3. Resolve model context window
      const providerRepo = new ProviderRepository(db);
      const providerId = session.provider_id || 'anthropic';
      const modelId = session.model_id || '';
      let contextWindow = 200_000; // sensible default
      let resolvedModel = modelId;

      // Try to find the model in the provider's model catalog
      const provider = providerRepo.get(providerId);
      if (provider) {
        const model = provider.models.find((m) => m.id === modelId);
        if (model) {
          contextWindow = model.contextWindow;
          resolvedModel = model.name || model.id;
        } else if (provider.models.length > 0) {
          // If model_id not found directly, search across all providers
          const allModels = providerRepo.allModels();
          const found = allModels.find((m) => m.id === modelId);
          if (found) {
            contextWindow = found.contextWindow;
            resolvedModel = found.name || found.id;
          }
        }
      } else {
        // Search across all providers
        const allModels = providerRepo.allModels();
        const found = allModels.find((m) => m.id === modelId);
        if (found) {
          contextWindow = found.contextWindow;
          resolvedModel = found.name || found.id;
        }
      }

      // 4. Calculate totals — tokensUsed is input tokens (what fills the context window)
      const tokensUsed = summary.totalTokensIn;
      const percentUsed = contextWindow > 0
        ? Math.round((tokensUsed / contextWindow) * 1000) / 10
        : 0;

      // 5. Can compact? Session must have enough messages
      const canCompact = messageCount >= 20;

      return reply.send({
        data: {
          tokensUsed,
          contextWindow,
          percentUsed,
          messageCount,
          costUsd: summary.totalCost,
          model: resolvedModel,
          canCompact,
        },
      });
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

    const result = getEngineService().sessions.handoff({
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

  // ── POST /sessions/:id/cancel ───────────────────────────────────────────────
  //
  // P1: Cancel an active agent run. Triggers AbortController, which propagates
  // to the adapter fetch() and tool loop. Partial response is persisted.
  app.post<{ Params: { id: string } }>('/sessions/:id/cancel', async (req, reply) => {
    const { id } = req.params;
    const cancelled = getEngineService().sessions.cancelRun(id);
    if (cancelled) {
      return { data: { cancelled: true, message: 'Run cancelled' } };
    }
    return reply.status(404).send({ error: { code: 'NO_ACTIVE_RUN', message: 'No active run for this session' } });
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
    Body: { content: string; agent_id?: string; sender?: { id?: string; name?: string; emoji?: string; type?: string } };
  }>('/sessions/:id/message', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params;
    const { content, agent_id, sender: senderBody } = req.body ?? {};

    // Sprint C: Resolve sender identity
    // R15: If request was authenticated via agent bearer token, use agent identity
    const agentAuth = (req as unknown as Record<string, unknown>).agentAuth as
      { id: string; name: string; emoji: string; type: string } | undefined;

    // If sender field provided (e.g., from external agent or identified client), use it.
    // Agent bearer token overrides any sender field in body.
    const sender = agentAuth
      ? { id: agentAuth.id, name: agentAuth.name, emoji: agentAuth.emoji, type: 'agent' }
      : {
          id: senderBody?.id ?? 'user',
          name: senderBody?.name ?? '',
          emoji: senderBody?.emoji ?? '',
          type: senderBody?.type ?? 'human',
        };

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

    // Resolve agent config — check local agents first, then external agents
    let agentConfig: AgentConfig;
    const agentId = agent_id ?? sessionRow.agent_id;
    if (agentId) {
      const agentRow = agentRepo.getById(agentId);
      if (agentRow) {
        agentConfig = agentRowToConfig(agentRow);
      } else {
        // Fallback: check external_agents table (e.g., Alice 🐕 via webhook)
        const extAgentRepo = new ExternalAgentRepository(db);
        const extAgent = extAgentRepo.getById(agentId);
        if (extAgent && extAgent.status === 'active') {
          agentConfig = {
            id: extAgent.id,
            name: extAgent.name,
            emoji: extAgent.emoji,
            systemPrompt: '',
            providerId: '__external__',
            modelId: '__external__',
            temperature: 0.7,
            maxTokens: 4096,
            role: extAgent.role,
            isExternal: true,
            webhookUrl: extAgent.webhookUrl,
            outboundToken: extAgent.outboundToken,
            tier: extAgent.tier,
          } as AgentConfig & { isExternal: boolean; webhookUrl: string; outboundToken: string; tier: string };
        } else {
          agentConfig = { id: agentId, name: 'HiveClaw', ...DEFAULT_AGENT_CONFIG, providerId: getDefaultProviderId(), modelId: getDefaultModelId(getDefaultProviderId()) };
        }
      }
    } else {
      const defaultPid = getDefaultProviderId();
      agentConfig = { id: 'default', name: 'HiveClaw', ...DEFAULT_AGENT_CONFIG, providerId: defaultPid, modelId: getDefaultModelId(defaultPid) };
    }

    // ── Squad routing ──────────────────────────────────────────────────────────
    // When the session has a squad_id, delegate to the squad runner instead of
    // the single-agent runner.
    if (sessionRow.squad_id) {
      const squadRow = squadRepo.getById(sessionRow.squad_id);
      if (squadRow) {
        // S3: Resolve agents from squad_members (with position), fallback to agent_ids JSON
        const extAgentRepo = new ExternalAgentRepository(db);
        const smRepo = new SquadMemberRepository(db);
        const members = smRepo.listBySquad(squadRow.id);
        // Use squad_members if populated (already ordered by position), else fallback to JSON
        const agentIdList = members.length > 0
          ? members.map(m => m.agentId)
          : (squadRow.agentIds ?? []) as string[];
        const squadAgents: AgentConfig[] = [];
        for (const aid of agentIdList) {
          // Try local agent first
          const localAgent = agentRepo.getById(aid);
          if (localAgent) {
            squadAgents.push(agentRowToConfig(localAgent));
            continue;
          }
          // Try external agent
          const extAgent = extAgentRepo.getById(aid);
          if (extAgent && extAgent.status === 'active') {
            squadAgents.push({
              id: extAgent.id,
              name: extAgent.name,
              emoji: extAgent.emoji,
              systemPrompt: '', // External agents have their own prompts
              providerId: '__external__',
              modelId: '__external__',
              temperature: 0.7,
              maxTokens: 4096,
              role: extAgent.role,
              isExternal: true,
              webhookUrl: extAgent.webhookUrl,
              outboundToken: extAgent.outboundToken,
              tier: extAgent.tier,
            } as AgentConfig & { isExternal: boolean; webhookUrl: string; outboundToken: string; tier: string });
          }
        }

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
          const wire = getEngineService().sessions.serializeSSE(event);
          reply.raw.write(wire);
          sessionEvents.emit(`session:${id}`, event);
        };

        try {
          for await (const event of getEngineService().sessions.runSquad(id, content.trim(), squadConfig, { sender })) {
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
      const wire = getEngineService().sessions.serializeSSE(event);
      reply.raw.write(wire);
      // Broadcast to /events subscribers
      sessionEvents.emit(`session:${id}`, event);
    };

    try {
      // ── External agent routing (1:1 chat) ──────────────────────────────────
      // When the resolved agent is external (webhook-based, e.g. Alice 🐕),
      // route through the external-agent-bridge instead of the local LLM runner.
      const extConfig = agentConfig as AgentConfig & { isExternal?: boolean; webhookUrl?: string; outboundToken?: string; tier?: string };
      if (extConfig.isExternal && extConfig.webhookUrl) {
        const { dispatchToExternalAgent } = await import('../engine/external-agent-bridge.js');
        const extAgentRepo = new ExternalAgentRepository(db);
        const extAgent = extAgentRepo.getById(agentConfig.id);
        if (extAgent) {
          // Persist user message
          sm.addMessage(id, { role: 'user', content: content.trim(), agent_id: sender.id, agent_name: sender.name, agent_emoji: sender.emoji, sender_type: sender.type as 'human' | 'agent' | 'external_agent' });

          emit({ event: 'message.start', data: { agentId: agentConfig.id, agentName: agentConfig.name, agentEmoji: agentConfig.emoji } });

          const callbackBaseUrl = `http://localhost:${process.env.PORT ?? 4070}`;
          const responseText = await dispatchToExternalAgent(extAgent, {
            squadId: 'direct',
            squadName: 'Direct Chat',
            members: [{ name: extAgent.name, emoji: extAgent.emoji, role: extAgent.role, isExternal: true }],
            userMessage: content.trim(),
            senderName: sender.name || 'User',
            previousResponses: [],
            turnNumber: 1,
            totalTurns: 1,
            wasMentioned: true,
          }, callbackBaseUrl);

          // Persist assistant response
          sm.addMessage(id, { role: 'assistant', content: responseText, agent_id: extAgent.id, agent_name: extAgent.name, agent_emoji: extAgent.emoji, sender_type: 'external_agent' });

          // Stream response as SSE events
          emit({ event: 'message.delta', data: { text: responseText } });
          emit({ event: 'message.finish', data: { text: responseText, finishReason: 'stop' } });
        } else {
          emit({ event: 'error', data: { message: 'External agent not found', code: 'AGENT_NOT_FOUND' } });
        }
        reply.raw.end();
        return;
      }

      for await (const event of getEngineService().sessions.runAgent(id, content.trim(), agentConfig, { sender })) {
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
      reply.raw.write(getEngineService().sessions.serializeSSE(event));
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

// ============================================================
// Squad Runner — Multi-agent orchestration engine for SuperClaw
// ============================================================
//
// Routing strategies:
//   round-robin  — rotate through agents one at a time
//   specialist   — coordinator picks the best agent for the task
//   debate       — all agents respond, debate, then converge on resolution
//   sequential   — agents process in order, each building on the previous
//
// v2: Uses AgentWorkerPool + MessageBus + TurnManager when available,
//     falls back to direct runAgent() calls for backward compatibility.
//
// NOTE: This file is intentionally kept as a single module (~590 lines).
// All 4 routing strategies share the same SquadContext, StrategyResult,
// and TurnState types plus common helper functions. Splitting would
// introduce a circular-dependency graph or require duplicating the shared
// types across 4+ files with no readability gain.

import type { AgentConfig, SSEEvent } from './agent-runner.js';
import { runAgent } from './agent-runner.js';
import { getSessionManager } from './session-manager.js';
import { getProviderRouter } from './providers/index.js';
import type { LLMMessage } from './providers/types.js';
import { getWorkerPool } from './agent-worker-pool.js';
import { getMessageBus } from './message-bus.js';
import { TurnManager } from './turn-manager.js';
import type { AgentWorker } from './agent-worker.js';
import { logger } from '../lib/logger.js';
import { dispatchToExternalAgent, type SquadMessageContext } from './external-agent-bridge.js';
import { ExternalAgentRepository } from '../db/external-agents.js';
import { initDatabase } from '../db/index.js';

// ─── Squad Config ─────────────────────────────────────────────────────────────

export interface SquadConfig {
  id: string;
  name: string;
  agents: AgentConfig[];
  routingStrategy: 'round-robin' | 'specialist' | 'debate' | 'sequential';
  debateEnabled: boolean;
  maxDebateRounds: number;
}

// ─── Debate Types ─────────────────────────────────────────────────────────────

export interface DebateRound {
  round: number;
  positions: Array<{
    agentId: string;
    agentName: string;
    agentEmoji: string;
    position: string;
    confidence: number; // 0-100
  }>;
}

export interface DebateResult {
  topic: string;
  rounds: DebateRound[];
  resolution: string;
  resolvedBy: string; // agent ID that resolved
  totalRounds: number;
}

// ─── Internal position accumulator ───────────────────────────────────────────

interface AgentPosition {
  agentId: string;
  name: string;
  emoji: string;
  response: string;
  confidence: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Try to get-or-spawn a worker for an agent config.
 * Returns the worker if the pool is available, or undefined to signal fallback.
 */
function tryGetWorker(config: AgentConfig): AgentWorker | undefined {
  try {
    const pool = getWorkerPool();
    if (pool.list().length === 0 && !pool.get(config.id)) {
      // Pool is empty and this agent isn't spawned — try to spawn it
      return pool.spawn({
        id: config.id,
        name: config.name,
        emoji: config.emoji,
        systemPrompt: config.systemPrompt,
        providerId: config.providerId,
        modelId: config.modelId,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    }
    return pool.getOrSpawn({
      id: config.id,
      name: config.name,
      emoji: config.emoji,
      systemPrompt: config.systemPrompt,
      providerId: config.providerId,
      modelId: config.modelId,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
  } catch {
    return undefined;
  }
}

/**
 * Check if an agent is external (providerId === '__external__') and if so,
 * dispatch via webhook instead of running locally.
 * Returns an async generator that yields SSE events, or null if not external.
 */
function isExternalAgent(agent: AgentConfig): boolean {
  return agent.providerId === '__external__' || (agent as unknown as Record<string, unknown>).isExternal === true;
}

async function* runExternalAgent(
  sessionId: string,
  message: string,
  agent: AgentConfig,
  config: SquadConfig,
  previousResponses: Array<{ agentId: string; name: string; emoji: string; text: string }> = [],
  turnNumber = 1,
): AsyncGenerator<SSEEvent> {
  const db = initDatabase();
  const extRepo = new ExternalAgentRepository(db);
  const extAgent = extRepo.getById(agent.id);

  if (!extAgent) {
    yield { event: 'message.delta', data: { text: `⚠️ External agent ${agent.name} not found in registry`, agentId: agent.id } };
    return;
  }

  yield {
    event: 'message.delta',
    data: { text: `\n\n**${agent.emoji ?? '🤖'} ${agent.name}** _(external, ${extAgent.tier})_\n\n`, agentId: agent.id, isHeader: true },
  };

  const ctx: SquadMessageContext = {
    squadId: config.id,
    squadName: config.name,
    members: config.agents.map(a => ({
      name: a.name,
      emoji: a.emoji ?? '🤖',
      role: (a as unknown as Record<string, unknown>).role as string ?? 'member',
      isExternal: isExternalAgent(a),
    })),
    userMessage: message,
    senderName: 'User',
    previousResponses: previousResponses.map(r => ({
      agentName: r.name,
      agentEmoji: r.emoji,
      text: r.text,
    })),
    turnNumber,
    totalTurns: config.agents.length,
    wasMentioned: true,
  };

  const baseUrl = process.env.SUPERCLAW_PUBLIC_URL ?? 'http://localhost:4070';
  const response = await dispatchToExternalAgent(extAgent, ctx, baseUrl);

  yield {
    event: 'message.delta',
    data: { text: response, agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji },
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function* runSquad(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  // Guard: need at least one agent
  if (!config.agents || config.agents.length === 0) {
    yield {
      event: 'error',
      data: { message: 'Squad has no agents configured', code: 'NO_AGENTS' },
    };
    return;
  }

  // Emit squad start
  yield {
    event: 'message.start',
    data: { sessionId, squadId: config.id, mode: config.routingStrategy },
  };

  // Publish squad start to message bus
  const bus = getMessageBus();
  bus.publish({
    from: 'system',
    to: `squad.${config.id}`,
    type: 'broadcast',
    content: JSON.stringify({ event: 'squad.start', message, strategy: config.routingStrategy }),
    metadata: { sessionId, squadId: config.id, priority: 1, timestamp: Date.now() },
  });

  switch (config.routingStrategy) {
    case 'round-robin':
      yield* runRoundRobin(sessionId, message, config);
      break;
    case 'specialist':
      yield* runSpecialist(sessionId, message, config);
      break;
    case 'debate':
      yield* runDebate(sessionId, message, config);
      break;
    case 'sequential':
      yield* runSequential(sessionId, message, config);
      break;
    default: {
      // Fallback: treat unknown strategies as round-robin
      const strategy = (config as SquadConfig).routingStrategy;
      logger.warn(`[SquadRunner] Unknown routing strategy "${strategy}", falling back to round-robin`);
      yield* runRoundRobin(sessionId, message, config);
    }
  }

  // Publish squad end to message bus
  bus.publish({
    from: 'system',
    to: `squad.${config.id}`,
    type: 'broadcast',
    content: JSON.stringify({ event: 'squad.end' }),
    metadata: { sessionId, squadId: config.id, priority: 1, timestamp: Date.now() },
  });
}

// ─── Routing Strategy: Round-Robin ───────────────────────────────────────────
//
// Uses TurnManager('round-robin') to pick the next agent. Falls back to
// direct runAgent() if worker pool is unavailable.

async function* runRoundRobin(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  const sm = getSessionManager();
  const session = sm.getSession(sessionId);

  // Find the last agent used in this session
  const lastAgentIdx = session?.agent_id
    ? config.agents.findIndex((a) => a.id === session.agent_id)
    : -1;

  const nextIdx = (lastAgentIdx + 1) % config.agents.length;
  const agent = config.agents[nextIdx];

  // Try worker-based execution
  const worker = tryGetWorker(agent);
  if (worker) {
    const turnMgr = new TurnManager(
      config.agents.map((a) => a.id),
      'round-robin',
    );
    // Advance turn manager to match the current index
    for (let i = 0; i < nextIdx; i++) {
      turnMgr.recordTurn(config.agents[i].id);
    }
    if (turnMgr.canSpeak(agent.id)) {
      turnMgr.recordTurn(agent.id);
    }
    yield* worker.processUserMessage(sessionId, message);
    return;
  }

  // Fallback: direct runAgent() or external dispatch
  if (isExternalAgent(agent)) {
    yield* runExternalAgent(sessionId, message, agent, config);
  } else {
    yield* runAgent(sessionId, message, agent);
  }
}

// ─── Routing Strategy: Specialist ────────────────────────────────────────────
//
// Uses TurnManager('moderated') with coordinator as moderator.
// Coordinator picks the best specialist, then routes message to that agent.

async function* runSpecialist(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  const coordinator = config.agents[0];
  const router = getProviderRouter();

  // Set up moderated turn manager (coordinator = moderator = first agent)
  const turnMgr = new TurnManager(
    config.agents.map((a) => a.id),
    'moderated',
  );

  const agentList = config.agents
    .map((a) => `- ${a.name} (id: ${a.id}): ${a.systemPrompt.slice(0, 100)}`)
    .join('\n');

  const routingPrompt =
    `You are a routing coordinator. Given the user's request below, pick the single best agent to handle it.\n\n` +
    `Available agents:\n${agentList}\n\n` +
    `Reply with ONLY the agent ID (the part after "id: "), nothing else.\n\n` +
    `User request: ${message}`;

  const provider = router.get(coordinator.providerId) ?? router.getDefault();
  if (!provider) {
    yield { event: 'error', data: { message: 'No provider available for routing', code: 'NO_PROVIDER' } };
    return;
  }

  // Non-streaming routing call — collect full response
  let pickedId = '';
  try {
    const routingMessages: LLMMessage[] = [{ role: 'user', content: routingPrompt }];
    for await (const chunk of router.chatWithFallback(routingMessages, {
      model: coordinator.modelId,
      maxTokens: 50,
      temperature: 0,
    }, [coordinator.providerId])) {
      if (chunk.type === 'text') pickedId += chunk.text;
    }
    // Record coordinator's turn
    turnMgr.recordTurn(coordinator.id, 'delegate');
  } catch (err) {
    logger.warn('[SquadRunner] Routing call failed, using first agent: %s', (err as Error).message);
  }

  // Match picked agent by ID substring (LLM may include extra whitespace)
  const trimmed = pickedId.trim();
  const picked =
    config.agents.find((a) => trimmed === a.id || trimmed.includes(a.id)) ??
    config.agents[0];

  // Delegate turn to picked agent
  turnMgr.delegateTo(picked.id);

  // Emit routing decision as tool events (visible in the UI)
  yield {
    event: 'tool.start',
    data: {
      name: 'squad_route',
      input: { picked: picked.name, agent_id: picked.id, reason: `Routed to ${picked.name}` },
    },
  };
  yield {
    event: 'tool.finish',
    data: {
      name: 'squad_route',
      output: `Routing to ${picked.name} (${picked.id})`,
    },
  };

  // Publish routing decision to message bus
  const bus = getMessageBus();
  bus.publish({
    from: coordinator.id,
    to: picked.id,
    type: 'delegate',
    content: message,
    metadata: { sessionId, squadId: config.id, priority: 2, timestamp: Date.now() },
  });

  // Try worker-based execution
  const worker = tryGetWorker(picked);
  if (worker) {
    turnMgr.recordTurn(picked.id);
    yield* worker.processUserMessage(sessionId, message);
    return;
  }

  // Fallback: direct runAgent()
  yield* runAgent(sessionId, message, picked);
}

// ─── Routing Strategy: Debate ─────────────────────────────────────────────────
//
// Uses TurnManager('consensus') so all agents can propose/vote.
// Phase 1: All agents provide independent positions.
// Phase 2: Emit a structured debate card with all positions.
// Phase 3: The most-confident agent synthesises a final resolution.

async function* runDebate(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  const router = getProviderRouter();
  const bus = getMessageBus();
  const positions: AgentPosition[] = [];

  // Set up consensus turn manager
  const turnMgr = new TurnManager(
    config.agents.map((a) => a.id),
    'consensus',
    config.maxDebateRounds || 3,
  );

  // ── Phase 1: Collect initial positions ─────────────────────────────────────
  for (const agent of config.agents) {
    if (turnMgr.isComplete) break;

    yield {
      event: 'message.start',
      data: { sessionId, agentId: agent.id, agentName: agent.name, phase: 'initial' },
    };

    // Try worker-based execution for collecting position
    const worker = tryGetWorker(agent);
    let response = '';

    if (worker) {
      // Worker-based: use processUserMessage and collect text
      const debatePrompt =
        `${message}\n\nProvide your position on this. Be concise and direct. ` +
        `End your response with exactly "Confidence: X%" where X is a number from 0 to 100.`;

      for await (const event of worker.processUserMessage(sessionId, debatePrompt)) {
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string') {
            response += d.text;
          }
        }
        yield event;
      }
      turnMgr.recordTurn(agent.id, 'propose');
    } else {
      // Fallback: direct provider call
      const provider = router.get(agent.providerId) ?? router.getDefault();
      if (!provider) {
        logger.warn(`[SquadRunner] No provider for agent ${agent.id}, skipping`);
        continue;
      }

      const debateMessages: LLMMessage[] = [
        { role: 'system', content: agent.systemPrompt },
        {
          role: 'user',
          content:
            `${message}\n\nProvide your position on this. Be concise and direct. ` +
            `End your response with exactly "Confidence: X%" where X is a number from 0 to 100.`,
        },
      ];

      try {
        for await (const chunk of router.chatWithFallback(debateMessages, {
          model: agent.modelId,
          maxTokens: 1000,
          temperature: 0.8,
        }, [agent.providerId])) {
          if (chunk.type === 'text') {
            response += chunk.text;
            yield { event: 'message.delta', data: { text: chunk.text, agentId: agent.id } };
          }
        }
        turnMgr.recordTurn(agent.id, 'propose');
      } catch (err) {
        logger.warn(`[SquadRunner] Agent ${agent.id} debate phase failed: %s`, (err as Error).message);
        yield { event: 'message.delta', data: { text: `\n[${agent.name} failed to respond]\n`, agentId: agent.id } };
      }
    }

    // Parse confidence from response
    const confMatch = response.match(/Confidence:\s*(\d+)%/i);
    const confidence = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1], 10))) : 70;

    const emoji = agent.emoji ?? '🤖';
    positions.push({ agentId: agent.id, name: agent.name, emoji, response, confidence });

    // Publish position to message bus
    bus.publish({
      from: agent.id,
      to: `squad.${config.id}`,
      type: 'broadcast',
      content: JSON.stringify({ phase: 'position', confidence, response: response.slice(0, 200) }),
      metadata: { sessionId, squadId: config.id, priority: 1, timestamp: Date.now() },
    });

    yield { event: 'message.finish', data: { agentId: agent.id, confidence } };
  }

  if (positions.length === 0) {
    yield { event: 'error', data: { message: 'All agents failed during debate phase', code: 'DEBATE_FAILED' } };
    return;
  }

  // ── Phase 2: Emit structured debate card ───────────────────────────────────
  const debateCardData = {
    topic: message.slice(0, 100),
    status: 'active' as const,
    participants: positions.map((p) => ({
      name: p.name,
      emoji: p.emoji,
      position: p.response.slice(0, 150),
      confidence: p.confidence,
    })),
    rounds: turnMgr.round,
  };

  yield {
    event: 'message.delta',
    data: { text: `\n\n:::debate${JSON.stringify(debateCardData)}:::\n\n` },
  };

  // ── Phase 3: Resolution ────────────────────────────────────────────────────
  // Highest-confidence agent synthesises the final answer
  const sorted = [...positions].sort((a, b) => b.confidence - a.confidence);
  const highestConf = sorted[0];

  const otherPositions = positions
    .filter((p) => p.agentId !== highestConf.agentId)
    .map((p) => `${p.name}: ${p.response.slice(0, 200)}`)
    .join('\n\n');

  const resolutionPrompt =
    `You are ${highestConf.name}. You had the highest confidence in the debate.\n` +
    `Other agents' positions:\n${otherPositions}\n\n` +
    `Synthesize a final resolution that incorporates the best insights from all positions. Be concise and definitive.`;

  const resolverAgent = config.agents.find((a) => a.id === highestConf.agentId) ?? config.agents[0];
  const resolverWorker = tryGetWorker(resolverAgent);

  if (resolverWorker) {
    yield {
      event: 'message.start',
      data: { sessionId, phase: 'resolution', resolvedBy: highestConf.agentId },
    };

    for await (const event of resolverWorker.processUserMessage(sessionId, resolutionPrompt)) {
      if (event.event === 'message.delta' || event.event === 'message.finish') {
        yield event;
      }
    }
    turnMgr.recordTurn(highestConf.agentId, 'speak');
  } else {
    // Fallback: direct provider call
    const resolverProvider =
      router.get(resolverAgent.providerId) ??
      router.get(config.agents[0].providerId) ??
      router.getDefault();

    if (resolverProvider) {
      yield {
        event: 'message.start',
        data: { sessionId, phase: 'resolution', resolvedBy: highestConf.agentId },
      };

      const resolutionMessages: LLMMessage[] = [
        { role: 'system', content: highestConf.response },
        { role: 'user', content: resolutionPrompt },
      ];

      try {
        for await (const chunk of router.chatWithFallback(resolutionMessages, {
          model: resolverAgent.modelId,
          maxTokens: 500,
          temperature: 0.5,
        }, [resolverAgent.providerId])) {
          if (chunk.type === 'text') {
            yield { event: 'message.delta', data: { text: chunk.text } };
          }
        }
      } catch (err) {
        yield {
          event: 'message.delta',
          data: { text: `\n[Resolution synthesis failed: ${(err as Error).message}]\n` },
        };
      }

      yield {
        event: 'message.finish',
        data: { tokens_in: 0, tokens_out: 0, cost: 0, resolution: true },
      };
    }
  }
}

// ─── Routing Strategy: Sequential ────────────────────────────────────────────
//
// Uses TurnManager('round-robin') with maxRounds=1.
// Each agent processes in order; each agent receives the previous agent's
// output as context.  The last agent delivers the final synthesised answer.

async function* runSequential(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  let context = message;

  // Set up turn manager with maxRounds=1 (each agent speaks once)
  const turnMgr = new TurnManager(
    config.agents.map((a) => a.id),
    'round-robin',
    1,
  );

  for (let i = 0; i < config.agents.length; i++) {
    const agent = config.agents[i];
    const isFirst = i === 0;
    const isLast = i === config.agents.length - 1;

    const prompt = isFirst
      ? context
      : `Previous agent's analysis:\n${context}\n\n` +
        `Build on this analysis. ${isLast ? 'Provide the final synthesized answer.' : 'Add your perspective.'}`;

    yield {
      event: 'message.start',
      data: {
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        step: i + 1,
        total: config.agents.length,
      },
    };

    let response = '';

    // Try worker-based execution
    const worker = tryGetWorker(agent);
    if (isExternalAgent(agent)) {
      // External agent — dispatch via webhook
      const prevResponses = config.agents.slice(0, i).map((a, idx) => ({
        agentId: a.id, name: a.name, emoji: a.emoji ?? '🤖', text: '', // TODO: accumulate
      }));
      for await (const event of runExternalAgent(sessionId, prompt, agent, config, prevResponses, i + 1)) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string' && !d.isHeader) {
            response += d.text;
          }
        }
      }
    } else if (worker && turnMgr.canSpeak(agent.id)) {
      for await (const event of worker.processUserMessage(sessionId, prompt)) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string') {
            response += d.text;
          }
        }
      }
      turnMgr.recordTurn(agent.id);
    } else {
      // Fallback: direct runAgent()
      for await (const event of runAgent(sessionId, prompt, agent)) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string') {
            response += d.text;
          }
        }
      }
    }

    context = response;

    // Publish sequential step to bus
    const bus = getMessageBus();
    bus.publish({
      from: agent.id,
      to: `squad.${config.id}`,
      type: 'response',
      content: response.slice(0, 500),
      metadata: { sessionId, squadId: config.id, priority: 1, timestamp: Date.now() },
    });
  }
}

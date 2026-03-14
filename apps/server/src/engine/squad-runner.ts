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
import {
  parseMentions,
  detectPullThrough,
  buildArcherContext,
  type SquadAgent,
  type MentionParseResult,
} from './archer-router.js';
import { ExternalAgentRepository } from '../db/external-agents.js';
import { initDatabase } from '../db/index.js';

// ─── ARCHER v2 helpers ────────────────────────────────────────────────────────

/** Map an AgentConfig to the SquadAgent shape expected by archer-router */
function toSquadAgent(a: AgentConfig): SquadAgent {
  return {
    id: a.id,
    name: a.name,
    emoji: a.emoji ?? '🤖',
    sessionKey: a.id, // use agent id as session key for routing purposes
  };
}

/**
 * Compute keyword-overlap score between a message and an agent's system prompt.
 * Returns a value between 0 and 1.  Stopwords are excluded.
 */
const STOPWORDS = new Set([
  'the','a','an','is','in','on','at','to','of','and','or','but','for',
  'with','this','that','it','be','are','was','were','you','we','i',
  'he','she','they','have','has','had','do','does','did','will','would',
  'can','could','should','may','might','not','no','so','if','as','by',
  'from','up','about','into','than','then','its','our','your',
]);

function keywordOverlap(message: string, systemPrompt: string): number {
  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w));

  const msgTokens = new Set(tokenize(message));
  const sysTokens = new Set(tokenize(systemPrompt));

  if (msgTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of msgTokens) {
    if (sysTokens.has(token)) overlap++;
  }

  return overlap / msgTokens.size;
}

/**
 * 2.9 — Smart skip heuristic.
 * Returns true if the agent should be skipped (overlap < SKIP_THRESHOLD).
 * Never skips index=0 (coordinator/PO) or @mentioned agents.
 */
const SKIP_THRESHOLD = 0.10; // 10%

function shouldSkipAgent(
  agent: AgentConfig,
  agentIndex: number,
  message: string,
  mentionResult: MentionParseResult,
): boolean {
  // Never skip the first agent (PO/coordinator)
  if (agentIndex === 0) return false;

  // Never skip @mentioned agents
  const isMentioned = mentionResult.targetAgents.some(a => a.id === agent.id);
  if (isMentioned) return false;

  const score = keywordOverlap(message, agent.systemPrompt);
  if (score < SKIP_THRESHOLD) {
    logger.info(
      `[SquadRunner] 2.9 Smart-skip: ${agent.name} (overlap=${(score * 100).toFixed(1)}% < ${SKIP_THRESHOLD * 100}%)`,
    );
    return true;
  }
  return false;
}

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

  // S5: Populate recentHistory from session messages
  const sm = getSessionManager();
  const recentMessages = sm.getMessages(sessionId, { limit: 10 }).map(m => ({
    role: m.role,
    name: m.agent_id
      ? (config.agents.find(a => a.id === m.agent_id)?.name ?? 'Agent')
      : 'User',
    content: m.content,
  }));

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
    recentHistory: recentMessages,
  };

  const baseUrl = process.env.SUPERCLAW_PUBLIC_URL ?? 'http://localhost:4070';
  const response = await dispatchToExternalAgent(extAgent, ctx, baseUrl);

  yield {
    event: 'message.delta',
    data: { text: response, agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji },
  };

  // Persist external agent response as assistant message with correct sender_type
  try {
    sm.addMessage(sessionId, {
      role: 'assistant',
      content: response,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_emoji: agent.emoji ?? '',
      sender_type: 'external_agent',
    });
  } catch (err) {
    logger.error('[SquadRunner] Failed to persist external agent message: %s', (err as Error).message);
  }
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

  // Save the user's original message ONCE (squad agents use skipPersistUserMessage)
  const sm = getSessionManager();
  try {
    sm.addMessage(sessionId, { role: 'user', content: message, sender_type: 'human' });
  } catch (err) {
    logger.error('[SquadRunner] Failed to persist user message: %s', (err as Error).message);
  }

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

  // S4+S5: Touch session for memory consolidation (squad sessions were never consolidated before)
  try {
    const { touchSession } = await import('./session-consolidator.js');
    touchSession(config.id, sessionId);
  } catch {
    // Non-fatal — consolidator may not be available
  }
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
    yield* worker.processUserMessage(sessionId, message, { skipPersistUserMessage: true });
    return;
  }

  // Fallback: direct runAgent() or external dispatch
  if (isExternalAgent(agent)) {
    yield* runExternalAgent(sessionId, message, agent, config);
  } else {
    yield* runAgent(sessionId, message, agent, { skipPersistUserMessage: true });
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
    yield* worker.processUserMessage(sessionId, message, { skipPersistUserMessage: true });
    return;
  }

  // Fallback: direct runAgent()
  yield* runAgent(sessionId, message, picked, { skipPersistUserMessage: true });
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
      event: 'agent.start',
      data: { sessionId, agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji, phase: 'initial' },
    };

    // Try worker-based execution for collecting position
    const worker = tryGetWorker(agent);
    let response = '';

    if (worker) {
      // Worker-based: use processUserMessage and collect text
      const debatePrompt =
        `${message}\n\nProvide your position on this. Be concise and direct. ` +
        `End your response with exactly "Confidence: X%" where X is a number from 0 to 100.`;

      for await (const event of worker.processUserMessage(sessionId, debatePrompt, { skipPersistUserMessage: true })) {
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

    for await (const event of resolverWorker.processUserMessage(sessionId, resolutionPrompt, { skipPersistUserMessage: true })) {
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
// v3 — ARCHER v2 + Squad Intelligence (Sprint 73: items 2.7, 2.8, 2.9)
//
// 2.7 — ARCHER v2 @mention routing:
//   @specific  → only that agent (+ always PO as first)
//   @all       → all agents in squad order
//   no @       → PO-only (unless PO pulls through)
//   PO pull-through: after PO responds, scan for @mentions → trigger those agents
//
// 2.8 — Agent-to-agent routing:
//   After each non-PO agent responds, scan for @mentions of other agents.
//   Triggered agents get an extra turn even if already spoken / skipped.
//   maxExtraTurns = 2 prevents infinite chains.
//
// 2.9 — Smart skip:
//   Before running each non-PO, non-mentioned agent, compute keyword overlap
//   between message and agent's system_prompt. If overlap < 10%, skip and
//   emit a squad.skip event. Skipped agents are not silently dropped — they
//   emit a typed SSE event so the UI can show "Agent X skipped".

/** Maximum extra turns granted via agent-to-agent @mentions (2.8) */
const MAX_EXTRA_TURNS = 2;

async function* runSequential(
  sessionId: string,
  message: string,
  config: SquadConfig,
): AsyncGenerator<SSEEvent> {
  const bus = getMessageBus();
  const allSquadAgents = config.agents.map(toSquadAgent);

  // ── 2.7: Parse @mentions in the user message ──────────────────────────────
  const mentionResult = parseMentions(message, allSquadAgents);
  logger.info(
    `[SquadRunner] 2.7 ARCHER: noMention=${mentionResult.isNoMention} isAll=${mentionResult.isAllMention} targets=[${mentionResult.targetAgents.map(a => a.id).join(',')}]`,
  );

  // Determine which agents should respond in the primary loop.
  // Rules:
  //   @all / @todos / @team → every agent
  //   @specific             → those agents only (PO is always index 0, keeps first-turn semantics)
  //   no @                  → PO only (pull-through may add more after PO responds)
  let primaryAgents: AgentConfig[];
  if (mentionResult.isAllMention) {
    primaryAgents = [...config.agents];
  } else if (!mentionResult.isNoMention && mentionResult.targetAgents.length > 0) {
    // @specific: preserve squad order, include only mentioned agents
    // Always ensure the PO (index 0) runs first — even if not mentioned —
    // so pull-through detection can fire.
    const mentionedIds = new Set(mentionResult.targetAgents.map(a => a.id));
    primaryAgents = config.agents.filter((a, idx) => idx === 0 || mentionedIds.has(a.id));
  } else {
    // No @mention → PO only
    primaryAgents = config.agents.length > 0 ? [config.agents[0]] : [];
  }

  // Set up turn manager with maxRounds=1 (each agent speaks once in primary loop)
  const turnMgr = new TurnManager(
    config.agents.map((a) => a.id),
    'round-robin',
    1,
  );

  // Accumulated previous responses for context passing
  const previousResponses: Array<{ agentId: string; name: string; emoji: string; text: string }> = [];

  // Track agents that have already spoken (for agent-to-agent extra turns in 2.8)
  const spokenAgentIds = new Set<string>();

  // 2.8: extra turn counter to cap infinite chains
  let extraTurnsUsed = 0;

  // ── Helper: run one agent turn and collect response ────────────────────────
  async function* runAgentTurn(
    agent: AgentConfig,
    agentIndex: number,         // position in config.agents (for isFirst/isLast semantics)
    totalActive: number,        // how many agents are in this pass
    turnInPass: number,         // 1-based turn number within this pass
    prevContext: string,
    responseRef: { text: string },
    isExtraTurn = false,
  ): AsyncGenerator<SSEEvent> {
    const isFirst = agentIndex === 0 && !isExtraTurn;
    const isLast = turnInPass === totalActive;

    // Build ARCHER context block for this agent
    const archerCtx = buildArcherContext(
      { squadName: config.name, agents: allSquadAgents },
      toSquadAgent(agent),
      turnInPass,
      totalActive,
      mentionResult,
    );

    const prompt = isFirst
      ? prevContext
      : `${archerCtx}\n\n` +
        (prevContext !== message
          ? `Previous agent's analysis:\n${prevContext}\n\n`
          : '') +
        (isLast ? 'Provide the final synthesized answer.' : 'Add your perspective.');

    yield {
      event: 'agent.start',
      data: {
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        step: turnInPass,
        total: totalActive,
        isExtraTurn,
      },
    };

    let response = '';
    const worker = tryGetWorker(agent);

    if (isExternalAgent(agent)) {
      for await (const event of runExternalAgent(sessionId, prompt, agent, config, previousResponses, turnInPass)) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string' && !d.isHeader) response += d.text;
        }
      }
    } else if (worker && turnMgr.canSpeak(agent.id)) {
      for await (const event of worker.processUserMessage(sessionId, prompt, { skipPersistUserMessage: true })) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string') response += d.text;
        }
      }
      turnMgr.recordTurn(agent.id);
    } else {
      for await (const event of runAgent(sessionId, prompt, agent, { skipPersistUserMessage: true })) {
        yield event;
        if (event.event === 'message.delta') {
          const d = event.data as Record<string, unknown>;
          if (typeof d.text === 'string') response += d.text;
        }
      }
    }

    responseRef.text = response;

    // Stash response for context passing
    previousResponses.push({ agentId: agent.id, name: agent.name, emoji: agent.emoji ?? '🤖', text: response });
    spokenAgentIds.add(agent.id);

    bus.publish({
      from: agent.id,
      to: `squad.${config.id}`,
      type: 'response',
      content: response.slice(0, 500),
      metadata: { sessionId, squadId: config.id, priority: 1, timestamp: Date.now() },
    });
  }

  // ── Primary loop (2.7 + 2.9) ──────────────────────────────────────────────
  let lastResponse = message;
  let poResponse = '';

  for (let passIdx = 0; passIdx < primaryAgents.length; passIdx++) {
    const agent = primaryAgents[passIdx];
    const configIndex = config.agents.findIndex(a => a.id === agent.id);

    // ── 2.9 Smart skip (non-PO, non-mentioned) ──────────────────────────────
    // Skip check: only when @all or no-mention (specific @mention agents are always included)
    if (mentionResult.isAllMention || mentionResult.isNoMention) {
      if (shouldSkipAgent(agent, configIndex, message, mentionResult)) {
        yield {
          event: 'squad.skip',
          data: {
            agentId: agent.id,
            agentName: agent.name,
            reason: 'low-relevance',
            threshold: SKIP_THRESHOLD,
          },
        } as SSEEvent;
        continue;
      }
    }

    const ref = { text: '' };
    for await (const event of runAgentTurn(agent, configIndex, primaryAgents.length, passIdx + 1, lastResponse, ref)) {
      yield event;
    }
    lastResponse = ref.text;

    // Save PO response for pull-through detection (2.7)
    if (configIndex === 0) {
      poResponse = ref.text;
    }
  }

  // ── 2.7 PO Pull-Through ───────────────────────────────────────────────────
  // Only when @all is NOT active and PO ran (i.e., not already in @specific or @all mode
  // where all agents already ran). Also skip if we're already in @all mode.
  const poAgent = config.agents[0];

  if (!mentionResult.isAllMention && poResponse.length > 0) {
    const pullResult = detectPullThrough(poResponse, allSquadAgents, toSquadAgent(poAgent));
    if (pullResult.pulledAgents.length > 0) {
      logger.info(`[SquadRunner] 2.7 Pull-through: ${pullResult.pulledAgents.map(a => a.id).join(', ')}`);

      for (let ptIdx = 0; ptIdx < pullResult.pulledAgents.length; ptIdx++) {
        const pulledSquadAgent = pullResult.pulledAgents[ptIdx];
        const pulledConfig = config.agents.find(a => a.id === pulledSquadAgent.id);
        if (!pulledConfig) continue;

        // Don't re-run agents that already spoke in primary loop
        if (spokenAgentIds.has(pulledConfig.id)) continue;

        const ptConfigIndex = config.agents.findIndex(a => a.id === pulledConfig.id);
        const ptRef = { text: '' };
        for await (const event of runAgentTurn(
          pulledConfig,
          ptConfigIndex,
          pullResult.pulledAgents.length,
          ptIdx + 1,
          lastResponse,
          ptRef,
        )) {
          yield event;
        }
        lastResponse = ptRef.text;
      }
    }
  }

  // ── 2.8 Agent-to-agent routing ────────────────────────────────────────────
  // After each agent in the spoken set, scan their response for @mentions.
  // If found, queue those agents for extra turns (up to MAX_EXTRA_TURNS).
  // We process newly-spoken agents in FIFO order; pulled agents may in turn
  // trigger more agents, capped by MAX_EXTRA_TURNS.

  // Queue: [{ agentId, response }] of agents we haven't yet checked for pull-through
  const a2aQueue: Array<{ agentId: string; response: string }> = previousResponses
    .filter(r => r.agentId !== poAgent.id) // PO was already handled by pull-through above
    .map(r => ({ agentId: r.agentId, response: r.text }));

  while (a2aQueue.length > 0 && extraTurnsUsed < MAX_EXTRA_TURNS) {
    const { agentId, response } = a2aQueue.shift()!;
    const speakingSquadAgent = allSquadAgents.find(a => a.id === agentId);
    if (!speakingSquadAgent || !response) continue;

    const a2aResult = detectPullThrough(response, allSquadAgents, speakingSquadAgent);
    if (a2aResult.pulledAgents.length === 0) continue;

    for (const pulledSquadAgent of a2aResult.pulledAgents) {
      if (extraTurnsUsed >= MAX_EXTRA_TURNS) break;

      const pulledConfig = config.agents.find(a => a.id === pulledSquadAgent.id);
      if (!pulledConfig) continue;

      const a2aConfigIndex = config.agents.findIndex(a => a.id === pulledConfig.id);
      extraTurnsUsed++;

      logger.info(
        `[SquadRunner] 2.8 Agent-to-agent: ${speakingSquadAgent.name} → ${pulledSquadAgent.name} (extra turn ${extraTurnsUsed}/${MAX_EXTRA_TURNS})`,
      );

      const a2aRef = { text: '' };
      for await (const event of runAgentTurn(
        pulledConfig,
        a2aConfigIndex,
        1,
        1,
        lastResponse,
        a2aRef,
        /* isExtraTurn */ true,
      )) {
        yield event;
      }
      lastResponse = a2aRef.text;

      // Add to a2a queue so this agent's response can also trigger further pulls
      if (a2aRef.text) {
        a2aQueue.push({ agentId: pulledConfig.id, response: a2aRef.text });
      }
    }
  }

  if (extraTurnsUsed >= MAX_EXTRA_TURNS && a2aQueue.length > 0) {
    logger.info(`[SquadRunner] 2.8 Agent-to-agent chain capped at maxExtraTurns=${MAX_EXTRA_TURNS}`);
  }
}

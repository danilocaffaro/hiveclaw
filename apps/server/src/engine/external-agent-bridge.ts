/**
 * engine/external-agent-bridge.ts — External Agent Communication Bridge
 *
 * Handles bidirectional communication with external agents:
 *   1. OUTBOUND: Send contextual messages to external agents via webhook
 *   2. INBOUND: Receive responses from external agents via callback
 *
 * The Context Injector enriches messages before sending to external agents,
 * providing squad context, conversation history, and protocol guidance
 * so the external agent can participate without knowing ARCHER/NEXUS internally.
 */

import type { ExternalAgent } from '../db/external-agents.js';
import { ExternalAgentRepository } from '../db/external-agents.js';
import { initDatabase } from '../db/index.js';
import { logger } from '../lib/logger.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SquadMessageContext {
  squadId: string;
  squadName: string;
  /** All members (local + external) for context */
  members: Array<{ name: string; emoji: string; role: string; isExternal: boolean }>;
  /** The user's original message */
  userMessage: string;
  /** Who sent it */
  senderName: string;
  /** Previous responses in this turn (ECHO-FREE context) */
  previousResponses: Array<{ agentName: string; agentEmoji: string; text: string }>;
  /** Which turn this agent is (e.g., 2/4) */
  turnNumber: number;
  totalTurns: number;
  /** Was this agent specifically @mentioned? */
  wasMentioned: boolean;
  /** Current NEXUS phase if detected */
  nexusPhase?: string;
  /** Recent conversation history (last N messages) */
  recentHistory?: Array<{ role: string; name: string; content: string }>;
}

export interface ExternalAgentRequest {
  /** Unique request ID for correlation */
  requestId: string;
  /** The enriched message for the agent */
  message: string;
  /** Squad context metadata */
  context: {
    squadId: string;
    squadName: string;
    members: string[];
    turnNumber: number;
    totalTurns: number;
    senderName: string;
  };
  /** Callback URL for the agent to respond to */
  callbackUrl: string;
  /** Protocol Pack info (Tier 2 only) */
  protocolPack?: {
    archerRules: string;
    nexusPhase?: string;
    availableActions: string[];
  };
}

export interface ExternalAgentResponse {
  requestId: string;
  text: string;
  /** Optional: Tier 2 agents can include structured actions */
  actions?: Array<{
    type: 'mention' | 'create_task' | 'tag';
    payload: Record<string, unknown>;
  }>;
}

// ─── Context Injector ──────────────────────────────────────────────────────────

/**
 * Build a contextual message for a Tier 1 (lightweight) external agent.
 * The agent receives a natural-language message with all context embedded.
 * No protocol knowledge required.
 */
function buildTier1Message(ctx: SquadMessageContext): string {
  const memberList = ctx.members
    .map(m => `${m.emoji} ${m.name} (${m.role}${m.isExternal ? ', external' : ''})`)
    .join('\n  ');

  let msg = `You are participating in a group chat called "${ctx.squadName}".\n\n`;
  msg += `Members:\n  ${memberList}\n\n`;

  // S5: Recent session history (last 10 messages) for full context
  if (ctx.recentHistory && ctx.recentHistory.length > 0) {
    msg += `--- Recent session history ---\n`;
    for (const h of ctx.recentHistory) {
      msg += `[${h.role}] ${h.name}: ${h.content.slice(0, 500)}\n`;
    }
    msg += `--- End history ---\n\n`;
  }

  // Previous responses (ECHO-FREE context)
  if (ctx.previousResponses.length > 0) {
    msg += `--- Conversation so far ---\n`;
    msg += `**${ctx.senderName}:** ${ctx.userMessage}\n\n`;
    for (const resp of ctx.previousResponses) {
      msg += `**${resp.agentEmoji} ${resp.agentName}:** ${resp.text}\n\n`;
    }
    msg += `--- End of conversation ---\n\n`;
    msg += `It's your turn to respond (${ctx.turnNumber}/${ctx.totalTurns}).\n`;
    msg += `IMPORTANT: Do NOT repeat information already stated above. Add your unique perspective or expertise.\n\n`;
  } else {
    msg += `**${ctx.senderName}:** ${ctx.userMessage}\n\n`;
    msg += `You are the first to respond (${ctx.turnNumber}/${ctx.totalTurns}).\n\n`;
  }

  if (ctx.wasMentioned) {
    msg += `You were specifically asked to respond to this.\n`;
  }

  if (ctx.nexusPhase) {
    msg += `Current project phase: ${ctx.nexusPhase}\n`;
  }

  msg += `\nKeep your response concise and relevant. This is a group chat, not an essay.`;
  return msg;
}

/**
 * Build a contextual message for a Tier 2 (enhanced) external agent.
 * Includes Protocol Pack rules + structured context.
 */
function buildTier2Message(ctx: SquadMessageContext): string {
  let msg = buildTier1Message(ctx);

  msg += `\n\n--- Protocol Pack (ARCHER v2) ---\n`;
  msg += `- ECHO-FREE: Never repeat info already posted by another agent\n`;
  msg += `- ROLE-GATE: Respond only within your scope/expertise\n`;
  msg += `- Use @agentName to reference or call on other members\n`;
  msg += `- Status tags: [CLAIM] #N, [DONE] #N, [BLOCKED] #N, [QA-PASS] #N, [QA-FAIL] #N\n`;
  msg += `- If you have nothing to add, a brief ACK is fine\n`;

  if (ctx.nexusPhase) {
    msg += `\n--- NEXUS v3 ---\n`;
    msg += `Current phase: ${ctx.nexusPhase}\n`;
    msg += `Phases: Understand → Plan → Execute → QA → Ship → Close\n`;
  }

  return msg;
}

// ─── Webhook Dispatcher ────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 120_000; // S6: extended from 30s for complex agent tasks

/**
 * Send a message to an external agent via webhook and wait for response.
 * Returns the agent's response text, or an error message.
 */
export async function dispatchToExternalAgent(
  agent: ExternalAgent,
  ctx: SquadMessageContext,
  callbackBaseUrl: string,
): Promise<string> {
  const repo = new ExternalAgentRepository(initDatabase());

  // Circuit breaker: skip if agent is in error state
  if (agent.status === 'error') {
    logger.warn('[ExternalBridge] Skipping %s — circuit breaker OPEN', agent.name);
    return `⚠️ ${agent.name} is temporarily unavailable (circuit breaker open)`;
  }

  const requestId = crypto.randomUUID();
  const message = agent.tier === 'enhanced'
    ? buildTier2Message(ctx)
    : buildTier1Message(ctx);

  const payload: ExternalAgentRequest = {
    requestId,
    message,
    context: {
      squadId: ctx.squadId,
      squadName: ctx.squadName,
      members: ctx.members.map(m => `${m.emoji} ${m.name}`),
      turnNumber: ctx.turnNumber,
      totalTurns: ctx.totalTurns,
      senderName: ctx.senderName,
    },
    callbackUrl: `${callbackBaseUrl}/api/external-agents/${agent.id}/callback`,
  };

  if (agent.tier === 'enhanced') {
    payload.protocolPack = {
      archerRules: 'ECHO-FREE, ROLE-GATE, @mention routing',
      nexusPhase: ctx.nexusPhase,
      availableActions: ['mention', 'create_task', 'tag'],
    };
  }

  try {
    logger.info('[ExternalBridge] Dispatching to %s (%s) tier=%s', agent.name, agent.webhookUrl, agent.tier);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const res = await fetch(agent.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.outboundToken}`,
        'X-SuperClaw-Request-Id': requestId,
        'X-SuperClaw-Agent-Tier': agent.tier,
        'X-SuperClaw-Agent-Id': agent.id,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      repo.recordFailure(agent.id);
      logger.error('[ExternalBridge] %s returned %d: %s', agent.name, res.status, errBody.slice(0, 200));
      return `⚠️ ${agent.name} returned error ${res.status}`;
    }

    // Parse response — expect { text: "...", actions?: [...] }
    const body = await res.json() as ExternalAgentResponse;
    const responseText = body.text ?? '';

    if (!responseText.trim()) {
      repo.markSeen(agent.id);
      return `_${agent.name} acknowledged but had no response_`;
    }

    repo.markSeen(agent.id);
    logger.info('[ExternalBridge] %s responded (%d chars)', agent.name, responseText.length);

    return responseText.trim();

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    repo.recordFailure(agent.id);

    if (message.includes('abort')) {
      logger.warn('[ExternalBridge] %s timed out after %dms', agent.name, WEBHOOK_TIMEOUT_MS);
      return `⚠️ ${agent.name} timed out (${WEBHOOK_TIMEOUT_MS / 1000}s)`;
    }

    logger.error('[ExternalBridge] %s dispatch failed: %s', agent.name, message);
    return `⚠️ ${agent.name} unreachable: ${message}`;
  }
}

// ─── Protocol Pack Generator ───────────────────────────────────────────────────

/**
 * Generate a Protocol Pack for an external agent to install.
 * This is a SKILL.md-like document + webhook spec that teaches the agent
 * how to participate as a first-class squad member.
 */
export function generateProtocolPack(agent: ExternalAgent, baseUrl: string): {
  skillPrompt: string;
  webhookSpec: {
    endpoint: string;
    authToken: string;
    messageFormat: string;
    callbackFormat: string;
  };
  capabilities: string[];
} {
  const skillPrompt = `# SuperClaw Protocol Pack — Squad Communication

You have been invited to participate in squads on SuperClaw.
When you receive a message from SuperClaw, follow these rules:

## Communication Rules (ARCHER v2)
1. **ECHO-FREE**: Never repeat information already posted by another agent
2. **ROLE-GATE**: Only respond within your area of expertise
3. **@mentions**: Use @AgentName to reference or call on another member
4. **Be concise**: This is a group chat — keep responses focused

## Status Tags (NEXUS v3)
Use these tags when relevant:
- [CLAIM] #N — You're taking ownership of task/issue N
- [DONE] #N — You've completed task/issue N
- [BLOCKED] #N — You're blocked on task/issue N
- [QA-PASS] #N — QA approved
- [QA-FAIL] #N — QA failed, needs fixes

## Response Format
When SuperClaw sends you a squad message:
1. Read the conversation context carefully
2. Add YOUR unique perspective (don't repeat others)
3. If you have nothing to add, respond with a brief ACK
4. If the topic is outside your expertise, say so briefly

## Webhook Response
Respond with JSON: { "text": "your response", "actions": [] }
Actions (optional): [{ "type": "mention", "payload": { "agent": "@name" } }]
`;

  return {
    skillPrompt,
    webhookSpec: {
      endpoint: `${baseUrl}/api/external-agents/${agent.id}/callback`,
      authToken: agent.inboundToken,
      messageFormat: 'POST with JSON body: { requestId, message, context, callbackUrl, protocolPack? }',
      callbackFormat: 'POST with JSON body: { requestId, text, actions? } + Authorization: Bearer <inboundToken>',
    },
    capabilities: ['mention', 'create_task', 'tag', 'read_history'],
  };
}

// Need crypto for UUID
import crypto from 'node:crypto';

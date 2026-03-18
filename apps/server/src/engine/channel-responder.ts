/**
 * engine/channel-responder.ts — Auto-reply for inbound channel messages (Phase 2)
 *
 * When an inbound message arrives via webhook (Telegram, Discord, Slack, etc.),
 * this module:
 *   1. Finds or creates a session for that channel + sender
 *   2. Runs the agent loop (runAgent)
 *   3. Collects the full response
 *   4. Sends it back via the channel's outbound path
 *
 * Sessions are keyed as `channel:{channelId}:{fromId}` so each external user
 * gets a persistent conversation thread with the assigned agent.
 *
 * Fix (2026-03-15): Guarantee persistence even on error paths.
 *   - User message is saved before runAgent (was already true via runAgent itself)
 *   - If runAgent exits via error event or throw, we still persist the error response
 *     as an assistant message so session history stays consistent with channel_messages.
 *   - Temporal awareness: inject [TIME GAP] notice when >30min between messages.
 */

import type { Agent } from '@hiveclaw/shared';
import { getSessionManager } from './session-manager.js';
import { runAgent } from './agent-runner.js';
import type { AgentConfig } from './agent-runner.js';
import { AgentRepository } from '../db/agents.js';
import { ProviderRepository } from '../db/providers.js';
import { initDatabase } from '../db/index.js';
import { logger } from '../lib/logger.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getDefaultProviderId(): string {
  const db = initDatabase();
  const provRepo = new ProviderRepository(db);
  const providers = provRepo.list();
  return providers[0]?.id ?? 'default';
}

function getDefaultModelId(providerId: string): string {
  const db = initDatabase();
  const provRepo = new ProviderRepository(db);
  const provider = provRepo.list().find(p => p.id === providerId);
  return provider?.models?.[0]?.id ?? 'auto';
}

function agentRowToConfig(agent: Agent): AgentConfig {
  const resolvedProvider = (agent.providerPreference as string) || getDefaultProviderId();
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji ?? '🤖',
    systemPrompt: agent.systemPrompt ?? 'You are a helpful AI assistant.',
    providerId: resolvedProvider,
    modelId: (agent.modelPreference as string) || getDefaultModelId(resolvedProvider),
    temperature: (agent.temperature as number) ?? 0.7,
    maxTokens: 4096,
  };
}

/**
 * Build a temporal-awareness prefix when there's a significant gap since the
 * last session message.  This lets the agent know time has passed so it
 * doesn't confuse stale context with the current request.
 */
function buildTemporalPrefix(sessionId: string): string {
  try {
    const sm = getSessionManager();
    const msgs = sm.getMessages(sessionId, { limit: 1 });
    if (msgs.length === 0) return '';

    const lastMsg = msgs[msgs.length - 1];
    const lastTs = new Date(lastMsg.created_at);
    const now = new Date();
    const diffMs = now.getTime() - lastTs.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 30) return ''; // less than 30 min — no notice needed

    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);

    let gapStr: string;
    if (diffD > 0) {
      gapStr = `${diffD}d ${diffH % 24}h`;
    } else if (diffH > 0) {
      gapStr = `${diffH}h ${diffMin % 60}min`;
    } else {
      gapStr = `${diffMin}min`;
    }

    const nowStr = now.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    return `[⏱ TIME GAP: ${gapStr} have passed since your last message. Current time: ${nowStr} (São Paulo). Your previous context may be stale — verify assumptions before acting.]\n\n`;
  } catch {
    return '';
  }
}

// ─── Core ───────────────────────────────────────────────────────────────────────

// ─── R20.3a: Per-session mutex ──────────────────────────────────────────────────
// Prevents concurrent agent runs on the same session. If user sends rapid messages
// while the agent is still processing, subsequent messages queue up instead of
// spawning parallel loops that corrupt shared state.
// OpenClaw has full QueueMode/debounce system; this is a simpler equivalent.
const _sessionLocks = new Map<string, Promise<void>>();

function withSessionLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = _sessionLocks.get(sessionKey) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn()); // always proceed even if prior failed
  // Store the void version (we don't want to keep resolved values in the map)
  _sessionLocks.set(sessionKey, next.then(() => {}, () => {}));
  // Cleanup after completion to avoid memory leak
  next.finally(() => {
    // Only delete if this is still the latest promise in the chain
    const current = _sessionLocks.get(sessionKey);
    if (current === next.then(() => {}, () => {})) {
      _sessionLocks.delete(sessionKey);
    }
  });
  return next;
}

export interface ChannelInbound {
  channelId: string;
  agentId: string;
  fromId: string;
  text: string;
}

/**
 * Process an inbound channel message and return the agent's response.
 * Creates/reuses a persistent session for this channel+sender pair.
 *
 * Persistence guarantee: every call results in BOTH the user message AND the
 * assistant response being written to the session's messages table, even when
 * runAgent exits via an error path.  This keeps session history in sync with
 * channel_messages so the agent never loses conversational context.
 */
export async function handleChannelInbound(inbound: ChannelInbound): Promise<string> {
  const sessionKey = `channel:${inbound.channelId}:${inbound.fromId}`;
  // R20.3a: Serialize agent runs per session to prevent concurrent corruption
  return withSessionLock(sessionKey, () => _handleChannelInboundInner(inbound));
}

async function _handleChannelInboundInner(inbound: ChannelInbound): Promise<string> {
  const sm = getSessionManager();
  const db = initDatabase();
  const agentRepo = new AgentRepository(db);

  // 1. Resolve agent config
  const agentRow = agentRepo.getById(inbound.agentId);
  const agentConfig: AgentConfig = agentRow
    ? agentRowToConfig(agentRow)
    : {
        id: inbound.agentId,
        name: 'HiveClaw',
        emoji: '🤖',
        systemPrompt: 'You are a helpful AI assistant.',
        providerId: getDefaultProviderId(),
        modelId: getDefaultModelId(getDefaultProviderId()),
        temperature: 0.7,
        maxTokens: 4096,
      };

  // 2. Find or create session for channel:channelId:fromId
  const sessionKey = `channel:${inbound.channelId}:${inbound.fromId}`;
  let sessionId: string;

  const sessions = sm.listSessions();
  const existing = sessions.find(s => s.title === sessionKey);
  if (existing) {
    sessionId = existing.id;
  } else {
    const newSession = sm.createSession({
      title: sessionKey,
      agent_id: inbound.agentId,
      mode: 'dm',
    });
    sessionId = newSession.id;
    logger.info('[channel-responder] Created session %s for %s', sessionId, sessionKey);
  }

  // 3. Build temporal prefix (inject time gap notice if >30min since last message)
  const temporalPrefix = buildTemporalPrefix(sessionId);
  const userMessageWithContext = temporalPrefix
    ? `${temporalPrefix}${inbound.text}`
    : inbound.text;

  // 4. Run agent loop, collect full response.
  //    runAgent internally saves the user message + assistant response.
  //    On ANY error path we fall through to the fallback persistence block below.
  let fullResponse = '';
  let ranToCompletion = false;

  try {
    for await (const event of runAgent(sessionId, userMessageWithContext, agentConfig)) {
      if (event.event === 'message.delta') {
        const delta = event.data as { text?: string };
        if (delta.text) fullResponse += delta.text;
      } else if (event.event === 'message.finish') {
        ranToCompletion = true;
      } else if (event.event === 'error') {
        const errData = event.data as { message?: string };
        const errMsg = errData?.message ?? 'Unknown error';
        logger.error('[channel-responder] Agent error: %s', errMsg);
        // runAgent already saved user message but may NOT have saved assistant message.
        // If we have partial text, use it; otherwise use the error message.
        if (!fullResponse.trim()) {
          fullResponse = `⚠️ ${errMsg}`;
        }
        // Persist assistant response explicitly when runAgent exits via error event
        // (runAgent's own addMessage at line 588 is unreachable on error paths)
        try {
          sm.addMessage(sessionId, {
            role: 'assistant',
            content: fullResponse,
            agent_id: agentConfig.id,
            agent_name: agentConfig.name ?? '',
            agent_emoji: (agentConfig as { emoji?: string }).emoji ?? '🤖',
            sender_type: 'agent',
          });
          logger.info('[channel-responder] Persisted assistant message after error path (%d chars)', fullResponse.length);
        } catch (persistErr) {
          logger.error('[channel-responder] Failed to persist assistant message after error: %s', (persistErr as Error).message);
        }
        return fullResponse.trim();
      }
    }
  } catch (err) {
    logger.error({ err }, '[channel-responder] runAgent threw');
    if (!fullResponse.trim()) {
      fullResponse = '⚠️ Sorry, I encountered an error processing your message.';
    }
    // runAgent threw — persist what we have
    try {
      sm.addMessage(sessionId, {
        role: 'assistant',
        content: fullResponse,
        agent_id: agentConfig.id,
        agent_name: agentConfig.name ?? '',
        agent_emoji: (agentConfig as { emoji?: string }).emoji ?? '🤖',
        sender_type: 'agent',
      });
      logger.info('[channel-responder] Persisted assistant message after throw (%d chars)', fullResponse.length);
    } catch (persistErr) {
      logger.error('[channel-responder] Failed to persist assistant message after throw: %s', (persistErr as Error).message);
    }
    return fullResponse.trim();
  }

  if (!fullResponse.trim()) {
    fullResponse = '🤖 (no response)';
    // Persist empty response too so session stays in sync
    if (!ranToCompletion) {
      try {
        sm.addMessage(sessionId, {
          role: 'assistant',
          content: fullResponse,
          agent_id: agentConfig.id,
          agent_name: agentConfig.name ?? '',
          agent_emoji: (agentConfig as { emoji?: string }).emoji ?? '🤖',
          sender_type: 'agent',
        });
      } catch { /* non-fatal */ }
    }
  }

  return fullResponse.trim();
}

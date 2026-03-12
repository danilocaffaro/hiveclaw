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
 */

import type { Agent } from '@superclaw/shared';
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
  return provider?.models?.[0]?.id ?? 'gpt-4o-mini';
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

// ─── Core ───────────────────────────────────────────────────────────────────────

export interface ChannelInbound {
  channelId: string;
  agentId: string;
  fromId: string;
  text: string;
}

/**
 * Process an inbound channel message and return the agent's response.
 * Creates/reuses a persistent session for this channel+sender pair.
 */
export async function handleChannelInbound(inbound: ChannelInbound): Promise<string> {
  const sm = getSessionManager();
  const db = initDatabase();
  const agentRepo = new AgentRepository(db);

  // 1. Resolve agent config
  const agentRow = agentRepo.getById(inbound.agentId);
  const agentConfig: AgentConfig = agentRow
    ? agentRowToConfig(agentRow)
    : {
        id: inbound.agentId,
        name: 'SuperClaw',
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

  // Look for existing session with this title pattern
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

  // 3. Run agent loop, collect full response
  let fullResponse = '';
  try {
    for await (const event of runAgent(sessionId, inbound.text, agentConfig)) {
      if (event.event === 'message.delta') {
        const delta = event.data as { text?: string };
        if (delta.text) fullResponse += delta.text;
      } else if (event.event === 'error') {
        const errData = event.data as { message?: string };
        logger.error('[channel-responder] Agent error: %s', errData?.message ?? 'Unknown');
        return `⚠️ ${errData?.message ?? 'Unknown error'}`;
      }
    }
  } catch (err) {
    logger.error({ err }, '[channel-responder] runAgent threw');
    return '⚠️ Sorry, I encountered an error processing your message.';
  }

  if (!fullResponse.trim()) {
    return '🤖 (no response)';
  }

  return fullResponse.trim();
}

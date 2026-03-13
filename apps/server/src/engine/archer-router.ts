// ============================================================
// ARCHER v2 — @Mention Routing Engine
// ============================================================
//
// Implements ARCHER v2 protocol for squad message routing:
//   - @agentId / @agentName → route only to mentioned agent(s)
//   - @all / @todos / @team → route to ALL agents (sequential)
//   - No @ → PO only (first agent in squad, typically Alice)
//   - PO pull-through: if PO's response @mentions another agent, trigger that agent next
//
// Also detects NEXUS v3 tags: [CLAIM], [DONE], [BLOCKED], [QA-PASS], [QA-FAIL]

import { logger } from '../lib/logger.js';

// ─── SquadAgent ────────────────────────────────────────────────────────────────
//
// Sprint 69 (Item 1.2): SquadAgent was previously imported from the now-deleted
// squad-bridge-runner.ts. It is defined here since archer-router.ts is its only
// consumer. If other modules need it in the future, extract to types/squad.ts.

export interface SquadAgent {
  id: string;
  name: string;
  emoji: string;
  sessionKey: string;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MentionParseResult {
  /** Which agents should respond based on @mentions */
  targetAgents: SquadAgent[];
  /** Was @all / @todos / @team used? */
  isAllMention: boolean;
  /** Was no @ used at all? (PO-only mode) */
  isNoMention: boolean;
  /** Raw mention tokens found in the message */
  mentionTokens: string[];
  /** User message with @mentions cleaned for display */
  cleanMessage: string;
}

export interface PullThroughResult {
  /** Additional agents to trigger based on PO's response */
  pulledAgents: SquadAgent[];
  /** Mention tokens found in PO's response */
  mentionTokens: string[];
}

export interface TagDetection {
  tag: string;           // CLAIM, DONE, BLOCKED, QA-PASS, QA-FAIL, INFO, AGECON, CONSENSUS
  issueNumber?: string;  // #XX if present
  detail?: string;       // text after the tag
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Tokens that mean "everyone responds" */
const ALL_TOKENS = new Set(['all', 'todos', 'team', 'everyone']);

/** Known agent name aliases (lowercase → canonical id).
 *  This is a **seed** for static resolution. At runtime, agents are
 *  resolved from the DB via `buildAliasMap()`.
 */
const NAME_ALIASES: Record<string, string> = {
  // Intentionally empty — populated at runtime from DB agents
};

/** NEXUS v3 / ARCHER v2 status tags regex */
const TAG_REGEX = /\[(CLAIM|DONE|BLOCKED|QA-PASS|QA-FAIL|INFO|AGECON|CONSENSUS|HOTFIX|UPDATE)\]\s*(#(\d+))?\s*(.*)/gi;

// ─── Mention Parser ────────────────────────────────────────────────────────────

/**
 * Parse @mentions from a user message and determine which agents should respond.
 * 
 * Rules (ARCHER v2):
 *   @specific  → only that agent
 *   @a @b      → those agents, in squad order
 *   @all       → everyone, in squad order
 *   no @       → PO only (first agent in squad)
 */
export function parseMentions(message: string, agents: SquadAgent[]): MentionParseResult {
  // Build lookup: id, lowercase name, aliases → agent
  const agentById = new Map<string, SquadAgent>();
  const agentByLower = new Map<string, SquadAgent>();
  
  for (const agent of agents) {
    agentById.set(agent.id, agent);
    agentByLower.set(agent.id.toLowerCase(), agent);
    agentByLower.set(agent.name.toLowerCase(), agent);
    // Add cleaned name without emoji
    const cleanedName = agent.name.replace(/[^\w\s]/g, '').trim().toLowerCase();
    if (cleanedName) agentByLower.set(cleanedName, agent);
  }
  
  // Add known aliases
  for (const [alias, canonicalId] of Object.entries(NAME_ALIASES)) {
    const agent = agentById.get(canonicalId);
    if (agent) agentByLower.set(alias, agent);
  }

  // Extract @mentions using regex
  // Matches: @word, @"multi word" — NOTE: email addresses (user@word) ARE matched as tokens
  // but will fail agent lookup, falling through to PO fallback. This is acceptable behavior.
  const mentionRegex = /@(\w[\w\s]*?)(?=\s|$|[.,!?;:])/g;
  const mentionTokens: string[] = [];
  const mentionedAgents = new Set<SquadAgent>();
  let isAllMention = false;
  let cleanMessage = message;
  
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(message)) !== null) {
    const token = match[1].trim().toLowerCase();
    mentionTokens.push(token);
    
    if (ALL_TOKENS.has(token)) {
      isAllMention = true;
    } else {
      // Try to resolve to an agent
      const agent = agentByLower.get(token);
      if (agent) {
        mentionedAgents.add(agent);
      } else {
        // Try partial match (e.g., "@res" for "Researcher")
        for (const [key, a] of agentByLower) {
          if (key.startsWith(token) && token.length >= 3) {
            mentionedAgents.add(a);
            break;
          }
        }
      }
    }
    
    // Remove mention from clean message
    cleanMessage = cleanMessage.replace(match[0], '').trim();
  }
  
  // Clean up double spaces
  cleanMessage = cleanMessage.replace(/\s+/g, ' ').trim();
  if (!cleanMessage) cleanMessage = message; // safety: don't return empty

  // Determine target agents
  let targetAgents: SquadAgent[];
  const isNoMention = mentionTokens.length === 0;

  if (isAllMention) {
    // @all → everyone in squad order
    targetAgents = [...agents];
  } else if (mentionedAgents.size > 0) {
    // Specific @mentions → those agents, preserving squad order
    targetAgents = agents.filter(a => mentionedAgents.has(a));
  } else {
    // No @ → PO only (first agent in squad)
    targetAgents = agents.length > 0 ? [agents[0]] : [];
  }

  logger.info(`[ARCHER] Parsed mentions: tokens=${JSON.stringify(mentionTokens)} isAll=${isAllMention} noMention=${isNoMention} targets=[${targetAgents.map(a => a.id).join(',')}]`);

  return {
    targetAgents,
    isAllMention,
    isNoMention,
    mentionTokens,
    cleanMessage,
  };
}

// ─── PO Pull-Through ──────────────────────────────────────────────────────────

/**
 * After PO responds, scan their response for @mentions of other agents.
 * If found, those agents should be triggered for a follow-up response.
 * 
 * This implements ARCHER v2 rule: "PO decides if others need to respond"
 */
export function detectPullThrough(poResponse: string, allAgents: SquadAgent[], poAgent: SquadAgent): PullThroughResult {
  // Reuse the same mention parser, but exclude the PO itself
  const nonPoAgents = allAgents.filter(a => a.id !== poAgent.id);
  const result = parseMentions(poResponse, nonPoAgents);
  
  // Only pull through if PO explicitly mentioned specific agents (not @all)
  if (result.isAllMention) {
    return { pulledAgents: nonPoAgents, mentionTokens: result.mentionTokens };
  }
  
  if (result.targetAgents.length > 0 && !result.isNoMention) {
    logger.info(`[ARCHER] PO pull-through detected: ${result.targetAgents.map(a => a.id).join(', ')}`);
    return { pulledAgents: result.targetAgents, mentionTokens: result.mentionTokens };
  }
  
  return { pulledAgents: [], mentionTokens: [] };
}

// ─── Tag Detection (NEXUS v3) ──────────────────────────────────────────────────

/**
 * Detect NEXUS v3 / ARCHER v2 status tags in agent responses.
 * Tags like [CLAIM] #42, [DONE] #42, [QA-PASS] #42, etc.
 */
export function detectTags(text: string): TagDetection[] {
  const tags: TagDetection[] = [];
  const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
  
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tags.push({
      tag: match[1].toUpperCase(),
      issueNumber: match[3] || undefined,
      detail: match[4]?.trim() || undefined,
    });
  }
  
  return tags;
}

// ─── Group Context Builder (ARCHER v2 enhanced) ────────────────────────────────

/**
 * Build enhanced group context metadata that tells the agent:
 * - Who's in the squad
 * - Whether they were specifically mentioned
 * - ARCHER v2 rules relevant to their situation
 */
export function buildArcherContext(
  config: { squadName: string; agents: SquadAgent[] },
  currentAgent: SquadAgent,
  turnNumber: number,
  totalTurns: number,
  mentionResult: MentionParseResult,
): string {
  const members = config.agents
    .map(a => `${a.emoji} ${a.name}${a.id === currentAgent.id ? ' (you)' : ''}`)
    .join(', ');

  const wasMentioned = mentionResult.targetAgents.some(a => a.id === currentAgent.id);
  const mentionContext = mentionResult.isAllMention
    ? '- you_were_mentioned: Yes (@all — everyone responds)'
    : mentionResult.isNoMention
      ? `- mention_mode: No specific @mention — ${turnNumber === 1 ? 'you respond as PO/lead' : 'you were pulled in by PO'}`
      : wasMentioned
        ? '- you_were_mentioned: Yes — you were specifically called on this topic'
        : '- you_were_mentioned: No — but PO pulled you in for your expertise';

  return `[Squad Group Context]
- squad: ${config.squadName}
- type: group chat (like WhatsApp group or Discord channel)
- members: ${members}
- your_turn: You are agent ${turnNumber}/${totalTurns}
${mentionContext}
- protocols: ARCHER v2 active
  • Respond in hierarchy order (PO > Tech Lead > QA > SRE)
  • ECHO-FREE: Never repeat info already posted by another agent
  • ROLE-GATE: Respond only within your scope/expertise
  • Build on what others said — add YOUR unique perspective
  • Use @mentions to reference other agents when you want their input
  • Be concise — this is a group chat, not an essay
  • If you have nothing to add, a brief ACK is fine`;
}

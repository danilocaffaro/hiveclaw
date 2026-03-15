/**
 * engine/session-rotator.ts — Automatic session rotation with memory preservation
 *
 * Sprint 80: Eidetic Memory v2
 *
 * When context approaches model limit, this module:
 * 1. Extracts ALL important information to appropriate memory layers
 *    - L3 (Working Memory): current task state — compacted
 *    - L4 (Graph Memory): facts, decisions, entities — structured
 *    - L5 (Archival): COMPLETE message history — never compacted
 * 2. Creates a new session linked to the old one
 * 3. Injects context from memory layers into the new session
 *
 * Principle: SHORT-TERM = compacted for efficiency.
 *            LONG-TERM = complete and faithful. Never lose the original.
 */

import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import { getSessionManager, type MessageInfo } from './session-manager.js';
import { llmCompact } from './llm-compactor.js';
import { AgentMemoryRepository } from '../db/agent-memory.js';
import { ProviderRepository } from '../db/providers.js';
import { getDb } from '../db/index.js';
import {
  checkTokenStatus,
  estimateTotalTokens,
  type TokenStatus,
  type ThresholdLevel,
} from './token-monitor.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RotationResult {
  rotated: boolean;
  reason: string;
  oldSessionId?: string;
  newSessionId?: string;
  extractedFacts?: number;
  archivedMessages?: number;
}

export interface ExtractionResult {
  factsExtracted: number;
  messagesArchived: number;
  workingMemorySaved: boolean;
  fidelityScore: number; // 0-1: how complete the extraction was
}

// ─── Config ─────────────────────────────────────────────────────────────────

/** Minimum messages before rotation is even considered */
const MIN_MESSAGES_FOR_ROTATION = 10;

/** Minimum time between rotations (prevent rapid cycling) */
const MIN_ROTATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Track last rotation per session chain */
const lastRotationTime = new Map<string, number>();

// ─── Schema Migration ───────────────────────────────────────────────────────

/**
 * Ensure session_chain table exists for linking rotated sessions.
 * Called once at startup.
 */
export function ensureSessionChainSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_chain (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      chain_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT,
      rotation_reason TEXT,
      tokens_at_rotation INTEGER,
      facts_extracted INTEGER DEFAULT 0,
      messages_archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_chain_chain ON session_chain(chain_id);
    CREATE INDEX IF NOT EXISTS idx_session_chain_session ON session_chain(session_id);
  `);
  logger.debug('[SessionRotator] Schema ready');
}

// ─── Step 1: Intensive Extraction ───────────────────────────────────────────

/**
 * Extract all important information from current session to memory layers.
 * Called at 70% context threshold.
 *
 * L3 (Working Memory): current task state — compacted for quick reference
 * L4 (Graph Memory): durable facts — structured, searchable
 * L5 (Archival): complete messages — NEVER compacted, full fidelity
 */
export async function intensiveExtraction(
  sessionId: string,
  agentId: string,
): Promise<ExtractionResult> {
  const db = getDb();
  const memRepo = new AgentMemoryRepository(db);
  const sessionManager = getSessionManager();
  const messages = sessionManager.getMessages(sessionId, { limit: 100_000 });

  if (messages.length === 0) {
    return { factsExtracted: 0, messagesArchived: 0, workingMemorySaved: false, fidelityScore: 0 };
  }

  logger.info('[SessionRotator] Starting intensive extraction: %d messages, agent=%s', messages.length, agentId);

  // ── L5: Archive COMPLETE messages — no compaction, full fidelity ──────────
  let messagesArchived = 0;
  try {
    const archiveStmt = db.prepare(`
      INSERT OR IGNORE INTO archival_memories (id, agent_id, session_id, content, role, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Check if archival_memories table exists, create if not
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='archival_memories'
    `).get();

    if (!tableExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS archival_memories (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          content TEXT NOT NULL,
          role TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_archival_agent ON archival_memories(agent_id);
        CREATE INDEX IF NOT EXISTS idx_archival_session ON archival_memories(session_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS archival_memories_fts USING fts5(
          content, role, metadata,
          content='archival_memories',
          content_rowid='rowid'
        );
      `);
    }

    for (const msg of messages) {
      const metadata = JSON.stringify({
        agent_name: msg.agent_name,
        agent_emoji: msg.agent_emoji,
        sender_type: msg.sender_type,
        tool_name: msg.tool_name,
        tool_input: msg.tool_input ? msg.tool_input.slice(0, 10_000) : undefined,
        tool_result: msg.tool_result ? msg.tool_result.slice(0, 10_000) : undefined,
        tokens_in: msg.tokens_in,
        tokens_out: msg.tokens_out,
      });

      archiveStmt.run(
        msg.id,
        agentId,
        sessionId,
        msg.content,
        msg.role,
        metadata,
        msg.created_at,
      );
      messagesArchived++;
    }
    logger.info('[SessionRotator] L5 archived %d messages (complete, no compaction)', messagesArchived);
  } catch (err) {
    logger.warn('[SessionRotator] L5 archival failed: %s', (err as Error).message);
  }

  // ── L4: Structured extraction via LLM ─────────────────────────────────────
  let factsExtracted = 0;
  try {
    const providers = new ProviderRepository(db);
    const result = await llmCompact(
      messages.map(m => ({ role: m.role, content: m.content })),
      providers,
    );

    if (result) {
      for (const fact of result.facts) {
        memRepo.set(
          agentId,
          `${fact.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          fact.value,
          (fact.type ?? 'fact') as any,
          0.9,  // High confidence — intensive extraction
          undefined,
          { source: 'intensive_extraction' },
        );
        factsExtracted++;
      }
      logger.info('[SessionRotator] L4 extracted %d facts via LLM (%s)', factsExtracted, result.model);
    }
  } catch (err) {
    logger.warn('[SessionRotator] L4 extraction failed: %s', (err as Error).message);
  }

  // ── L3: Working memory — compacted state of current task ──────────────────
  let workingMemorySaved = false;
  try {
    const recentAssistant = messages.filter(m => m.role === 'assistant').slice(-5);
    const recentUser = messages.filter(m => m.role === 'user').slice(-3);

    const activeGoals: string[] = [];
    const completedSteps: string[] = [];
    const nextActions: string[] = [];
    const openQuestions: string[] = [];

    for (const msg of [...recentUser, ...recentAssistant]) {
      const text = msg.content;
      if (!text) continue;
      for (const line of text.split('\n')) {
        const lo = line.toLowerCase().trim();
        if (!lo || lo.length < 5) continue;
        if (/(?:goal|objective|need to|must|should|want to|preciso|quero|vou)\b/i.test(lo) && lo.length < 300)
          activeGoals.push(line.trim().slice(0, 200));
        if (/(?:done|completed|finished|implemented|fixed|✅|✓|pronto|feito|concluído)\b/i.test(lo) && lo.length < 300)
          completedSteps.push(line.trim().slice(0, 200));
        if (/(?:next|todo|will do|plan to|going to|próximo|depois|em seguida)\b/i.test(lo) && lo.length < 300)
          nextActions.push(line.trim().slice(0, 200));
        if (lo.endsWith('?') && msg.role === 'user')
          openQuestions.push(line.trim().slice(0, 200));
      }
    }

    const pendingContext = recentUser.length > 0
      ? recentUser[recentUser.length - 1].content.slice(0, 500)
      : '';

    memRepo.saveWorkingMemory(sessionId, agentId, {
      activeGoals: [...new Set(activeGoals)].slice(0, 10),
      currentPlan: '',
      completedSteps: [...new Set(completedSteps)].slice(0, 10),
      nextActions: [...new Set(nextActions)].slice(0, 10),
      pendingContext,
      openQuestions: [...new Set(openQuestions)].slice(0, 5),
    });
    workingMemorySaved = true;
    logger.info('[SessionRotator] L3 working memory saved');
  } catch (err) {
    logger.warn('[SessionRotator] L3 save failed: %s', (err as Error).message);
  }

  // ── Fidelity score: how complete was the extraction? ──────────────────────
  const fidelityScore = Math.min(1.0,
    (messagesArchived > 0 ? 0.5 : 0) +        // L5 complete
    (factsExtracted > 0 ? 0.3 : 0) +           // L4 has facts
    (workingMemorySaved ? 0.2 : 0),             // L3 saved
  );

  return { factsExtracted, messagesArchived, workingMemorySaved, fidelityScore };
}

// ─── Step 2: Fidelity Check ─────────────────────────────────────────────────

/**
 * Verify that extraction was complete. Called at 85% threshold.
 * If fidelity is low, run another extraction pass.
 */
export async function fidelityCheck(
  sessionId: string,
  agentId: string,
  previousResult: ExtractionResult,
): Promise<ExtractionResult> {
  if (previousResult.fidelityScore >= 0.8) {
    logger.info('[SessionRotator] Fidelity check passed (score=%s)', previousResult.fidelityScore.toFixed(2));
    return previousResult;
  }

  logger.warn('[SessionRotator] Fidelity low (score=%s), running second extraction pass', previousResult.fidelityScore.toFixed(2));
  const secondPass = await intensiveExtraction(sessionId, agentId);

  // Merge results
  return {
    factsExtracted: previousResult.factsExtracted + secondPass.factsExtracted,
    messagesArchived: Math.max(previousResult.messagesArchived, secondPass.messagesArchived),
    workingMemorySaved: previousResult.workingMemorySaved || secondPass.workingMemorySaved,
    fidelityScore: Math.max(previousResult.fidelityScore, secondPass.fidelityScore),
  };
}

// ─── Step 3: Session Rotation ───────────────────────────────────────────────

/**
 * Create a new session, link it to the old one, inject memory context.
 * The user should not perceive any interruption.
 */
export async function rotateSession(
  oldSessionId: string,
  agentId: string,
  modelId: string,
  extraction: ExtractionResult,
): Promise<RotationResult> {
  const db = getDb();
  const sessionManager = getSessionManager();
  const memRepo = new AgentMemoryRepository(db);

  // ── Guard: minimum interval ───────────────────────────────────────────────
  const now = Date.now();
  const lastRotation = lastRotationTime.get(oldSessionId);
  if (lastRotation && (now - lastRotation) < MIN_ROTATION_INTERVAL_MS) {
    return { rotated: false, reason: 'Too soon since last rotation' };
  }

  // ── Get old session info ──────────────────────────────────────────────────
  const oldSession = sessionManager.getSession(oldSessionId);
  if (!oldSession) {
    return { rotated: false, reason: 'Old session not found' };
  }

  // ── Determine chain_id ────────────────────────────────────────────────────
  const existingChain = db.prepare(`
    SELECT chain_id, MAX(sequence_number) as max_seq
    FROM session_chain WHERE session_id = ?
  `).get(oldSessionId) as { chain_id: string; max_seq: number } | undefined;

  const chainId = existingChain?.chain_id ?? randomUUID();
  const sequenceNumber = (existingChain?.max_seq ?? 0) + 1;

  // ── Create new session ────────────────────────────────────────────────────
  const newSessionId = sessionManager.createSession({
    title: oldSession.title,
    provider_id: oldSession.provider_id,
    model_id: oldSession.model_id,
    agent_id: oldSession.agent_id,
    mode: oldSession.mode,
    squad_id: oldSession.squad_id,
  }).id;

  // ── Link sessions in chain ────────────────────────────────────────────────
  // Register old session in chain if first rotation
  if (!existingChain?.chain_id) {
    db.prepare(`
      INSERT OR IGNORE INTO session_chain (id, chain_id, session_id, sequence_number, parent_session_id, rotation_reason, tokens_at_rotation, created_at)
      VALUES (?, ?, ?, 0, NULL, 'original', 0, datetime('now'))
    `).run(randomUUID(), chainId, oldSessionId);
  }

  // Register new session in chain
  const tokenStatus = checkTokenStatus(
    sessionManager.getMessages(oldSessionId, { limit: 100_000 }).map(m => ({
      role: m.role,
      content: m.content,
      tool_result: m.tool_result,
    })),
    modelId,
  );

  db.prepare(`
    INSERT INTO session_chain (id, chain_id, session_id, sequence_number, parent_session_id, rotation_reason, tokens_at_rotation, facts_extracted, messages_archived, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    randomUUID(),
    chainId,
    newSessionId,
    sequenceNumber,
    oldSessionId,
    `Context at ${(tokenStatus.ratio * 100).toFixed(0)}%`,
    tokenStatus.currentTokens,
    extraction.factsExtracted,
    extraction.messagesArchived,
  );

  // ── Inject context into new session ───────────────────────────────────────
  // Build context from memory layers
  const contextParts: string[] = [];

  // L3: Working memory (compacted — current task state)
  try {
    const workingMem = memRepo.getWorkingMemory(oldSessionId);
    if (workingMem) {
      const wmParts: string[] = ['[Working Memory — Current State]'];
      if (workingMem.activeGoals?.length) wmParts.push(`Goals: ${workingMem.activeGoals.join('; ')}`);
      if (workingMem.completedSteps?.length) wmParts.push(`Done: ${workingMem.completedSteps.join('; ')}`);
      if (workingMem.nextActions?.length) wmParts.push(`Next: ${workingMem.nextActions.join('; ')}`);
      if (workingMem.openQuestions?.length) wmParts.push(`Open questions: ${workingMem.openQuestions.join('; ')}`);
      if (workingMem.pendingContext) wmParts.push(`Last context: ${workingMem.pendingContext}`);
      contextParts.push(wmParts.join('\n'));
    }
  } catch (err) {
    logger.warn('[SessionRotator] Failed to inject L3: %s', (err as Error).message);
  }

  // L4: Recent relevant facts
  try {
    const recentFacts = memRepo.search('session context', 10);
    if (recentFacts.length > 0) {
      const factLines = recentFacts.map(f => `- [${f.type}] ${f.value}`);
      contextParts.push(`[Recent Knowledge]\n${factLines.join('\n')}`);
    }
  } catch (err) {
    logger.warn('[SessionRotator] Failed to inject L4: %s', (err as Error).message);
  }

  // Inject as system message in new session
  if (contextParts.length > 0) {
    const contextMsg = `[Session Continuation — Auto-rotated for optimal performance]\n\n${contextParts.join('\n\n')}\n\n[Previous session archived. Full history searchable via archival memory.]`;

    sessionManager.addMessage(newSessionId, {
      role: 'system',
      content: contextMsg,
      agent_id: agentId,
    });
  }

  // ── Mark rotation time ────────────────────────────────────────────────────
  lastRotationTime.set(oldSessionId, now);

  logger.info(
    '[SessionRotator] Rotated session %s → %s (chain=%s, seq=%d, facts=%d, archived=%d)',
    oldSessionId, newSessionId, chainId, sequenceNumber,
    extraction.factsExtracted, extraction.messagesArchived,
  );

  return {
    rotated: true,
    reason: `Context at ${(tokenStatus.ratio * 100).toFixed(0)}%`,
    oldSessionId,
    newSessionId,
    extractedFacts: extraction.factsExtracted,
    archivedMessages: extraction.messagesArchived,
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/** State per session — tracks extraction progress */
const extractionState = new Map<string, { result: ExtractionResult; level: ThresholdLevel }>();

/**
 * handleThreshold — Main entry point. Called by agent-runner after each turn.
 * Receives the token status and orchestrates the appropriate action.
 *
 * Returns the new session ID if rotated, or null if no rotation occurred.
 */
export async function handleThreshold(
  tokenStatus: TokenStatus,
  sessionId: string,
  agentId: string,
  modelId: string,
): Promise<string | null> {
  if (!tokenStatus.actionRequired) return null;

  const key = `${agentId}:${sessionId}`;

  switch (tokenStatus.recommendedAction) {
    case 'extract': {
      // 70% — Start intensive extraction
      if (!extractionState.has(key)) {
        logger.info('[SessionRotator] 70%% threshold — starting intensive extraction');
        const result = await intensiveExtraction(sessionId, agentId);
        extractionState.set(key, { result, level: 'extraction' });
      }
      return null;
    }

    case 'verify': {
      // 85% — Fidelity check
      const state = extractionState.get(key);
      if (state && state.level === 'extraction') {
        logger.info('[SessionRotator] 85%% threshold — running fidelity check');
        const verified = await fidelityCheck(sessionId, agentId, state.result);
        extractionState.set(key, { result: verified, level: 'fidelity' });
      } else if (!state) {
        // Missed the 70% threshold — extract now
        const result = await intensiveExtraction(sessionId, agentId);
        const verified = await fidelityCheck(sessionId, agentId, result);
        extractionState.set(key, { result: verified, level: 'fidelity' });
      }
      return null;
    }

    case 'rotate': {
      // 90% — Rotate session
      let extraction = extractionState.get(key)?.result;
      if (!extraction) {
        // Emergency: no prior extraction — do it now
        logger.warn('[SessionRotator] 90%% threshold with no prior extraction — emergency extraction');
        extraction = await intensiveExtraction(sessionId, agentId);
        await fidelityCheck(sessionId, agentId, extraction);
      }

      const result = await rotateSession(sessionId, agentId, modelId, extraction);
      extractionState.delete(key);

      if (result.rotated && result.newSessionId) {
        return result.newSessionId;
      }
      return null;
    }

    default:
      return null;
  }
}

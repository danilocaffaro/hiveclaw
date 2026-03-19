/**
 * engine/heartbeat-scheduler.ts — Proactive heartbeat executor (P4)
 *
 * Reads heartbeat_config, runs the designated agent at the configured interval.
 * The agent's response is stored in heartbeat_runs.
 *
 * Design: Reuses the existing agent runner (v1/v2) directly, not the
 * automations system. Heartbeat is a first-class concept with its own
 * config, history, and status — not just another automation.
 *
 * Flow:
 *   1. Timer fires → create heartbeat_runs entry (status=running)
 *   2. Find or create a dedicated heartbeat session for the agent
 *   3. Send the heartbeat prompt to the agent
 *   4. Collect the full response → update heartbeat_runs (status=completed/failed)
 *   5. If response contains alerts → optionally notify (future: channel delivery)
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { runAgent, type AgentConfig } from './agent-runner.js';
import { runAgentV2 } from './agent-runner-v2.js';
import { getDb } from '../db/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface HeartbeatConfig {
  id: number;
  enabled: number;
  interval_minutes: number;
  agent_id: string | null;
  prompt: string | null;
  last_run_id: string | null;
}

// ─── State ──────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ─── Default Prompt ─────────────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT_PROMPT = `[HEARTBEAT] Run a quick health check:
1. Check server status (memory usage, uptime)
2. Check for any pending tasks or alerts
3. Report any issues found, or confirm all clear.
Keep the response concise.`;

// ─── Core Execution ─────────────────────────────────────────────────────────────

async function executeHeartbeat(db: Database.Database): Promise<void> {
  if (_running) {
    logger.info('[heartbeat] Skipping — previous heartbeat still running');
    return;
  }

  _running = true;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // Read config
    const config = db.prepare('SELECT * FROM heartbeat_config WHERE id = 1').get() as HeartbeatConfig | undefined;
    if (!config || !config.enabled) {
      _running = false;
      return;
    }

    // Need an agent to run
    const agentId = config.agent_id;
    if (!agentId) {
      logger.warn('[heartbeat] No agent_id configured — skipping');
      _running = false;
      return;
    }

    // Load agent config
    const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
    if (!agentRow) {
      logger.warn('[heartbeat] Agent %s not found — skipping', agentId);
      _running = false;
      return;
    }

    // Record run start
    db.prepare(
      "INSERT INTO heartbeat_runs (id, status, started_at) VALUES (?, 'running', ?)"
    ).run(runId, startedAt);

    // Find or create dedicated heartbeat session
    const sessionTitle = `[Heartbeat] ${agentRow.name || agentId}`;
    let session = db.prepare(
      "SELECT id FROM sessions WHERE title = ? AND agent_id = ? LIMIT 1"
    ).get(sessionTitle, agentId) as { id: string } | undefined;

    if (!session) {
      const sid = randomUUID();
      db.prepare(
        "INSERT INTO sessions (id, title, agent_id, created_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(sid, sessionTitle, agentId);
      session = { id: sid };
      logger.info('[heartbeat] Created dedicated session %s for agent %s', sid, agentId);
    }

    const agentConfig: AgentConfig = {
      id: String(agentRow.id),
      name: String(agentRow.name || ''),
      emoji: String(agentRow.emoji || '🤖'),
      systemPrompt: String(agentRow.system_prompt || ''),
      providerId: String(agentRow.provider_preference || agentRow.provider_id || ''),
      modelId: String(agentRow.model_preference || agentRow.model_id || ''),
      temperature: Number(agentRow.temperature ?? 0.7),
      maxTokens: Number(agentRow.max_tokens ?? 4096),
      tools: JSON.parse(String(agentRow.tools || '[]')),
      maxToolIterations: agentRow.max_tool_iterations ? Number(agentRow.max_tool_iterations) : undefined,
      engineVersion: (Number(agentRow.engine_version) || 1) as 1 | 2,
    };

    const prompt = config.prompt || DEFAULT_HEARTBEAT_PROMPT;
    const runner = agentConfig.engineVersion === 2 ? runAgentV2 : runAgent;

    // Run agent and collect response
    let fullResponse = '';
    let tokensIn = 0;
    let tokensOut = 0;

    for await (const event of runner(session.id, prompt, agentConfig)) {
      if (event.event === 'message.delta') {
        const delta = event.data as { text?: string };
        if (delta.text) fullResponse += delta.text;
      } else if (event.event === 'message.finish') {
        const finish = event.data as { tokens_in?: number; tokens_out?: number };
        tokensIn = finish.tokens_in ?? 0;
        tokensOut = finish.tokens_out ?? 0;
      }
    }

    // Record completion
    const completedAt = new Date().toISOString();
    const result = JSON.stringify({
      response: fullResponse.slice(0, 5000),
      tokensIn,
      tokensOut,
      sessionId: session.id,
    });

    db.prepare(
      "UPDATE heartbeat_runs SET status = 'completed', completed_at = ?, result = ? WHERE id = ?"
    ).run(completedAt, result, runId);

    db.prepare(
      'UPDATE heartbeat_config SET last_run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(runId);

    logger.info('[heartbeat] Completed run %s — %d chars, %d/%d tokens', runId, fullResponse.length, tokensIn, tokensOut);

    // Check for alert indicators in the response
    const alertPatterns = [/🔴|critical|emergency|down|unreachable|crash/i, /⚠️|warning|degraded|high.*load/i];
    const hasAlert = alertPatterns.some(p => p.test(fullResponse));
    if (hasAlert) {
      logger.warn('[heartbeat] Alert detected in heartbeat response! Run: %s', runId);
      // Future: deliver alert via channel (Telegram, etc.)
    }

  } catch (err) {
    logger.error('[heartbeat] Execution failed: %s', (err as Error).message);
    try {
      db.prepare(
        "UPDATE heartbeat_runs SET status = 'failed', completed_at = ?, result = ? WHERE id = ?"
      ).run(new Date().toISOString(), JSON.stringify({ error: (err as Error).message }), runId);
    } catch { /* ignore DB error during error handling */ }
  } finally {
    _running = false;
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────────

export function startHeartbeatScheduler(): void {
  const db = getDb();

  // Ensure config table has new columns
  try {
    db.exec(`ALTER TABLE heartbeat_config ADD COLUMN agent_id TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE heartbeat_config ADD COLUMN prompt TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }

  const config = db.prepare('SELECT * FROM heartbeat_config WHERE id = 1').get() as HeartbeatConfig | undefined;
  if (!config || !config.enabled || !config.agent_id) {
    logger.info('[heartbeat] Scheduler not started (disabled or no agent configured)');
    return;
  }

  const intervalMs = config.interval_minutes * 60 * 1000;

  // First run after a short delay (30s), then at interval
  const firstRunDelay = 30_000;
  setTimeout(() => {
    void executeHeartbeat(db);

    _timer = setInterval(() => {
      void executeHeartbeat(db);
    }, intervalMs);
    _timer.unref();
  }, firstRunDelay);

  logger.info('[heartbeat] Scheduler started — every %d min, agent: %s', config.interval_minutes, config.agent_id);
}

export function stopHeartbeatScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/** Trigger a heartbeat run immediately (for the API endpoint). */
export async function triggerHeartbeat(): Promise<{ runId: string; status: string }> {
  const db = getDb();
  const config = db.prepare('SELECT * FROM heartbeat_config WHERE id = 1').get() as HeartbeatConfig | undefined;

  if (!config?.agent_id) {
    return { runId: '', status: 'skipped — no agent configured' };
  }

  // Fire-and-forget
  void executeHeartbeat(db);
  return { runId: 'triggered', status: 'running' };
}

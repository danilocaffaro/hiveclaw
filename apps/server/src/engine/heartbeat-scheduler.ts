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

/** Max wall time for a single heartbeat run (60s). Prevents hung agents. */
const HEARTBEAT_TIMEOUT_MS = 60_000;

// ─── Default Prompt ─────────────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT_PROMPT = `[HEARTBEAT] Run a quick health check:
1. Check server status (memory usage, uptime)
2. Check for any pending tasks or alerts
3. Report any issues found, or confirm all clear.

End your response with a JSON status block:
\`\`\`json
{"status": "ok|warning|critical", "alerts": ["description of any issues"]}
\`\`\`
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

    // Run agent with timeout — heartbeats should be fast (60s max)
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), HEARTBEAT_TIMEOUT_MS);

    let fullResponse = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let timedOut = false;

    try {
      const runnerOpts = agentConfig.engineVersion === 2
        ? { signal: abortController.signal }
        : undefined;

      for await (const event of runner(session.id, prompt, agentConfig, runnerOpts)) {
        if (abortController.signal.aborted) {
          timedOut = true;
          break;
        }
        if (event.event === 'message.delta') {
          const delta = event.data as { text?: string };
          if (delta.text) fullResponse += delta.text;
        } else if (event.event === 'message.finish') {
          const finish = event.data as { tokens_in?: number; tokens_out?: number };
          tokensIn = finish.tokens_in ?? 0;
          tokensOut = finish.tokens_out ?? 0;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (timedOut) {
      logger.warn('[heartbeat] Run %s timed out after %dms', runId, HEARTBEAT_TIMEOUT_MS);
      fullResponse += '\n[HEARTBEAT TIMEOUT — agent did not complete within time limit]';
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

    // Detect alert level from structured response or fallback heuristics.
    // Preferred: agent returns JSON block like ```json\n{"status":"critical","alerts":[...]}\n```
    // Fallback: keyword detection (only on lines starting with status markers, not in technical prose).
    let alertLevel: 'ok' | 'warning' | 'critical' = 'ok';

    // Try structured JSON extraction first
    const jsonMatch = fullResponse.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as { status?: string; alerts?: unknown[] };
        if (parsed.status === 'critical' || (parsed.alerts && parsed.alerts.length > 0)) {
          alertLevel = 'critical';
        } else if (parsed.status === 'warning') {
          alertLevel = 'warning';
        }
      } catch { /* malformed JSON, fall through to heuristic */ }
    }

    // Fallback heuristic: only match explicit status-reporting patterns, not technical prose
    if (alertLevel === 'ok') {
      // Lines that START with alert markers (agent deliberately flagging something)
      const lines = fullResponse.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^(🔴|❌|\[CRITICAL\]|\[ALERT\])/i.test(trimmed)) { alertLevel = 'critical'; break; }
        if (/^(⚠️|🟡|\[WARNING\])/i.test(trimmed)) { alertLevel = alertLevel === 'critical' ? 'critical' : 'warning'; }
      }
      // Timeout is always at least a warning
      if (timedOut && alertLevel === 'ok') alertLevel = 'warning';
    }

    if (alertLevel !== 'ok') {
      logger.warn('[heartbeat] Alert level=%s in run %s', alertLevel, runId);
      // Future: deliver alert via channel (Telegram, etc.)
    }

    // Store alert level in result
    db.prepare(
      "UPDATE heartbeat_runs SET result = json_set(result, '$.alertLevel', ?) WHERE id = ?"
    ).run(alertLevel, runId);

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

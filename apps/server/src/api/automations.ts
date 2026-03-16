/**
 * api/automations.ts — Automation CRUD + cron scheduler (R6)
 *
 * Trigger types:
 *   - cron: runs on schedule (e.g., "0 9 * * 1-5" = weekdays at 9am)
 *   - event: fires on system events (future: on_message, on_session_create)
 *   - webhook: fires on incoming webhook POST
 *
 * Action types:
 *   - send_message: sends a prompt to an agent session
 *   - run_workflow: starts a workflow run
 *   - http_request: makes an HTTP request (future)
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { runAgent, type AgentConfig } from '../engine/agent-runner.js';

interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: number;
  trigger_type: 'cron' | 'event' | 'webhook';
  trigger_config: string;
  agent_id: string | null;
  action_type: 'send_message' | 'run_workflow' | 'http_request' | 'webhook_call';
  action_config: string;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
}

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

const cronTimers = new Map<string, ReturnType<typeof setInterval>>();

function parseCronToMs(cron: string): number | null {
  // Cron parser for common patterns — returns interval in ms
  // Supports: */N (every N min/hour), fixed time, weekday filtering
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [min, hour, , , dow] = parts;

  // Every N minutes: */N * * * *
  const everyMinMatch = min.match(/^\*\/(\d+)$/);
  if (everyMinMatch && hour === '*') {
    return parseInt(everyMinMatch[1]) * 60 * 1000;
  }

  // Every N hours: 0 */N * * *
  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (min === '0' && everyHourMatch) {
    return parseInt(everyHourMatch[1]) * 3600 * 1000;
  }

  // Daily/weekday at specific time: M H * * * or M H * * 1-5
  const fixedMin = parseInt(min);
  const fixedHour = parseInt(hour);
  if (!isNaN(fixedMin) && !isNaN(fixedHour) && parts[2] === '*' && parts[3] === '*') {
    // Run daily — use 24h interval (weekday filtering happens at execution time)
    return 24 * 3600 * 1000;
  }

  // Unrecognized pattern — log warning and return null (don't silently default)
  logger.warn('[cron] Unrecognized cron pattern "%s" — skipping schedule', cron);
  return null;
}

/** Parse day-of-week from cron field. Returns null (any day) or Set of 0-6 (Sun-Sat). */
function parseDowFilter(cron: string): Set<number> | null {
  const parts = cron.trim().split(/\s+/);
  const dow = parts[4] ?? '*';
  if (dow === '*') return null; // any day

  const days = new Set<number>();
  for (const segment of dow.split(',')) {
    const range = segment.match(/^(\d)-(\d)$/);
    if (range) {
      for (let d = parseInt(range[1]); d <= parseInt(range[2]); d++) days.add(d);
    } else if (/^\d$/.test(segment)) {
      days.add(parseInt(segment));
    }
  }
  return days.size > 0 ? days : null;
}

function getNextRunDelay(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 60000;

  const [minPart, hourPart] = parts;
  const fixedMin = parseInt(minPart);
  const fixedHour = parseInt(hourPart);

  if (!isNaN(fixedMin) && !isNaN(fixedHour) && parts[2] === '*' && parts[3] === '*') {
    // Daily: calculate ms until next HH:MM
    const now = new Date();
    const target = new Date(now);
    target.setHours(fixedHour, fixedMin, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  // For interval-based crons, start immediately
  return 1000;
}

async function executeAutomation(db: Database.Database, auto: Automation): Promise<void> {
  logger.info('[automation] Executing "%s" (agent_id=%s, action=%s)', auto.name, auto.agent_id, auto.action_type);
  const config = JSON.parse(auto.action_config || '{}');

  try {
    if (auto.action_type === 'send_message' && auto.agent_id) {
      // Create or find a session for this automation
      const sessionTitle = `[Auto] ${auto.name}`;
      let session = db.prepare(
        "SELECT id FROM sessions WHERE title = ? AND agent_id = ? LIMIT 1"
      ).get(sessionTitle, auto.agent_id) as { id: string } | undefined;

      if (!session) {
        const sid = randomUUID();
        db.prepare(
          "INSERT INTO sessions (id, title, agent_id, created_at) VALUES (?, ?, ?, datetime('now'))"
        ).run(sid, sessionTitle, auto.agent_id);
        session = { id: sid };
      }

      // Store the user message
      const msgId = randomUUID();
      const message = config.message || config.prompt || `Automation: ${auto.name}`;
      // Store as JSON content block (same format as session-manager.ts saveMessage)
      const contentJson = JSON.stringify([{ type: 'text', text: message }]);
      db.prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))"
      ).run(msgId, session.id, contentJson);

      // Actually trigger the agent to respond (R9 fix: was dead-letter before)
      const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(auto.agent_id) as Record<string, unknown> | undefined;
      if (agentRow) {
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
        };
        // Consume the SSE stream to completion (fire-and-forget — no client to stream to)
        try {
          logger.info('[automation] Running agent %s (provider=%s model=%s)', agentConfig.name, agentConfig.providerId, agentConfig.modelId);
          for await (const _event of runAgent(session.id, message, agentConfig, { skipPersistUserMessage: true })) {
            // Events consumed silently — agent response is persisted in DB by agent-runner
          }
          logger.info('[automation] Agent %s completed for "%s"', agentConfig.name, auto.name);
        } catch (runErr) {
          logger.error({ err: runErr, autoId: auto.id }, '[automation] Agent run failed for "%s"', auto.name);
        }
      }

      logger.info('[automation] Executed "%s" → message to agent %s', auto.name, auto.agent_id);
    }

    // ─── Outbound Webhook Action (R19.4) ────────────────────────────────────
    if (auto.action_type === 'webhook_call') {
      const url = config.url;
      if (!url) {
        throw new Error('webhook_call action requires a url in action_config');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
      };

      // Build the outbound payload — include automation context
      const payload = config.body
        ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body))
        : JSON.stringify({
            automation: { id: auto.id, name: auto.name },
            agent_id: auto.agent_id,
            trigger_type: auto.trigger_type,
            timestamp: new Date().toISOString(),
            message: config.message || config.prompt || null,
          });

      logger.info('[automation] Outbound webhook to %s for "%s"', url, auto.name);

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000), // 30s timeout
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Webhook returned ${resp.status}: ${body.slice(0, 200)}`);
      }

      logger.info('[automation] Outbound webhook OK (%d) for "%s"', resp.status, auto.name);
    }

    // Update status
    db.prepare(
      "UPDATE automations SET last_run_at = datetime('now'), last_run_status = 'success', run_count = run_count + 1 WHERE id = ?"
    ).run(auto.id);

  } catch (err) {
    logger.error({ err, autoId: auto.id }, '[automation] Execution failed');
    db.prepare(
      "UPDATE automations SET last_run_at = datetime('now'), last_run_status = ? WHERE id = ?"
    ).run(String(err), auto.id);
  }
}

export function startCronScheduler(db: Database.Database): void {
  // Load all enabled cron automations
  const autos = db.prepare(
    "SELECT * FROM automations WHERE enabled = 1 AND trigger_type = 'cron'"
  ).all() as Automation[];

  for (const auto of autos) {
    scheduleCron(db, auto);
  }

  logger.info('[automation] Cron scheduler started with %d automations', autos.length);
}

function scheduleCron(db: Database.Database, auto: Automation): void {
  // Clear existing timer
  const existing = cronTimers.get(auto.id);
  if (existing) clearInterval(existing);

  const config = JSON.parse(auto.trigger_config || '{}');
  const cron = config.cron ?? config.schedule;
  if (!cron) return;

  const intervalMs = parseCronToMs(cron);
  if (!intervalMs) return;

  const dowFilter = parseDowFilter(cron);
  const firstDelay = getNextRunDelay(cron);

  const shouldRunToday = (): boolean => {
    if (!dowFilter) return true;
    return dowFilter.has(new Date().getDay());
  };

  // Schedule first run, then repeat
  const timeout = setTimeout(() => {
    if (shouldRunToday()) void executeAutomation(db, auto);

    const interval = setInterval(() => {
      // Re-check if still enabled
      const current = db.prepare("SELECT enabled FROM automations WHERE id = ?").get(auto.id) as { enabled: number } | undefined;
      if (!current || !current.enabled) {
        clearInterval(interval);
        cronTimers.delete(auto.id);
        return;
      }
      if (shouldRunToday()) void executeAutomation(db, auto);
    }, intervalMs);

    cronTimers.set(auto.id, interval);
  }, firstDelay);

  // Store timeout ref for cleanup
  cronTimers.set(auto.id, timeout as unknown as ReturnType<typeof setInterval>);
}

export function stopCronScheduler(): void {
  for (const [id, timer] of cronTimers) {
    clearInterval(timer);
    cronTimers.delete(id);
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

export function registerAutomationRoutes(app: FastifyInstance, db: Database.Database): void {

  // GET /api/automations — list all automations
  app.get('/api/automations', async () => {
    const autos = db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all() as Automation[];
    return {
      data: autos.map(a => ({
        ...a,
        enabled: !!a.enabled,
        trigger_config: JSON.parse(a.trigger_config || '{}'),
        action_config: JSON.parse(a.action_config || '{}'),
      })),
    };
  });

  // POST /api/automations — create automation
  app.post<{
    Body: {
      name: string;
      description?: string;
      triggerType: 'cron' | 'event' | 'webhook';
      triggerConfig: Record<string, unknown>;
      agentId?: string;
      actionType?: 'send_message' | 'run_workflow' | 'http_request';
      actionConfig?: Record<string, unknown>;
    };
  }>('/api/automations', async (req, reply) => {
    const { name, description = '', triggerType, triggerConfig, agentId, actionType = 'send_message', actionConfig = {} } = req.body ?? {};

    if (!name) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name is required' } });
    if (!triggerType) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'triggerType is required' } });

    const validTriggers = ['cron', 'event', 'webhook'];
    if (!validTriggers.includes(triggerType)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `triggerType must be one of: ${validTriggers.join(', ')}` } });
    }
    const validActions = ['send_message', 'run_workflow', 'http_request', 'webhook_call'];
    if (!validActions.includes(actionType)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `actionType must be one of: ${validActions.join(', ')}` } });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO automations (id, name, description, trigger_type, trigger_config, agent_id, action_type, action_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, triggerType, JSON.stringify(triggerConfig), agentId ?? null, actionType, JSON.stringify(actionConfig));

    // If cron, schedule it
    if (triggerType === 'cron') {
      const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Automation;
      scheduleCron(db, auto);
    }

    return reply.status(201).send({ data: { id, name } });
  });

  // PUT /api/automations/:id — update automation
  app.put<{
    Params: { id: string };
    Body: Partial<{
      name: string;
      description: string;
      enabled: boolean;
      triggerConfig: Record<string, unknown>;
      agentId: string;
      actionConfig: Record<string, unknown>;
    }>;
  }>('/api/automations/:id', async (req, reply) => {
    const fields: string[] = [];
    const values: unknown[] = [];

    const b = req.body ?? {};
    if (b.name !== undefined) { fields.push('name = ?'); values.push(b.name); }
    if (b.description !== undefined) { fields.push('description = ?'); values.push(b.description); }
    if (b.enabled !== undefined) { fields.push('enabled = ?'); values.push(b.enabled ? 1 : 0); }
    if (b.triggerConfig !== undefined) { fields.push('trigger_config = ?'); values.push(JSON.stringify(b.triggerConfig)); }
    if (b.agentId !== undefined) { fields.push('agent_id = ?'); values.push(b.agentId); }
    if (b.actionConfig !== undefined) { fields.push('action_config = ?'); values.push(JSON.stringify(b.actionConfig)); }

    if (fields.length === 0) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'No fields to update' } });

    values.push(req.params.id);
    db.prepare(`UPDATE automations SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Reschedule cron if needed
    const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id) as Automation | undefined;
    if (auto?.trigger_type === 'cron') {
      if (auto.enabled) {
        scheduleCron(db, auto);
      } else {
        const timer = cronTimers.get(auto.id);
        if (timer) { clearInterval(timer); cronTimers.delete(auto.id); }
      }
    }

    return { data: { success: true } };
  });

  // DELETE /api/automations/:id — delete automation
  app.delete<{ Params: { id: string } }>('/api/automations/:id', async (req, reply) => {
    const timer = cronTimers.get(req.params.id);
    if (timer) { clearInterval(timer); cronTimers.delete(req.params.id); }

    const result = db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });
    }
    return { data: { success: true } };
  });

  // POST /api/automations/:id/run — manually trigger an automation
  app.post<{ Params: { id: string } }>('/api/automations/:id/run', async (req, reply) => {
    const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id) as Automation | undefined;
    if (!auto) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });

    // Fire-and-forget: don't await (automation runs in background)
    void executeAutomation(db, auto).catch(err => {
      logger.error({ err, autoId: auto.id }, '[automation] Unhandled execution error');
    });
    return { data: { success: true, message: `Automation "${auto.name}" triggered` } };
  });

  // ─── Webhook Trigger Endpoint (R19) ─────────────────────────────────────────
  // POST /api/automations/:id/webhook — external trigger for webhook-type automations
  // Can be called by n8n, Zapier, Make, curl, or any HTTP client.
  // Optional: pass JSON body with { message } to override the automation's default prompt.
  // Auth: open by design (automation ID = secret), or use ?token= for extra security.
  app.post<{
    Params: { id: string };
    Body?: { message?: string; data?: Record<string, unknown> };
    Querystring?: { token?: string };
  }>('/api/automations/:id/webhook', async (req, reply) => {
    const auto = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id) as Automation | undefined;
    if (!auto) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });

    if (!auto.enabled) {
      return reply.status(403).send({ error: { code: 'DISABLED', message: 'Automation is disabled' } });
    }

    // Optional webhook token check
    const triggerConfig = JSON.parse(auto.trigger_config || '{}');
    if (triggerConfig.webhookToken) {
      const providedToken = (req.query as Record<string, string>)?.token ?? req.headers['x-webhook-token'];
      if (providedToken !== triggerConfig.webhookToken) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token' } });
      }
    }

    // Allow overriding the message/prompt from the webhook payload
    const body = req.body as Record<string, unknown> | null;
    const overrideMessage = typeof body?.message === 'string' ? body.message : null;
    const webhookData = body?.data ?? body ?? {};

    // If there's an override message, temporarily modify the automation's action config
    let autoToRun = auto;
    if (overrideMessage) {
      const actionConfig = JSON.parse(auto.action_config || '{}');
      actionConfig.message = overrideMessage;
      autoToRun = { ...auto, action_config: JSON.stringify(actionConfig) };
    }

    logger.info('[webhook] Triggered automation "%s" (id=%s) via webhook', auto.name, auto.id);

    // Fire-and-forget
    void executeAutomation(db, autoToRun).catch(err => {
      logger.error({ err, autoId: auto.id }, '[webhook] Execution error');
    });

    return {
      data: {
        success: true,
        message: `Webhook triggered automation "${auto.name}"`,
        automationId: auto.id,
        overrideApplied: !!overrideMessage,
      },
    };
  });
}

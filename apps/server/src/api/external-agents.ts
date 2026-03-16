/**
 * api/external-agents.ts — External Agent Management API
 *
 * CRUD for external agents + webhook callback endpoint + protocol pack.
 *
 * Routes:
 *   GET    /external-agents              — List all external agents
 *   POST   /external-agents              — Register a new external agent
 *   GET    /external-agents/:id          — Get one external agent
 *   PATCH  /external-agents/:id          — Update an external agent
 *   DELETE /external-agents/:id          — Remove an external agent
 *   POST   /external-agents/:id/callback — Webhook callback (inbound from external agent)
 *   GET    /external-agents/:id/protocol-pack — Get Protocol Pack for Tier 2 upgrade
 *   POST   /external-agents/:id/upgrade  — Upgrade to Tier 2
 *   POST   /external-agents/:id/test     — Send a test message to verify connectivity
 */

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { type ExternalAgentCreateInput, type ExternalAgentTier, type ExternalAgentStatus } from '../db/external-agents.js';
import { getEngineService } from '../engine/engine-service.js';
import { generateProtocolPack } from '../engine/external-agent-bridge.js';
import { broadcastSSE } from './sse.js';
import { logger } from '../lib/logger.js';
import { DEFAULT_PORT } from '../config/defaults.js';

// ─── Pending callback storage (for async responses) ────────────────────────────

interface PendingCallback {
  resolve: (text: string) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingCallbacks = new Map<string, PendingCallback>();

/**
 * Register a pending callback for a request. Returns a promise that resolves
 * when the external agent responds via the callback endpoint.
 */
export function registerPendingCallback(requestId: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCallbacks.delete(requestId);
      resolve('⚠️ Callback timed out');
    }, timeoutMs);

    pendingCallbacks.set(requestId, { resolve, timer });
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export function registerExternalAgentRoutes(app: FastifyInstance): void {
  const engine = getEngineService();
  const repo = engine.db.externalAgents();

  // ── List all external agents ──────────────────────────────────────────────

  app.get('/external-agents', async () => {
    const agents = repo.list();
    // Never expose tokens in list view
    return {
      data: agents.map(a => ({
        ...a,
        inboundToken: '***',
        outboundToken: '***',
      })),
    };
  });

  // ── Register a new external agent ─────────────────────────────────────────

  app.post<{ Body: ExternalAgentCreateInput }>('/external-agents', async (req, reply) => {
    const { name, webhookUrl } = req.body;
    if (!name || !webhookUrl) {
      return reply.status(400).send({ error: 'name and webhookUrl are required' });
    }

    // Validate URL
    try {
      new URL(webhookUrl);
    } catch {
      return reply.status(400).send({ error: 'Invalid webhookUrl' });
    }

    const agent = repo.create(req.body);

    // Return full tokens on creation (only time they're visible)
    return reply.status(201).send({
      data: agent,
      _notice: 'Save the inboundToken and outboundToken — they will not be shown again in list views.',
    });
  });

  // ── Get one external agent ────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/external-agents/:id', async (req, reply) => {
    const agent = repo.getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'External agent not found' });
    return { data: { ...agent, inboundToken: '***', outboundToken: '***' } };
  });

  // ── Update external agent ─────────────────────────────────────────────────

  app.patch<{ Params: { id: string }; Body: Partial<ExternalAgentCreateInput & { status: ExternalAgentStatus; tier: ExternalAgentTier }> }>(
    '/external-agents/:id',
    async (req, reply) => {
      const updated = repo.update(req.params.id, req.body);
      if (!updated) return reply.status(404).send({ error: 'External agent not found' });
      return { data: { ...updated, inboundToken: '***', outboundToken: '***' } };
    },
  );

  // ── Delete external agent ─────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>('/external-agents/:id', async (req, reply) => {
    const deleted = repo.delete(req.params.id);
    if (!deleted) return reply.status(404).send({ error: 'External agent not found' });
    return { ok: true };
  });

  // ── Webhook callback (inbound from external agent) ────────────────────────
  // This is called by the external agent to deliver its response.
  // Auth: Bearer token must match the agent's inboundToken.

  app.post<{ Params: { id: string }; Body: { requestId: string; text: string; sessionId?: string; actions?: unknown[] } }>(
    '/external-agents/:id/callback',
    { config: { rateLimit: { max: 500, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const agent = repo.getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: 'External agent not found' });

      // Validate auth token
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token !== agent.inboundToken) {
        logger.warn('[ExternalAgent] Invalid inbound token for %s', agent.name);
        return reply.status(401).send({ error: 'Invalid token' });
      }

      const { requestId, text, sessionId } = req.body;
      if (!requestId || !text) {
        return reply.status(400).send({ error: 'requestId and text are required' });
      }

      // Resolve pending callback if exists
      const pending = pendingCallbacks.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(text);
        pendingCallbacks.delete(requestId);
      }

      // M-4: Broadcast to frontend via SSE (wildcard + session-specific)
      broadcastSSE(sessionId ?? null, 'message.complete', {
        id: requestId,
        session_id: sessionId,
        role: 'assistant',
        content: text,
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        sender_type: 'external',
        created_at: new Date().toISOString(),
      });

      repo.markSeen(agent.id);
      logger.info('[ExternalAgent] Callback from %s, requestId=%s, %d chars', agent.name, requestId, text.length);

      return { ok: true };
    },
  );

  // ── Get Protocol Pack (for Tier 2 upgrade) ────────────────────────────────

  app.get<{ Params: { id: string } }>('/external-agents/:id/protocol-pack', async (req, reply) => {
    const agent = repo.getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'External agent not found' });

    // Build base URL from request
    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${process.env.PORT ?? DEFAULT_PORT}`;
    const baseUrl = `${proto}://${host}`;

    const pack = generateProtocolPack(agent, baseUrl);
    return { data: pack };
  });

  // ── Upgrade to Tier 2 ────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/external-agents/:id/upgrade', async (req, reply) => {
    const upgraded = repo.upgradeToTier2(req.params.id);
    if (!upgraded) return reply.status(404).send({ error: 'External agent not found' });

    logger.info('[ExternalAgent] %s upgraded to Tier 2 (Enhanced)', upgraded.name);
    return { data: { ...upgraded, inboundToken: '***', outboundToken: '***' } };
  });

  // ── Test connectivity ─────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/external-agents/:id/test', async (req, reply) => {
    const agent = repo.getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'External agent not found' });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(agent.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${agent.outboundToken}`,
          'X-HiveClaw-Test': 'true',
        },
        body: JSON.stringify({
          requestId: 'test-' + Date.now(),
          message: 'This is a connectivity test from HiveClaw. Please respond with { "text": "ok" }',
          context: { test: true },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        repo.markSeen(agent.id);
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        return { ok: true, status: res.status, response: body };
      } else {
        const errText = await res.text().catch(() => '');
        return reply.status(502).send({ ok: false, status: res.status, error: errText.slice(0, 200) });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ ok: false, error: msg.includes('abort') ? 'Timeout (10s)' : msg });
    }
  });

  // ── Rotate tokens ─────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { tokenType?: 'inbound' | 'outbound' | 'both' } }>(
    '/external-agents/:id/rotate-token',
    async (req, reply) => {
      const agent = repo.getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: 'External agent not found' });

      const tokenType = req.body?.tokenType ?? 'both';
      const newInbound = tokenType === 'outbound' ? undefined : crypto.randomBytes(32).toString('hex');
      const newOutbound = tokenType === 'inbound' ? undefined : crypto.randomBytes(32).toString('hex');

      const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const values: unknown[] = [];
      if (newInbound) { updates.push('inbound_token = ?'); values.push(newInbound); }
      if (newOutbound) { updates.push('outbound_token = ?'); values.push(newOutbound); }
      values.push(req.params.id);

      engine.db.getDb().prepare(`UPDATE external_agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      logger.info('[ExternalAgent] Tokens rotated for %s (type=%s)', agent.name, tokenType);
      return {
        data: {
          ...(newInbound ? { inboundToken: newInbound } : {}),
          ...(newOutbound ? { outboundToken: newOutbound } : {}),
        },
        _notice: 'Save these tokens — they will not be shown again.',
      };
    },
  );

  // ── Revoke tokens (deactivate agent) ──────────────────────────────────────

  app.delete<{ Params: { id: string } }>('/external-agents/:id/token', async (req, reply) => {
    const agent = repo.getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'External agent not found' });

    engine.db.getDb().prepare('UPDATE external_agents SET inbound_token = ?, outbound_token = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('revoked', 'revoked', 'inactive', req.params.id);

    logger.info('[ExternalAgent] Tokens revoked for %s — agent deactivated', agent.name);
    return { ok: true, message: 'Tokens revoked. Agent deactivated.' };
  });

  logger.info('[API] External agent routes registered');
}

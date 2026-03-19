/**
 * Nodes API — Pairing, management, approval resolution, and audit.
 *
 * Routes:
 *   POST /nodes/pair                    — pair a new device
 *   GET  /nodes                         — list all nodes
 *   GET  /nodes/:id                     — get node details
 *   DELETE /nodes/:id                   — unpair a node
 *   POST /nodes/:id/rotate-token        — rotate auth token
 *   GET  /nodes/approvals               — list pending Tier 3 approvals
 *   POST /nodes/approvals/:id/resolve   — approve or deny a pending command
 *   GET  /nodes/:id/audit               — command audit for a node
 *
 * Phase 3.1 of HiveClaw Platform Blueprint.
 */

import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { NodeRepository } from '../engine/nodes/node-repository.js';
import { resolveApproval, listPendingApprovals } from '../engine/nodes/approval-flow.js';
import { logger } from '../lib/logger.js';

// ─── Pairing Code Store ───────────────────────────────────────────────────

interface PairingRequest {
  code: string;
  createdAt: number;
  expiresAt: number;
}

const pairingCodes = new Map<string, PairingRequest>();
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Routes ───────────────────────────────────────────────────────────────

export function registerNodeRoutes(app: FastifyInstance, db: Database.Database): void {
  const repo = new NodeRepository(db);

  // ─── Pairing code generation ──────────────────────────────────────

  /**
   * Step 1: Server generates a pairing code.
   * Returns a 6-digit code to show to the user.
   * The user enters it on the device side.
   */
  app.post('/nodes/generate-code', async () => {
    const code = String(randomInt(100000, 999999));
    const now = Date.now();
    pairingCodes.set(code, {
      code,
      createdAt: now,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    });

    // Prune expired codes
    for (const [k, v] of pairingCodes) {
      if (Date.now() > v.expiresAt) pairingCodes.delete(k);
    }

    logger.info('[Nodes] Pairing code generated: %s', code);
    return {
      data: {
        code,
        expiresIn: PAIRING_CODE_TTL_MS / 1000,
        expiresAt: new Date(now + PAIRING_CODE_TTL_MS).toISOString(),
      },
    };
  });

  /**
   * Step 2: Device calls this with the pairing code and its capabilities.
   * Server verifies the code, creates the node, returns auth token.
   */
  app.post<{
    Body: {
      code: string;
      name: string;
      deviceType?: string;
      capabilities?: string[];
      metadata?: Record<string, unknown>;
    };
  }>('/nodes/pair', async (req, reply) => {
    const { code, name, deviceType, capabilities, metadata } = req.body ?? {};

    if (!code || !name) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'code and name are required' },
      });
    }

    // Verify pairing code
    const pairingReq = pairingCodes.get(code);
    if (!pairingReq) {
      return reply.status(400).send({
        error: { code: 'INVALID_CODE', message: 'Invalid or expired pairing code' },
      });
    }
    if (Date.now() > pairingReq.expiresAt) {
      pairingCodes.delete(code);
      return reply.status(400).send({
        error: { code: 'CODE_EXPIRED', message: 'Pairing code expired' },
      });
    }

    // Consume code (one-time use)
    pairingCodes.delete(code);

    // Create node
    const { node, rawToken } = repo.create({
      name,
      deviceType: (deviceType ?? 'macos') as 'macos' | 'linux' | 'windows' | 'pwa',
      capabilities: (capabilities ?? []) as Array<'camera' | 'screen' | 'exec' | 'location' | 'notifications'>,
      metadata,
    });

    logger.info('[Nodes] Node paired: %s (%s)', node.name, node.id);

    return {
      data: {
        nodeId: node.id,
        token: rawToken,
        wsUrl: '/api/nodes/connect',
        message: `✅ Node '${node.name}' paired successfully`,
      },
    };
  });

  // ─── Node management ──────────────────────────────────────────────

  app.get('/nodes', async () => {
    const nodes = repo.list();
    return { data: nodes };
  });

  app.get<{ Params: { id: string } }>('/nodes/:id', async (req, reply) => {
    const node = repo.get(req.params.id);
    if (!node) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const recentCommands = repo.listCommands(req.params.id, { limit: 10 });
    return { data: { ...node, recentCommands } };
  });

  app.delete<{ Params: { id: string } }>('/nodes/:id', async (req, reply) => {
    const deleted = repo.delete(req.params.id);
    if (!deleted) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    logger.info('[Nodes] Node unpaired: %s', req.params.id);
    return { data: { ok: true } };
  });

  app.post<{ Params: { id: string } }>('/nodes/:id/rotate-token', async (req, reply) => {
    const node = repo.get(req.params.id);
    if (!node) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const newToken = repo.rotateToken(req.params.id);
    if (!newToken) return reply.status(500).send({ error: { code: 'ROTATE_FAILED' } });

    logger.info('[Nodes] Token rotated for node: %s', req.params.id);
    return { data: { token: newToken, message: 'Token rotated — update the node client config' } };
  });

  // ─── Approval flow ────────────────────────────────────────────────

  app.get('/nodes/approvals', async () => {
    const pending = listPendingApprovals();
    return { data: pending };
  });

  app.post<{
    Params: { id: string };
    Body: { approved: boolean; reason?: string };
  }>('/nodes/approvals/:id/resolve', async (req, reply) => {
    const { approved, reason } = req.body ?? {};

    if (typeof approved !== 'boolean') {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'approved (boolean) is required' },
      });
    }

    const result = resolveApproval(repo, req.params.id, approved, reason);
    if (!result.resolved) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: result.message },
      });
    }

    return { data: { ok: true, message: result.message } };
  });

  // ─── Audit ────────────────────────────────────────────────────────

  app.get<{
    Params: { id: string };
    Querystring: { tier?: string; status?: string; limit?: string; offset?: string };
  }>('/nodes/:id/audit', async (req, reply) => {
    const node = repo.get(req.params.id);
    if (!node) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const commands = repo.listCommands(req.params.id, {
      tier: req.query.tier !== undefined ? parseInt(req.query.tier, 10) as 0 | 1 | 2 | 3 | 4 : undefined,
      status: req.query.status,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    });

    return { data: { node: { id: node.id, name: node.name }, commands } };
  });

  logger.debug('[Nodes] Routes registered');
}

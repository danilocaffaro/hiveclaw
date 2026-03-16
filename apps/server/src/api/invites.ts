/**
 * api/invites.ts — Invite link CRUD for multi-user access (R4)
 *
 * POST   /api/invites          — create invite link (admin+)
 * GET    /api/invites          — list invites (admin+)
 * DELETE /api/invites/:id      — revoke invite (admin+)
 * GET    /api/invites/:code/info — public: validate invite code
 * POST   /api/invites/:code/accept — public: accept invite, create user
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { getAuthUser, requireRole } from './auth.js';
import { UserRepository } from '../db/users.js';

interface Invite {
  id: string;
  code: string;
  created_by: string;
  role: string;
  allowed_agents: string;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export function registerInviteRoutes(app: FastifyInstance, db: Database.Database): void {
  const users = new UserRepository(db);

  // POST /api/invites — create invite link
  app.post<{
    Body: {
      role?: 'admin' | 'member' | 'viewer';
      allowedAgents?: string[];
      maxUses?: number;
      expiresInDays?: number;
    };
  }>('/api/invites', async (req, reply) => {
    const caller = getAuthUser(req, users);
    if (!requireRole(caller, 'admin')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
    }

    const { role = 'member', allowedAgents = [], maxUses = 1, expiresInDays = 7 } = req.body ?? {};

    // Validate role
    const validRoles = ['admin', 'member', 'viewer'] as const;
    if (!validRoles.includes(role as typeof validRoles[number])) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `role must be one of: ${validRoles.join(', ')}` } });
    }
    const id = randomUUID();
    const code = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();

    db.prepare(`
      INSERT INTO invites (id, code, created_by, role, allowed_agents, max_uses, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, code, caller!.id, role, JSON.stringify(allowedAgents), maxUses, expiresAt);

    return reply.status(201).send({
      data: {
        id,
        code,
        role,
        allowedAgents,
        maxUses,
        expiresAt,
        url: `/invite/${code}`,
      },
    });
  });

  // GET /api/invites — list all invites
  app.get('/api/invites', async (req, reply) => {
    const caller = getAuthUser(req, users);
    if (!requireRole(caller, 'admin')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
    }

    const invites = db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all() as Invite[];
    return {
      data: invites.map(inv => ({
        ...inv,
        allowed_agents: JSON.parse(inv.allowed_agents || '[]'),
        expired: inv.expires_at ? new Date(inv.expires_at) < new Date() : false,
        exhausted: inv.uses >= inv.max_uses,
      })),
    };
  });

  // DELETE /api/invites/:id — revoke invite
  app.delete<{ Params: { id: string } }>('/api/invites/:id', async (req, reply) => {
    const caller = getAuthUser(req, users);
    if (!requireRole(caller, 'admin')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
    }

    const result = db.prepare('DELETE FROM invites WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Invite not found' } });
    }
    return { data: { success: true } };
  });

  // GET /api/invites/:code/info — public: validate invite code (no auth needed)
  app.get<{ Params: { code: string } }>('/api/invites/:code/info', async (req, reply) => {
    const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(req.params.code) as Invite | undefined;

    if (!invite) {
      return reply.status(404).send({ error: { code: 'INVALID_INVITE', message: 'Invite link not found or expired' } });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return reply.status(410).send({ error: { code: 'EXPIRED', message: 'This invite has expired' } });
    }

    if (invite.uses >= invite.max_uses) {
      return reply.status(410).send({ error: { code: 'EXHAUSTED', message: 'This invite has reached its usage limit' } });
    }

    // Return safe info (don't expose created_by id)
    const allowedAgents = JSON.parse(invite.allowed_agents || '[]') as string[];
    // Resolve agent names
    let agentNames: string[] = [];
    if (allowedAgents.length > 0) {
      const agents = db.prepare(
        `SELECT id, name FROM agents WHERE id IN (${allowedAgents.map(() => '?').join(',')})`
      ).all(...allowedAgents) as Array<{ id: string; name: string }>;
      agentNames = agents.map(a => a.name);
    }

    return {
      data: {
        valid: true,
        role: invite.role,
        agentNames,
        expiresAt: invite.expires_at,
      },
    };
  });

  // POST /api/invites/:code/accept — public: accept invite, create user
  app.post<{
    Params: { code: string };
    Body: { name: string; pin?: string };
  }>('/api/invites/:code/accept', async (req, reply) => {
    const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(req.params.code) as Invite | undefined;

    if (!invite) {
      return reply.status(404).send({ error: { code: 'INVALID_INVITE', message: 'Invite not found' } });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return reply.status(410).send({ error: { code: 'EXPIRED', message: 'This invite has expired' } });
    }

    if (invite.uses >= invite.max_uses) {
      return reply.status(410).send({ error: { code: 'EXHAUSTED', message: 'This invite has been fully used' } });
    }

    const { name } = req.body ?? {};
    if (!name || name.trim().length < 2) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Name must be at least 2 characters' } });
    }

    // Create user
    const allowedAgents = invite.allowed_agents || '[]';
    const user = users.create({
      name: name.trim(),
      role: invite.role as 'admin' | 'member' | 'viewer',
    });

    // Set allowed agents and invited_by
    db.prepare('UPDATE users SET allowed_agents = ?, invited_by = ? WHERE id = ?')
      .run(allowedAgents, invite.created_by, user.id);

    // Increment invite uses
    db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(invite.id);

    // Return user info with API key (shown once)
    return reply.status(201).send({
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        apiKey: user.apiKey, // Shown only on accept, used as session token
      },
    });
  });
}

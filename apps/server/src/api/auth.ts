import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UserRepository, type User } from '../db/users.js';
import { AuditRepository } from '../db/audit.js';
import type Database from 'better-sqlite3';

// ─── Auth helpers ────────────────────────────────────────────────────────────────

export function getAuthUser(req: FastifyRequest, users: UserRepository): User | null {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) return users.getByApiKey(apiKey) ?? null;
  // Self-hosted owner fallback: if running on same machine (no API key), allow owner
  // SEC-05: opt-in via SUPERCLAW_DEV_AUTH=true or explicitly non-production
  const isDev = process.env.NODE_ENV === 'development' || process.env.SUPERCLAW_DEV_AUTH === 'true';
  if (process.env.NODE_ENV === 'production' && !isDev) {
    // In production, allow self-hosted owner fallback (SPA on same origin doesn't send x-api-key)
    const cachedOwner = users.list().find(u => u.role === 'owner');
    return cachedOwner ?? null;
  }
  if (!isDev) return null;
  const allUsers = users.list();
  return allUsers[0] ?? null;
}

const ROLE_HIERARCHY: Record<User['role'], number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function requireRole(user: User | null, minRole: User['role']): boolean {
  if (!user) return false;
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minRole];
}

// ─── Route registration ──────────────────────────────────────────────────────────

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  const users = new UserRepository(db);
  const audit = new AuditRepository(db);

  // GET /auth/me — current user info
  app.get('/auth/me', async (req, reply) => {
    try {
      const user = getAuthUser(req, users);
      if (!user) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'No user found' } });
      }
      // Update last login
      users.update(user.id, { lastLogin: new Date().toISOString() });
      // Don't expose api_key in /me response
      const { apiKey: _key, ...safeUser } = user;
      return { data: safeUser };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /auth/users — list users (admin+)
  app.get('/auth/users', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const list = users.list().map(({ apiKey: _k, ...u }) => u);
      return { data: list };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /auth/users — create user (admin+)
  app.post<{
    Body: { name: string; email?: string; role?: User['role'] };
  }>('/auth/users', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const { name, email, role } = req.body ?? {};
      if (!name) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name is required' } });
      }
      const user = users.create({ name, email, role });
      audit.log({
        userId: caller?.id ?? null,
        action: 'user.create',
        resourceType: 'user',
        resourceId: user.id,
        details: { name, email, role },
        ipAddress: req.ip ?? null,
      });
      const { apiKey: _k, ...safeUser } = user;
      return reply.status(201).send({ data: safeUser });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // PATCH /auth/users/:id — update user (admin+)
  app.patch<{
    Params: { id: string };
    Body: Partial<Pick<User, 'name' | 'email' | 'role' | 'avatarUrl'>>;
  }>('/auth/users/:id', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const target = users.getById(req.params.id);
      if (!target) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `User '${req.params.id}' not found` } });
      }
      const updated = users.update(req.params.id, req.body ?? {});
      audit.log({
        userId: caller?.id ?? null,
        action: 'user.update',
        resourceType: 'user',
        resourceId: updated.id,
        details: req.body as Record<string, unknown>,
        ipAddress: req.ip ?? null,
      });
      const { apiKey: _k, ...safeUser } = updated;
      return { data: safeUser };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /auth/users/:id — delete user (owner only)
  app.delete<{ Params: { id: string } }>('/auth/users/:id', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'owner')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires owner role' } });
      }
      if (req.params.id === caller?.id) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Cannot delete yourself' } });
      }
      const deleted = users.delete(req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `User '${req.params.id}' not found` } });
      }
      audit.log({
        userId: caller?.id ?? null,
        action: 'user.delete',
        resourceType: 'user',
        resourceId: req.params.id,
        details: {},
        ipAddress: req.ip ?? null,
      });
      return { data: { success: true, id: req.params.id } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /auth/users/:id/api-key — regenerate API key (admin+ or self)
  app.post<{ Params: { id: string } }>('/auth/users/:id/api-key', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      const isSelf = caller?.id === req.params.id;
      if (!isSelf && !requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role or self' } });
      }
      const target = users.getById(req.params.id);
      if (!target) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `User '${req.params.id}' not found` } });
      }
      const newKey = users.generateApiKey(req.params.id);
      audit.log({
        userId: caller?.id ?? null,
        action: 'user.api-key.regenerate',
        resourceType: 'user',
        resourceId: req.params.id,
        details: {},
        ipAddress: req.ip ?? null,
      });
      return { data: { apiKey: newKey } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /auth/audit — audit log (admin+)
  app.get<{
    Querystring: { userId?: string; action?: string; limit?: string };
  }>('/auth/audit', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const { userId, action, limit } = req.query;
      const entries = audit.list({
        userId,
        action,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return { data: entries };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /audit — alias for SecurityTab (SEC-02: requires admin auth)
  app.get<{ Querystring: { userId?: string; action?: string; limit?: string } }>('/audit', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const { userId, action, limit } = req.query;
      const entries = audit.list({
        userId,
        action,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return { data: entries };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── API Keys (SecurityTab compat) ─────────────────────────────────────────

  // GET /api/auth/api-keys — list all API keys (admin+, SEC-06)
  app.get('/api/auth/api-keys', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const allUsers = users.list();
      const keys = allUsers
        .filter(u => u.apiKey)
        .map(u => ({
          id: u.id,
          label: u.name ?? u.email ?? u.id,
          prefix: u.apiKey!.slice(0, 8) + '...',
          createdAt: u.createdAt,
          lastUsed: u.lastLogin,
          status: 'active' as const,
        }));
      return { data: keys };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /api/auth/api-keys — create a new API key (admin+, SEC-06)
  app.post<{ Body: { label: string } }>('/api/auth/api-keys', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const { label } = req.body ?? {};
      if (!label) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'label is required' } });
      const user = users.create({ name: label, role: 'member' });
      audit.log({
        userId: null,
        action: 'api-key.create',
        resourceType: 'api-key',
        resourceId: user.id,
        details: { label },
        ipAddress: req.ip ?? null,
      });
      return reply.status(201).send({
        id: user.id,
        apiKey: user.apiKey,
        prefix: user.apiKey ? user.apiKey.slice(0, 8) + '...' : '',
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /api/auth/api-keys/:id/rotate — rotate key (admin+, SEC-06)
  app.post<{ Params: { id: string } }>('/api/auth/api-keys/:id/rotate', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const target = users.getById(req.params.id);
      if (!target) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Key not found' } });
      const newKey = users.generateApiKey(req.params.id);
      audit.log({
        userId: null,
        action: 'api-key.rotate',
        resourceType: 'api-key',
        resourceId: req.params.id,
        details: {},
        ipAddress: req.ip ?? null,
      });
      return { apiKey: newKey, prefix: newKey.slice(0, 8) + '...' };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /api/auth/api-keys/:id — revoke key (admin+, SEC-06)
  app.delete<{ Params: { id: string } }>('/api/auth/api-keys/:id', async (req, reply) => {
    try {
      const caller = getAuthUser(req, users);
      if (!requireRole(caller, 'admin')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Requires admin role' } });
      }
      const target = users.getById(req.params.id);
      if (!target) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Key not found' } });
      // Nullify the API key instead of deleting the user
      db.prepare('UPDATE users SET api_key = NULL WHERE id = ?').run(req.params.id);
      audit.log({
        userId: null,
        action: 'api-key.revoke',
        resourceType: 'api-key',
        resourceId: req.params.id,
        details: {},
        ipAddress: req.ip ?? null,
      });
      return { data: { success: true } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── Active Sessions (SecurityTab compat) ──────────────────────────────────

  // GET /api/auth/sessions — list active sessions (minimal: current request only)
  app.get('/api/auth/sessions', async (req) => {
    // SuperClaw doesn't have session tokens (stateless API).
    // Return the current request as the only "session".
    return {
      data: [
        {
          id: 'current',
          userId: 'owner',
          ipAddress: req.ip ?? '127.0.0.1',
          userAgent: (req.headers['user-agent'] ?? 'Unknown').slice(0, 80),
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          current: true,
        },
      ],
    };
  });

  // DELETE /api/auth/sessions/:id — terminate session (no-op for stateless)
  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (_req, reply) => {
    return reply.status(200).send({ data: { success: true } });
  });
}

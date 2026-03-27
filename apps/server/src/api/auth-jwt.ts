/**
 * api/auth-jwt.ts — JWT Authentication Routes
 *
 * POST /auth/register     — Create account (email + password)
 * POST /auth/login        — Login (email + password + optional TOTP)
 * POST /auth/refresh      — Rotate refresh token → new access + refresh
 * POST /auth/logout       — Revoke refresh token
 * POST /auth/2fa/setup    — Generate TOTP secret + QR code
 * POST /auth/2fa/verify   — Verify TOTP code and enable 2FA
 * POST /auth/2fa/disable  — Disable 2FA
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  rotateRefreshToken,
  verifyAccessToken,
  generateTotpSecret,
  verifyTotp,
  recordFailedLogin,
  resetFailedAttempts,
  isAccountLocked,
  revokeTokenFamily,
  cleanExpiredTokens,
  AuthError,
  type AuthTokens,
} from '../lib/auth-service.js';
import { AuditRepository } from '../db/audit.js';
import { logger } from '../lib/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LoginBody {
  email: string;
  password: string;
  totpCode?: string;
}

interface RegisterBody {
  email: string;
  password: string;
  name?: string;
}

interface RefreshBody {
  refreshToken: string;
}

interface TotpVerifyBody {
  code: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getClientIp(req: FastifyRequest): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || 'unknown';
}

function getUserAgent(req: FastifyRequest): string {
  return (req.headers['user-agent'] as string) || 'unknown';
}

/** Extract & verify Bearer token → returns payload or throws */
function requireAuth(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }
  return verifyAccessToken(header.slice(7));
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerAuthJwtRoutes(app: FastifyInstance, db: Database.Database): void {
  const audit = new AuditRepository(db);

  // Clean expired tokens on startup and every hour
  cleanExpiredTokens(db);
  setInterval(() => cleanExpiredTokens(db), 3600_000);

  // ── POST /auth/register ─────────────────────────────────────────────────
  app.post('/auth/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    const { email, password, name } = req.body || {} as RegisterBody;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }
    if (!validateEmail(email)) {
      return reply.status(400).send({ error: 'Invalid email format' });
    }
    const pwError = validatePassword(password);
    if (pwError) {
      return reply.status(400).send({ error: pwError });
    }

    // Check if email taken
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);

    db.prepare(`
      INSERT INTO users (id, email, name, role, password_hash)
      VALUES (?, ?, ?, 'member', ?)
    `).run(userId, email, name || null, passwordHash);

    const user = { id: userId, email, name: name || null, role: 'member' };
    const tokens = generateTokenPair(db, user, getClientIp(req), getUserAgent(req));

    audit.log({
      userId,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: userId,
      details: { email },
      ipAddress: getClientIp(req),
    });

    logger.info(`[auth] New user registered: ${email} (${userId})`);

    return reply.status(201).send({
      user: { id: userId, email, name: name || null, role: 'member' },
      ...tokens,
    });
  });

  // ── POST /auth/login ───────────────────────────────────────────────────
  app.post('/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password, totpCode } = req.body || {} as LoginBody;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    // ── Find user ──
    const user = db.prepare(
      'SELECT id, email, name, role, password_hash, totp_enabled, totp_secret FROM users WHERE email = ?',
    ).get(email) as {
      id: string; email: string; name: string | null; role: string;
      password_hash: string | null; totp_enabled: number; totp_secret: string | null;
    } | undefined;

    if (!user || !user.password_hash) {
      // Constant-time-ish: don't reveal whether user exists
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    // ── Account lockout check ──
    if (isAccountLocked(db, user.id)) {
      audit.log({
        userId: user.id,
        action: 'auth.login.locked',
        resourceType: 'user',
        resourceId: user.id,
        details: { email },
        ipAddress: getClientIp(req),
      });
      return reply.status(429).send({
        error: 'Account temporarily locked due to too many failed attempts',
        retryAfterMinutes: 15,
      });
    }

    // ── Verify password ──
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      const lockResult = recordFailedLogin(db, user.id);
      audit.log({
        userId: user.id,
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: user.id,
        details: { email, reason: 'invalid_password', attemptsLeft: lockResult.attemptsLeft },
        ipAddress: getClientIp(req),
      });
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    // ── 2FA check (if enabled) ──
    if (user.totp_enabled && user.totp_secret) {
      if (!totpCode) {
        return reply.status(403).send({
          error: '2FA code required',
          requires2FA: true,
        });
      }
      if (!verifyTotp(user.totp_secret, totpCode)) {
        const lockResult = recordFailedLogin(db, user.id);
        audit.log({
          userId: user.id,
          action: 'auth.login.failed',
          resourceType: 'user',
          resourceId: user.id,
          details: { email, reason: 'invalid_totp', attemptsLeft: lockResult.attemptsLeft },
          ipAddress: getClientIp(req),
        });
        return reply.status(401).send({ error: 'Invalid 2FA code' });
      }
    }

    // ── Success: reset failed attempts, generate tokens ──
    resetFailedAttempts(db, user.id);
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const tokens = generateTokenPair(
      db,
      { id: user.id, email: user.email, name: user.name, role: user.role },
      getClientIp(req),
      getUserAgent(req),
    );

    audit.log({
      userId: user.id,
      action: 'auth.login.success',
      resourceType: 'user',
      resourceId: user.id,
      details: { email, has2FA: !!user.totp_enabled },
      ipAddress: getClientIp(req),
    });

    logger.info(`[auth] Login success: ${email}`);

    return reply.send({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────
  app.post('/auth/refresh', async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    const { refreshToken } = req.body || {} as RefreshBody;

    if (!refreshToken) {
      return reply.status(400).send({ error: 'refreshToken is required' });
    }

    try {
      const result = rotateRefreshToken(db, refreshToken, getClientIp(req), getUserAgent(req));

      audit.log({
        userId: result.user.id,
        action: 'auth.refresh',
        resourceType: 'user',
        resourceId: result.user.id,
        details: {},
        ipAddress: getClientIp(req),
      });

      return reply.send({
        user: result.user,
        ...result.tokens,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      logger.error({ err }, '[auth] Refresh error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────
  app.post('/auth/logout', async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    const { refreshToken } = req.body || {} as RefreshBody;

    if (refreshToken) {
      try {
        // Revoke the token family to kill all related sessions
        const { createHash } = await import('crypto');
        const hash = createHash('sha256').update(refreshToken).digest('hex');
        const stored = db.prepare('SELECT family, user_id FROM refresh_tokens WHERE token_hash = ?').get(hash) as
          { family: string; user_id: string } | undefined;
        if (stored) {
          revokeTokenFamily(db, stored.family);
          audit.log({
            userId: stored.user_id,
            action: 'auth.logout',
            resourceType: 'user',
            resourceId: stored.user_id,
            details: {},
            ipAddress: getClientIp(req),
          });
        }
      } catch {
        // Logout should not fail
      }
    }

    return reply.send({ success: true });
  });

  // ── POST /auth/2fa/setup ───────────────────────────────────────────────
  app.post('/auth/2fa/setup', async (req: FastifyRequest, reply: FastifyReply) => {
    let payload;
    try {
      payload = requireAuth(req);
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const user = db.prepare('SELECT id, email, totp_enabled FROM users WHERE id = ?')
      .get(payload.sub) as { id: string; email: string; totp_enabled: number } | undefined;

    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.totp_enabled) return reply.status(409).send({ error: '2FA is already enabled' });

    const setup = generateTotpSecret(user.email);

    // Store secret (not yet enabled until verified)
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(setup.secret, user.id);

    // Generate QR code as data URL
    let qrDataUrl: string | undefined;
    try {
      qrDataUrl = await QRCode.toDataURL(setup.uri);
    } catch {
      // QR generation is optional
    }

    audit.log({
      userId: user.id,
      action: 'auth.2fa.setup',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: getClientIp(req),
    });

    return reply.send({
      secret: setup.secret,
      uri: setup.uri,
      qrCode: qrDataUrl,
    });
  });

  // ── POST /auth/2fa/verify ──────────────────────────────────────────────
  app.post('/auth/2fa/verify', async (req: FastifyRequest<{ Body: TotpVerifyBody }>, reply: FastifyReply) => {
    let payload;
    try {
      payload = requireAuth(req);
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { code } = req.body || {} as TotpVerifyBody;
    if (!code) return reply.status(400).send({ error: 'TOTP code is required' });

    const user = db.prepare('SELECT id, totp_secret, totp_enabled FROM users WHERE id = ?')
      .get(payload.sub) as { id: string; totp_secret: string | null; totp_enabled: number } | undefined;

    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (!user.totp_secret) return reply.status(400).send({ error: 'Run /auth/2fa/setup first' });
    if (user.totp_enabled) return reply.status(409).send({ error: '2FA is already enabled' });

    if (!verifyTotp(user.totp_secret, code)) {
      return reply.status(401).send({ error: 'Invalid TOTP code' });
    }

    // Enable 2FA
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);

    audit.log({
      userId: user.id,
      action: 'auth.2fa.enabled',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: getClientIp(req),
    });

    logger.info(`[auth] 2FA enabled for user: ${user.id}`);
    return reply.send({ success: true, message: '2FA is now enabled' });
  });

  // ── POST /auth/2fa/disable ─────────────────────────────────────────────
  app.post('/auth/2fa/disable', async (req: FastifyRequest<{ Body: { password: string } }>, reply: FastifyReply) => {
    let payload;
    try {
      payload = requireAuth(req);
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { password } = req.body || {} as { password: string };
    if (!password) return reply.status(400).send({ error: 'Password is required to disable 2FA' });

    const user = db.prepare('SELECT id, password_hash, totp_enabled FROM users WHERE id = ?')
      .get(payload.sub) as { id: string; password_hash: string; totp_enabled: number } | undefined;

    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (!user.totp_enabled) return reply.status(409).send({ error: '2FA is not enabled' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return reply.status(401).send({ error: 'Invalid password' });

    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);

    audit.log({
      userId: user.id,
      action: 'auth.2fa.disabled',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: getClientIp(req),
    });

    logger.info(`[auth] 2FA disabled for user: ${user.id}`);
    return reply.send({ success: true, message: '2FA has been disabled' });
  });

  logger.info('[auth] JWT auth routes registered: /auth/login, /auth/register, /auth/refresh, /auth/logout, /auth/2fa/*');
}

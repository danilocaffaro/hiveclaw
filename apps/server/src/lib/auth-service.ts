/**
 * lib/auth-service.ts — Authentication Service
 *
 * Handles: password hashing, JWT signing/verification, refresh token
 * rotation, TOTP 2FA setup & verification, account lockout.
 *
 * Design decisions:
 * - Refresh tokens use rotation + family-based revocation (reuse detection)
 * - Access tokens are short-lived (15min), refresh tokens 7 days
 * - TOTP uses otpauth (RFC 6238 compliant)
 * - bcryptjs for password hashing (pure JS, no native deps)
 * - Account locks after 5 failed attempts for 15 min
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import { randomUUID, createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from './logger.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.HIVECLAW_JWT_SECRET || randomUUID();
const JWT_REFRESH_SECRET = process.env.HIVECLAW_JWT_REFRESH_SECRET || randomUUID();
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ISSUER = 'HiveClaw';

// Warn if using ephemeral secrets (tokens won't survive restart)
if (!process.env.HIVECLAW_JWT_SECRET) {
  logger.warn('[auth] HIVECLAW_JWT_SECRET not set — using ephemeral secret (tokens lost on restart)');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;       // user id
  email: string;
  role: string;
  name: string | null;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  family: string;    // rotation family for reuse detection
  type: 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;  // seconds
}

export interface LoginResult {
  tokens: AuthTokens;
  user: { id: string; email: string; name: string | null; role: string };
}

export interface TotpSetupResult {
  secret: string;
  uri: string;
  qrDataUrl?: string;
}

// ─── Password hashing ────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: ISSUER,
  });
}

export function signRefreshToken(userId: string, family: string): string {
  return jwt.sign(
    { sub: userId, family, type: 'refresh', jti: randomUUID() } as RefreshTokenPayload & { jti: string },
    JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`, issuer: ISSUER },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, { issuer: ISSUER }) as AccessTokenPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type');
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, { issuer: ISSUER }) as RefreshTokenPayload;
  if (decoded.type !== 'refresh') throw new Error('Invalid token type');
  return decoded;
}

// ─── Refresh token storage (DB) ──────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function storeRefreshToken(
  db: Database.Database,
  userId: string,
  token: string,
  family: string,
  ip?: string,
  userAgent?: string,
): void {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000).toISOString();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, hashToken(token), family, expiresAt, ip ?? null, userAgent ?? null);
}

export function revokeRefreshTokenByHash(db: Database.Database, tokenHash: string): void {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

export function revokeTokenFamily(db: Database.Database, family: string): void {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE family = ?').run(family);
  logger.warn(`[auth] Revoked entire token family: ${family} (potential reuse detected)`);
}

export function findRefreshToken(
  db: Database.Database,
  tokenHash: string,
): { id: string; user_id: string; family: string; revoked: number; expires_at: string } | undefined {
  return db.prepare(
    'SELECT id, user_id, family, revoked, expires_at FROM refresh_tokens WHERE token_hash = ?',
  ).get(tokenHash) as { id: string; user_id: string; family: string; revoked: number; expires_at: string } | undefined;
}

export function cleanExpiredTokens(db: Database.Database): void {
  const result = db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')").run();
  if (result.changes > 0) {
    logger.info(`[auth] Cleaned ${result.changes} expired refresh tokens`);
  }
}

// ─── Account lockout ─────────────────────────────────────────────────────────

export function recordFailedLogin(db: Database.Database, userId: string): { locked: boolean; attemptsLeft: number } {
  const user = db.prepare('SELECT failed_login_attempts FROM users WHERE id = ?').get(userId) as { failed_login_attempts: number } | undefined;
  const attempts = (user?.failed_login_attempts ?? 0) + 1;

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
      .run(attempts, lockedUntil, userId);
    logger.warn(`[auth] Account locked: ${userId} — too many failed attempts`);
    return { locked: true, attemptsLeft: 0 };
  }

  db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(attempts, userId);
  return { locked: false, attemptsLeft: MAX_FAILED_ATTEMPTS - attempts };
}

export function resetFailedAttempts(db: Database.Database, userId: string): void {
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
}

export function isAccountLocked(db: Database.Database, userId: string): boolean {
  const user = db.prepare('SELECT locked_until FROM users WHERE id = ?').get(userId) as { locked_until: string | null } | undefined;
  if (!user?.locked_until) return false;
  if (new Date(user.locked_until) > new Date()) return true;
  // Lockout expired — reset
  resetFailedAttempts(db, userId);
  return false;
}

// ─── TOTP 2FA ────────────────────────────────────────────────────────────────

export function generateTotpSecret(email: string): TotpSetupResult {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  };
}

export function verifyTotp(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // window=1 → accepts ±1 period (30s tolerance)
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

// ─── Token generation (combines access + refresh) ────────────────────────────

export function generateTokenPair(
  db: Database.Database,
  user: { id: string; email: string; name: string | null; role: string },
  ip?: string,
  userAgent?: string,
): AuthTokens {
  const family = randomUUID();
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });
  const refreshToken = signRefreshToken(user.id, family);

  storeRefreshToken(db, user.id, refreshToken, family, ip, userAgent);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 min in seconds
  };
}

// ─── Refresh token rotation ──────────────────────────────────────────────────

export interface RotationResult {
  tokens: AuthTokens;
  user: { id: string; email: string; name: string | null; role: string };
}

export function rotateRefreshToken(
  db: Database.Database,
  oldToken: string,
  ip?: string,
  userAgent?: string,
): RotationResult {
  const oldHash = hashToken(oldToken);
  const stored = findRefreshToken(db, oldHash);

  if (!stored) {
    throw new AuthError('Invalid refresh token', 401);
  }

  // ── Reuse detection: if token already revoked, nuke the family ──
  if (stored.revoked) {
    revokeTokenFamily(db, stored.family);
    throw new AuthError('Refresh token reuse detected — all sessions revoked', 401);
  }

  // ── Check expiry ──
  if (new Date(stored.expires_at) < new Date()) {
    revokeRefreshTokenByHash(db, oldHash);
    throw new AuthError('Refresh token expired', 401);
  }

  // ── Revoke old token ──
  revokeRefreshTokenByHash(db, oldHash);

  // ── Get user ──
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?')
    .get(stored.user_id) as { id: string; email: string; name: string; role: string } | undefined;

  if (!user) {
    throw new AuthError('User not found', 401);
  }

  // ── Issue new pair (same family) ──
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });
  const refreshToken = signRefreshToken(user.id, stored.family);
  storeRefreshToken(db, user.id, refreshToken, stored.family, ip, userAgent);

  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: 900,
    },
    user,
  };
}

// ─── Auth Error ──────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

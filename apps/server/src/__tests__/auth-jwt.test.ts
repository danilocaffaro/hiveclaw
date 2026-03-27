/**
 * __tests__/auth-jwt.test.ts — Tests for JWT auth system
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateTokenPair,
  rotateRefreshToken,
  storeRefreshToken,
  revokeTokenFamily,
  recordFailedLogin,
  resetFailedAttempts,
  isAccountLocked,
  generateTotpSecret,
  verifyTotp,
  cleanExpiredTokens,
  AuthError,
} from '../lib/auth-service.js';
import { migrateAuthSchema } from '../db/auth-schema.js';

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Create minimal users table
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT DEFAULT 'member',
      password_hash TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      api_key TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  // Run auth migration
  migrateAuthSchema(db);

  // Seed a test user
  db.prepare(`
    INSERT INTO users (id, email, name, role, password_hash)
    VALUES ('user-1', 'test@example.com', 'Test User', 'member', 'placeholder')
  `).run();
});

afterAll(() => {
  db.close();
});

// ─── Password Hashing ─────────────────────────────────────────────────────

describe('Password hashing', () => {
  it('should hash and verify a password', async () => {
    const hash = await hashPassword('MyStr0ngP@ss');
    expect(hash).not.toBe('MyStr0ngP@ss');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix

    const valid = await verifyPassword('MyStr0ngP@ss', hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('WrongPass1', hash);
    expect(invalid).toBe(false);
  });
});

// ─── JWT Access Tokens ────────────────────────────────────────────────────

describe('JWT Access Tokens', () => {
  it('should sign and verify access tokens', () => {
    const token = signAccessToken({
      sub: 'user-1',
      email: 'test@example.com',
      role: 'member',
      name: 'Test',
    });
    expect(typeof token).toBe('string');

    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('test@example.com');
    expect(payload.type).toBe('access');
  });

  it('should reject tampered tokens', () => {
    const token = signAccessToken({
      sub: 'user-1',
      email: 'test@example.com',
      role: 'member',
      name: 'Test',
    });
    expect(() => verifyAccessToken(token + 'tampered')).toThrow();
  });
});

// ─── JWT Refresh Tokens ──────────────────────────────────────────────────

describe('JWT Refresh Tokens', () => {
  it('should sign and verify refresh tokens', () => {
    const token = signRefreshToken('user-1', 'family-1');
    expect(typeof token).toBe('string');

    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.family).toBe('family-1');
    expect(payload.type).toBe('refresh');
  });
});

// ─── Token Pair Generation ───────────────────────────────────────────────

describe('Token pair generation', () => {
  it('should generate access + refresh tokens and store in DB', () => {
    const tokens = generateTokenPair(db, {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      role: 'member',
    });

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresIn).toBe(900);

    // Verify stored in DB
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM refresh_tokens WHERE user_id = ?')
      .get('user-1') as { cnt: number }).cnt;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── Refresh Token Rotation ──────────────────────────────────────────────

describe('Refresh token rotation', () => {
  it('should rotate: old revoked, new issued', () => {
    const tokens = generateTokenPair(db, {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      role: 'member',
    });

    const result = rotateRefreshToken(db, tokens.refreshToken);
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(result.tokens.refreshToken).not.toBe(tokens.refreshToken);
    expect(result.user.id).toBe('user-1');
  });

  it('should detect reuse and revoke family', () => {
    const tokens = generateTokenPair(db, {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      role: 'member',
    });

    // First rotation: success
    rotateRefreshToken(db, tokens.refreshToken);

    // Second use of same token: reuse detected → family revoked
    expect(() => rotateRefreshToken(db, tokens.refreshToken)).toThrow('reuse detected');
  });

  it('should reject invalid tokens', () => {
    expect(() => rotateRefreshToken(db, 'garbage-token')).toThrow();
  });
});

// ─── Account Lockout ─────────────────────────────────────────────────────

describe('Account lockout', () => {
  const lockUserId = 'lock-test-user';

  beforeAll(async () => {
    const hash = await hashPassword('Test1234');
    db.prepare(`
      INSERT INTO users (id, email, name, role, password_hash)
      VALUES (?, 'lock@test.com', 'Lock Test', 'member', ?)
    `).run(lockUserId, hash);
  });

  it('should lock after 5 failed attempts', () => {
    resetFailedAttempts(db, lockUserId);
    for (let i = 0; i < 5; i++) {
      recordFailedLogin(db, lockUserId);
    }
    expect(isAccountLocked(db, lockUserId)).toBe(true);
  });

  it('should reset after unlock', () => {
    resetFailedAttempts(db, lockUserId);
    expect(isAccountLocked(db, lockUserId)).toBe(false);
  });
});

// ─── TOTP 2FA ────────────────────────────────────────────────────────────

describe('TOTP 2FA', () => {
  it('should generate a valid TOTP secret and URI', () => {
    const setup = generateTotpSecret('test@example.com');
    expect(setup.secret).toBeTruthy();
    expect(setup.secret.length).toBeGreaterThan(10);
    expect(setup.uri).toContain('otpauth://totp/');
    expect(setup.uri).toContain('HiveClaw');
  });

  it('should verify a valid TOTP code', () => {
    const setup = generateTotpSecret('test@example.com');
    // Generate a valid code from the secret
    const OTPAuth = require('otpauth');
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(setup.secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const validCode = totp.generate();
    expect(verifyTotp(setup.secret, validCode)).toBe(true);
  });

  it('should reject an invalid TOTP code', () => {
    const setup = generateTotpSecret('test@example.com');
    expect(verifyTotp(setup.secret, '000000')).toBe(false);
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────────

describe('Token cleanup', () => {
  it('should clean expired tokens', () => {
    // Insert an expired token
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at)
      VALUES ('expired-1', 'user-1', 'hash-expired', 'fam-expired', datetime('now', '-1 day'))
    `).run();

    cleanExpiredTokens(db);

    const row = db.prepare('SELECT id FROM refresh_tokens WHERE id = ?').get('expired-1');
    expect(row).toBeUndefined();
  });
});

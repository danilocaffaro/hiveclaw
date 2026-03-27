/**
 * db/auth-schema.ts — Auth tables migration
 *
 * Adds password_hash, totp_secret to users table,
 * and creates refresh_tokens table.
 *
 * Safe to run multiple times (IF NOT EXISTS + column checks).
 */
import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';

export function migrateAuthSchema(db: Database.Database): void {
  // ── Add columns to users if missing ─────────────────────────────────────
  const userColumns = db
    .prepare("PRAGMA table_info('users')")
    .all() as { name: string }[];
  const colNames = new Set(userColumns.map((c) => c.name));

  if (!colNames.has('password_hash')) {
    db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
    logger.info('[auth-schema] Added users.password_hash');
  }
  if (!colNames.has('totp_secret')) {
    db.prepare('ALTER TABLE users ADD COLUMN totp_secret TEXT').run();
    logger.info('[auth-schema] Added users.totp_secret');
  }
  if (!colNames.has('totp_enabled')) {
    db.prepare('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0').run();
    logger.info('[auth-schema] Added users.totp_enabled');
  }
  if (!colNames.has('failed_login_attempts')) {
    db.prepare('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0').run();
    logger.info('[auth-schema] Added users.failed_login_attempts');
  }
  if (!colNames.has('locked_until')) {
    db.prepare('ALTER TABLE users ADD COLUMN locked_until TEXT').run();
    logger.info('[auth-schema] Added users.locked_until');
  }

  // ── refresh_tokens table ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
  `);
  logger.info('[auth-schema] refresh_tokens table ready');
}

/**
 * HiveClaw Connect — Device Manager
 *
 * Manages paired devices, sessions, and revocation
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/index.js';

export interface Device {
  id: string;
  userId: string;
  name: string;
  publicKey: string;
  sessionToken: string;
  pairedAt: string;
  lastSeenAt: string;
  revoked: boolean;
  userAgent?: string;
}

/** Initialize the devices table */
export function initDevicesTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS connect_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      paired_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked INTEGER NOT NULL DEFAULT 0,
      user_agent TEXT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_connect_devices_session ON connect_devices(session_token)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_connect_devices_user ON connect_devices(user_id)
  `);
}

/** Register a new paired device */
export function pairDevice(params: {
  userId: string;
  name: string;
  publicKey: string;
  userAgent?: string;
}): Device {
  const db = getDb();
  const id = randomUUID();
  const sessionToken = `st_${randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO connect_devices (id, user_id, name, public_key, session_token, paired_at, last_seen_at, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.userId, params.name, params.publicKey, sessionToken, now, now, params.userAgent || null);

  return {
    id,
    userId: params.userId,
    name: params.name,
    publicKey: params.publicKey,
    sessionToken,
    pairedAt: now,
    lastSeenAt: now,
    revoked: false,
    userAgent: params.userAgent,
  };
}

/** Validate a session token and return the device */
export function validateSession(sessionToken: string): Device | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM connect_devices WHERE session_token = ? AND revoked = 0
  `).get(sessionToken) as Record<string, unknown> | undefined;

  if (!row) return null;

  // Update last seen
  db.prepare(`UPDATE connect_devices SET last_seen_at = datetime('now') WHERE id = ?`).run(row.id);

  return rowToDevice(row);
}

/** Get all devices for a user */
export function getDevicesByUser(userId: string): Device[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM connect_devices WHERE user_id = ? ORDER BY paired_at DESC
  `).all(userId) as Record<string, unknown>[];

  return rows.map(rowToDevice);
}

/** Get all active (non-revoked) devices */
export function getActiveDevices(): Device[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM connect_devices WHERE revoked = 0 ORDER BY last_seen_at DESC
  `).all() as Record<string, unknown>[];

  return rows.map(rowToDevice);
}

/** Revoke a device */
export function revokeDevice(deviceId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE connect_devices SET revoked = 1 WHERE id = ?
  `).run(deviceId);
  return result.changes > 0;
}

/** Revoke all devices for a user */
export function revokeAllDevices(userId: string): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE connect_devices SET revoked = 1 WHERE user_id = ?
  `).run(userId);
  return result.changes;
}

function rowToDevice(row: Record<string, unknown>): Device {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    publicKey: row.public_key as string,
    sessionToken: row.session_token as string,
    pairedAt: row.paired_at as string,
    lastSeenAt: row.last_seen_at as string,
    revoked: Boolean(row.revoked),
    userAgent: row.user_agent as string | undefined,
  };
}

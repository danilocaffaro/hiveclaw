/**
 * Node Repository — DB schema, CRUD, and audit queries for paired nodes.
 *
 * Tables: nodes, node_commands (audit trail)
 * Auth tokens stored hashed (SHA-256).
 * Per spec §4 + §5.2.
 */

import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CommandTier, CommandType } from './command-classifier.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type NodeStatus = 'online' | 'offline' | 'busy';
export type DeviceType = 'macos' | 'linux' | 'windows' | 'pwa';
export type NodeCapability = 'camera' | 'screen' | 'exec' | 'location' | 'notifications';

export interface NodeRecord {
  id: string;
  name: string;
  deviceType: DeviceType;
  capabilities: NodeCapability[];
  status: NodeStatus;
  lastSeen: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NodeCommandRecord {
  id: string;
  nodeId: string;
  agentId: string | null;
  sessionId: string | null;
  command: string;
  commandType: CommandType;
  params: Record<string, unknown> | null;
  tier: CommandTier;
  approvalStatus: 'auto' | 'agent_approved' | 'owner_approved' | 'denied' | 'timeout' | 'expired' | 'stale';
  approvalBy: string | null;
  approvalReason: string | null;
  approvalAt: string | null;
  status: 'pending' | 'pending_approval' | 'running' | 'completed' | 'failed' | 'timeout' | 'denied' | 'expired';
  result: unknown | null;
  resultSizeBytes: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  ipAddress: string | null;
  createdAt: string;
}

// ─── DB Row Types ─────────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  name: string;
  device_type: string;
  capabilities: string;
  auth_token_hash: string;
  status: string;
  last_seen: string | null;
  metadata: string | null;
  created_at: string;
}

interface NodeCommandRow {
  id: string;
  node_id: string;
  agent_id: string | null;
  session_id: string | null;
  command: string;
  command_type: string;
  params: string | null;
  tier: number;
  approval_status: string;
  approval_by: string | null;
  approval_reason: string | null;
  approval_at: string | null;
  status: string;
  result: string | null;
  result_size_bytes: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  ip_address: string | null;
  created_at: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────

function initNodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'macos',
      capabilities TEXT NOT NULL DEFAULT '[]',
      auth_token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS node_commands (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      agent_id TEXT,
      session_id TEXT,
      command TEXT NOT NULL,
      command_type TEXT NOT NULL DEFAULT 'exec',
      params TEXT,
      tier INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT DEFAULT 'auto',
      approval_by TEXT,
      approval_reason TEXT,
      approval_at DATETIME,
      status TEXT DEFAULT 'pending',
      result TEXT,
      result_size_bytes INTEGER,
      started_at DATETIME,
      completed_at DATETIME,
      duration_ms INTEGER,
      error TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_node_commands_node ON node_commands(node_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_node_commands_agent ON node_commands(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_node_commands_tier ON node_commands(tier);
    CREATE INDEX IF NOT EXISTS idx_node_commands_status ON node_commands(status);
  `);
}

// ─── Repository ───────────────────────────────────────────────────────────

export class NodeRepository {
  constructor(private db: Database.Database) {
    initNodeSchema(db);
  }

  // ─── Pairing ────────────────────────────────────────────────────────

  /**
   * Create a new node. Returns { node, rawToken } — rawToken is shown ONCE.
   */
  create(data: {
    name: string;
    deviceType: DeviceType;
    capabilities: NodeCapability[];
    metadata?: Record<string, unknown>;
  }): { node: NodeRecord; rawToken: string } {
    const id = randomUUID();
    const rawToken = `hc-node-${randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(rawToken);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO nodes (id, name, device_type, capabilities, auth_token_hash, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, 'offline', ?, ?)
    `).run(
      id,
      data.name,
      data.deviceType,
      JSON.stringify(data.capabilities),
      tokenHash,
      JSON.stringify(data.metadata ?? {}),
      now,
    );

    return { node: this.get(id)!, rawToken };
  }

  /**
   * Verify a raw token and return the node if valid.
   */
  authenticate(rawToken: string): NodeRecord | null {
    const hash = hashToken(rawToken);
    const row = this.db.prepare(
      'SELECT * FROM nodes WHERE auth_token_hash = ?'
    ).get(hash) as NodeRow | undefined;
    return row ? this.rowToNode(row) : null;
  }

  /**
   * Rotate token — returns new rawToken, invalidates old.
   */
  rotateToken(nodeId: string): string | null {
    const node = this.get(nodeId);
    if (!node) return null;

    const rawToken = `hc-node-${randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(rawToken);

    this.db.prepare(
      'UPDATE nodes SET auth_token_hash = ? WHERE id = ?'
    ).run(tokenHash, nodeId);

    return rawToken;
  }

  // ─── CRUD ───────────────────────────────────────────────────────────

  get(id: string): NodeRecord | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? this.rowToNode(row) : null;
  }

  list(): NodeRecord[] {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY created_at DESC').all() as NodeRow[];
    return rows.map(r => this.rowToNode(r));
  }

  listOnline(): NodeRecord[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE status != 'offline' ORDER BY name").all() as NodeRow[];
    return rows.map(r => this.rowToNode(r));
  }

  updateStatus(id: string, status: NodeStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE nodes SET status = ?, last_seen = ? WHERE id = ?'
    ).run(status, now, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ─── Command Audit ──────────────────────────────────────────────────

  /**
   * Log a new command (pending state).
   */
  createCommand(data: {
    nodeId: string;
    agentId?: string;
    sessionId?: string;
    command: string;
    commandType: CommandType;
    params?: Record<string, unknown>;
    tier: CommandTier;
    approvalStatus?: string;
    ipAddress?: string;
  }): NodeCommandRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO node_commands (id, node_id, agent_id, session_id, command, command_type, params, tier, approval_status, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.nodeId,
      data.agentId ?? null,
      data.sessionId ?? null,
      data.command,
      data.commandType,
      data.params ? JSON.stringify(data.params) : null,
      data.tier,
      data.approvalStatus ?? 'auto',
      data.ipAddress ?? null,
      now,
    );

    return this.getCommand(id)!;
  }

  getCommand(id: string): NodeCommandRecord | null {
    const row = this.db.prepare('SELECT * FROM node_commands WHERE id = ?').get(id) as NodeCommandRow | undefined;
    return row ? this.rowToCommand(row) : null;
  }

  /**
   * Update command status + result.
   */
  updateCommand(id: string, data: Partial<{
    status: string;
    approvalStatus: string;
    approvalBy: string;
    approvalReason: string;
    result: unknown;
    resultSizeBytes: number;
    error: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  }>): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (data.status !== undefined) { sets.push('status = ?'); values.push(data.status); }
    if (data.approvalStatus !== undefined) { sets.push('approval_status = ?'); values.push(data.approvalStatus); }
    if (data.approvalBy !== undefined) { sets.push('approval_by = ?'); values.push(data.approvalBy); }
    if (data.approvalReason !== undefined) { sets.push('approval_reason = ?'); values.push(data.approvalReason); }
    if (data.result !== undefined) { sets.push('result = ?'); values.push(JSON.stringify(data.result)); }
    if (data.resultSizeBytes !== undefined) { sets.push('result_size_bytes = ?'); values.push(data.resultSizeBytes); }
    if (data.error !== undefined) { sets.push('error = ?'); values.push(data.error); }
    if (data.startedAt !== undefined) { sets.push('started_at = ?'); values.push(data.startedAt); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(data.completedAt); }
    if (data.durationMs !== undefined) { sets.push('duration_ms = ?'); values.push(data.durationMs); }
    if (data.approvalStatus === 'owner_approved' || data.approvalStatus === 'agent_approved') {
      sets.push('approval_at = ?'); values.push(new Date().toISOString());
    }

    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE node_commands SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Audit query — commands for a node.
   */
  listCommands(nodeId: string, opts?: {
    tier?: CommandTier;
    status?: string;
    limit?: number;
    offset?: number;
  }): NodeCommandRecord[] {
    let query = 'SELECT * FROM node_commands WHERE node_id = ?';
    const params: unknown[] = [nodeId];

    if (opts?.tier !== undefined) { query += ' AND tier = ?'; params.push(opts.tier); }
    if (opts?.status) { query += ' AND status = ?'; params.push(opts.status); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(opts?.limit ?? 50);
    params.push(opts?.offset ?? 0);

    const rows = this.db.prepare(query).all(...params) as NodeCommandRow[];
    return rows.map(r => this.rowToCommand(r));
  }

  /**
   * Get pending approval commands (for approval flow).
   */
  getPendingApprovals(): NodeCommandRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM node_commands WHERE status = 'pending_approval' ORDER BY created_at ASC"
    ).all() as NodeCommandRow[];
    return rows.map(r => this.rowToCommand(r));
  }

  /**
   * Prune old audit records per retention policy (spec §4.2).
   */
  pruneAudit(): { pruned: number } {
    const now = new Date();

    // Tier 0-1: 30 days
    const t01Cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const r1 = this.db.prepare(
      "DELETE FROM node_commands WHERE tier <= 1 AND created_at < ?"
    ).run(t01Cutoff);

    // Tier 2: 90 days
    const t2Cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const r2 = this.db.prepare(
      "DELETE FROM node_commands WHERE tier = 2 AND created_at < ?"
    ).run(t2Cutoff);

    // Tier 3-4: Never prune

    return { pruned: r1.changes + r2.changes };
  }

  // ─── Stale Detection (spec §10.2) ──────────────────────────────────

  /**
   * Check if any subsequent exec commands from the same agent on the same node
   * overlap with a pending command (path-based heuristic).
   */
  hasSubsequentOverlap(commandId: string, nodeId: string, agentId: string): boolean {
    const cmd = this.getCommand(commandId);
    if (!cmd) return false;

    const subsequent = this.db.prepare(`
      SELECT command FROM node_commands
      WHERE node_id = ? AND agent_id = ? AND created_at > ? AND id != ? AND command_type = 'exec'
      ORDER BY created_at ASC LIMIT 10
    `).all(nodeId, agentId, cmd.createdAt, commandId) as Array<{ command: string }>;

    if (subsequent.length === 0) return false;

    // Simple path overlap: extract paths from the original command and check subsequent ones
    const originalPaths = extractPaths(cmd.command);
    if (originalPaths.length === 0) return subsequent.length >= 3; // 3+ tool calls = stale

    for (const row of subsequent) {
      const subPaths = extractPaths(row.command);
      for (const op of originalPaths) {
        for (const sp of subPaths) {
          if (op === sp || op.startsWith(sp) || sp.startsWith(op)) return true;
        }
      }
    }

    return false;
  }

  // ─── Row Mappers ────────────────────────────────────────────────────

  private rowToNode(row: NodeRow): NodeRecord {
    return {
      id: row.id,
      name: row.name,
      deviceType: row.device_type as DeviceType,
      capabilities: JSON.parse(row.capabilities),
      status: row.status as NodeStatus,
      lastSeen: row.last_seen,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
    };
  }

  private rowToCommand(row: NodeCommandRow): NodeCommandRecord {
    return {
      id: row.id,
      nodeId: row.node_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      command: row.command,
      commandType: row.command_type as CommandType,
      params: row.params ? JSON.parse(row.params) : null,
      tier: row.tier as CommandTier,
      approvalStatus: row.approval_status as NodeCommandRecord['approvalStatus'],
      approvalBy: row.approval_by,
      approvalReason: row.approval_reason,
      approvalAt: row.approval_at,
      status: row.status as NodeCommandRecord['status'],
      result: row.result ? JSON.parse(row.result) : null,
      resultSizeBytes: row.result_size_bytes,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      error: row.error,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Extract file paths from a command string (simple heuristic).
 */
function extractPaths(command: string): string[] {
  const matches = command.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
  if (!matches) return [];
  return matches.map(m => m.trim());
}

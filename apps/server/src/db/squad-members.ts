// ============================================================
// Squad Members Repository — ARCHER v2 role management
// ============================================================

import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';

export interface SquadMember {
  squadId: string;
  agentId: string;
  role: 'owner' | 'admin' | 'member';
  addedBy: string;
  addedAt: string;
}

export interface SquadEvent {
  id: string;
  squadId: string;
  eventType: string;
  agentId?: string;
  actor: string;
  detail: string;
  createdAt: string;
}

interface MemberRow {
  squad_id: string; agent_id: string; role: string; added_by: string; added_at: string;
}

interface EventRow {
  id: string; squad_id: string; event_type: string; agent_id: string | null;
  actor: string; detail: string; created_at: string;
}

export class SquadMemberRepository {
  constructor(private db: Database.Database) {}

  /** List all members of a squad */
  listBySquad(squadId: string): SquadMember[] {
    const rows = this.db.prepare(
      'SELECT * FROM squad_members WHERE squad_id = ? ORDER BY added_at ASC'
    ).all(squadId) as MemberRow[];
    return rows.map(this.toMember);
  }

  /** Get a specific member */
  get(squadId: string, agentId: string): SquadMember | null {
    const row = this.db.prepare(
      'SELECT * FROM squad_members WHERE squad_id = ? AND agent_id = ?'
    ).get(squadId, agentId) as MemberRow | undefined;
    return row ? this.toMember(row) : null;
  }

  /** Add a member to a squad */
  add(squadId: string, agentId: string, role: 'owner' | 'admin' | 'member' = 'member', addedBy: string = 'system'): SquadMember {
    this.db.prepare(`
      INSERT OR REPLACE INTO squad_members (squad_id, agent_id, role, added_by, added_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(squadId, agentId, role, addedBy);

    // Record event
    this.recordEvent(squadId, 'member_added', agentId, addedBy, `${agentId} added as ${role}`);

    return this.get(squadId, agentId)!;
  }

  /** Remove a member from a squad */
  remove(squadId: string, agentId: string, removedBy: string = 'system'): boolean {
    const existing = this.get(squadId, agentId);
    if (!existing) return false;

    // If removing owner, auto-promote
    if (existing.role === 'owner') {
      this.autoPromote(squadId, agentId);
    }

    const result = this.db.prepare(
      'DELETE FROM squad_members WHERE squad_id = ? AND agent_id = ?'
    ).run(squadId, agentId);

    if (result.changes > 0) {
      this.recordEvent(squadId, 'member_removed', agentId, removedBy, `${agentId} removed`);
    }

    return result.changes > 0;
  }

  /** Update member role */
  updateRole(squadId: string, agentId: string, newRole: 'owner' | 'admin' | 'member', actor: string = 'system'): SquadMember | null {
    const existing = this.get(squadId, agentId);
    if (!existing) return null;

    // If promoting to owner, demote current owner
    if (newRole === 'owner') {
      this.db.prepare(
        "UPDATE squad_members SET role = 'admin' WHERE squad_id = ? AND role = 'owner'"
      ).run(squadId);
    }

    this.db.prepare(
      'UPDATE squad_members SET role = ? WHERE squad_id = ? AND agent_id = ?'
    ).run(newRole, squadId, agentId);

    this.recordEvent(squadId, 'role_changed', agentId, actor, `${agentId} → ${newRole}`);

    return this.get(squadId, agentId);
  }

  /** Auto-promote on owner removal: oldest admin, then oldest member */
  private autoPromote(squadId: string, removedOwnerId: string): void {
    // Find next in line: admin first, then member
    const next = this.db.prepare(`
      SELECT * FROM squad_members
      WHERE squad_id = ? AND agent_id != ?
      ORDER BY
        CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
        added_at ASC
      LIMIT 1
    `).get(squadId, removedOwnerId) as MemberRow | undefined;

    if (next) {
      this.db.prepare(
        "UPDATE squad_members SET role = 'owner' WHERE squad_id = ? AND agent_id = ?"
      ).run(squadId, next.agent_id);
      this.recordEvent(squadId, 'auto_promoted', next.agent_id, 'system',
        `${next.agent_id} auto-promoted to owner (previous owner ${removedOwnerId} removed)`);
    }
  }

  /** Sync squad_members from the squads.agent_ids JSON array (migration helper) */
  syncFromAgentIds(squadId: string, agentIds: string[], createdBy: string = 'system'): void {
    const existing = new Set(this.listBySquad(squadId).map(m => m.agentId));

    for (let i = 0; i < agentIds.length; i++) {
      const agentId = agentIds[i];
      if (!existing.has(agentId)) {
        const role = i === 0 ? 'owner' : 'member';
        this.db.prepare(`
          INSERT OR IGNORE INTO squad_members (squad_id, agent_id, role, added_by, added_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(squadId, agentId, role, createdBy);
      }
    }
  }

  /** Record a squad event (member add/remove/role change) */
  recordEvent(squadId: string, eventType: string, agentId: string | undefined, actor: string, detail: string): void {
    this.db.prepare(`
      INSERT INTO squad_events (id, squad_id, event_type, agent_id, actor, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuid(), squadId, eventType, agentId || null, actor, detail);
  }

  /** Get recent events for a squad */
  getEvents(squadId: string, limit: number = 20): SquadEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM squad_events WHERE squad_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(squadId, limit) as EventRow[];
    return rows.map(this.toEvent);
  }

  private toMember(row: MemberRow): SquadMember {
    return {
      squadId: row.squad_id,
      agentId: row.agent_id,
      role: row.role as SquadMember['role'],
      addedBy: row.added_by,
      addedAt: row.added_at,
    };
  }

  private toEvent(row: EventRow): SquadEvent {
    return {
      id: row.id,
      squadId: row.squad_id,
      eventType: row.event_type,
      agentId: row.agent_id ?? undefined,
      actor: row.actor,
      detail: row.detail,
      createdAt: row.created_at,
    };
  }
}

import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { Squad, SquadCreateInput } from '@superclaw/shared';

interface SquadRow {
  id: string; name: string; emoji: string; description: string;
  agent_ids: string; sprint_config: string | null; routing_strategy: string;
  debate_enabled: number; created_at: string; updated_at: string;
}

export class SquadRepository {
  constructor(private db: Database.Database) {}

  list(): Squad[] {
    const rows = this.db.prepare('SELECT * FROM squads ORDER BY created_at DESC').all() as SquadRow[];
    return rows.map(this.toSquad);
  }

  getById(id: string): Squad | null {
    const row = this.db.prepare('SELECT * FROM squads WHERE id = ?').get(id) as SquadRow | undefined;
    return row ? this.toSquad(row) : null;
  }

  create(input: SquadCreateInput): Squad {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO squads (id, name, emoji, description, agent_ids, routing_strategy, debate_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.emoji ?? '🚀',
      input.description ?? '',
      JSON.stringify(input.agentIds),
      input.routingStrategy ?? 'auto',
      input.debateEnabled !== false ? 1 : 0,
      now,
      now
    );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<SquadCreateInput>): Squad | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.emoji !== undefined) { fields.push('emoji = ?'); values.push(patch.emoji); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.agentIds !== undefined) { fields.push('agent_ids = ?'); values.push(JSON.stringify(patch.agentIds)); }
    if (patch.routingStrategy !== undefined) { fields.push('routing_strategy = ?'); values.push(patch.routingStrategy); }
    if (patch.debateEnabled !== undefined) { fields.push('debate_enabled = ?'); values.push(patch.debateEnabled ? 1 : 0); }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE squads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM squads WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private toSquad(row: SquadRow): Squad {
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      description: row.description,
      agentIds: JSON.parse(row.agent_ids || '[]'),
      sprintConfig: JSON.parse(row.sprint_config || '{}'),
      routingStrategy: row.routing_strategy as Squad['routingStrategy'],
      debateEnabled: Boolean(row.debate_enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

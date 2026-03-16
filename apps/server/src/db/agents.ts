import { v4 as uuid } from 'uuid';
import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import type { Agent, AgentCreateInput } from '@hiveclaw/shared';
import { sanitizeText } from '../utils/sanitize.js';

interface AgentRow {
  id: string; name: string; emoji: string; role: string; type: string;
  system_prompt: string; skills: string; model_preference: string | null;
  provider_preference: string | null; fallback_providers: string;
  temperature: number; max_tokens: number | null; status: string; color: string | null;
  api_token: string | null;
  created_at: string; updated_at: string;
}

export class AgentRepository {
  constructor(private db: Database.Database) {}

  list(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentRow[];
    return rows.map(this.toAgent);
  }

  getById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    return row ? this.toAgent(row) : null;
  }

  create(input: AgentCreateInput): Agent {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agents (id, name, emoji, role, type, system_prompt, skills, model_preference, provider_preference, fallback_providers, temperature, max_tokens, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sanitizeText(input.name),
      sanitizeText(input.emoji ?? '🤖'),
      sanitizeText(input.role),
      input.type ?? 'specialist',
      input.systemPrompt,
      JSON.stringify(input.skills ?? []),
      input.modelPreference ?? '',
      input.providerPreference ?? '',
      JSON.stringify(input.fallbackProviders ?? []),
      input.temperature ?? 0.7,
      input.maxTokens ?? 4096,
      input.color ?? '#7c5bf5',
      now,
      now
    );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<AgentCreateInput>): Agent | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(sanitizeText(patch.name)); }
    if (patch.emoji !== undefined) { fields.push('emoji = ?'); values.push(sanitizeText(patch.emoji)); }
    if (patch.role !== undefined) { fields.push('role = ?'); values.push(sanitizeText(patch.role)); }
    if (patch.type !== undefined) { fields.push('type = ?'); values.push(patch.type); }
    if (patch.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(patch.systemPrompt); }
    if (patch.skills !== undefined) { fields.push('skills = ?'); values.push(JSON.stringify(patch.skills)); }
    if (patch.modelPreference !== undefined) { fields.push('model_preference = ?'); values.push(patch.modelPreference); }
    if (patch.providerPreference !== undefined) { fields.push('provider_preference = ?'); values.push(patch.providerPreference); }
    if (patch.fallbackProviders !== undefined) { fields.push('fallback_providers = ?'); values.push(JSON.stringify(patch.fallbackProviders)); }
    if (patch.temperature !== undefined) { fields.push('temperature = ?'); values.push(patch.temperature); }
    if (patch.maxTokens !== undefined) { fields.push('max_tokens = ?'); values.push(patch.maxTokens); }
    if (patch.color !== undefined) { fields.push('color = ?'); values.push(patch.color); }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── R15: Agent Bearer Token Management ────────────────────────────────────

  /** Generate a new API token for an agent: hc-agent-{shortId}-{random} */
  generateToken(id: string): string | null {
    const agent = this.getById(id);
    if (!agent) return null;
    const shortId = id.slice(0, 8);
    const random = randomBytes(16).toString('hex');
    const token = `hc-agent-${shortId}-${random}`;
    this.db.prepare('UPDATE agents SET api_token = ?, updated_at = ? WHERE id = ?')
      .run(token, new Date().toISOString(), id);
    return token;
  }

  /** Revoke (clear) an agent's API token */
  revokeToken(id: string): boolean {
    const result = this.db.prepare('UPDATE agents SET api_token = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Look up an agent by its bearer token. Returns null if not found or token is null. */
  getByToken(token: string): Agent | null {
    if (!token || !token.startsWith('hc-agent-')) return null;
    const row = this.db.prepare('SELECT * FROM agents WHERE api_token = ?').get(token) as AgentRow | undefined;
    return row ? this.toAgent(row) : null;
  }

  private toAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      role: row.role,
      type: row.type as Agent['type'],
      systemPrompt: row.system_prompt,
      skills: JSON.parse(row.skills || '[]'),
      modelPreference: row.model_preference ?? '',
      providerPreference: row.provider_preference ?? '',
      fallbackProviders: JSON.parse(row.fallback_providers || '[]'),
      temperature: row.temperature,
      maxTokens: row.max_tokens ?? 4096,
      status: row.status as Agent['status'],
      color: row.color ?? '',
      apiToken: row.api_token ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// Repository helpers for DB operations
import { getDb } from './index.js';
import { randomUUID } from 'node:crypto';

// ── Providers ────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key?: string;
  models: string[];
  enabled: boolean;
}

export function listProviders(): Provider[] {
  const rows = getDb().prepare('SELECT * FROM providers ORDER BY name').all() as any[];
  return rows.map(r => ({ ...r, models: JSON.parse(r.models || '[]'), enabled: !!r.enabled }));
}

export function getProvider(id: string): Provider | undefined {
  const r = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
  if (!r) return undefined;
  return { ...r, models: JSON.parse(r.models || '[]'), enabled: !!r.enabled };
}

export function createProvider(data: Omit<Provider, 'id'>): Provider {
  const id = randomUUID();
  getDb().prepare(
    'INSERT INTO providers (id, name, type, base_url, api_key, models, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.name, data.type, data.base_url, data.api_key ?? null, JSON.stringify(data.models), data.enabled ? 1 : 0);
  return { id, ...data };
}

export function deleteProvider(id: string): boolean {
  const result = getDb().prepare('DELETE FROM providers WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Agents ───────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  system_prompt: string;
  provider_id?: string;
  model?: string;
  temperature: number;
  max_tokens: number;
}

export function listAgents(): Agent[] {
  return getDb().prepare('SELECT * FROM agents ORDER BY created_at').all() as Agent[];
}

export function getAgent(id: string): Agent | undefined {
  return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
}

export function createAgent(data: Partial<Agent>): Agent {
  const id = data.id ?? randomUUID();
  const agent: Agent = {
    id,
    name: data.name ?? 'Agent',
    emoji: data.emoji ?? '🤖',
    system_prompt: data.system_prompt ?? 'You are a helpful assistant.',
    provider_id: data.provider_id,
    model: data.model,
    temperature: data.temperature ?? 0.7,
    max_tokens: data.max_tokens ?? 4096,
  };
  getDb().prepare(
    'INSERT INTO agents (id, name, emoji, system_prompt, provider_id, model, temperature, max_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(agent.id, agent.name, agent.emoji, agent.system_prompt, agent.provider_id ?? null, agent.model ?? null, agent.temperature, agent.max_tokens);
  return agent;
}

export function updateAgent(id: string, data: Partial<Agent>): boolean {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k !== 'id') { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  const result = getDb().prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return result.changes > 0;
}

export function deleteAgent(id: string): boolean {
  return getDb().prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
}

// ── Sessions ─────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  agent_id?: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export function listSessions(): Session[] {
  return getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Session[];
}

export function getSession(id: string): Session | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
}

export function createSession(agentId?: string): Session {
  const id = randomUUID();
  getDb().prepare('INSERT INTO sessions (id, agent_id) VALUES (?, ?)').run(id, agentId ?? null);
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}

export function updateSession(id: string, title: string): boolean {
  return getDb().prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id).changes > 0;
}

export function deleteSession(id: string): boolean {
  return getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
}

// ── Messages ─────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  model?: string;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

export function listMessages(sessionId: string): Message[] {
  return getDb().prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Message[];
}

export function createMessage(data: { session_id: string; role: string; content: string; model?: string; tokens_in?: number; tokens_out?: number }): Message {
  const id = randomUUID();
  getDb().prepare(
    'INSERT INTO messages (id, session_id, role, content, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.session_id, data.role, data.content, data.model ?? null, data.tokens_in ?? 0, data.tokens_out ?? 0);
  // Update session timestamp
  getDb().prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(data.session_id);
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message;
}

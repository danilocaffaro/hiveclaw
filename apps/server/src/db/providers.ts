import type Database from 'better-sqlite3';
// Provider configuration and repository
import { PROVIDER_BASE_URLS } from '../config/defaults.js';

// ============================================================
// Provider & Model Types
// ============================================================

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput?: number;
  costPerMInput?: number;
  costPerMOutput?: number;
  capabilities: string[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'google' | 'ollama' | 'github-copilot' | 'openrouter' | 'deepseek' | 'groq' | 'mistral' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  status: 'connected' | 'not_configured' | 'error';
  models: ModelConfig[];
  enabled: boolean;
}

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  api_key: string | null;
  base_url: string | null;
  enabled: number;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderConfigJson {
  models?: ModelConfig[];
  status?: string;
}

// ============================================================
// Default providers seed data
// ============================================================

export const DEFAULT_PROVIDERS: Array<Omit<ProviderConfig, 'status'> & { base_url?: string }> = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    enabled: true,
    models: [
      {
        id: 'claude-sonnet-4-5-20250514',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 8192,
        costPerMInput: 3,
        costPerMOutput: 15,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-sonnet-4-6-20250725',
        name: 'Claude Sonnet 4.6 (snapshot)',
        provider: 'anthropic',
        contextWindow: 1000000,
        maxOutput: 64000,
        costPerMInput: 3,
        costPerMOutput: 15,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'anthropic',
        contextWindow: 1000000,
        maxOutput: 64000,
        costPerMInput: 3,
        costPerMOutput: 15,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-opus-4-6-20250725',
        name: 'Claude Opus 4.6 (snapshot)',
        provider: 'anthropic',
        contextWindow: 1000000,
        maxOutput: 128000,
        costPerMInput: 5,
        costPerMOutput: 25,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        provider: 'anthropic',
        contextWindow: 1000000,
        maxOutput: 128000,
        costPerMInput: 5,
        costPerMOutput: 25,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5 (snapshot)',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 64000,
        costPerMInput: 1,
        costPerMOutput: 5,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 64000,
        costPerMInput: 1,
        costPerMOutput: 5,
        capabilities: ['text', 'vision', 'tools'],
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        contextWindow: 128000,
        maxOutput: 16384,
        costPerMInput: 2.5,
        costPerMOutput: 10,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        contextWindow: 128000,
        maxOutput: 16384,
        costPerMInput: 0.15,
        costPerMOutput: 0.6,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'o3',
        name: 'o3',
        provider: 'openai',
        contextWindow: 200000,
        maxOutput: 100000,
        costPerMInput: 10,
        costPerMOutput: 40,
        capabilities: ['text', 'tools'],
      },
      {
        id: 'o4-mini',
        name: 'o4-mini',
        provider: 'openai',
        contextWindow: 200000,
        maxOutput: 100000,
        costPerMInput: 1.1,
        costPerMOutput: 4.4,
        capabilities: ['text', 'tools'],
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    type: 'ollama',
    enabled: true,
    baseUrl: PROVIDER_BASE_URLS.ollama,
    models: [
      {
        id: 'llama3.3:70b',
        name: 'Llama 3.3 70B',
        provider: 'ollama',
        contextWindow: 131072,
        maxOutput: 8192,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'tools'],
      },
      {
        id: 'deepseek-r1:32b',
        name: 'DeepSeek R1 32B',
        provider: 'ollama',
        contextWindow: 131072,
        maxOutput: 8192,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'tools'],
      },
      {
        id: 'qwen3:8b',
        name: 'Qwen3 8B',
        provider: 'ollama',
        contextWindow: 32768,
        maxOutput: 8192,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text'],
      },
    ],
  },
  {
    id: 'google',
    name: 'Google AI',
    type: 'google',
    enabled: true,
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'google',
        contextWindow: 1000000,
        maxOutput: 8192,
        costPerMInput: 1.25,
        costPerMOutput: 10,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'google',
        contextWindow: 1000000,
        maxOutput: 8192,
        costPerMInput: 0.15,
        costPerMOutput: 0.6,
        capabilities: ['text', 'vision', 'tools'],
      },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    type: 'github-copilot',
    enabled: true,
    base_url: 'https://api.githubcopilot.com',
    models: [
      {
        id: 'claude-opus-4',
        name: 'Claude Opus 4',
        provider: 'github-copilot',
        contextWindow: 200000,
        maxOutput: 32768,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        provider: 'github-copilot',
        contextWindow: 200000,
        maxOutput: 8192,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'github-copilot',
        contextWindow: 128000,
        maxOutput: 16384,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'vision', 'tools'],
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        provider: 'github-copilot',
        contextWindow: 200000,
        maxOutput: 100000,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'tools'],
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'github-copilot',
        contextWindow: 1000000,
        maxOutput: 8192,
        costPerMInput: 0,
        costPerMOutput: 0,
        capabilities: ['text', 'vision', 'tools'],
      },
    ],
  },
];

// ============================================================
// Helper: mask API key
// ============================================================

export function maskApiKey(key: string): string {
  if (key.length <= 4) return '****';
  return `...${key.slice(-4)}`;
}

// ============================================================
// ProviderRepository
// ============================================================

export class ProviderRepository {
  constructor(private db: Database.Database) {}

  /** Deserialize a DB row to ProviderConfig (API key masked) */
  private rowToConfig(row: ProviderRow, maskKey = true): ProviderConfig {
    const cfg: ProviderConfigJson = row.config_json ? (JSON.parse(row.config_json) as ProviderConfigJson) : {};
    const models: ModelConfig[] = cfg.models ?? [];

    let apiKey: string | undefined;
    if (row.api_key) {
      apiKey = maskKey ? maskApiKey(row.api_key) : row.api_key;
    }

    // Determine status
    let status: ProviderConfig['status'];
    if (row.type === 'ollama' || row.type === 'local' || row.type === 'lmstudio') {
      // Keyless providers: check if they were ever successfully tested
      // config_json.status is set to 'connected' after a successful test/connection
      status = cfg.status === 'connected' ? 'connected' : 'not_configured';
    } else {
      status = row.api_key ? 'connected' : 'not_configured';
    }

    return {
      id: row.id,
      name: row.name,
      type: row.type as ProviderConfig['type'],
      apiKey,
      baseUrl: row.base_url ?? undefined,
      status,
      models,
      enabled: row.enabled === 1,
    };
  }

  /** List all providers (API keys masked) */
  list(): ProviderConfig[] {
    const rows = this.db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all() as ProviderRow[];
    return rows.map((r) => this.rowToConfig(r, true));
  }

  /** Get one provider by ID (unmasked, for internal use) */
  getUnmasked(id: string): (ProviderConfig & { rawApiKey?: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
    if (!row) return undefined;
    const cfg = this.rowToConfig(row, false);
    return { ...cfg, rawApiKey: row.api_key ?? undefined };
  }

  /** Get one provider by ID (masked) */
  get(id: string): ProviderConfig | undefined {
    const row = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
    if (!row) return undefined;
    return this.rowToConfig(row, true);
  }

  /** Upsert a provider */
  upsert(data: {
    id: string;
    name?: string;
    type?: string;
    apiKey?: string;
    baseUrl?: string;
    enabled?: boolean;
    models?: ModelConfig[];
  }): ProviderConfig {
    const existing = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(data.id) as ProviderRow | undefined;

    if (existing) {
      // Update — only update provided fields
      const name = data.name ?? existing.name;
      const type = data.type ?? existing.type;
      const apiKey = data.apiKey !== undefined ? data.apiKey : existing.api_key;
      const baseUrl = data.baseUrl !== undefined ? data.baseUrl : existing.base_url;
      const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled;

      // Merge models
      const existingCfg: ProviderConfigJson = existing.config_json
        ? (JSON.parse(existing.config_json) as ProviderConfigJson)
        : {};
      const models = data.models ?? existingCfg.models ?? [];
      // Mark keyless providers as connected when they have models (test succeeded)
      const isKeyless = ['ollama', 'local', 'lmstudio'].includes(type);
      const status = isKeyless && data.models && data.models.length > 0
        ? 'connected'
        : (isKeyless ? existingCfg.status : undefined);
      const configJson = JSON.stringify({ ...existingCfg, models, ...(status ? { status } : {}) });

      this.db
        .prepare(
          `UPDATE providers SET name=?, type=?, api_key=?, base_url=?, enabled=?, config_json=?, updated_at=datetime('now') WHERE id=?`,
        )
        .run(name, type, apiKey, baseUrl, enabled, configJson, data.id);
    } else {
      // Insert
      const models = data.models ?? [];
      const configJson = JSON.stringify({ models });
      this.db
        .prepare(
          `INSERT INTO providers (id, name, type, api_key, base_url, enabled, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.id,
          data.name ?? data.id,
          data.type ?? 'custom',
          data.apiKey ?? null,
          data.baseUrl ?? null,
          data.enabled !== false ? 1 : 0,
          configJson,
        );
    }

    return this.get(data.id)!;
  }

  /** Delete a provider */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Get all models across all enabled providers */
  allModels(): ModelConfig[] {
    const rows = this.db.prepare('SELECT * FROM providers WHERE enabled = 1').all() as ProviderRow[];
    const models: ModelConfig[] = [];
    for (const row of rows) {
      const cfg: ProviderConfigJson = row.config_json ? (JSON.parse(row.config_json) as ProviderConfigJson) : {};
      for (const m of cfg.models ?? []) {
        models.push({ ...m, provider: row.id });
      }
    }
    return models;
  }

  /** Get default model from settings */
  getDefaultModel(): { providerId: string; modelId: string } | undefined {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'default_model'`)
      .get() as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as { providerId: string; modelId: string };
    } catch {
      return undefined;
    }
  }

  /** Set default model */
  setDefaultModel(providerId: string, modelId: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('default_model', ?, datetime('now'))`)
      .run(JSON.stringify({ providerId, modelId }));
  }

  /** Seed default providers if table is empty */
  seedDefaults(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as n FROM providers').get() as { n: number }).n;
    if (count > 0) return;

    for (const p of DEFAULT_PROVIDERS) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO providers (id, name, type, api_key, base_url, enabled, config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.id,
          p.name,
          p.type,
          null, // no API key on seed
          p.baseUrl ?? null,
          1,
          JSON.stringify({ models: p.models }),
        );
    }
  }
}

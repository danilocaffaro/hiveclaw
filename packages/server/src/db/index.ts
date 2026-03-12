// Database initialization and schema management
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const DATA_DIR = resolve(homedir(), '.superclaw-pure');
const DB_PATH = resolve(DATA_DIR, 'superclaw.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- App config (key-value store)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- LLM Providers
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT NOT NULL,
      api_key TEXT,
      models TEXT DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Agents
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🤖',
      system_prompt TEXT DEFAULT '',
      provider_id TEXT,
      model TEXT,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
    );

    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      title TEXT DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Check if setup is complete
  const setupDone = db.prepare("SELECT value FROM config WHERE key = 'setup_complete'").get();
  if (!setupDone) {
    db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('setup_complete', 'false')").run();
    db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('app_name', 'SuperClaw Pure')").run();
    db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('version', '0.1.0')").run();
  }
}

export function isSetupComplete(): boolean {
  const row = getDb().prepare("SELECT value FROM config WHERE key = 'setup_complete'").get() as { value: string } | undefined;
  return row?.value === 'true';
}

export function completeSetup(): void {
  getDb().prepare("UPDATE config SET value = 'true', updated_at = datetime('now') WHERE key = 'setup_complete'").run();
}

export function getConfig(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  getDb().prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value);
}

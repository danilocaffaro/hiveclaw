import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const SUPERCLAW_DIR = join(homedir(), '.superclaw');
const DB_PATH = join(SUPERCLAW_DIR, 'superclaw.db');

let _dbInstance: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (_dbInstance) return _dbInstance;

  mkdirSync(SUPERCLAW_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🤖',
      role TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'specialist',
      system_prompt TEXT NOT NULL,
      skills TEXT DEFAULT '[]',
      model_preference TEXT DEFAULT '',
      provider_preference TEXT DEFAULT '',
      fallback_providers TEXT DEFAULT '[]',
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096,
      status TEXT DEFAULT 'active',
      color TEXT DEFAULT '#7c5bf5',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS squads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🚀',
      description TEXT DEFAULT '',
      agent_ids TEXT NOT NULL DEFAULT '[]',
      sprint_config TEXT DEFAULT '{}',
      routing_strategy TEXT DEFAULT 'auto',
      debate_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      agent_id TEXT DEFAULT '',
      squad_id TEXT DEFAULT '',
      mode TEXT DEFAULT 'dm',
      provider_id TEXT DEFAULT '',
      model_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      agent_id TEXT DEFAULT '',
      content TEXT NOT NULL DEFAULT '[]',
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- B063: sprints, debates, debate_entries tables are unused (no repository, no API)
    -- Kept for backward compat with existing DBs but not created in new installs
    -- CREATE TABLE IF NOT EXISTS sprints (...)
    -- CREATE TABLE IF NOT EXISTS debates (...)
    -- CREATE TABLE IF NOT EXISTS debate_entries (...)
    -- 
    --     CREATE TABLE IF NOT EXISTS tasks (
    --       id TEXT PRIMARY KEY,
    --       session_id TEXT,
    --       squad_id TEXT,
    --       title TEXT NOT NULL,
    --       description TEXT DEFAULT '',
    --       status TEXT DEFAULT 'todo' CHECK(status IN ('todo','doing','review','done')),
    --       priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    --       assigned_agent_id TEXT,
    --       tags TEXT DEFAULT '[]',
    --       sort_order INTEGER DEFAULT 0,
    --       completed_at TEXT,
    --       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    --       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    --     );
    -- 
    --     CREATE TABLE IF NOT EXISTS debates (
    --       id TEXT PRIMARY KEY,
    --       session_id TEXT NOT NULL REFERENCES sessions(id),
    --       squad_id TEXT,
    --       topic TEXT NOT NULL,
    --       status TEXT DEFAULT 'active',
    --       resolution TEXT DEFAULT '',
    --       rounds INTEGER DEFAULT 0,
    --       max_rounds INTEGER DEFAULT 3,
    --       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    --     );
    -- 
    --     CREATE TABLE IF NOT EXISTS debate_entries (
    --       id TEXT PRIMARY KEY,
    --       debate_id TEXT NOT NULL REFERENCES debates(id),
    --       agent_id TEXT NOT NULL,
    --       round INTEGER NOT NULL,
    --       position TEXT NOT NULL,
    --       content TEXT NOT NULL,
    --       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    --     );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      enabled INTEGER DEFAULT 1,
      config_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      squad_id TEXT,
      agent_id TEXT,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'text' CHECK(type IN ('text','code','image','file','url')),
      content TEXT DEFAULT '',
      language TEXT,
      metadata TEXT DEFAULT '{}',
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS marketplace_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      author TEXT DEFAULT 'community',
      version TEXT DEFAULT '1.0.0',
      category TEXT DEFAULT 'general',
      tags TEXT DEFAULT '[]',
      downloads INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      icon TEXT DEFAULT '🔧',
      install_command TEXT,
      config_schema TEXT DEFAULT '{}',
      installed INTEGER DEFAULT 0,
      installed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT DEFAULT 'member' CHECK(role IN ('owner','admin','member','viewer')),
      avatar_url TEXT,
      api_key TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finetune_datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      format TEXT DEFAULT 'jsonl' CHECK(format IN ('jsonl','csv','conversation')),
      source_path TEXT,
      row_count INTEGER DEFAULT 0,
      size_bytes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','validated','uploading','uploaded','error')),
      validation_errors TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finetune_jobs (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_model TEXT NOT NULL,
      fine_tuned_model TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','preparing','training','succeeded','failed','cancelled')),
      hyperparameters TEXT DEFAULT '{}',
      metrics TEXT DEFAULT '{}',
      provider_job_id TEXT,
      epochs INTEGER DEFAULT 3,
      learning_rate REAL,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_squad ON artifacts(squad_id);
    -- idx_tasks_session moved to after tasks table creation (B056 migration block)
    -- CREATE INDEX IF NOT EXISTS idx_debate_entries_debate ON debate_entries(debate_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_squad ON sessions(squad_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_finetune_jobs_dataset ON finetune_jobs(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_finetune_jobs_status ON finetune_jobs(status);

    CREATE TABLE IF NOT EXISTS credential_vault (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      service TEXT DEFAULT '',
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      salt TEXT NOT NULL,
      expires_at TEXT,
      one_time INTEGER DEFAULT 1,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credential_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      label TEXT NOT NULL,
      service TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','provided','expired','cancelled')),
      credential_id TEXT,
      one_time INTEGER DEFAULT 1,
      save_to_vault INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_credential_requests_session ON credential_requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_credential_requests_status ON credential_requests(status);

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('short_term','long_term','entity','preference','fact','decision','goal','event','procedure','correction')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      relevance REAL DEFAULT 1.0,
      source TEXT,
      tags TEXT DEFAULT '[]',
      access_count INTEGER DEFAULT 0,
      last_accessed DATETIME,
      event_at DATETIME,
      valid_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id, type);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory(expires_at);

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('related_to','updates','contradicts','supports','caused_by','part_of')),
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, target_id, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id);

    CREATE TABLE IF NOT EXISTS session_usage (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_session_usage_session ON session_usage(session_id);

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '⚡',
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'development',
      steps TEXT NOT NULL DEFAULT '[]',
      is_builtin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      status TEXT NOT NULL DEFAULT 'pending',
      current_step INTEGER DEFAULT 0,
      params TEXT DEFAULT '{}',
      error TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      agent_role TEXT DEFAULT '',
      agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      input_context TEXT DEFAULT '',
      output TEXT DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_wrs_run ON workflow_run_steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);

    CREATE TABLE IF NOT EXISTS squad_members (
      squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      role TEXT DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
      added_by TEXT DEFAULT 'system',
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (squad_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_squad_members_squad ON squad_members(squad_id);

    CREATE TABLE IF NOT EXISTS squad_events (
      id TEXT PRIMARY KEY,
      squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      agent_id TEXT,
      actor TEXT DEFAULT 'system',
      detail TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_squad_events_squad ON squad_events(squad_id);

    -- ── Gateways (B046 — Sprint 49) ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS gateways (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      tunnel_port INTEGER,
      tunnel_host TEXT DEFAULT '127.0.0.1',
      ssh_target TEXT,
      enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error')),
      last_health_at DATETIME,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- B054: Shared links for external/guest chat access
    CREATE TABLE IF NOT EXISTS shared_links (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      welcome_message TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      max_messages INTEGER DEFAULT 100,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── Migrations (idempotent column additions) ──────────────────────────────
  // Add max_tokens if missing (for existing DBs created before this column was added)
  const agentCols = (db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!agentCols.includes('max_tokens')) {
    db.exec("ALTER TABLE agents ADD COLUMN max_tokens INTEGER DEFAULT 4096");
  }
  if (!agentCols.includes('fallback_providers')) {
    db.exec("ALTER TABLE agents ADD COLUMN fallback_providers TEXT DEFAULT '[]'");
  }

  // B056: Ensure tasks table exists (may be missing in fresh installs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      squad_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo','doing','review','done')),
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      assigned_agent_id TEXT,
      tags TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      source_message_id TEXT,
      completed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add source_message_id if missing (existing DBs)
  const taskCols = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map(c => c.name);
  if (!taskCols.includes('source_message_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN source_message_id TEXT");
  }

  // BUG-01: Create tasks index here (after table exists), not in initial block
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);

  // ── Sprint 65: Eidetic Memory Layer ───────────────────────────────────────

  // 1. FTS5 index on messages — full-text search across all chat history
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        session_id UNINDEXED,
        agent_id UNINDEXED,
        role UNINDEXED,
        created_at UNINDEXED,
        tokenize='porter unicode61 remove_diacritics 2',
        content_rowid='rowid'
      )
    `);
  } catch {
    // FTS5 may already exist or tokenizer unavailable — non-fatal
  }

  // 2. Auto-sync triggers: new messages → FTS5 index
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
        VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.agent_id, NEW.role, NEW.created_at);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, session_id, agent_id, role, created_at)
        VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.agent_id, OLD.role, OLD.created_at);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, session_id, agent_id, role, created_at)
        VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.agent_id, OLD.role, OLD.created_at);
        INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
        VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.agent_id, NEW.role, NEW.created_at);
      END;
    `);
  } catch {
    // Triggers may already exist — non-fatal
  }

  // 3. Working Memory — task continuation state, saved before compaction
  db.exec(`
    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL DEFAULT '',
      active_goals TEXT DEFAULT '[]',
      current_plan TEXT DEFAULT '',
      completed_steps TEXT DEFAULT '[]',
      next_actions TEXT DEFAULT '[]',
      pending_context TEXT DEFAULT '',
      open_questions TEXT DEFAULT '[]',
      tool_state TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Unique constraint on session
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_working_memory_session ON working_memory(session_id)");
  } catch { /* may exist */ }

  // 4. Core Memory Blocks — always-in-prompt, agent-editable structured memory
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_memory_blocks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      block_name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      max_tokens INTEGER DEFAULT 500,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(agent_id, block_name)
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_core_memory_agent ON core_memory_blocks(agent_id)");
  } catch { /* may exist */ }

  // 5. Episodes — temporal log of events (Zep/Graphiti-inspired)
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK(type IN ('message','compaction','extraction','decision','event')),
      content TEXT NOT NULL,
      event_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}'
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_episodes_agent ON episodes(agent_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_episodes_event_at ON episodes(event_at)");
  } catch { /* may exist */ }

  // 6. Compaction Log — audit trail of compaction events
  db.exec(`
    CREATE TABLE IF NOT EXISTS compaction_log (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      extracted_facts INTEGER DEFAULT 0,
      messages_compacted INTEGER DEFAULT 0,
      tokens_before INTEGER DEFAULT 0,
      tokens_after INTEGER DEFAULT 0,
      working_memory_saved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_compaction_log_session ON compaction_log(session_id)");
  } catch { /* may exist */ }

  // 7. Migrate agent_memory: add event_at, valid_until columns if missing (existing DBs)
  const amCols = (db.prepare("PRAGMA table_info(agent_memory)").all() as Array<{ name: string }>).map(c => c.name);
  if (!amCols.includes('event_at')) {
    try { db.exec("ALTER TABLE agent_memory ADD COLUMN event_at DATETIME"); } catch { /* */ }
  }
  if (!amCols.includes('valid_until')) {
    try { db.exec("ALTER TABLE agent_memory ADD COLUMN valid_until DATETIME"); } catch { /* */ }
  }

  // 8. Migrate: backfill FTS5 from existing messages (one-time)
  try {
    const ftsCount = (db.prepare("SELECT COUNT(*) as cnt FROM messages_fts").get() as { cnt: number }).cnt;
    if (ftsCount === 0) {
      const msgCount = (db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number }).cnt;
      if (msgCount > 0) {
        db.exec(`
          INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
          SELECT rowid, content, session_id, agent_id, role, created_at FROM messages
        `);
      }
    }
  } catch {
    // Non-fatal — FTS backfill can be retried
  }

  // No default agent seed — the setup wizard creates the first agent
  // This ensures a 100% virgin setup experience

  _dbInstance = db;
  return db;
}

// ─── Singleton accessor ───────────────────────────────────────────────────────

/**
 * Get the shared SQLite database instance.
 * initDatabase() must be called first (in index.ts); if not yet called, this
 * will call it automatically.
 */
export function getDb(): Database.Database {
  if (!_dbInstance) {
    return initDatabase();
  }
  return _dbInstance;
}


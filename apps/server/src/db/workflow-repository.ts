// ============================================================
// Workflow Repository — SQLite-backed workflow persistence
// ============================================================

import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import { randomUUID } from 'crypto';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface WorkflowStep {
  name: string;
  agentRole: string;
  description: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  category: string;
  steps: WorkflowStep[];
  isBuiltin: boolean;
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  params: Record<string, string>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  steps: WorkflowRunStep[];
}

export interface WorkflowRunStep {
  id: string;
  runId: string;
  stepIndex: number;
  name: string;
  agentRole: string;
  agentId?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  inputContext: string;
  output: string;
  durationMs: number;
  startedAt?: string;
  completedAt?: string;
}

// ─── Row types (raw SQLite) ───────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  name: string;
  emoji: string;
  description: string;
  category: string;
  steps: string;
  is_builtin: number;
  created_at: string;
}

interface RunRow {
  id: string;
  workflow_id: string;
  status: string;
  current_step: number;
  params: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RunStepRow {
  id: string;
  run_id: string;
  step_index: number;
  name: string;
  agent_role: string;
  agent_id: string | null;
  status: string;
  input_context: string;
  output: string;
  duration_ms: number;
  started_at: string | null;
  completed_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToTemplate(row: TemplateRow): WorkflowTemplate {
  let steps: WorkflowStep[] = [];
  try {
    steps = JSON.parse(row.steps) as WorkflowStep[];
  } catch (e) { logger.debug({ err: e }, '[workflow] Failed to parse template steps JSON'); }

  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? '⚡',
    description: row.description ?? '',
    category: row.category ?? 'development',
    steps,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
  };
}

function rowToRunStep(row: RunStepRow): WorkflowRunStep {
  return {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    name: row.name,
    agentRole: row.agent_role ?? '',
    agentId: row.agent_id ?? undefined,
    status: row.status as WorkflowRunStep['status'],
    inputContext: row.input_context ?? '',
    output: row.output ?? '',
    durationMs: row.duration_ms ?? 0,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToRun(row: RunRow, steps: WorkflowRunStep[]): WorkflowRun {
  let params: Record<string, string> = {};
  try {
    params = JSON.parse(row.params) as Record<string, string>;
  } catch (e) { logger.debug({ err: e }, '[workflow] Failed to parse run params JSON'); }

  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRun['status'],
    currentStep: row.current_step ?? 0,
    params,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    steps,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class WorkflowRepository {
  constructor(private db: Database.Database) {}

  // ── Templates ─────────────────────────────────────────────────────────────

  listTemplates(): WorkflowTemplate[] {
    const rows = this.db.prepare(
      'SELECT * FROM workflows ORDER BY name',
    ).all() as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  getTemplate(id: string): WorkflowTemplate | null {
    const row = this.db.prepare(
      'SELECT * FROM workflows WHERE id = ?',
    ).get(id) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }

  createTemplate(t: Omit<WorkflowTemplate, 'id' | 'createdAt'>): WorkflowTemplate {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflows (id, name, emoji, description, category, steps, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, t.name, t.emoji, t.description, t.category, JSON.stringify(t.steps), t.isBuiltin ? 1 : 0, now);
    return this.getTemplate(id)!;
  }

  updateTemplate(id: string, patch: Partial<WorkflowTemplate>): WorkflowTemplate | null {
    const existing = this.getTemplate(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) { updates.push('name = ?'); values.push(patch.name); }
    if (patch.emoji !== undefined) { updates.push('emoji = ?'); values.push(patch.emoji); }
    if (patch.description !== undefined) { updates.push('description = ?'); values.push(patch.description); }
    if (patch.category !== undefined) { updates.push('category = ?'); values.push(patch.category); }
    if (patch.steps !== undefined) { updates.push('steps = ?'); values.push(JSON.stringify(patch.steps)); }

    if (updates.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getTemplate(id);
  }

  deleteTemplate(id: string): boolean {
    const existing = this.getTemplate(id);
    if (!existing || existing.isBuiltin) return false;
    const result = this.db.prepare('DELETE FROM workflows WHERE id = ? AND is_builtin = 0').run(id);
    return result.changes > 0;
  }

  seedBuiltins(templates: Array<Omit<WorkflowTemplate, 'id' | 'createdAt' | 'isBuiltin'>>): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO workflows (id, name, emoji, description, category, steps, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `);

    for (const t of templates) {
      const id = `builtin-${slugify(t.name)}`;
      stmt.run(id, t.name, t.emoji, t.description, t.category, JSON.stringify(t.steps));
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  createRun(workflowId: string, params?: Record<string, string>): WorkflowRun {
    const template = this.getTemplate(workflowId);
    if (!template) throw new Error(`Workflow template not found: ${workflowId}`);

    const runId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO workflow_runs (id, workflow_id, status, current_step, params, started_at, created_at)
      VALUES (?, ?, 'pending', 0, ?, ?, ?)
    `).run(runId, workflowId, JSON.stringify(params ?? {}), now, now);

    // Insert steps from template
    const stepStmt = this.db.prepare(`
      INSERT INTO workflow_run_steps (id, run_id, step_index, name, agent_role, status, input_context)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);

    for (let i = 0; i < template.steps.length; i++) {
      const step = template.steps[i];
      stepStmt.run(randomUUID(), runId, i, step.name, step.agentRole, step.description);
    }

    return this.getRun(runId)!;
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare(
      'SELECT * FROM workflow_runs WHERE id = ?',
    ).get(id) as RunRow | undefined;
    if (!row) return null;

    const stepRows = this.db.prepare(
      'SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY step_index ASC',
    ).all(id) as RunStepRow[];

    return rowToRun(row, stepRows.map(rowToRunStep));
  }

  listRuns(status?: string): WorkflowRun[] {
    let runRows: RunRow[];
    if (status) {
      runRows = this.db.prepare(
        'SELECT * FROM workflow_runs WHERE status = ? ORDER BY created_at DESC',
      ).all(status) as RunRow[];
    } else {
      runRows = this.db.prepare(
        'SELECT * FROM workflow_runs ORDER BY created_at DESC',
      ).all() as RunRow[];
    }

    return runRows.map((row) => {
      const stepRows = this.db.prepare(
        'SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY step_index ASC',
      ).all(row.id) as RunStepRow[];
      return rowToRun(row, stepRows.map(rowToRunStep));
    });
  }

  updateRunStatus(id: string, status: string, error?: string): void {
    const now = new Date().toISOString();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.db.prepare(
        'UPDATE workflow_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?',
      ).run(status, error ?? null, now, id);
    } else {
      this.db.prepare(
        'UPDATE workflow_runs SET status = ?, error = ?, started_at = COALESCE(started_at, ?) WHERE id = ?',
      ).run(status, error ?? null, now, id);
    }
  }

  // ── Run Steps ─────────────────────────────────────────────────────────────

  updateStepStatus(stepId: string, status: string, output?: string, durationMs?: number): void {
    const now = new Date().toISOString();

    if (status === 'running') {
      this.db.prepare(
        'UPDATE workflow_run_steps SET status = ?, started_at = ? WHERE id = ?',
      ).run(status, now, stepId);
    } else {
      this.db.prepare(
        'UPDATE workflow_run_steps SET status = ?, output = COALESCE(?, output), duration_ms = COALESCE(?, duration_ms), completed_at = ? WHERE id = ?',
      ).run(status, output ?? null, durationMs ?? null, now, stepId);
    }
  }

  getStep(stepId: string): WorkflowRunStep | null {
    const row = this.db.prepare(
      'SELECT * FROM workflow_run_steps WHERE id = ?',
    ).get(stepId) as RunStepRow | undefined;
    return row ? rowToRunStep(row) : null;
  }
}

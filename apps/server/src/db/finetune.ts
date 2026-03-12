import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ─── Row types ──────────────────────────────────────────────────────────────────

interface DatasetRow {
  id: string; name: string; description: string; format: string;
  source_path: string | null; row_count: number | null; size_bytes: number | null;
  status: string; validation_errors: string | null; created_at: string; updated_at: string;
}

interface JobRow {
  id: string; dataset_id: string; provider: string; base_model: string;
  fine_tuned_model: string | null; status: string; hyperparameters: string | null;
  metrics: string | null; provider_job_id: string | null; epochs: number | null;
  learning_rate: number | null; error_message: string | null;
  started_at: string | null; completed_at: string | null; created_at: string;
}

// ─── Interfaces ─────────────────────────────────────────────────────────────────

export interface FinetuneDataset {
  id: string;
  name: string;
  description: string;
  format: 'jsonl' | 'csv' | 'conversation';
  sourcePath: string | null;
  rowCount: number;
  sizeBytes: number;
  status: 'draft' | 'validated' | 'uploading' | 'uploaded' | 'error';
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FinetuneJob {
  id: string;
  datasetId: string;
  provider: string;
  baseModel: string;
  fineTunedModel: string | null;
  status: 'pending' | 'preparing' | 'training' | 'succeeded' | 'failed' | 'cancelled';
  hyperparameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  providerJobId: string | null;
  epochs: number;
  learningRate: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export class DatasetRepository {
  constructor(private db: Database.Database) {}

  list(): FinetuneDataset[] {
    return (
      this.db.prepare('SELECT * FROM finetune_datasets ORDER BY created_at DESC').all() as DatasetRow[]
    ).map(this.rowToDataset);
  }

  getById(id: string): FinetuneDataset | undefined {
    const row = this.db
      .prepare('SELECT * FROM finetune_datasets WHERE id = ?')
      .get(id) as DatasetRow | undefined;
    return row ? this.rowToDataset(row) : undefined;
  }

  create(data: {
    name: string;
    description?: string;
    format?: string;
    sourcePath?: string;
  }): FinetuneDataset {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO finetune_datasets (id, name, description, format, source_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.name,
        data.description ?? '',
        data.format ?? 'jsonl',
        data.sourcePath ?? null,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<FinetuneDataset>): FinetuneDataset {
    const updates: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push('name = ?');
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      updates.push('description = ?');
      params.push(patch.description);
    }
    if (patch.status !== undefined) {
      updates.push('status = ?');
      params.push(patch.status);
    }
    if (patch.rowCount !== undefined) {
      updates.push('row_count = ?');
      params.push(patch.rowCount);
    }
    if (patch.sizeBytes !== undefined) {
      updates.push('size_bytes = ?');
      params.push(patch.sizeBytes);
    }
    if (patch.validationErrors !== undefined) {
      updates.push('validation_errors = ?');
      params.push(JSON.stringify(patch.validationErrors));
    }
    if (patch.sourcePath !== undefined) {
      updates.push('source_path = ?');
      params.push(patch.sourcePath);
    }
    if (patch.format !== undefined) {
      updates.push('format = ?');
      params.push(patch.format);
    }

    params.push(id);
    this.db
      .prepare(`UPDATE finetune_datasets SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);
    return this.getById(id)!;
  }

  delete(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM finetune_datasets WHERE id = ?').run(id).changes > 0
    );
  }

  private rowToDataset(row: DatasetRow): FinetuneDataset {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      format: row.format as FinetuneDataset['format'],
      sourcePath: row.source_path,
      rowCount: row.row_count ?? 0,
      sizeBytes: row.size_bytes ?? 0,
      status: row.status as FinetuneDataset['status'],
      validationErrors: JSON.parse(row.validation_errors ?? '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class FinetuneJobRepository {
  constructor(private db: Database.Database) {}

  list(filters?: { datasetId?: string; status?: string }): FinetuneJob[] {
    let sql = 'SELECT * FROM finetune_jobs';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.datasetId) {
      conditions.push('dataset_id = ?');
      params.push(filters.datasetId);
    }
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    return (this.db.prepare(sql).all(...params) as JobRow[]).map(this.rowToJob);
  }

  getById(id: string): FinetuneJob | undefined {
    const row = this.db
      .prepare('SELECT * FROM finetune_jobs WHERE id = ?')
      .get(id) as JobRow | undefined;
    return row ? this.rowToJob(row) : undefined;
  }

  create(data: {
    datasetId: string;
    provider: string;
    baseModel: string;
    epochs?: number;
    learningRate?: number;
    hyperparameters?: Record<string, unknown>;
  }): FinetuneJob {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO finetune_jobs
           (id, dataset_id, provider, base_model, epochs, learning_rate, hyperparameters)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.datasetId,
        data.provider,
        data.baseModel,
        data.epochs ?? 3,
        data.learningRate ?? null,
        JSON.stringify(data.hyperparameters ?? {}),
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<FinetuneJob>): FinetuneJob {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      updates.push('status = ?');
      params.push(patch.status);
      if (patch.status === 'training') {
        updates.push("started_at = datetime('now')");
      }
      if (patch.status === 'succeeded' || patch.status === 'failed') {
        updates.push("completed_at = datetime('now')");
      }
    }
    if (patch.fineTunedModel !== undefined) {
      updates.push('fine_tuned_model = ?');
      params.push(patch.fineTunedModel);
    }
    if (patch.providerJobId !== undefined) {
      updates.push('provider_job_id = ?');
      params.push(patch.providerJobId);
    }
    if (patch.metrics !== undefined) {
      updates.push('metrics = ?');
      params.push(JSON.stringify(patch.metrics));
    }
    if (patch.errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.push(patch.errorMessage);
    }

    if (updates.length === 0) return this.getById(id)!;

    params.push(id);
    this.db
      .prepare(`UPDATE finetune_jobs SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);
    return this.getById(id)!;
  }

  cancel(id: string): FinetuneJob {
    return this.update(id, { status: 'cancelled' });
  }

  private rowToJob(row: JobRow): FinetuneJob {
    return {
      id: row.id,
      datasetId: row.dataset_id,
      provider: row.provider,
      baseModel: row.base_model,
      fineTunedModel: row.fine_tuned_model,
      status: row.status as FinetuneJob['status'],
      hyperparameters: JSON.parse(row.hyperparameters ?? '{}'),
      metrics: JSON.parse(row.metrics ?? '{}'),
      providerJobId: row.provider_job_id,
      epochs: row.epochs ?? 3,
      learningRate: row.learning_rate,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }
}

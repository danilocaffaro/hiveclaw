import type { FastifyInstance } from 'fastify';
import { readFileSync, statSync } from 'fs';
import type { DatasetRepository, FinetuneDataset, FinetuneJob, FinetuneJobRepository } from '../db/finetune.js';
import { resolveApiKey } from '../config/resolve-api-key.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateDatasetBody {
  name: string;
  description?: string;
  format?: 'jsonl' | 'csv' | 'conversation';
  sourcePath?: string;
}

interface UpdateDatasetBody {
  name?: string;
  description?: string;
  format?: 'jsonl' | 'csv' | 'conversation';
  sourcePath?: string;
  status?: FinetuneDataset['status'];
}

interface CreateJobBody {
  datasetId: string;
  provider: string;
  baseModel: string;
  epochs?: number;
  learningRate?: number;
  hyperparameters?: Record<string, unknown>;
}

interface ListJobsQuery {
  datasetId?: string;
  status?: string;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  rowCount: number;
  sizeBytes: number;
}

function validateDatasetFile(
  sourcePath: string,
  format: FinetuneDataset['format'],
): ValidationResult {
  const errors: string[] = [];
  let rowCount = 0;
  let sizeBytes = 0;

  try {
    const stat = statSync(sourcePath);
    sizeBytes = stat.size;
  } catch {
    return { valid: false, errors: [`File not found: ${sourcePath}`], rowCount: 0, sizeBytes: 0 };
  }

  try {
    const content = readFileSync(sourcePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      let parsed: unknown;

      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        errors.push(`Line ${lineNum}: invalid JSON`);
        continue;
      }

      // Validate conversation format — each line must have a messages array
      if (format === 'conversation' || format === 'jsonl') {
        const obj = parsed as Record<string, unknown>;
        if (format === 'conversation') {
          if (!Array.isArray(obj['messages'])) {
            errors.push(`Line ${lineNum}: missing "messages" array`);
            continue;
          }
          const messages = obj['messages'] as unknown[];
          for (let j = 0; j < messages.length; j++) {
            const msg = messages[j] as Record<string, unknown>;
            if (!msg['role'] || !msg['content']) {
              errors.push(
                `Line ${lineNum}, message ${j + 1}: missing "role" or "content"`,
              );
            }
          }
        }
      }

      rowCount++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to read file: ${msg}`);
  }

  return { valid: errors.length === 0, errors, rowCount, sizeBytes };
}

// ─── OpenAI Fine-tuning integration (native fetch, no extra deps) ─────────────

interface OpenAIFileResponse {
  id: string;
  object: string;
  filename: string;
}

interface OpenAIFineTuneResponse {
  id: string;
  object: string;
  status: string;
  fine_tuned_model: string | null;
}

async function uploadFileToOpenAI(
  apiKey: string,
  filePath: string,
): Promise<OpenAIFileResponse> {
  const { readFileSync } = await import('fs');
  const { basename } = await import('path');

  const fileContent = readFileSync(filePath);
  const filename = basename(filePath);

  const formData = new FormData();
  formData.append('purpose', 'fine-tune');
  formData.append('file', new Blob([fileContent], { type: 'application/json' }), filename);

  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `OpenAI file upload failed: ${response.status}`);
  }

  return response.json() as Promise<OpenAIFileResponse>;
}

async function createOpenAIFineTune(
  apiKey: string,
  fileId: string,
  baseModel: string,
  epochs: number,
  hyperparameters: Record<string, unknown>,
): Promise<OpenAIFineTuneResponse> {
  const body = {
    training_file: fileId,
    model: baseModel,
    hyperparameters: {
      n_epochs: epochs,
      ...hyperparameters,
    },
  };

  const response = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `OpenAI fine-tune creation failed: ${response.status}`);
  }

  return response.json() as Promise<OpenAIFineTuneResponse>;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFinetuneRoutes(
  app: FastifyInstance,
  datasets: DatasetRepository,
  jobs: FinetuneJobRepository,
): void {
  // ── Datasets ──────────────────────────────────────────────────────────────

  // GET /finetune/datasets
  app.get('/finetune/datasets', async () => {
    return { data: datasets.list() };
  });

  // GET /finetune/datasets/:id
  app.get<{ Params: { id: string } }>('/finetune/datasets/:id', async (req, reply) => {
    const dataset = datasets.getById(req.params.id);
    if (!dataset) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
    }
    return { data: dataset };
  });

  // POST /finetune/datasets
  app.post<{ Body: CreateDatasetBody }>('/finetune/datasets', async (req, reply) => {
    const { name, description, format, sourcePath } = req.body ?? {};
    if (!name?.trim()) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: '"name" is required' } });
    }
    const dataset = datasets.create({ name: name.trim(), description, format, sourcePath });
    return reply.status(201).send({ data: dataset });
  });

  // PATCH /finetune/datasets/:id
  app.patch<{ Params: { id: string }; Body: UpdateDatasetBody }>(
    '/finetune/datasets/:id',
    async (req, reply) => {
      const existing = datasets.getById(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      try {
        const updated = datasets.update(req.params.id, req.body ?? {});
        return { data: updated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
      }
    },
  );

  // DELETE /finetune/datasets/:id
  app.delete<{ Params: { id: string } }>('/finetune/datasets/:id', async (req, reply) => {
    const deleted = datasets.delete(req.params.id);
    if (!deleted) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
    }
    return { data: { deleted: true } };
  });

  // POST /finetune/datasets/:id/validate
  app.post<{ Params: { id: string } }>(
    '/finetune/datasets/:id/validate',
    async (req, reply) => {
      const dataset = datasets.getById(req.params.id);
      if (!dataset) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }

      if (!dataset.sourcePath) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'Dataset has no source_path set' },
        });
      }

      const result = validateDatasetFile(dataset.sourcePath, dataset.format);

      const updated = datasets.update(dataset.id, {
        status: result.valid ? 'validated' : 'error',
        rowCount: result.rowCount,
        sizeBytes: result.sizeBytes,
        validationErrors: result.errors,
      });

      return {
        data: {
          dataset: updated,
          validation: {
            valid: result.valid,
            rowCount: result.rowCount,
            sizeBytes: result.sizeBytes,
            errors: result.errors,
          },
        },
      };
    },
  );

  // ── Jobs ──────────────────────────────────────────────────────────────────

  // GET /finetune/jobs?datasetId=&status=
  app.get<{ Querystring: ListJobsQuery }>('/finetune/jobs', async (req) => {
    const { datasetId, status } = req.query;
    return { data: jobs.list({ datasetId, status }) };
  });

  // GET /finetune/jobs/:id
  app.get<{ Params: { id: string } }>('/finetune/jobs/:id', async (req, reply) => {
    const job = jobs.getById(req.params.id);
    if (!job) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    return { data: job };
  });

  // POST /finetune/jobs — create & optionally launch
  app.post<{ Body: CreateJobBody }>('/finetune/jobs', async (req, reply) => {
    const { datasetId, provider, baseModel, epochs, learningRate, hyperparameters } =
      req.body ?? {};

    if (!datasetId || !provider || !baseModel) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: '"datasetId", "provider", and "baseModel" are required',
        },
      });
    }

    // Dataset must exist and be validated
    const dataset = datasets.getById(datasetId);
    if (!dataset) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
    }
    if (dataset.status !== 'validated' && dataset.status !== 'uploaded') {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: `Dataset must be in "validated" status before creating a job (current: "${dataset.status}")`,
        },
      });
    }

    // Create job record (status: pending)
    const job = jobs.create({
      datasetId,
      provider,
      baseModel,
      epochs,
      learningRate,
      hyperparameters,
    });

    // Attempt to launch via OpenAI if provider === 'openai' and key is available
    if (provider === 'openai') {
      const openaiKey =
        resolveApiKey('OPENAI_API_KEY');

      if (!openaiKey) {
        // No key — leave as pending with a note
        const updated = jobs.update(job.id, {
          errorMessage:
            'OPENAI_API_KEY not set — job queued as pending. Set the key and re-submit.',
        });
        return reply.status(201).send({ data: updated });
      }

      if (!dataset.sourcePath) {
        const updated = jobs.update(job.id, {
          status: 'failed',
          errorMessage: 'Dataset has no source_path — cannot upload to OpenAI.',
        });
        return reply.status(201).send({ data: updated });
      }

      try {
        // 1. Mark as preparing + update dataset status
        jobs.update(job.id, { status: 'preparing' });
        datasets.update(datasetId, { status: 'uploading' });

        // 2. Upload file to OpenAI
        const fileRes = await uploadFileToOpenAI(openaiKey, dataset.sourcePath);
        datasets.update(datasetId, { status: 'uploaded' });

        // 3. Create fine-tuning job
        const ftRes = await createOpenAIFineTune(
          openaiKey,
          fileRes.id,
          baseModel,
          epochs ?? 3,
          hyperparameters ?? {},
        );

        // 4. Store provider job id, transition to training
        const updated = jobs.update(job.id, {
          status: 'training',
          providerJobId: ftRes.id,
        });

        return reply.status(201).send({ data: updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const updated = jobs.update(job.id, {
          status: 'failed',
          errorMessage: msg,
        });
        datasets.update(datasetId, { status: 'error', validationErrors: [msg] });
        // Return 201 with failed status (job was created, launch failed)
        return reply.status(201).send({ data: updated });
      }
    }

    // Non-openai provider or no special handling — return pending job
    return reply.status(201).send({ data: jobs.getById(job.id) });
  });

  // POST /finetune/jobs/:id/cancel
  app.post<{ Params: { id: string } }>(
    '/finetune/jobs/:id/cancel',
    async (req, reply) => {
      const job = jobs.getById(req.params.id);
      if (!job) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }

      const terminalStatuses: FinetuneJob['status'][] = [
        'succeeded',
        'failed',
        'cancelled',
      ];
      if (terminalStatuses.includes(job.status)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_STATE',
            message: `Cannot cancel a job in "${job.status}" status`,
          },
        });
      }

      const updated = jobs.cancel(job.id);
      return { data: updated };
    },
  );
}

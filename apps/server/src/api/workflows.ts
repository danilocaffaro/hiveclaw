// ============================================================
// Workflow API — CRUD for templates + runs + SSE streaming
// ============================================================

import type { FastifyInstance } from 'fastify';
import type { WorkflowRepository } from '../db/workflow-repository.js';
import { getEngineService, type MessageBus } from '../engine/engine-service.js';

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerWorkflowRoutes(
  app: FastifyInstance,
  repo: WorkflowRepository,
): void {
  // ── Templates ─────────────────────────────────────────────────────────────

  // GET /workflows — list all templates
  app.get('/workflows', async (_req, reply) => {
    const templates = repo.listTemplates();
    return reply.send({ data: templates });
  });

  // POST /workflows — create template
  app.post('/workflows', async (req, reply) => {
    const body = req.body as {
      name: string;
      emoji?: string;
      description?: string;
      category?: string;
      steps: Array<{ name: string; agentRole: string; description: string }>;
    };
    if (!body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
      return reply.status(400).send({ error: 'name and steps[] required' });
    }
    const template = repo.createTemplate({
      name: body.name,
      emoji: body.emoji ?? '⚡',
      description: body.description ?? '',
      category: body.category ?? 'development',
      steps: body.steps,
      isBuiltin: false,
    });
    return reply.status(201).send({ data: template });
  });

  // GET /workflows/:id — get template
  app.get<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const template = repo.getTemplate(req.params.id);
    if (!template) return reply.status(404).send({ error: 'Workflow not found' });
    return reply.send({ data: template });
  });

  // PUT /workflows/:id — update template
  app.put<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const body = req.body as Partial<{
      name: string;
      emoji: string;
      description: string;
      category: string;
      steps: Array<{ name: string; agentRole: string; description: string }>;
    }>;
    const updated = repo.updateTemplate(req.params.id, body);
    if (!updated) return reply.status(404).send({ error: 'Workflow not found' });
    return reply.send({ data: updated });
  });

  // DELETE /workflows/:id — delete template (only non-builtin)
  app.delete<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const deleted = repo.deleteTemplate(req.params.id);
    if (!deleted) {
      return reply.status(400).send({ error: 'Cannot delete builtin workflow or not found' });
    }
    return reply.send({ data: { deleted: true } });
  });

  // ── Runs ──────────────────────────────────────────────────────────────────

  // POST /workflows/:id/run — start a run
  app.post<{ Params: { id: string } }>('/workflows/:id/run', async (req, reply) => {
    const template = repo.getTemplate(req.params.id);
    if (!template) return reply.status(404).send({ error: 'Workflow not found' });
    const body = (req.body as { params?: Record<string, string> } | null) ?? {};
    const run = await getEngineService().workflows.getEngine().startRun(req.params.id, body.params);
    return reply.status(201).send({ data: run });
  });

  // GET /workflow-runs — list runs
  app.get('/workflow-runs', async (req, reply) => {
    const query = req.query as { status?: string };
    const runs = repo.listRuns(query.status);
    return reply.send({ data: runs });
  });

  // GET /workflow-runs/:id — get run
  app.get<{ Params: { id: string } }>('/workflow-runs/:id', async (req, reply) => {
    const run = repo.getRun(req.params.id);
    if (!run) return reply.status(404).send({ error: 'Run not found' });
    return reply.send({ data: run });
  });

  // POST /workflow-runs/:id/cancel — cancel run
  app.post<{ Params: { id: string } }>('/workflow-runs/:id/cancel', async (req, reply) => {
    const run = repo.getRun(req.params.id);
    if (!run) return reply.status(404).send({ error: 'Run not found' });
    if (run.status !== 'running' && run.status !== 'pending') {
      return reply.status(400).send({ error: 'Run is not active' });
    }
    getEngineService().workflows.getEngine().cancelRun(req.params.id);
    return reply.send({ data: { cancelled: true } });
  });

  // GET /workflow-runs/:id/stream — SSE for run progress
  app.get<{ Params: { id: string } }>('/workflow-runs/:id/stream', async (req, reply) => {
    const run = repo.getRun(req.params.id);
    if (!run) return reply.status(404).send({ error: 'Run not found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
    });

    // Replay current state for late-joiners
    for (const step of run.steps) {
      if (step.status !== 'pending') {
        const eventName = step.status === 'done' ? 'step.finish' : 'step.start';
        reply.raw.write(
          `event: ${eventName}\ndata: ${JSON.stringify({
            runId: run.id,
            stepIndex: step.stepIndex,
            name: step.name,
            status: step.status,
            duration: step.durationMs,
          })}\n\n`,
        );
      }
    }

    // If run already terminal, close immediately
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      reply.raw.write(
        `event: run.finish\ndata: ${JSON.stringify({ runId: run.id, status: run.status })}\n\n`,
      );
      reply.raw.end();
      return;
    }

    // Subscribe to the global 'message' bus topic and filter for this run.
    // The WorkflowEngine publishes messages to `workflow.run.{runId}` topic.
    // We also listen on global 'message' to catch any workflow-related events.
    const bus: MessageBus = getEngineService().workflows.getBus();
    const runTopic = `workflow.run.${run.id}`;

    const unsub = bus.subscribe(runTopic, (msg: unknown) => {
      // Engine publishes: content = JSON.stringify({ topic: 'step.start', runId, ... })
      const legacyMsg = msg as { content?: string };
      try {
        const payload = JSON.parse(legacyMsg.content ?? '{}');
        const eventType: string | undefined = payload.topic;
        if (eventType) {
          reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
        }
        // Close stream when run finishes
        if (eventType === 'run.finish') {
          reply.raw.end();
        }
      } catch {
        // If content is not JSON, send as generic event
        reply.raw.write(`event: message\ndata: ${JSON.stringify({ content: legacyMsg.content })}\n\n`);
      }
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });
}

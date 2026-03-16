import type { FastifyInstance } from 'fastify';
import type { AgentRepository } from '../db/agents.js';
import type { AgentCreateInput } from '@hiveclaw/shared';
import { getWorkerPool } from '../engine/agent-worker-pool.js';
import { AgentMemoryRepository, type MemoryType } from '../db/agent-memory.js';
import { DEFAULT_SKILLS } from '../engine/skill-hub.js';
import { getEngineService } from '../engine/engine-service.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

// ── Core Memory Auto-Provisioning ────────────────────────────────────────────
// Every new agent gets 4 core blocks (persona, human, project, scratchpad)
// so they start with full identity awareness — same level as Alice (OpenClaw).

function provisionCoreMemory(
  memRepo: AgentMemoryRepository,
  agentId: string,
  agentName: string,
  agentEmoji: string,
  agentRole: string,
): void {
  // Only provision if agent has NO core blocks yet (avoid overwriting existing)
  const existing = memRepo.getCoreBlocks(agentId);
  if (existing.length > 0) return;

  const repoPath = process.cwd();

  memRepo.setCoreBlock(agentId, 'persona', [
    `Name: ${agentName} ${agentEmoji}`,
    `Role: ${agentRole}`,
    `Platform: HiveClaw — self-hosted AI assistant platform`,
    `Communication: Direct, concise, match the user's language.`,
    `Decision style: Analyze → decide → execute. Be proactive, not passive.`,
    `Verification: NEVER claim something works without verifying first.`,
    `Anti-fabrication: NEVER make up code, file contents, or command outputs. If unsure, check.`,
  ].join('\n'));

  memRepo.setCoreBlock(agentId, 'human', [
    'This block stores information about the user you work with.',
    'Update it as you learn their preferences, name, timezone, and working style.',
    'Safety: Do not deceive, do not cause harm, get consent for irreversible actions.',
  ].join('\n'));

  memRepo.setCoreBlock(agentId, 'project', [
    'This block stores context about what you work on — a business, project, codebase, routine, or any domain.',
    'Update it as you learn about the user\'s world.',
    `Working directory: ${repoPath}`,
  ].join('\n'));

  memRepo.setCoreBlock(agentId, 'scratchpad', [
    `Agent ${agentName} (${agentRole}) — newly created.`,
    'Update this scratchpad as you learn about your tasks and the codebase.',
  ].join('\n'));

  logger.info('[Agents] Core memory provisioned for new agent %s (%s)', agentName, agentId);
}

// ── Agent Templates ──────────────────────────────────────────────────────────

const AGENT_TEMPLATES = [
  {
    id: 'coder',
    name: 'Coder',
    emoji: '👨‍💻',
    role: 'Full-stack developer',
    color: '#58A6FF',
    systemPrompt:
      'You are an expert full-stack developer. Write clean, well-tested code. Follow best practices. Explain your architectural decisions.',
    skills: ['bash', 'edit', 'read', 'write', 'glob', 'grep'],
  },
  {
    id: 'architect',
    name: 'Architect',
    emoji: '🏗️',
    role: 'System architect',
    color: '#BC8CFF',
    systemPrompt:
      'You are a senior system architect. Design scalable, maintainable systems. Consider trade-offs, performance, and security. Provide diagrams when helpful.',
    skills: ['read', 'write', 'webfetch', 'plans'],
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    emoji: '🔍',
    role: 'Code reviewer',
    color: '#3FB950',
    systemPrompt:
      'You are a meticulous code reviewer. Check for bugs, security issues, performance problems, and style violations. Be constructive but thorough.',
    skills: ['read', 'glob', 'grep'],
  },
  {
    id: 'writer',
    name: 'Writer',
    emoji: '✍️',
    role: 'Technical writer',
    color: '#D29922',
    systemPrompt:
      'You are a technical writer. Create clear, well-structured documentation, README files, API docs, and user guides. Use examples liberally.',
    skills: ['read', 'write', 'webfetch'],
  },
  {
    id: 'devops',
    name: 'DevOps',
    emoji: '⚙️',
    role: 'DevOps engineer',
    color: '#FF6B6B',
    systemPrompt:
      'You are a DevOps engineer. Handle CI/CD, Docker, deployments, monitoring, and infrastructure. Automate everything possible.',
    skills: ['bash', 'read', 'write', 'edit'],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    emoji: '📊',
    role: 'Data analyst',
    color: '#58A6FF',
    systemPrompt:
      'You are a data analyst. Analyze data, create visualizations, write SQL queries, and provide actionable insights.',
    skills: ['bash', 'read', 'write', 'webfetch'],
  },
] as const;

export type AgentTemplate = (typeof AGENT_TEMPLATES)[number];

// ── Route Registration ────────────────────────────────────────────────────────

export function registerAgentRoutes(app: FastifyInstance, injectedAgents?: AgentRepository, memoryRepo?: AgentMemoryRepository) {
  // P-3: Facade fallback — resolve repo via EngineService when not injected
  const agents = () => injectedAgents ?? getEngineService().db.agents();

  // List agents — systemPrompt stripped by default (opt-in via ?include=systemPrompt)
  app.get<{ Querystring: { include?: string } }>('/agents', async (req) => {
    const includeSystemPrompt = req.query.include?.split(',').includes('systemPrompt') ?? false;
    const list = agents().list();
    if (includeSystemPrompt) return { data: list };
    // Strip systemPrompt from list response — it can be large and is sensitive
    return { data: list.map(({ systemPrompt: _sp, ...rest }) => rest) };
  });

  // List agent templates (read-only, not stored in DB)
  app.get('/agents/templates', async () => {
    return { data: AGENT_TEMPLATES };
  });

  // ── Agent Status SSE Stream ──────────────────────────────────────────────
  app.get('/agents/status/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const pool = getWorkerPool();

    // Send initial status
    reply.raw.write(`data: ${JSON.stringify(pool.status())}\n\n`);

    // Subscribe to changes
    const handler = (data: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ ...pool.status(), event: data })}\n\n`);
      } catch {
        // Connection may be closed
      }
    };
    pool.on('agentStateChange', handler);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    req.raw.on('close', () => {
      pool.off('agentStateChange', handler);
      clearInterval(heartbeat);
    });
  });

  // Get agent by ID
  app.get<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const agent = agents().getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return { data: agent };
  });

  // Create agent
  app.post<{ Body: AgentCreateInput }>('/agents', async (req, reply) => {
    const { name, role, systemPrompt } = req.body;
    if (!name || !role || !systemPrompt) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name, role, and systemPrompt are required' } });
    }
    const agent = agents().create(req.body);

    // Auto-provision core memory blocks so every new agent starts with full identity
    try {
      const memRepo = new AgentMemoryRepository(getDb());
      provisionCoreMemory(memRepo, agent.id, agent.name, agent.emoji ?? '🤖', agent.role ?? role);
    } catch (e) {
      logger.warn('[Agents] Core memory provisioning failed for %s: %s', agent.id, (e as Error).message);
    }

    return reply.status(201).send({ data: agent });
  });

  // Discover agents — in Pure mode this is a no-op (no external gateways)
  app.post('/agents/discover', async (_req, reply) => {
    return reply.send({ data: { discovered: 0, message: 'Agent discovery is not available in standalone mode' } });
  });

  // Update agent
  app.patch<{ Params: { id: string }; Body: Partial<AgentCreateInput> }>('/agents/:id', async (req, reply) => {
    const agent = agents().update(req.params.id, req.body);
    if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return { data: agent };
  });

  // Delete agent
  app.delete<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const ok = agents().delete(req.params.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found or protected' } });
    return { data: { deleted: true } };
  });

  // Create agent from template
  app.post<{ Body: { templateId: string; name?: string } }>(
    '/agents/from-template',
    async (req, reply) => {
      const { templateId, name } = req.body ?? {};
      const template = AGENT_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Template '${templateId}' not found` },
        });
      }
      const agent = agents().create({
        name: name || template.name,
        emoji: template.emoji,
        role: template.role,
        color: template.color,
        systemPrompt: template.systemPrompt,
        skills: [...new Set([...template.skills, ...DEFAULT_SKILLS])],
        providerPreference: '', // uses default provider configured in setup
        modelPreference: '', // uses default model from provider
      });
      return reply.status(201).send({ data: agent });
    },
  );

  // ── Agent Memory Routes ──────────────────────────────────────────────────
  if (memoryRepo) {
    // List memories for an agent
    app.get<{
      Params: { id: string };
      Querystring: { type?: MemoryType; limit?: string; search?: string };
    }>('/agents/:id/memory', async (req, reply) => {
      const agent = agents().getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

      const { type, limit, search } = req.query;

      const limitNum = limit ? parseInt(limit, 10) : undefined;
      if (limit && (isNaN(limitNum!) || limitNum! < 0)) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'limit must be a positive integer' } });
      }

      const memories = memoryRepo.list(req.params.id, {
        type: type as MemoryType | undefined,
        limit: limitNum,
        search,
      });
      return { data: memories };
    });

    // Set a memory for an agent
    app.post<{
      Params: { id: string };
      Body: { key: string; value: string; type?: MemoryType; relevance?: number };
    }>('/agents/:id/memory', async (req, reply) => {
      const agent = agents().getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

      const { key, value, type, relevance } = req.body;
      if (!key || !value) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'key and value are required' } });
      }

      const validTypes = ['short_term', 'long_term', 'entity', 'preference', 'fact', 'decision', 'goal', 'event', 'procedure', 'correction'] as const;
      if (type && !validTypes.includes(type as typeof validTypes[number])) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: `type must be one of: ${validTypes.join(', ')}` } });
      }

      if (relevance !== undefined && (typeof relevance !== 'number' || relevance < 0 || relevance > 1)) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'relevance must be a number between 0 and 1' } });
      }

      const memory = memoryRepo.set(
        req.params.id,
        key,
        value,
        type ?? 'short_term',
        relevance ?? 1.0,
      );
      return reply.status(201).send({ data: memory });
    });

    // Delete a memory
    app.delete<{
      Params: { id: string; memoryId: string };
    }>('/agents/:id/memory/:memoryId', async (req, reply) => {
      const agent = agents().getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

      const ok = memoryRepo.delete(req.params.memoryId);
      if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Memory not found' } });
      return { data: { deleted: true } };
    });

    // Bulk memory set — import multiple memories at once
    app.post<{
      Params: { id: string };
      Body: { memories: Array<{ key: string; value: string; type?: MemoryType; relevance?: number }> };
    }>('/agents/:id/memory/bulk', async (req, reply) => {
      const agent = agents().getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

      const { memories } = req.body ?? {};
      if (!Array.isArray(memories) || memories.length === 0) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'memories must be a non-empty array' },
        });
      }

      let created = 0;
      for (const mem of memories) {
        if (!mem.key || !mem.value) continue;
        memoryRepo.set(
          req.params.id,
          mem.key,
          mem.value,
          mem.type ?? 'short_term',
          mem.relevance ?? 1.0,
        );
        created++;
      }

      return reply.status(201).send({ data: { created } });
    });

    // Clear all memories for an agent
    app.delete<{ Params: { id: string } }>('/agents/:id/memory', async (req, reply) => {
      const agent = agents().getById(req.params.id);
      if (!agent) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

      const cleared = memoryRepo.clearAgent(req.params.id);
      return { data: { cleared: true, count: cleared } };
    });

    // Search memories across all agents (Eidetic Memory)
    app.get<{
      Querystring: { q: string; limit?: string };
    }>('/memory/search', async (req, reply) => {
      const { q, limit } = req.query;
      if (!q || typeof q !== 'string' || q.trim() === '') {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'q (search query) is required' },
        });
      }

      const limitNum = limit ? parseInt(limit, 10) : 20;
      if (isNaN(limitNum) || limitNum < 1) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: 'limit must be a positive integer' },
        });
      }

      const results = memoryRepo.search(q.trim(), limitNum);
      return { data: results };
    });
  }
}

import type { FastifyInstance } from 'fastify';
import type { SquadRepository } from '../db/squads.js';
import type { SquadMemberRepository } from '../db/squad-members.js';
import type { AgentRepository } from '../db/agents.js';
import type { ExternalAgentRepository } from '../db/external-agents.js';
import type { SquadCreateInput } from '@superclaw/shared';

// ── Squad Templates ──────────────────────────────────────────────────────────

const SQUAD_TEMPLATES = [
  {
    id: 'dev-team',
    name: 'Dev Team',
    emoji: '🚀',
    description: 'Full development squad: coder + architect + reviewer',
    agentTemplates: ['coder', 'architect', 'reviewer'],
    routingStrategy: 'debate',
    debateEnabled: true,
  },
  {
    id: 'content-team',
    name: 'Content Team',
    emoji: '📝',
    description: 'Content creation squad: writer + analyst',
    agentTemplates: ['writer', 'analyst'],
    routingStrategy: 'sequential',
    debateEnabled: false,
  },
  {
    id: 'review-board',
    name: 'Review Board',
    emoji: '⚖️',
    description: 'Multi-perspective review: architect + reviewer + devops',
    agentTemplates: ['architect', 'reviewer', 'devops'],
    routingStrategy: 'debate',
    debateEnabled: true,
  },
] as const;

export type SquadTemplate = (typeof SQUAD_TEMPLATES)[number];

// ── Route Registration ────────────────────────────────────────────────────────

export function registerSquadRoutes(app: FastifyInstance, squads: SquadRepository, members?: SquadMemberRepository, agentRepo?: AgentRepository, extAgentRepo?: ExternalAgentRepository) {
  app.get('/squads', async () => {
    const list = squads.list();
    // Expand agent objects for each squad using squad_members
    const expanded = list.map((squad) => {
      const memberRows = members?.listBySquad(squad.id) ?? [];
      const agentIds = memberRows.length > 0
        ? memberRows.map((m) => m.agentId)
        : squad.agentIds;
      const agents = agentIds
        .map((id) => {
          // Try local agents first, then external agents
          const local = agentRepo?.getById(id);
          if (local) return { id: local.id, name: local.name, emoji: local.emoji ?? '', role: local.role ?? '', type: 'local' as const };
          const ext = extAgentRepo?.getById(id);
          if (ext) return { id: ext.id, name: ext.name, emoji: ext.emoji ?? '', role: ext.role ?? '', type: 'external' as const };
          return null;
        })
        .filter(Boolean);
      return { ...squad, agentIds, agents };
    });
    return { data: expanded };
  });

  // List squad templates (read-only, not stored in DB)
  app.get('/squads/templates', async () => {
    return { data: SQUAD_TEMPLATES };
  });

  app.get<{ Params: { id: string } }>('/squads/:id', async (req, reply) => {
    const squad = squads.getById(req.params.id);
    if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
    return { data: squad };
  });

  app.post<{ Body: SquadCreateInput }>('/squads', async (req, reply) => {
    const { name, agentIds } = req.body;
    if (!name || !agentIds?.length) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name and agentIds are required' } });
    }
    const squad = squads.create(req.body);
    return reply.status(201).send({ data: squad });
  });

  app.patch<{ Params: { id: string }; Body: Partial<SquadCreateInput> }>('/squads/:id', async (req, reply) => {
    const squad = squads.update(req.params.id, req.body);
    if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
    return { data: squad };
  });

  app.delete<{ Params: { id: string } }>('/squads/:id', async (req, reply) => {
    const ok = squads.delete(req.params.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
    return { data: { deleted: true } };
  });

  // ── Squad Member Management (ARCHER v2 roles) ─────────────────────────────

  if (members) {
    // GET /squads/:id/members — list members with roles
    app.get<{ Params: { id: string } }>('/squads/:id/members', async (req, reply) => {
      const squad = squads.getById(req.params.id);
      if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
      // Auto-sync members from agentIds if squad_members table is empty
      const existing = members.listBySquad(req.params.id);
      if (existing.length === 0 && squad.agentIds.length > 0) {
        members.syncFromAgentIds(req.params.id, squad.agentIds);
      }
      return { data: members.listBySquad(req.params.id) };
    });

    // POST /squads/:id/members — add agent(s) to squad
    app.post<{
      Params: { id: string };
      Body: { agentId: string; role?: 'owner' | 'admin' | 'member'; addedBy?: string };
    }>('/squads/:id/members', async (req, reply) => {
      const squad = squads.getById(req.params.id);
      if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
      const { agentId, role = 'member', addedBy = 'owner' } = req.body;
      if (!agentId) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'agentId is required' } });

      const member = members.add(req.params.id, agentId, role, addedBy);

      // Keep squads.agent_ids in sync
      const currentIds: string[] = squad.agentIds ?? [];
      if (!currentIds.includes(agentId)) {
        squads.update(req.params.id, { agentIds: [...currentIds, agentId] });
      }

      return reply.status(201).send({ data: member });
    });

    // DELETE /squads/:id/members/:agentId — remove agent from squad
    app.delete<{
      Params: { id: string; agentId: string };
      Querystring: { removedBy?: string };
    }>('/squads/:id/members/:agentId', async (req, reply) => {
      const squad = squads.getById(req.params.id);
      if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
      const { agentId } = req.params;
      const removedBy = req.query.removedBy ?? 'owner';

      const ok = members.remove(req.params.id, agentId, removedBy);
      if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Member not found' } });

      // Keep squads.agent_ids in sync
      const newIds = (squad.agentIds ?? []).filter((id: string) => id !== agentId);
      squads.update(req.params.id, { agentIds: newIds });

      return { data: { removed: true } };
    });

    // PATCH /squads/:id/members/:agentId — change role
    app.patch<{
      Params: { id: string; agentId: string };
      Body: { role: 'owner' | 'admin' | 'member'; actor?: string };
    }>('/squads/:id/members/:agentId', async (req, reply) => {
      const { role, actor = 'owner' } = req.body;
      if (!role) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'role is required' } });
      const member = members.updateRole(req.params.id, req.params.agentId, role, actor);
      if (!member) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Member not found' } });
      return { data: member };
    });

    // GET /squads/:id/events — member change history
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/squads/:id/events', async (req, reply) => {
      const squad = squads.getById(req.params.id);
      if (!squad) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Squad not found' } });
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
      return { data: members.getEvents(req.params.id, limit) };
    });
  }
}

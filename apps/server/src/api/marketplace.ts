import type { FastifyInstance } from 'fastify';
import { MarketplaceRepository } from '../db/marketplace.js';
import { CURATED_SKILLS, searchSkills, getSkillsByCategory, getCategoryStats, type SkillCategory } from '../engine/skill-hub.js';
import type Database from 'better-sqlite3';

export function registerMarketplaceRoutes(app: FastifyInstance, db: Database.Database): void {
  const marketplace = new MarketplaceRepository(db);

  // GET /marketplace — list skills with filters
  app.get<{
    Querystring: { category?: string; installed?: string; search?: string };
  }>('/marketplace', async (req, reply) => {
    try {
      const { category, installed, search } = req.query;
      const filters: { category?: string; installed?: boolean; search?: string } = {};
      if (category) filters.category = category;
      if (installed !== undefined) filters.installed = installed === 'true';
      if (search) filters.search = search;

      const skills = marketplace.list(filters);
      return { data: skills };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /marketplace/:id — single skill details
  app.get<{ Params: { id: string } }>('/marketplace/:id', async (req, reply) => {
    try {
      const skill = marketplace.getById(req.params.id);
      if (!skill) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Skill '${req.params.id}' not found` } });
      }
      return { data: skill };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /marketplace/:id/install
  app.post<{ Params: { id: string } }>('/marketplace/:id/install', async (req, reply) => {
    try {
      const skill = marketplace.install(req.params.id);
      return { data: skill };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      }
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // POST /marketplace/:id/uninstall
  app.post<{ Params: { id: string } }>('/marketplace/:id/uninstall', async (req, reply) => {
    try {
      const skill = marketplace.uninstall(req.params.id);
      return { data: skill };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      }
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // POST /marketplace/:id/rate — body: { rating: 1-5 }
  app.post<{
    Params: { id: string };
    Body: { rating: number };
  }>('/marketplace/:id/rate', async (req, reply) => {
    try {
      const { rating } = req.body ?? {};
      if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'rating must be a number between 1 and 5' } });
      }
      const skill = marketplace.rate(req.params.id, rating);
      return { data: skill };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: msg } });
      }
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: msg } });
    }
  });

  // ── Curated Skill Hub (Batch 7.5) ──────────────────────────────────────────

  // GET /marketplace/curated — full curated library with content
  app.get<{
    Querystring: { category?: string; search?: string; badge?: string };
  }>('/marketplace/curated', async (req) => {
    let skills = req.query.search
      ? searchSkills(req.query.search)
      : req.query.category
        ? getSkillsByCategory(req.query.category as SkillCategory)
        : CURATED_SKILLS;

    if (req.query.badge) {
      skills = skills.filter(s => s.badge === req.query.badge);
    }

    return {
      data: {
        skills,
        total: skills.length,
        categories: getCategoryStats(),
      },
    };
  });

  // GET /marketplace/curated/:slug — single curated skill with full SKILL.md content
  app.get<{ Params: { slug: string } }>('/marketplace/curated/:slug', async (req, reply) => {
    const skill = CURATED_SKILLS.find(s => s.slug === req.params.slug);
    if (!skill) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    return { data: skill };
  });

  // POST /marketplace/curated/:slug/install — install curated skill to agent
  app.post<{
    Params: { slug: string };
    Body: { agentId?: string };
  }>('/marketplace/curated/:slug/install', async (req, reply) => {
    const skill = CURATED_SKILLS.find(s => s.slug === req.params.slug);
    if (!skill) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    // Mark as installed in marketplace DB (for tracking)
    try {
      marketplace.install(skill.slug);
    } catch {
      // May already exist (duplicate install) — not an error
    }

    return { data: { ok: true, slug: skill.slug, message: `Skill '${skill.name}' installed` } };
  });
}

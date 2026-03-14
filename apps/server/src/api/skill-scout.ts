/**
 * api/skill-scout.ts — Skill Scout API Routes
 *
 * GET  /skills/recommended          — list recommended skills (status=ready, not activated)
 * GET  /skills/recommended/all      — list all (including activated & failed)
 * POST /skills/recommended/:id/activate — activate a recommended skill
 * POST /skills/scout/run            — trigger manual scout run
 * GET  /skills/scout/status         — cron status
 *
 * Sprint 78 — Clark 🐙
 */

import type { FastifyInstance } from 'fastify';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { logger } from '../lib/logger.js';
import { runScoutNow, getScoutStatus } from '../engine/skill-scout-cron.js';
import type Database from 'better-sqlite3';

const SKILLS_DIR = join(homedir(), '.hiveclaw', 'skills');

export function registerSkillScoutRoutes(app: FastifyInstance, db: Database.Database): void {

  // GET /skills/recommended — ready skills not yet activated
  app.get('/skills/recommended', async (_req, reply) => {
    try {
      const skills = db.prepare(`
        SELECT * FROM recommended_skills
        WHERE status = 'ready' AND activated = 0
        ORDER BY created_at DESC
      `).all();

      return {
        data: skills.map((s: any) => ({
          ...s,
          tags: JSON.parse(s.tags ?? '[]'),
          sources: JSON.parse(s.sources ?? '[]'),
          installed: existsSync(join(SKILLS_DIR, s.slug))
        }))
      };
    } catch (err) {
      logger.error({ err }, '[skill-scout] GET /skills/recommended failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /skills/recommended/all — all recommendations including activated & failed
  app.get('/skills/recommended/all', async (_req, reply) => {
    try {
      const skills = db.prepare(`
        SELECT * FROM recommended_skills
        ORDER BY created_at DESC
        LIMIT 100
      `).all();

      return {
        data: skills.map((s: any) => ({
          ...s,
          tags: JSON.parse(s.tags ?? '[]'),
          sources: JSON.parse(s.sources ?? '[]'),
          installed: existsSync(join(SKILLS_DIR, s.slug))
        }))
      };
    } catch (err) {
      logger.error({ err }, '[skill-scout] GET /skills/recommended/all failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /skills/recommended/:id/activate — user activates a recommended skill
  app.post<{ Params: { id: string } }>('/skills/recommended/:id/activate', async (req, reply) => {
    try {
      const { id } = req.params;

      const skill = db.prepare(`SELECT * FROM recommended_skills WHERE id = ?`).get(id) as any;
      if (!skill) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Recommendation '${id}' not found` } });
      }

      if (skill.status !== 'ready') {
        return reply.status(400).send({ error: { code: 'NOT_READY', message: `Skill is not ready (status: ${skill.status})` } });
      }

      if (!existsSync(join(SKILLS_DIR, skill.slug))) {
        return reply.status(400).send({ error: { code: 'NOT_INSTALLED', message: `Skill files not found at ${SKILLS_DIR}/${skill.slug}` } });
      }

      db.prepare(`
        UPDATE recommended_skills
        SET activated = 1, activated_at = datetime('now')
        WHERE id = ?
      `).run(id);

      logger.info({ slug: skill.slug }, '[skill-scout] Skill activated by user');

      return {
        data: {
          id: skill.id,
          slug: skill.slug,
          name: skill.name,
          activated: true,
          activated_at: new Date().toISOString()
        }
      };
    } catch (err) {
      logger.error({ err }, '[skill-scout] POST /skills/recommended/:id/activate failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /skills/scout/run — manual trigger
  app.post('/skills/scout/run', async (_req, reply) => {
    try {
      const status = getScoutStatus();
      if (status.isRunning) {
        return reply.status(409).send({
          error: { code: 'ALREADY_RUNNING', message: 'Skill scout is already running' }
        });
      }

      // Run in background — don't await
      runScoutNow(db).then(result => {
        logger.info({ result }, '[skill-scout] Manual run completed');
      }).catch(err => {
        logger.error({ err }, '[skill-scout] Manual run failed');
      });

      return { data: { message: 'Skill scout started', status: 'running' } };
    } catch (err) {
      logger.error({ err }, '[skill-scout] POST /skills/scout/run failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /skills/scout/status — cron status
  app.get('/skills/scout/status', async (_req, reply) => {
    try {
      const status = getScoutStatus();
      const totalRecommended = (db.prepare(`SELECT COUNT(*) as cnt FROM recommended_skills WHERE status='ready'`).get() as any)?.cnt ?? 0;
      const totalActivated = (db.prepare(`SELECT COUNT(*) as cnt FROM recommended_skills WHERE activated=1`).get() as any)?.cnt ?? 0;

      return {
        data: {
          ...status,
          totalRecommended,
          totalActivated
        }
      };
    } catch (err) {
      logger.error({ err }, '[skill-scout] GET /skills/scout/status failed');
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });
}

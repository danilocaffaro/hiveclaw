import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../lib/logger.js';

const SKILLS_DIR = join(homedir(), '.hiveclaw', 'workspace', 'skills');

interface SkillMeta {
  slug: string;
  name: string;
  path: string;
  content: string;
}

function ensureSkillsDir(): void {
  mkdirSync(SKILLS_DIR, { recursive: true });
}

function readSkillFromDisk(slug: string): SkillMeta | null {
  const skillDir = join(SKILLS_DIR, slug);
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillDir) || !existsSync(skillMdPath)) return null;

  const content = readFileSync(skillMdPath, 'utf-8');
  // Extract name from first H1 heading if present, fallback to slug
  const nameMatch = content.match(/^#\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : slug;

  return { slug, name, path: skillDir, content };
}

function listSkillsFromDisk(): SkillMeta[] {
  ensureSkillsDir();
  try {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills: SkillMeta[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skill = readSkillFromDisk(entry.name);
        if (skill) skills.push(skill);
      }
    }
    return skills.sort((a, b) => a.slug.localeCompare(b.slug));
  } catch (e) {
    logger.warn({ err: e }, '[skills] Failed to list skills from disk');
    return [];
  }
}

// In-memory skills cache
let skillsCache: SkillMeta[] | null = null;

function getSkillsCache(): SkillMeta[] {
  if (!skillsCache) {
    skillsCache = listSkillsFromDisk();
  }
  return skillsCache;
}

function invalidateCache(): void {
  skillsCache = null;
}

export async function skillRoutes(app: FastifyInstance) {
  ensureSkillsDir();

  // GET /skills — list all skills (read from disk via cache)
  app.get('/skills', async (_req, reply) => {
    try {
      const skills = getSkillsCache().map(({ slug, name, path: skillPath }) => ({ slug, name, path: skillPath }));
      return { data: skills };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /skills/reload — reload skills cache from disk (must be before /:slug)
  app.post('/skills/reload', async (_req, reply) => {
    try {
      invalidateCache();
      const skills = getSkillsCache();
      return { data: { reloaded: true, count: skills.length } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /skills/:slug — single skill detail with content
  app.get<{ Params: { slug: string } }>('/skills/:slug', async (req, reply) => {
    try {
      const { slug } = req.params;
      const skill = readSkillFromDisk(slug);
      if (!skill) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Skill '${slug}' not found` } });
      }
      return { data: skill };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /skills — create new skill {slug, name, content}
  app.post<{
    Body: { slug: string; name: string; content: string };
  }>('/skills', async (req, reply) => {
    try {
      const { slug, name, content } = req.body;
      if (!slug || !name || !content) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'slug, name, and content are required' } });
      }

      // Validate slug format (alphanumeric + hyphens/underscores only)
      if (!/^[a-z0-9_-]+$/.test(slug)) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'slug must be lowercase alphanumeric with hyphens/underscores only' } });
      }

      const skillDir = join(SKILLS_DIR, slug);
      if (existsSync(skillDir)) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: `Skill '${slug}' already exists` } });
      }

      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
      invalidateCache();

      const skill = readSkillFromDisk(slug)!;
      return reply.status(201).send({ data: skill });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // PUT /skills/:slug — update skill content
  app.put<{
    Params: { slug: string };
    Body: { content: string };
  }>('/skills/:slug', async (req, reply) => {
    try {
      const { slug } = req.params;
      const { content } = req.body;
      if (!content) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'content is required' } });
      }

      const skillDir = join(SKILLS_DIR, slug);
      if (!existsSync(skillDir)) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Skill '${slug}' not found` } });
      }

      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
      invalidateCache();

      const skill = readSkillFromDisk(slug)!;
      return { data: skill };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /skills/:slug — delete skill directory
  app.delete<{ Params: { slug: string } }>('/skills/:slug', async (req, reply) => {
    try {
      const { slug } = req.params;
      const skillDir = join(SKILLS_DIR, slug);
      if (!existsSync(skillDir)) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Skill '${slug}' not found` } });
      }

      rmSync(skillDir, { recursive: true, force: true });
      invalidateCache();

      return { data: { success: true, slug } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });
}

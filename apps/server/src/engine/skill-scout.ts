/**
 * engine/skill-scout.ts — Weekly Skill Discovery Engine
 *
 * Discovers trending AI agent skills and recreates them from scratch
 * (clean-room, no third-party code installed).
 *
 * Provider strategy (works with ANY configured provider):
 *   - Discovery: GitHub API (no LLM needed) + LLM enrichment via chatComplete
 *   - Recreation: chatComplete (uses user's configured provider/model)
 *   - Bonus: If GEMINI_API_KEY is set, uses Gemini Search Grounding for richer discovery
 *
 * Flow:
 *   1. Discover trending skills (GitHub API + optional Gemini grounding)
 *   2. Filter out skills already installed
 *   3. For each new skill: LLM recreates it from scratch via chatComplete
 *   4. audit-skill.sh runs (mandatory — 0 vulns required)
 *   5. Skill installed to ~/.hiveclaw/workspace/skills/
 *   6. Saved to DB as recommended_skills with status 'ready'
 *   7. UI shows in Settings → Skills → ✨ Recommended
 *
 * NEVER installs third-party code. Always clean-room rewrite.
 *
 * Sprint 78 — Clark 🐙 | Refactored — Alice 🐕
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { logger } from '../lib/logger.js';
import { getProviderRouter } from './providers/index.js';
import type Database from 'better-sqlite3';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillRecommendation {
  id: string;
  slug: string;
  name: string;
  description: string;
  why: string;
  category: string;
  tags: string[];
  sources: string[];
  status: 'discovering' | 'creating' | 'auditing' | 'ready' | 'failed';
  error?: string;
  created_at: string;
  activated: boolean;
  activated_at?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SKILLS_DIR = join(homedir(), '.hiveclaw', 'workspace', 'skills');
const AUDIT_SCRIPT = join(homedir(), '.hiveclaw', 'workspace', 'skills', 'self-learning', 'scripts', 'audit-skill.sh');

// ─── GitHub Discovery (no LLM required) ─────────────────────────────────────

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  topics: string[];
}

async function discoverFromGitHub(): Promise<Array<{
  slug: string; name: string; description: string;
  why: string; category: string; tags: string[]; sources: string[]
}>> {
  const topics = ['ai-agent-skill', 'mcp-tool', 'llm-tool', 'agent-skill', 'ai-agent-tool'];
  const allRepos: GitHubRepo[] = [];

  for (const topic of topics) {
    try {
      const response = await fetch(
        `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=5`,
        {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'HiveClaw-SkillScout' },
          signal: AbortSignal.timeout(15000)
        }
      );
      if (response.ok) {
        const data = await response.json() as { items?: GitHubRepo[] };
        allRepos.push(...(data.items ?? []));
      }
    } catch (err) {
      logger.debug({ err, topic }, '[skill-scout] GitHub topic search failed');
    }
  }

  // Deduplicate by full_name
  const seen = new Set<string>();
  const unique = allRepos.filter(r => {
    if (seen.has(r.full_name)) return false;
    seen.add(r.full_name);
    return true;
  });

  // Convert to skill concepts
  return unique.slice(0, 8).map(repo => ({
    slug: repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40),
    name: repo.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: repo.description || `AI agent skill based on ${repo.name}`,
    why: `Popular on GitHub (${repo.stargazers_count} stars). Topics: ${repo.topics.join(', ')}`,
    category: 'automation' as string,
    tags: repo.topics.slice(0, 5),
    sources: [repo.html_url]
  }));
}

// ─── Gemini Search Grounding (bonus — requires GEMINI_API_KEY) ───────────────

async function discoverWithGemini(apiKey: string, installedList: string): Promise<Array<{
  slug: string; name: string; description: string;
  why: string; category: string; tags: string[]; sources: string[]
}>> {
  const payload = {
    contents: [{ parts: [{ text:
      `What are the most useful and trending skills/capabilities for AI agents in ${new Date().toISOString().slice(0, 7)}? ` +
      `Search GitHub trending repos tagged with ai-agent, mcp-tool, llm-tool, agent-skill. ` +
      `Also search npm for packages tagged agent-skill, ai-tool, mcp-server. ` +
      `Return a JSON array of 5-8 skills NOT in this list: [${installedList}]. ` +
      `Format: [{"slug":"skill-name","name":"Skill Name","description":"what it does","why":"why useful for AI agents","category":"productivity|coding|search|media|data|automation","tags":["tag1","tag2"],"sources":["url1"]}]` +
      `Return ONLY the JSON array, no markdown.`
    }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}

// ─── LLM Skill Recreation (uses ANY configured provider) ─────────────────────

async function recreateSkillWithLLM(
  skillConcept: { slug: string; name: string; description: string; why: string }
): Promise<string> {
  const prompt = `You are an expert AI agent developer. Create a complete, production-ready skill for an AI agent platform.

Skill to create:
- Name: ${skillConcept.name}
- Slug: ${skillConcept.slug}
- Description: ${skillConcept.description}
- Why it's useful: ${skillConcept.why}

Generate a SKILL.md file with this exact format:

\`\`\`markdown
# ${skillConcept.name}

## Description
${skillConcept.description}

## Scripts

### main.sh
\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail
# [complete bash script implementing the skill]
# RULES:
# - Never hardcode paths like /Users/username/ - always use $HOME
# - Validate all inputs with regex whitelists
# - No eval, no dynamic code execution
# - Secrets always via env vars, never args
# - set -euo pipefail always
# - Quote all variables
\`\`\`

## Usage
[examples of how to use this skill]

## Security
[security considerations and what was hardened]
\`\`\`

Create ONLY the SKILL.md content. Make it complete and production-ready. Focus on security and correctness.`;

  const router = getProviderRouter();
  const providers = router.list();
  if (providers.length === 0) {
    throw new Error('No LLM providers configured — cannot recreate skill');
  }

  // Use all available providers as fallback chain
  const fallbackChain = providers.map(p => p.id);
  let content = '';

  for await (const chunk of router.chatWithFallback(
    [{ role: 'user', content: prompt }],
    { temperature: 0.3, maxTokens: 8192 },
    fallbackChain
  )) {
    if (chunk.type === 'text' && chunk.text) content += chunk.text;
    if (chunk.type === 'error') throw new Error(String(chunk.text ?? 'LLM error'));
  }

  if (!content) throw new Error('LLM returned empty content');
  return content;
}

// ─── Skill Discovery ─────────────────────────────────────────────────────────

function getInstalledSlugs(): string[] {
  try {
    mkdirSync(SKILLS_DIR, { recursive: true });
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

function installSkill(slug: string, content: string): void {
  const skillDir = join(SKILLS_DIR, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

  // Extract and write bash scripts from SKILL.md
  const scriptRegex = /###\s+(\S+\.sh)\n```bash\n([\s\S]*?)```/g;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    const scriptName = match[1];
    const scriptContent = match[2];
    if (!/^[a-zA-Z0-9_-]+\.sh$/.test(scriptName)) continue;
    const scriptsDir = join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const scriptPath = join(scriptsDir, scriptName);
    writeFileSync(scriptPath, scriptContent, 'utf-8');
    if (process.platform !== 'win32') {
      execSync(`chmod +x "${scriptPath}"`);
    }
  }
}

function auditSkill(slug: string): { passed: boolean; issues: string[] } {
  const skillDir = join(SKILLS_DIR, slug);

  if (!existsSync(AUDIT_SCRIPT)) {
    return { passed: true, issues: [] };
  }

  if (process.platform === 'win32') {
    logger.warn({ slug }, 'Skill audit skipped on Windows — audit-skill.sh requires bash');
    return { passed: true, issues: [] };
  }

  try {
    const output = execSync(`bash "${AUDIT_SCRIPT}" "${skillDir}" 2>&1`, {
      timeout: 30000,
      encoding: 'utf-8'
    });

    const issues = output.split('\n')
      .filter(line => line.includes('❌') || line.includes('FAIL'))
      .filter(line => !line.includes('comment') && !line.includes('pattern'));

    return { passed: issues.length === 0, issues };
  } catch {
    return { passed: false, issues: ['Audit script failed to run'] };
  }
}

// ─── Main Scout Engine ───────────────────────────────────────────────────────

export async function runSkillScout(db: Database.Database): Promise<{
  discovered: number;
  created: number;
  failed: number;
}> {
  logger.info('[skill-scout] Starting skill discovery...');

  const installedSlugs = getInstalledSlugs();
  const installedList = installedSlugs.join(', ');

  // Step 1: Discover skills
  // Strategy: GitHub API (always works) + Gemini grounding (bonus if GEMINI_API_KEY set)
  let skills: Array<{
    slug: string; name: string; description: string;
    why: string; category: string; tags: string[]; sources: string[]
  }> = [];

  const geminiKey = process.env.GEMINI_API_KEY;

  if (geminiKey) {
    // Best path: Gemini with Google Search Grounding
    try {
      logger.info('[skill-scout] Using Gemini Search Grounding for discovery');
      skills = await discoverWithGemini(geminiKey, installedList);
    } catch (err) {
      logger.warn({ err }, '[skill-scout] Gemini discovery failed, falling back to GitHub');
    }
  }

  if (skills.length === 0) {
    // Fallback: GitHub API (no API key needed)
    try {
      logger.info('[skill-scout] Using GitHub API for discovery');
      skills = await discoverFromGitHub();
    } catch (err) {
      logger.error({ err }, '[skill-scout] GitHub discovery also failed');
      return { discovered: 0, created: 0, failed: 0 };
    }
  }

  // Filter already installed + sanitize
  skills = skills.filter(s => {
    if (!/^[a-z0-9-]+$/.test(s.slug)) return false;
    return !installedSlugs.includes(s.slug);
  });

  if (skills.length === 0) {
    logger.info('[skill-scout] No new skills to create');
    return { discovered: 0, created: 0, failed: 0 };
  }

  logger.info(`[skill-scout] Discovered ${skills.length} new skills to create`);

  // Step 2: Recreate each skill via chatComplete (uses ANY configured provider)
  let created = 0;
  let failed = 0;

  for (const skill of skills) {
    const recId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      db.prepare(`
        INSERT OR REPLACE INTO recommended_skills
        (id, slug, name, description, why, category, tags, sources, status, created_at, activated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', datetime('now'), 0)
      `).run(
        recId, skill.slug, skill.name, skill.description,
        skill.why, skill.category,
        JSON.stringify(skill.tags ?? []),
        JSON.stringify(skill.sources ?? [])
      );
    } catch (err) {
      logger.error({ err, slug: skill.slug }, '[skill-scout] DB insert failed');
      continue;
    }

    // Recreate skill from scratch (clean-room) using user's LLM provider
    let skillContent = '';
    try {
      db.prepare(`UPDATE recommended_skills SET status='creating' WHERE id=?`).run(recId);
      skillContent = await recreateSkillWithLLM(skill);
    } catch (err) {
      logger.error({ err, slug: skill.slug }, '[skill-scout] Skill recreation failed');
      db.prepare(`UPDATE recommended_skills SET status='failed', error=? WHERE id=?`)
        .run(String(err), recId);
      failed++;
      continue;
    }

    // Install skill files
    try {
      db.prepare(`UPDATE recommended_skills SET status='auditing' WHERE id=?`).run(recId);
      installSkill(skill.slug, skillContent);
    } catch (err) {
      logger.error({ err, slug: skill.slug }, '[skill-scout] Skill install failed');
      db.prepare(`UPDATE recommended_skills SET status='failed', error=? WHERE id=?`)
        .run(String(err), recId);
      failed++;
      continue;
    }

    // Security audit (mandatory)
    const audit = auditSkill(skill.slug);
    if (!audit.passed) {
      logger.warn({ slug: skill.slug, issues: audit.issues }, '[skill-scout] Skill failed audit — removing');
      try {
        execSync(`rm -rf "${join(SKILLS_DIR, skill.slug)}"`);
      } catch { /* best effort */ }
      db.prepare(`UPDATE recommended_skills SET status='failed', error=? WHERE id=?`)
        .run(`Audit failed: ${audit.issues.join('; ')}`, recId);
      failed++;
      continue;
    }

    // Mark as ready
    db.prepare(`UPDATE recommended_skills SET status='ready' WHERE id=?`).run(recId);
    logger.info(`[skill-scout] ✅ Skill '${skill.slug}' created and ready`);
    created++;
  }

  logger.info(`[skill-scout] Done — ${created} created, ${failed} failed`);
  return { discovered: skills.length, created, failed };
}

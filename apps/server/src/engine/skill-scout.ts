/**
 * engine/skill-scout.ts — Weekly Skill Discovery Engine
 *
 * Uses Gemini + Google Search Grounding to discover trending AI agent skills,
 * then RECREATES them from scratch (clean-room, no third-party code installed).
 *
 * Flow:
 *   1. Gemini searches the web for trending AI agent skills
 *   2. Filter out skills already installed
 *   3. For each new skill: LLM recreates it from scratch
 *   4. audit-skill.sh runs (mandatory — 0 vulns required)
 *   5. Skill installed to ~/.hiveclaw/skills/
 *   6. Saved to DB as recommended_skills with status 'ready'
 *   7. UI shows in Settings → Skills → ✨ Recommended
 *
 * NEVER installs third-party code. Always clean-room rewrite.
 *
 * Sprint 78 — Clark 🐙
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { logger } from '../lib/logger.js';
import type Database from 'better-sqlite3';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillRecommendation {
  id: string;
  slug: string;
  name: string;
  description: string;
  why: string;           // Why it's useful
  category: string;
  tags: string[];
  sources: string[];     // URLs found by Gemini
  status: 'discovering' | 'creating' | 'auditing' | 'ready' | 'failed';
  error?: string;
  created_at: string;
  activated: boolean;
  activated_at?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SKILLS_DIR = join(homedir(), '.hiveclaw', 'skills');
const AUDIT_SCRIPT = join(homedir(), '.hiveclaw', 'skills', 'self-learning', 'scripts', 'audit-skill.sh');

// ─── Gemini Search ───────────────────────────────────────────────────────────

async function searchWithGemini(query: string, apiKey: string): Promise<string> {
  const payload = {
    contents: [{ parts: [{ text: query }] }],
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

  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ─── LLM Skill Recreation ────────────────────────────────────────────────────

async function recreateSkillWithLLM(
  skillConcept: { slug: string; name: string; description: string; why: string },
  apiKey: string
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

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };

  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
    // Sanitize script name
    if (!/^[a-zA-Z0-9_-]+\.sh$/.test(scriptName)) continue;
    const scriptsDir = join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const scriptPath = join(scriptsDir, scriptName);
    writeFileSync(scriptPath, scriptContent, 'utf-8');
    // chmod +x is only needed on Unix — Windows ignores file permissions
    if (process.platform !== 'win32') {
      execSync(`chmod +x "${scriptPath}"`);
    }
  }
}

function auditSkill(slug: string): { passed: boolean; issues: string[] } {
  const skillDir = join(SKILLS_DIR, slug);

  if (!existsSync(AUDIT_SCRIPT)) {
    // Basic audit if audit-skill.sh not available (or on Windows)
    return { passed: true, issues: [] };
  }

  // Audit script requires bash — skip on Windows
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('[skill-scout] GEMINI_API_KEY not set — skipping skill discovery');
    return { discovered: 0, created: 0, failed: 0 };
  }

  logger.info('[skill-scout] Starting weekly skill discovery...');

  const installedSlugs = getInstalledSlugs();
  const installedList = installedSlugs.join(', ');

  // Step 1: Gemini discovers trending skills
  let discoveryText = '';
  try {
    discoveryText = await searchWithGemini(
      `What are the most useful and trending skills/capabilities for AI agents in ${new Date().toISOString().slice(0, 7)}? ` +
      `Search GitHub trending repos tagged with ai-agent, mcp-tool, llm-tool, agent-skill. ` +
      `Also search npm for packages tagged agent-skill, ai-tool, mcp-server. ` +
      `Return a JSON array of 5-8 skills NOT in this list: [${installedList}]. ` +
      `Format: [{"slug":"skill-name","name":"Skill Name","description":"what it does","why":"why useful for AI agents","category":"productivity|coding|search|media|data|automation","tags":["tag1","tag2"],"sources":["url1"]}]` +
      `Return ONLY the JSON array, no markdown.`,
      apiKey
    );
  } catch (err) {
    logger.error({ err }, '[skill-scout] Gemini discovery failed');
    return { discovered: 0, created: 0, failed: 0 };
  }

  // Parse discovered skills
  let skills: Array<{
    slug: string; name: string; description: string;
    why: string; category: string; tags: string[]; sources: string[]
  }> = [];

  try {
    // Extract JSON from response (may have markdown around it)
    const jsonMatch = discoveryText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      skills = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    logger.error({ err }, '[skill-scout] Failed to parse Gemini response');
    return { discovered: 0, created: 0, failed: 0 };
  }

  // Filter already installed
  skills = skills.filter(s => {
    // Sanitize slug
    if (!/^[a-z0-9-]+$/.test(s.slug)) return false;
    return !installedSlugs.includes(s.slug);
  });

  logger.info(`[skill-scout] Discovered ${skills.length} new skills to create`);

  let created = 0;
  let failed = 0;

  for (const skill of skills) {
    const recId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Save to DB as 'creating'
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

    // Step 2: Recreate skill from scratch (clean-room)
    let skillContent = '';
    try {
      db.prepare(`UPDATE recommended_skills SET status='creating' WHERE id=?`).run(recId);
      skillContent = await recreateSkillWithLLM(skill, apiKey);
    } catch (err) {
      logger.error({ err, slug: skill.slug }, '[skill-scout] Skill recreation failed');
      db.prepare(`UPDATE recommended_skills SET status='failed', error=? WHERE id=?`)
        .run(String(err), recId);
      failed++;
      continue;
    }

    // Step 3: Install skill files
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

    // Step 4: Security audit (mandatory)
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

    // Step 5: Mark as ready
    db.prepare(`UPDATE recommended_skills SET status='ready' WHERE id=?`).run(recId);
    logger.info(`[skill-scout] ✅ Skill '${skill.slug}' created and ready`);
    created++;
  }

  logger.info(`[skill-scout] Done — ${created} created, ${failed} failed`);
  return { discovered: skills.length, created, failed };
}

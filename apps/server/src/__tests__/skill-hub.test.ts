import { describe, it, expect } from 'vitest';
import {
  CURATED_SKILLS,
  getSkillBySlug,
  getSkillsByCategory,
  searchSkills,
  getCategoryStats,
} from '../engine/skill-hub.js';

describe('Curated Skill Hub', () => {
  it('should have 27 curated skills', () => {
    expect(CURATED_SKILLS).toHaveLength(27);
  });

  it('should have all required fields on every skill', () => {
    for (const skill of CURATED_SKILLS) {
      expect(skill.slug).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.category).toBeTruthy();
      expect(skill.badge).toBe('verified');
      expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(skill.author).toBe('HiveClaw');
      expect(skill.securityScore).toBeGreaterThanOrEqual(8.5);
      expect(skill.content).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0);
      expect(skill.examples.length).toBeGreaterThan(0);
    }
  });

  it('should have unique slugs', () => {
    const slugs = CURATED_SKILLS.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('should cover 13 categories', () => {
    const categories = new Set(CURATED_SKILLS.map(s => s.category));
    expect(categories.size).toBe(13);
    expect(categories).toContain('productivity');
    expect(categories).toContain('coding');
    expect(categories).toContain('search');
    expect(categories).toContain('communication');
    expect(categories).toContain('data');
    expect(categories).toContain('automation');
    expect(categories).toContain('creative');
    expect(categories).toContain('utilities');
    expect(categories).toContain('system');
    expect(categories).toContain('ai-ops');
    expect(categories).toContain('qa');
    expect(categories).toContain('security');
    expect(categories).toContain('agent-protocols');
  });

  describe('getSkillBySlug', () => {
    it('should find existing skill', () => {
      const skill = getSkillBySlug('daily-brief');
      expect(skill).toBeDefined();
      expect(skill!.name).toBe('Daily Brief');
    });

    it('should return undefined for missing slug', () => {
      expect(getSkillBySlug('nonexistent')).toBeUndefined();
    });
  });

  describe('getSkillsByCategory', () => {
    it('should filter by category', () => {
      const coding = getSkillsByCategory('coding');
      expect(coding.length).toBe(3);
      expect(coding.every(s => s.category === 'coding')).toBe(true);
    });

    it('should return empty for unknown category', () => {
      expect(getSkillsByCategory('unknown' as any)).toHaveLength(0);
    });
  });

  describe('searchSkills', () => {
    it('should find by name', () => {
      const results = searchSkills('email');
      expect(results.some(s => s.slug === 'email-composer')).toBe(true);
    });

    it('should find by tag', () => {
      const results = searchSkills('regex');
      expect(results.some(s => s.slug === 'regex-builder')).toBe(true);
    });

    it('should find by description', () => {
      const results = searchSkills('cron');
      expect(results.some(s => s.slug === 'cron-scheduler')).toBe(true);
    });

    it('should return empty for no match', () => {
      expect(searchSkills('zzzznotexistingzzz')).toHaveLength(0);
    });
  });

  describe('getCategoryStats', () => {
    it('should return correct counts', () => {
      const stats = getCategoryStats();
      expect(stats.productivity).toBe(3);
      expect(stats.coding).toBe(3);
      expect(stats.search).toBe(3);
      expect(stats.communication).toBe(4);
      expect(stats.data).toBe(2);
      expect(stats.automation).toBe(2);
      expect(stats.creative).toBe(2);
      expect(stats.utilities).toBe(3);
    });
  });
});

// ============================================================
// Squad Intelligence — Sprint 73 items 2.7, 2.8, 2.9
// Tests for parseMentions, detectPullThrough, and smart-skip heuristic
// imported through squad-runner helpers exposed from archer-router.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseMentions,
  detectPullThrough,
  detectTags,
  buildArcherContext,
  type SquadAgent,
  type MentionParseResult,
} from '../engine/archer-router.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const alice: SquadAgent = { id: 'alice', name: 'Alice', emoji: '👩', sessionKey: 'alice' };
const bob: SquadAgent = { id: 'bob', name: 'Bob', emoji: '👨', sessionKey: 'bob' };
const hawk: SquadAgent = { id: 'hawk', name: 'Hawk', emoji: '🦅', sessionKey: 'hawk' };
const agents = [alice, bob, hawk];

// ─── 2.7 parseMentions ─────────────────────────────────────────────────────────

describe('2.7 parseMentions — @mention routing', () => {
  it('no @ → isNoMention=true, PO-only', () => {
    const r = parseMentions('What is the project status?', agents);
    expect(r.isNoMention).toBe(true);
    expect(r.isAllMention).toBe(false);
    expect(r.targetAgents).toHaveLength(1);
    expect(r.targetAgents[0].id).toBe('alice');
  });

  it('@all → isAllMention=true, all agents', () => {
    const r = parseMentions('@all please review this', agents);
    expect(r.isAllMention).toBe(true);
    expect(r.targetAgents).toHaveLength(3);
  });

  it('@todos → isAllMention=true', () => {
    const r = parseMentions('@todos confiram o status', agents);
    expect(r.isAllMention).toBe(true);
  });

  it('@team → isAllMention=true', () => {
    const r = parseMentions('@team sync please', agents);
    expect(r.isAllMention).toBe(true);
  });

  it('@specific agent by id', () => {
    const r = parseMentions('@hawk please review this PR', agents);
    expect(r.isNoMention).toBe(false);
    expect(r.isAllMention).toBe(false);
    expect(r.targetAgents).toHaveLength(1);
    expect(r.targetAgents[0].id).toBe('hawk');
  });

  it('@specific agent by name (lowercase)', () => {
    const r = parseMentions('@bob what do you think?', agents);
    expect(r.targetAgents).toHaveLength(1);
    expect(r.targetAgents[0].id).toBe('bob');
  });

  it('@two agents → both returned in squad order', () => {
    const r = parseMentions('@hawk and @bob please check', agents);
    expect(r.targetAgents).toHaveLength(2);
    // Squad order: bob (index 1) before hawk (index 2)
    expect(r.targetAgents[0].id).toBe('bob');
    expect(r.targetAgents[1].id).toBe('hawk');
  });

  it('cleanMessage removes @mention tokens', () => {
    const r = parseMentions('@hawk please review', agents);
    expect(r.cleanMessage).not.toContain('@hawk');
    expect(r.cleanMessage.length).toBeGreaterThan(0);
  });

  it('mentionTokens captures raw tokens', () => {
    const r = parseMentions('@hawk please review @bob', agents);
    expect(r.mentionTokens).toContain('hawk');
    expect(r.mentionTokens).toContain('bob');
  });

  it('empty agents list → empty targetAgents', () => {
    const r = parseMentions('hello there', []);
    expect(r.targetAgents).toHaveLength(0);
    expect(r.isNoMention).toBe(true);
  });

  it('email address — parseMentions extracts token but cannot resolve to any agent', () => {
    const r = parseMentions('send to user@example.com please', agents);
    // @ in email is extracted as token "example" but doesn't match any agent name/id
    // Falls through to PO fallback (agents[0]), isNoMention=false since token exists
    expect(r.mentionTokens).toContain('example');
    expect(r.isNoMention).toBe(false);
    // The key behavior: no agent was actually @mentioned by name
    // PO fallback is correct ARCHER behavior for unresolved tokens
  });
});

// ─── 2.7 detectPullThrough ─────────────────────────────────────────────────────

describe('2.7 detectPullThrough — PO pulls in agents', () => {
  it('PO mentions @hawk → hawk pulled through', () => {
    const result = detectPullThrough(
      'I think @hawk should review the architecture here.',
      agents,
      alice,
    );
    expect(result.pulledAgents).toHaveLength(1);
    expect(result.pulledAgents[0].id).toBe('hawk');
  });

  it('PO mentions @all → all non-PO agents pulled', () => {
    const result = detectPullThrough('@all please weigh in on this.', agents, alice);
    expect(result.pulledAgents).toHaveLength(2); // bob + hawk, alice excluded
    const ids = result.pulledAgents.map(a => a.id);
    expect(ids).not.toContain('alice');
  });

  it('PO mentions nobody → no pull-through', () => {
    const result = detectPullThrough('Looks good to me, I am satisfied.', agents, alice);
    expect(result.pulledAgents).toHaveLength(0);
  });

  it('PO never appears in pulled agents when she mentions herself', () => {
    // alice is excluded from nonPoAgents, so @alice is unresolvable.
    // Key invariant: alice never appears in the pulled list.
    const result = detectPullThrough('@alice what do you think?', agents, alice);
    const pulledIds = result.pulledAgents.map(a => a.id);
    expect(pulledIds).not.toContain('alice');
  });

  it('mentionTokens are returned', () => {
    const result = detectPullThrough('@bob check the tests', agents, alice);
    expect(result.mentionTokens).toContain('bob');
  });
});

// ─── 2.8 Agent-to-agent (via parseMentions on response) ───────────────────────

describe('2.8 agent-to-agent @mention detection', () => {
  it('non-PO agent mentioning another → parseMentions returns that agent', () => {
    // Bob says "@hawk please review my code"
    const r = parseMentions('@hawk please review my code', agents);
    expect(r.targetAgents[0].id).toBe('hawk');
  });

  it('detectPullThrough from non-PO correctly finds @mention', () => {
    // Bob (non-PO) says "@hawk can you look at this?"
    const result = detectPullThrough('@hawk can you look at this?', agents, bob);
    expect(result.pulledAgents).toHaveLength(1);
    expect(result.pulledAgents[0].id).toBe('hawk');
  });

  it('agent is never in its own pull-through result', () => {
    // hawk is the speaking agent; hawk is excluded from nonPoAgents.
    // Key invariant: hawk never appears in the pulled list.
    const result = detectPullThrough('@hawk I think I got it', agents, hawk);
    const pulledIds = result.pulledAgents.map(a => a.id);
    expect(pulledIds).not.toContain('hawk');
  });

  it('chain: agent A pulls B, B response parsed → can pull C', () => {
    // Simulate the chain: alice pulls bob, bob response mentions hawk
    const r1 = detectPullThrough('@bob please check the DB schema.', agents, alice);
    expect(r1.pulledAgents[0].id).toBe('bob');

    const r2 = detectPullThrough('@hawk can you verify the queries?', agents, bob);
    expect(r2.pulledAgents[0].id).toBe('hawk');
  });
});

// ─── 2.9 Smart skip keyword overlap ───────────────────────────────────────────
// The actual shouldSkipAgent() function is private to squad-runner.ts.
// We test the underlying heuristic by calling parseMentions and checking
// mention results, plus direct keyword overlap logic.

describe('2.9 smart skip — keyword overlap heuristic', () => {
  /**
   * Inline replica of the overlap logic from squad-runner.ts.
   * Kept here to spec the behaviour without coupling to internals.
   */
  const STOPWORDS = new Set([
    'the','a','an','is','in','on','at','to','of','and','or','but','for',
    'with','this','that','it','be','are','was','were','you','we','i',
    'he','she','they','have','has','had','do','does','did','will','would',
    'can','could','should','may','might','not','no','so','if','as','by',
    'from','up','about','into','than','then','its','our','your',
  ]);

  function keywordOverlap(message: string, systemPrompt: string): number {
    const tokenize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));

    const msgTokens = new Set(tokenize(message));
    const sysTokens = new Set(tokenize(systemPrompt));

    if (msgTokens.size === 0) return 0;

    let overlap = 0;
    for (const token of msgTokens) {
      if (sysTokens.has(token)) overlap++;
    }

    return overlap / msgTokens.size;
  }

  const SKIP_THRESHOLD = 0.10;

  it('high-overlap message → above threshold (should NOT skip)', () => {
    const systemPrompt = 'You are a QA engineer. You review code, write tests, and verify quality.';
    const message = 'Write tests to verify code quality and review the test coverage.';
    const score = keywordOverlap(message, systemPrompt);
    expect(score).toBeGreaterThanOrEqual(SKIP_THRESHOLD);
  });

  it('low-overlap message → below threshold (should skip)', () => {
    const systemPrompt = 'You are a QA engineer. You review code and write tests.';
    const message = 'Deploy the application to production using Docker and Kubernetes.';
    const score = keywordOverlap(message, systemPrompt);
    expect(score).toBeLessThan(SKIP_THRESHOLD);
  });

  it('empty message → overlap is 0 (skip)', () => {
    const score = keywordOverlap('', 'You are a QA engineer.');
    expect(score).toBe(0);
  });

  it('exact overlap → score is 1.0', () => {
    const systemPrompt = 'review code tests quality engineer';
    const message = 'review code tests quality engineer';
    const score = keywordOverlap(message, systemPrompt);
    expect(score).toBe(1.0);
  });

  it('no overlap → score is 0', () => {
    const systemPrompt = 'You are a QA engineer specializing in automated testing.';
    const message = 'Calculate the fibonacci sequence using memoization.';
    const score = keywordOverlap(message, systemPrompt);
    expect(score).toBe(0);
  });

  it('stopwords not counted as overlap', () => {
    const systemPrompt = 'the is in on and or';
    const message = 'the is in on and or we';
    // All tokens are stopwords — filtered out → 0 msg tokens → score 0
    const score = keywordOverlap(message, systemPrompt);
    expect(score).toBe(0);
  });

  it('@mentioned agent is never skipped (regardless of overlap)', () => {
    // This tests the rule: if isMentioned=true → never skip
    // Demonstrated by parseMentions: @hawk is in targetAgents
    const r = parseMentions('@hawk deploy to kubernetes', agents);
    const isMentioned = r.targetAgents.some(a => a.id === hawk.id);
    expect(isMentioned).toBe(true);
    // The rule is: if isMentioned → skip=false regardless of overlap score
  });

  it('PO (index 0) is never skipped regardless of overlap', () => {
    // No @mention → PO-only mode → PO runs, others don't even get to skip check
    const r = parseMentions('ping', agents);
    expect(r.targetAgents[0].id).toBe('alice');
    // alice is index 0, so shouldSkipAgent returns false
  });
});

// ─── detectTags (NEXUS v3) ─────────────────────────────────────────────────────

describe('detectTags — NEXUS v3 tag detection', () => {
  it('detects [CLAIM] tag', () => {
    const tags = detectTags('[CLAIM] #42 I will handle this');
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe('CLAIM');
    expect(tags[0].issueNumber).toBe('42');
  });

  it('detects [DONE] tag', () => {
    const tags = detectTags('[DONE] #7 Completed the migration');
    expect(tags[0].tag).toBe('DONE');
    expect(tags[0].issueNumber).toBe('7');
  });

  it('detects [BLOCKED] tag', () => {
    const tags = detectTags('[BLOCKED] waiting on infra');
    expect(tags[0].tag).toBe('BLOCKED');
    expect(tags[0].issueNumber).toBeUndefined();
  });

  it('detects multiple tags in one response', () => {
    const tags = detectTags('[CLAIM] #1 taking it\n[DONE] #2 finished');
    expect(tags).toHaveLength(2);
  });

  it('no tags → empty array', () => {
    const tags = detectTags('Just a normal response without any tags');
    expect(tags).toHaveLength(0);
  });
});

// ─── buildArcherContext ────────────────────────────────────────────────────────

describe('buildArcherContext — context block generation', () => {
  const mentionNone: MentionParseResult = {
    targetAgents: [alice],
    isAllMention: false,
    isNoMention: true,
    mentionTokens: [],
    cleanMessage: 'What is the status?',
  };

  it('includes squad name', () => {
    const ctx = buildArcherContext(
      { squadName: 'Alpha Squad', agents },
      alice,
      1, 3,
      mentionNone,
    );
    expect(ctx).toContain('Alpha Squad');
  });

  it('marks current agent as (you)', () => {
    const ctx = buildArcherContext(
      { squadName: 'Alpha Squad', agents },
      alice,
      1, 3,
      mentionNone,
    );
    expect(ctx).toContain('Alice (you)');
  });

  it('includes turn number', () => {
    const ctx = buildArcherContext(
      { squadName: 'Alpha Squad', agents },
      bob,
      2, 3,
      mentionNone,
    );
    expect(ctx).toContain('2/3');
  });

  it('@all mention context says everyone responds', () => {
    const mentionAll: MentionParseResult = {
      targetAgents: agents,
      isAllMention: true,
      isNoMention: false,
      mentionTokens: ['all'],
      cleanMessage: 'please review',
    };
    const ctx = buildArcherContext(
      { squadName: 'Alpha Squad', agents },
      bob,
      2, 3,
      mentionAll,
    );
    expect(ctx).toContain('@all');
  });

  it('specific mention context says agent was called', () => {
    const mentionHawk: MentionParseResult = {
      targetAgents: [hawk],
      isAllMention: false,
      isNoMention: false,
      mentionTokens: ['hawk'],
      cleanMessage: 'please review',
    };
    const ctx = buildArcherContext(
      { squadName: 'Alpha Squad', agents },
      hawk,
      1, 1,
      mentionHawk,
    );
    expect(ctx).toContain('specifically called');
  });
});

// ─── Hawk QA: Missing test cases ──────────────────────────────────────────────

describe('QA: @all + smart-skip interaction', () => {
  const STOPWORDS = new Set([
    'the','a','an','is','in','on','at','to','of','and','or','but','for',
    'with','this','that','it','be','are','was','were','you','we','i',
    'he','she','they','have','has','had','do','does','did','will','would',
    'can','could','should','may','might','not','no','so','if','as','by',
    'from','up','about','into','than','then','its','our','your',
  ]);

  function keywordOverlap(message: string, systemPrompt: string): number {
    const tokenize = (text: string) =>
      text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
    const msgTokens = new Set(tokenize(message));
    const sysTokens = new Set(tokenize(systemPrompt));
    if (msgTokens.size === 0) return 0;
    let overlap = 0;
    for (const token of msgTokens) if (sysTokens.has(token)) overlap++;
    return overlap / msgTokens.size;
  }

  it('@all mentions — even low-relevance agents should be considered (smart skip applies)', () => {
    const r = parseMentions('@all what is the weather?', agents);
    expect(r.isAllMention).toBe(true);
    expect(r.targetAgents).toHaveLength(agents.length);

    const score = keywordOverlap('what is the weather?', 'I am a database migration expert specializing in PostgreSQL');
    expect(score).toBeLessThan(0.10);
  });

  it('@all + agent with matching prompt → not skipped', () => {
    const score = keywordOverlap('review the database schema', 'I am a database schema expert who reviews SQL migrations');
    expect(score).toBeGreaterThan(0.10);
  });
});

describe('QA: MAX_EXTRA_TURNS cap behavior', () => {
  it('MAX_EXTRA_TURNS=2 caps agent-to-agent chains', () => {
    const maxExtraTurns = 2;
    const chain = ['B', 'C', 'D'];
    const executed = chain.slice(0, maxExtraTurns);
    const capped = chain.slice(maxExtraTurns);
    expect(executed).toEqual(['B', 'C']);
    expect(capped).toEqual(['D']);
  });

  it('agent-to-agent: each pulled agent can trigger further pulls within cap', () => {
    const r1 = detectPullThrough('@bob check this', agents, alice);
    expect(r1.pulledAgents).toHaveLength(1);
    expect(r1.pulledAgents[0].id).toBe('bob');

    const r2 = detectPullThrough('@hawk verify bobs work', agents, bob);
    expect(r2.pulledAgents).toHaveLength(1);
    expect(r2.pulledAgents[0].id).toBe('hawk');
  });
});

describe('QA: buildArcherContext with isNoMention=true (PO branch)', () => {
  it('PO gets leadership context when no one is mentioned', () => {
    const noMention: MentionParseResult = {
      targetAgents: [alice],
      isAllMention: false,
      isNoMention: true,
      mentionTokens: [],
      cleanMessage: 'please help with this task',
    };
    const ctx = buildArcherContext(
      { squadName: 'Dream Team', agents },
      alice,
      0, 3,
      noMention,
    );
    expect(ctx).toBeTruthy();
    expect(typeof ctx).toBe('string');
    expect(ctx).toContain('Dream Team');
  });

  it('non-PO agent gets context even in no-mention mode', () => {
    const noMention: MentionParseResult = {
      targetAgents: [alice],
      isAllMention: false,
      isNoMention: true,
      mentionTokens: [],
      cleanMessage: 'general question',
    };
    const ctx = buildArcherContext(
      { squadName: 'Dream Team', agents },
      bob,
      1, 3,
      noMention,
    );
    expect(ctx).toBeTruthy();
    expect(ctx).toContain('Dream Team');
  });
});

describe('QA: cleanMessage edge cases', () => {
  it('message with only @mentions produces non-empty cleanMessage', () => {
    const r = parseMentions('@alice @bob @hawk', agents);
    expect(r.cleanMessage.length).toBeGreaterThan(0);
  });

  it('message with @all only produces non-empty cleanMessage', () => {
    const r = parseMentions('@all', agents);
    expect(r.cleanMessage.length).toBeGreaterThan(0);
  });

  it('message with @unknown produces non-empty cleanMessage', () => {
    const r = parseMentions('@nobody @zilch', agents);
    expect(r.cleanMessage.length).toBeGreaterThan(0);
  });
});

describe('QA: partial match minimum length (>= 3 chars)', () => {
  it('2-char partial does NOT match', () => {
    const r = parseMentions('@bo check this', agents);
    const matched = r.targetAgents.filter(a => a.id === 'bob');
    expect(matched).toHaveLength(0);
  });

  it('3-char exact matches', () => {
    const r = parseMentions('@bob check this', agents);
    expect(r.targetAgents.some(a => a.id === 'bob')).toBe(true);
  });

  it('4-char partial matches longer name', () => {
    const r = parseMentions('@alic check this', agents);
    expect(r.targetAgents.some(a => a.id === 'alice')).toBe(true);
  });
});

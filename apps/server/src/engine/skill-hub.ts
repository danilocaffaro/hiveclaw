/**
 * engine/skill-hub.ts — Curated Skill Hub (Batch 8.0)
 *
 * HiveClaw ships a curated library of 24 audited skills, organized into categories.
 * Each skill has:
 *   - Clean-room rewrite (no copy-paste from community repos)
 *   - Security audit score
 *   - Verification badge
 *   - Sandboxed execution (workspace path guard)
 *   - Category classification
 *
 * Skills are stored in DB and installed to ~/.hiveclaw/skills/ on demand.
 * Community skills (ClawHub/PicoClaw) can be imported but are NOT pre-installed.
 *
 * Sprint 77 additions (Clark 🐙):
 *   - macos-control    — Full macOS control (mouse, keyboard, window, calibration)
 *   - self-learning    — Auto skill discovery & creation when gaps detected
 *   - ui-qa            — Frontend/UI quality assurance with Playwright
 *   - voice-tts-stt    — TTS (Gemini) + STT (whisper.cpp) voice I/O
 *   - image-analysis   — Vision LLM image/screenshot/diagram analysis
 *   - agent-messaging  — Authenticated agent-to-agent messaging (HMAC-SHA256)
 *
 * DEFAULT_SKILLS: skills auto-assigned to every new agent (starter pack).
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export type SkillCategory =
  | 'productivity'
  | 'coding'
  | 'search'
  | 'media'
  | 'communication'
  | 'data'
  | 'automation'
  | 'creative'
  | 'utilities'
  | 'system'
  | 'qa'
  | 'ai-ops';

export type SkillBadge = 'verified' | 'community' | 'experimental';

export interface CuratedSkill {
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  badge: SkillBadge;
  version: string;
  author: string;
  securityScore: number;   // 0-10
  usageCount: number;
  tags: string[];
  content: string;         // The SKILL.md content (clean-room rewrite)
  examples: string[];
  installed?: boolean;
  skillPath?: string;      // Local path to skill scripts (e.g. ~/.hiveclaw/workspace/skills/macos-control)
}

// ─── Curated Skill Library (18 skills) ─────────────────────────────────────────

export const CURATED_SKILLS: CuratedSkill[] = [

  // ── PRODUCTIVITY ──────────────────────────────────────────────────────────────

  {
    slug: 'daily-brief',
    name: 'Daily Brief',
    description: 'Generate a personalized daily summary: weather, calendar, tasks, news headlines, and system status.',
    category: 'productivity',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['morning', 'summary', 'daily', 'brief'],
    examples: ['Give me my morning brief', 'What\'s on my agenda today?'],
    content: `---
name: daily-brief
description: "Generate a personalized daily summary: weather, calendar, tasks, and system status."
---

# Daily Brief

When triggered, generate a structured daily summary including:

1. **Date & Time** — Current date, day of week, time
2. **System Status** — Agent health, active sessions, pending tasks
3. **Today's Tasks** — From the task store (GET /tasks?status=todo)
4. **Recent Activity** — Last 5 completed tasks or messages
5. **Quick Stats** — Token usage, cost today (from analytics)

Format as a clean, scannable brief. Use emojis sparingly. Be concise.

Trigger phrases: "morning brief", "daily brief", "what's on my plate", "status overview"
`,
  },

  {
    slug: 'task-extractor',
    name: 'Task Extractor',
    description: 'Automatically extract action items and tasks from conversations, emails, or documents.',
    category: 'productivity',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.8,
    usageCount: 0,
    tags: ['tasks', 'extraction', 'action-items', 'productivity'],
    examples: ['Extract tasks from this email', 'What are the action items here?'],
    content: `---
name: task-extractor
description: "Extract action items and tasks from text."
---

# Task Extractor

Analyze the provided text and extract:

1. **Action items** — Clear tasks with an owner (if mentioned) and deadline (if mentioned)
2. **Decisions made** — Things that were decided / agreed upon
3. **Open questions** — Things that need follow-up or clarification
4. **Dependencies** — Tasks that block other tasks

Output as structured JSON with fields: \`task\`, \`owner\`, \`due\`, \`priority\` (high/medium/low), \`type\` (action/decision/question).

After extraction, ask: "Should I add these to your task list?"
If confirmed, POST each task to /tasks.
`,
  },

  {
    slug: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Structure raw meeting notes into agenda, decisions, action items, and follow-ups.',
    category: 'productivity',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.8,
    usageCount: 0,
    tags: ['meetings', 'notes', 'summarize', 'structure'],
    examples: ['Structure these meeting notes', 'Clean up my meeting transcript'],
    content: `---
name: meeting-notes
description: "Structure raw meeting notes into clean, actionable format."
---

# Meeting Notes Structurer

Transform raw/messy meeting notes into:

## Output Format
\`\`\`
📅 Meeting: [title/date if mentioned]
👥 Attendees: [list if mentioned]

## Summary (2-3 sentences)
[High-level what was discussed]

## Decisions
- [decision 1]
- [decision 2]

## Action Items
- [ ] [task] — @owner — due [date]

## Open Questions
- [question needing follow-up]

## Next Meeting
[If mentioned]
\`\`\`

Be concise. Eliminate filler. Preserve all decisions and action items.
`,
  },

  // ── CODING ────────────────────────────────────────────────────────────────────

  {
    slug: 'code-review',
    name: 'Code Review',
    description: 'Perform a structured code review with focus on bugs, security, performance, and style.',
    category: 'coding',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['code', 'review', 'security', 'bugs', 'performance'],
    examples: ['Review this code', 'Find bugs in my function'],
    content: `---
name: code-review
description: "Structured code review: bugs, security, performance, style."
---

# Code Review

Analyze the provided code and produce a structured review:

## Review Dimensions
1. **Bugs / Logic errors** — Anything that will break or produce wrong output
2. **Security vulnerabilities** — Injection, auth bypass, path traversal, etc.
3. **Performance** — N+1 queries, unbounded loops, missing indexes, memory leaks
4. **Type safety** — Missing null checks, unsafe casts, implicit any
5. **Error handling** — Unhandled promises, swallowed errors, missing try/catch
6. **Style / Readability** — Naming, duplication, complexity

## Output Format
For each issue: severity (🔴 Critical / 🟡 Medium / 🟢 Low), line, description, fix.

End with: overall score /10 and top 3 priorities.
`,
  },

  {
    slug: 'commit-message',
    name: 'Commit Message Generator',
    description: 'Generate conventional commit messages from git diff or description of changes.',
    category: 'coding',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['git', 'commit', 'conventional-commits', 'developer'],
    examples: ['Write a commit message for these changes', 'Generate git commit'],
    content: `---
name: commit-message
description: "Generate conventional commit messages from changes."
---

# Commit Message Generator

Generate a commit message following the Conventional Commits spec:
\`type(scope): description\`

Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build

Rules:
- Subject line: imperative mood, max 72 chars, no period
- Body (if needed): explain WHY not WHAT, wrap at 72 chars
- Breaking changes: add BREAKING CHANGE: footer
- Reference issues: Closes #123

Examples:
\`\`\`
feat(auth): add OAuth2 login with GitHub
fix(api): prevent null pointer on missing session
docs(readme): update installation steps
refactor(router): simplify 3-bucket classification
\`\`\`

Generate 2-3 options if the change is ambiguous.
`,
  },

  {
    slug: 'debug-assistant',
    name: 'Debug Assistant',
    description: 'Systematic debugging: analyze error messages, stack traces, and suggest root causes and fixes.',
    category: 'coding',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['debug', 'error', 'stack-trace', 'troubleshoot'],
    examples: ['Debug this error', 'Why is this failing?', 'Help me fix this'],
    content: `---
name: debug-assistant
description: "Systematic debugging: analyze errors and suggest fixes."
---

# Debug Assistant

When given an error or unexpected behavior:

1. **Parse the error** — Extract error type, message, file, line number
2. **Identify the root cause** — Most likely reason (top 3 hypotheses)
3. **Suggest fixes** — Concrete code changes, ordered by likelihood
4. **Explain the fix** — Why it works, what was wrong

For stack traces: start from the bottom (user code) not top (framework noise).

If the error is ambiguous, ask ONE clarifying question before proceeding.

Always provide a minimal reproducer if possible.
`,
  },

  // ── SEARCH ────────────────────────────────────────────────────────────────────

  {
    slug: 'web-researcher',
    name: 'Web Researcher',
    description: 'Research a topic using web search, synthesize findings, and present a structured summary with sources.',
    category: 'search',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.0,
    usageCount: 0,
    tags: ['research', 'web', 'search', 'summarize', 'sources'],
    examples: ['Research this topic', 'Find information about X', 'What do you know about Y?'],
    content: `---
name: web-researcher
description: "Research a topic using web search and synthesize findings."
---

# Web Researcher

Research the given topic:

1. Identify 3-5 key aspects to research
2. Search for current information (use web_search tool)
3. Synthesize findings into a structured report
4. Cite sources with URLs

## Output Format
\`\`\`
## Summary
[2-3 sentence executive summary]

## Key Findings
1. [finding with source]
2. [finding with source]
...

## Conflicting Views (if any)
[Where sources disagree]

## Sources
- [URL 1] — brief description
- [URL 2] — brief description
\`\`\`

Be honest about uncertainty. Distinguish facts from opinions.
`,
  },

  {
    slug: 'fact-checker',
    name: 'Fact Checker',
    description: 'Verify claims and statements against reliable sources, flagging uncertain or false information.',
    category: 'search',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['fact-check', 'verify', 'truth', 'sources'],
    examples: ['Is this true?', 'Fact-check this claim', 'Verify this statement'],
    content: `---
name: fact-checker
description: "Verify claims against reliable sources."
---

# Fact Checker

For each claim provided:

1. **Identify the claim** — Extract the specific assertion
2. **Search for evidence** — Use web_search to find supporting/contradicting sources
3. **Rate the claim**:
   - ✅ **True** — Supported by reliable sources
   - ⚠️ **Partially true / Misleading** — Contains some truth but missing context
   - ❌ **False** — Contradicted by reliable sources
   - ❓ **Unverifiable** — Not enough information to confirm or deny

4. **Provide context** — What's the nuance? What are people getting wrong?
5. **Cite sources** with URLs

Be calibrated: "I'm not certain" is better than false confidence.
`,
  },

  // ── COMMUNICATION ─────────────────────────────────────────────────────────────

  {
    slug: 'email-composer',
    name: 'Email Composer',
    description: 'Draft professional emails in any tone (formal, casual, assertive) with subject line suggestions.',
    category: 'communication',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['email', 'writing', 'communication', 'compose'],
    examples: ['Write an email to...', 'Draft a reply to...', 'Compose a follow-up email'],
    content: `---
name: email-composer
description: "Draft professional emails with subject line suggestions."
---

# Email Composer

Draft a professional email based on the user's request.

Ask if not clear: purpose, recipient, tone (formal/casual/assertive), urgency.

## Output
\`\`\`
Subject: [3 options ranked by effectiveness]

---

[Email body]

Best regards,
[Name]
\`\`\`

Rules:
- Open with the most important thing (no "I hope this email finds you well")
- One clear ask per email
- Short paragraphs (2-3 sentences max)
- Formal: no contractions, no slang
- Casual: natural voice, can use "Hey" and contractions
- Assertive: direct, no hedging, clear expectations

Always offer to adjust tone or length.
`,
  },

  {
    slug: 'text-improver',
    name: 'Text Improver',
    description: 'Improve clarity, grammar, and style of any text while preserving the original voice.',
    category: 'communication',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['writing', 'grammar', 'editing', 'style', 'clarity'],
    examples: ['Improve this text', 'Fix my writing', 'Make this clearer'],
    content: `---
name: text-improver
description: "Improve clarity, grammar, and style while preserving voice."
---

# Text Improver

Improve the provided text. Focus on:

1. **Clarity** — Eliminate ambiguity, simplify complex sentences
2. **Grammar** — Fix errors without changing meaning
3. **Conciseness** — Remove filler words, redundancy
4. **Flow** — Improve transitions and sentence variety
5. **Voice** — Preserve the author's style and personality

## Output
Show the improved version, then briefly explain 2-3 key changes made.

Do NOT:
- Change the meaning or facts
- Over-formalize casual text
- Remove personality markers

If the text is already good, say so.
`,
  },

  // ── DATA ──────────────────────────────────────────────────────────────────────

  {
    slug: 'data-analyst',
    name: 'Data Analyst',
    description: 'Analyze data (CSV, JSON, tables) and produce insights, trends, and visualizations descriptions.',
    category: 'data',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['data', 'analysis', 'csv', 'insights', 'trends'],
    examples: ['Analyze this data', 'What trends do you see?', 'Summarize this CSV'],
    content: `---
name: data-analyst
description: "Analyze data and produce insights and trends."
---

# Data Analyst

Analyze the provided data (CSV, JSON, table, or raw numbers):

1. **Dataset overview** — Rows, columns, data types, missing values
2. **Key statistics** — Mean, median, min, max, distributions for numeric columns
3. **Notable patterns** — Trends, clusters, outliers, correlations
4. **Top insights** — 3-5 actionable findings ordered by importance
5. **Recommendations** — What decisions does this data support?

Format outputs as:
- Text analysis with specific numbers
- Structured lists (not prose walls)
- Suggest chart types for visualization (bar, line, scatter, etc.)

Ask for context if needed: "What decision is this data meant to inform?"
`,
  },

  {
    slug: 'sql-helper',
    name: 'SQL Helper',
    description: 'Write, optimize, and explain SQL queries. Supports PostgreSQL, MySQL, SQLite.',
    category: 'data',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.0,
    usageCount: 0,
    tags: ['sql', 'database', 'query', 'postgresql', 'mysql', 'sqlite'],
    examples: ['Write a SQL query to...', 'Optimize this query', 'Explain this SQL'],
    content: `---
name: sql-helper
description: "Write, optimize, and explain SQL queries."
---

# SQL Helper

Help with SQL queries:

**Write:** Generate a SQL query from natural language description.
**Optimize:** Analyze a slow query and suggest indexes, rewrites.
**Explain:** Walk through what a query does step by step.
**Debug:** Find errors in SQL syntax or logic.

Always:
- Ask for DB flavor (PostgreSQL/MySQL/SQLite) if not specified
- Use parameterized queries (never string interpolation) in examples
- Include comments for complex CTEs or subqueries
- Warn about missing indexes on JOINs and WHERE conditions
- Flag N+1 query patterns

For optimization: show EXPLAIN output interpretation if provided.
`,
  },

  // ── AUTOMATION ────────────────────────────────────────────────────────────────

  {
    slug: 'workflow-builder',
    name: 'Workflow Builder',
    description: 'Design automation workflows with triggers, conditions, and actions in plain language.',
    category: 'automation',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 8.5,
    usageCount: 0,
    tags: ['automation', 'workflow', 'n8n', 'zapier', 'trigger'],
    examples: ['Build a workflow that...', 'Automate this process', 'Create an automation for...'],
    content: `---
name: workflow-builder
description: "Design automation workflows with triggers, conditions, and actions."
---

# Workflow Builder

Design an automation workflow based on the user's description.

## Output Format
\`\`\`
Workflow: [Name]
Trigger: [What starts it]
Conditions: [If any filters apply]
Steps:
  1. [action] → [outcome]
  2. [action] → [outcome]
  ...
Error handling: [What happens if step N fails]
\`\`\`

After designing, offer to:
- Create this as a HiveClaw workflow (POST /workflows)
- Export as n8n JSON
- Provide webhook URL for trigger

For complex workflows: break into sub-workflows.
`,
  },

  {
    slug: 'cron-scheduler',
    name: 'Cron Scheduler',
    description: 'Generate, explain, and validate cron expressions with human-readable descriptions.',
    category: 'automation',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['cron', 'schedule', 'automation', 'time'],
    examples: ['Schedule this to run every day at 9am', 'What does this cron mean?', 'Create a cron for...'],
    content: `---
name: cron-scheduler
description: "Generate, explain, and validate cron expressions."
---

# Cron Scheduler

Help with cron expressions:

**Generate:** Natural language → cron expression
  - "every weekday at 9am" → \`0 9 * * 1-5\`
  - "every 15 minutes" → \`*/15 * * * *\`

**Explain:** Cron expression → human-readable description
  - \`0 0 * * 0\` → "Every Sunday at midnight"

**Validate:** Check if expression is valid, warn about edge cases

**Format:** Always show both standard (5-part) and extended (6-part with seconds) versions

Always specify timezone assumption. Warn about DST edge cases for hourly+ jobs.
`,
  },

  // ── CREATIVE ──────────────────────────────────────────────────────────────────

  {
    slug: 'content-writer',
    name: 'Content Writer',
    description: 'Write blog posts, social media content, product descriptions, and marketing copy.',
    category: 'creative',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['writing', 'content', 'blog', 'social-media', 'marketing', 'copy'],
    examples: ['Write a blog post about...', 'Create social media posts for...', 'Write product description for...'],
    content: `---
name: content-writer
description: "Write blog posts, social media content, and marketing copy."
---

# Content Writer

Produce written content based on user specifications.

**Ask if not provided:**
- Platform/format (blog, LinkedIn, Twitter/X, Instagram, product page)
- Tone (professional, casual, humorous, inspirational)
- Target audience
- Length/constraints
- Key message or call-to-action

**Formats available:**
- Blog post (intro + 3-5 sections + conclusion + CTA)
- LinkedIn post (insight-first, no hashtag spam, 150-300 words)
- Twitter/X thread (hook + 5-7 tweets + CTA)
- Product description (benefit-led, scannable, SEO-aware)
- Email newsletter (subject + preview + body + CTA)

Always: hook first, fluff last. Benefits over features.
`,
  },

  {
    slug: 'image-prompt',
    name: 'Image Prompt Engineer',
    description: 'Generate optimized prompts for DALL-E, Midjourney, Stable Diffusion, and Gemini image models.',
    category: 'creative',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['image', 'dall-e', 'midjourney', 'stable-diffusion', 'prompt', 'creative'],
    examples: ['Generate an image prompt for...', 'Create a Midjourney prompt for...'],
    content: `---
name: image-prompt
description: "Generate optimized image generation prompts for major models."
---

# Image Prompt Engineer

Generate optimized prompts for image generation models.

**Ask:** target model (DALL-E 3, Midjourney v6, SDXL, Gemini Imagen)

**Prompt structure (adapt per model):**
1. Subject description (what/who)
2. Style/medium (photography, oil painting, 3D render, etc.)
3. Lighting conditions
4. Color palette
5. Composition (wide shot, portrait, bird's eye, etc.)
6. Quality boosters (model-specific: "photorealistic", "--ar 16:9", "cfg_scale 7")
7. Negative prompt (SDXL only: what to exclude)

**Output:** Full prompt ready to copy, + 2 variations.

Safety: Do not generate prompts for real people, minors, violence, or NSFW content.
`,
  },

  // ── UTILITIES ─────────────────────────────────────────────────────────────────

  {
    slug: 'unit-converter',
    name: 'Unit Converter',
    description: 'Convert between any units: length, weight, temperature, currency, time zones, and more.',
    category: 'utilities',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 10,
    usageCount: 0,
    tags: ['convert', 'units', 'calculator', 'currency', 'timezone'],
    examples: ['Convert 100km to miles', 'What is 32°F in Celsius?', 'Convert $100 to BRL'],
    content: `---
name: unit-converter
description: "Convert between any units: length, weight, temperature, currency, timezone."
---

# Unit Converter

Convert between units instantly.

**Categories:**
- Length: mm, cm, m, km, inch, foot, yard, mile, nautical mile
- Weight: mg, g, kg, ton, ounce, pound, stone
- Temperature: °C, °F, K
- Volume: ml, L, fl oz, cup, pint, quart, gallon
- Speed: km/h, m/s, mph, knot
- Area: cm², m², km², ft², yd², acre, hectare
- Digital: bit, byte, KB, MB, GB, TB
- Time: seconds, minutes, hours, days, weeks, months, years
- Currency: Use live rates when web_search available, otherwise use approximate
- Timezone: Convert times between any IANA timezone

Format: "[value] [unit from] = [result] [unit to]"
Show inverse conversion too.
`,
  },

  {
    slug: 'regex-builder',
    name: 'Regex Builder',
    description: 'Build, explain, and test regular expressions with examples and edge cases.',
    category: 'utilities',
    badge: 'verified',
    version: '1.0.0',
    author: 'HiveClaw',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['regex', 'regexp', 'pattern', 'matching', 'developer'],
    examples: ['Build a regex for...', 'Explain this regex', 'Test this pattern against...'],
    content: `---
name: regex-builder
description: "Build, explain, and test regular expressions."
---

# Regex Builder

Help with regular expressions:

**Build:** Natural language → regex
- "Match email addresses" → \`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\`

**Explain:** Break down a regex into its components
  - Explain each group, quantifier, and anchor

**Test:** Show which strings match / don't match against examples

**Optimize:** Identify catastrophic backtracking, suggest fixes

Always:
- Show the regex in: JavaScript, Python, and Go variants (flags differ)
- Provide 3 positive + 3 negative test examples
- Warn about ReDoS (catastrophic backtracking) risks for user input
- Note Unicode/multiline flag requirements
`,
  },

  // ── SYSTEM / MACOS CONTROL ────────────────────────────────────────────────────

  {
    slug: 'macos-control',
    name: 'macOS Control',
    description: 'Full macOS control: mouse, keyboard, window management, screenshots, UI discovery, calibration. Requires cliclick via Homebrew.',
    category: 'system',
    badge: 'verified',
    version: '2.0.0',
    author: 'Clark 🐙 (rewritten from Zara macos-native-control, 12 vulns fixed)',
    securityScore: 9.2,
    usageCount: 0,
    tags: ['macos', 'mouse', 'keyboard', 'window', 'screenshot', 'ui', 'automation', 'calibration'],
    examples: ['Click on the Save button', 'Take a screenshot', 'Move window to left half', 'Type this text'],
    skillPath: '~/.hiveclaw/workspace/skills/macos-control',
    content: `---
name: macos-control
description: "Full macOS control via keyboard, mouse, window management, screenshots, and UI discovery."
---

# macOS Control

Full desktop automation for macOS agents.

## Scripts
- \`look.sh\` — Take screenshot, list windows, get screen info
- \`act.sh\` — Click, double-click, right-click, move mouse, drag
- \`keys.sh\` — Type text, press keys, keyboard shortcuts
- \`scroll.sh\` — Scroll up/down/left/right by amount
- \`window.sh\` — Resize, move, minimize, maximize, focus windows
- \`discover.sh\` — Find UI elements, get accessibility tree
- \`system.sh\` — Volume, brightness, notifications, open apps
- \`clipboard.sh\` — Read/write clipboard
- \`calibrate.sh\` — Auto-calibrate mouse coordinates

## Security
- All coordinates validated (max 8000px)
- App names whitelisted (alphanumeric only)
- URLs restricted to http/https
- Text input capped at 1000 chars
- No shell injection possible
`,
  },

  // ── AI-OPS ────────────────────────────────────────────────────────────────────

  {
    slug: 'self-learning',
    name: 'Self Learning',
    description: 'Auto-discovery and creation of new skills when gaps are detected. Searches workspace, web, audits for security, rewrites hardened versions.',
    category: 'ai-ops',
    badge: 'verified',
    version: '2.0.0',
    author: 'Clark 🐙',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['self-learning', 'meta', 'skills', 'auto-improve', 'gap-detection', 'ai-ops'],
    examples: ['I need a skill to do X', 'Find a skill for Y', 'Create a new skill for Z'],
    skillPath: '~/.hiveclaw/workspace/skills/self-learning',
    content: `---
name: self-learning
description: "Auto-discovery and creation of new skills when agent gaps are detected."
---

# Self Learning

When you encounter a limitation or capability gap, run this 5-step process:

## Process
1. **Detect & Log** — \`log-gap.sh "<gap>" "<description>" <priority>\`
2. **Search Workspace** — \`search-workspace.sh "<keyword>"\` — checks ALL hiveclaw/openclaw workspaces generically
3. **Search Web** — Use webfetch to search GitHub, AgentSkills, npm for best-in-class implementations
4. **Security Audit** — \`audit-skill.sh <skill_dir>\` — MANDATORY, 12 security checks
5. **Create/Rewrite** — \`create-skill.sh\` + harden + \`persist-skill-memory.sh\`

## Key principle
Search is GENERIC — not agent-specific. Searches entire workspace ecosystem.
Never install a skill that fails audit. Rewrite if needed.

## Gap log
Stored in \`~/.hiveclaw/workspace/skills/self-learning/.learnings/GAPS.md\`
`,
  },

  // ── QA ────────────────────────────────────────────────────────────────────────

  {
    slug: 'ui-qa',
    name: 'UI QA',
    description: 'Frontend and UI quality assurance with Playwright: visual regression, accessibility, performance, cross-browser testing.',
    category: 'qa',
    badge: 'verified',
    version: '2.0.0',
    author: 'Clark 🐙',
    securityScore: 9.3,
    usageCount: 0,
    tags: ['qa', 'testing', 'playwright', 'ui', 'frontend', 'accessibility', 'visual-regression', 'performance'],
    examples: ['Test the login flow', 'Check accessibility of this page', 'Visual regression test', 'Performance audit'],
    skillPath: '~/.hiveclaw/workspace/skills/ui-qa',
    content: `---
name: ui-qa
description: "Frontend/UI QA with Playwright: visual, accessibility, performance, cross-browser."
---

# UI QA Skill

Comprehensive frontend quality assurance.

## Scripts
- \`snapshot.sh <url>\` — Full page screenshot + visual diff
- \`accessibility.sh <url>\` — WCAG 2.1 compliance check (axe-core)
- \`performance.sh <url>\` — Core Web Vitals (LCP, CLS, FID, TTFB)
- \`flow-test.sh <url> <script>\` — Run Playwright test script
- \`cross-browser.sh <url>\` — Test on Chromium, Firefox, WebKit
- \`mobile.sh <url>\` — Mobile viewport simulation (iPhone, Android)
- \`report.sh\` — Aggregate HTML report of all QA results

## Modes
- **smoke** — Quick sanity check (load, no JS errors, basic interactions)
- **full** — All checks (visual + a11y + perf + cross-browser)
- **ci** — Headless, JSON output, exit code for CI/CD pipelines
`,
  },

  // ── COMMUNICATION (voice + agent messaging) ───────────────────────────────────

  {
    slug: 'voice-tts-stt',
    name: 'Voice TTS/STT',
    description: 'Bidirectional voice I/O: Text-to-Speech via Gemini TTS (pt-BR/EN, free) with macOS fallback, Speech-to-Text via whisper.cpp (local, offline, private).',
    category: 'communication',
    badge: 'verified',
    version: '2.0.0',
    author: 'Clark 🐙 (from gemini-tts + whisper-local, OpenClaw workspace)',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['voice', 'tts', 'stt', 'speech', 'whisper', 'gemini', 'audio', 'pt-BR', 'offline'],
    examples: ['Say this out loud', 'Transcribe this audio file', 'Convert text to speech', 'Voice note to text'],
    skillPath: '~/.hiveclaw/workspace/skills/voice-tts-stt',
    content: `---
name: voice-tts-stt
description: "TTS via Gemini + STT via whisper.cpp. Offline fallback via macOS say."
---

# Voice TTS/STT

## TTS (Text → Audio)
\`\`\`bash
./scripts/tts.sh "Olá mundo"              # Gemini TTS (online)
./scripts/tts.sh "Hello" --voice Charon   # Specific voice
./scripts/tts.sh "Text" --offline         # macOS say (offline)
./scripts/tts.sh "Text" --out audio.mp3   # Save to file
\`\`\`

## STT (Audio → Text)
\`\`\`bash
./scripts/stt.sh audio.ogg               # Transcribe (auto-detect language)
./scripts/stt.sh audio.mp3 --language pt # Force Portuguese
./scripts/stt.sh audio.m4a --model small # Higher accuracy
./scripts/stt.sh audio.wav --json        # JSON output
\`\`\`

## Fallback chain
TTS: Gemini API → macOS say
STT: whisper.cpp (local) — no fallback, private by design
`,
  },

  {
    slug: 'image-analysis',
    name: 'Image Analysis',
    description: 'Analyze images, screenshots, diagrams, and UI using vision LLMs (Claude, GPT-4V, Gemini). Supports OCR, UI QA, diagram interpretation.',
    category: 'utilities',
    badge: 'verified',
    version: '2.0.0',
    author: 'Clark 🐙',
    securityScore: 9.5,
    usageCount: 0,
    tags: ['image', 'vision', 'ocr', 'screenshot', 'ui', 'diagram', 'claude', 'gpt4v', 'gemini'],
    examples: ['What is in this image?', 'Extract text from screenshot', 'Analyze this UI', 'Interpret this diagram'],
    skillPath: '~/.hiveclaw/workspace/skills/image-analysis',
    content: `---
name: image-analysis
description: "Vision LLM analysis: describe, OCR, UI QA, diagram interpretation."
---

# Image Analysis

\`\`\`bash
./scripts/analyze.sh screenshot.png              # Describe image
./scripts/analyze.sh image.jpg --mode ocr        # Extract text
./scripts/analyze.sh ui.png --mode ui-qa         # UI quality check
./scripts/analyze.sh diagram.png --mode diagram  # Interpret diagram
./scripts/analyze.sh img.jpg --prompt "Find all buttons"  # Custom prompt
./scripts/analyze.sh https://example.com/img.png # From URL
\`\`\`

## Provider auto-detection (priority order)
1. Anthropic (Claude) — best for detailed analysis
2. OpenAI (GPT-4o) — strong alternative
3. Gemini 1.5 Pro — free fallback
`,
  },

  {
    slug: 'agent-messaging',
    name: 'Agent Messaging',
    description: 'Authenticated agent-to-agent messaging with HMAC-SHA256 signatures. Prevents impersonation in squad communications.',
    category: 'communication',
    badge: 'verified',
    version: '1.0.0',
    author: 'Clark 🐙',
    securityScore: 9.0,
    usageCount: 0,
    tags: ['agent', 'messaging', 'auth', 'squad', 'hmac', 'a2a', 'cross-agent', 'security'],
    examples: ['Send message to Alice', 'Broadcast to squad', 'Verified agent communication'],
    skillPath: '~/.hiveclaw/workspace/skills/agent-messaging',
    content: `---
name: agent-messaging
description: "HMAC-SHA256 authenticated agent-to-agent messaging."
---

# Agent Messaging

Solves the agent impersonation gap in squad communications.

\`\`\`bash
# Send authenticated message
./scripts/send.sh \\
  --from "<your-agent-id>" \\
  --to "<target-agent-id>" \\
  --session "<session-id>" \\
  --message "Analysis complete: score 6.9/10"

# Broadcast to squad
./scripts/broadcast.sh \\
  --squad "<squad-id>" \\
  --from "<your-agent-id>" \\
  --message "Report ready for review"
\`\`\`

## Security
- HMAC-SHA256 signature on every message
- Timestamp replay protection (±5min window)
- UUID validation on all IDs
- Secret via env var only (HIVECLAW_AGENT_SECRET)
`,
  },

];

// ─── Default Skills (Starter Pack) ──────────────────────────────────────────────
//
// These skills are automatically assigned to every new agent created in HiveClaw.
// They form the baseline capability set — agents can add more from CURATED_SKILLS.
//
export const DEFAULT_SKILLS: string[] = [
  'self-learning',    // Auto-expand capabilities when gaps detected
  'macos-control',    // Desktop automation (macOS)
  'ui-qa',            // Frontend QA and visual testing
  'voice-tts-stt',    // Voice I/O (TTS + STT)
  'image-analysis',   // Vision LLM for images/screenshots
  'agent-messaging',  // Authenticated agent-to-agent comms
  'web-researcher',   // Web search and research
  'code-review',      // Code quality and security review
  'debug-assistant',  // Systematic debugging
  'task-extractor',   // Extract action items from conversations
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

export function getSkillBySlug(slug: string): CuratedSkill | undefined {
  return CURATED_SKILLS.find(s => s.slug === slug);
}

export function getSkillsByCategory(category: SkillCategory): CuratedSkill[] {
  return CURATED_SKILLS.filter(s => s.category === category);
}

export function searchSkills(query: string): CuratedSkill[] {
  const q = query.toLowerCase();
  return CURATED_SKILLS.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.tags.some(t => t.includes(q)) ||
    s.category.includes(q),
  );
}

export function getCategoryStats(): Record<SkillCategory, number> {
  const stats = {} as Record<SkillCategory, number>;
  for (const skill of CURATED_SKILLS) {
    stats[skill.category] = (stats[skill.category] ?? 0) + 1;
  }
  return stats;
}

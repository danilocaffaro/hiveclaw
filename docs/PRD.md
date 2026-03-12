# SuperClaw Pure — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-03-11
**Author:** Alice 🐕 (PO) + Danilo C (Founder)

---

## 1. Vision

**SuperClaw Pure** is a standalone, user-agnostic AI agent platform that anyone can install and start using in under 5 minutes. It combines the best ideas from OpenClaw, CoWork-OS, and Spacebot into a clean, web-first experience with its own LLM engine, structured memory, and governed execution.

**One-liner:** *The personal AI assistant that actually works out of the box.*

### Non-Goals (v1)
- Multi-user / community features (that's Spacebot's niche)
- Mobile native app (PWA is sufficient)
- Cloud-hosted SaaS (self-hosted only for v1)
- Marketplace / paid skills

---

## 2. User Personas

### P1: "The Curious" (Beginner)
- Heard about AI agents, wants to try
- Not a developer, doesn't know what LLM means
- Needs: one-click install, guided setup, immediate value
- Pain: "I tried OpenClaw and gave up after 2 days"

### P2: "The Power User" (Advanced)
- Running OpenClaw or similar for months
- Has custom skills, complex workflows, multiple channels
- Needs: smart routing, persistent memory, cost control
- Pain: "Token burn, context amnesia, agent loops"

### P3: "The Builder" (Developer)
- Wants to extend, build custom tools, contribute
- Needs: clean API, plugin system, good docs
- Pain: "Codebase feels vibe-coded, hard to contribute"

---

## 3. Small Batch Delivery Plan

### Batch 0: Foundation (Sprint 1-2) — "It exists"
> Goal: Repo, skeleton, basic chat working with one LLM provider

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S001 | Create GitHub repo with monorepo structure | `packages/core`, `packages/server`, `packages/web`, `packages/cli` |
| S002 | CLI: `npx superclaw` starts the server | Server binds to port, opens browser |
| S003 | Setup Wizard: first-run experience | Step-by-step: name → provider → API key → first agent → done |
| S004 | Single LLM adapter (OpenAI-compatible) | Send message, get response, stream to UI |
| S005 | Basic chat UI | Message list, input, send, streaming response |
| S006 | SQLite database initialization | Auto-create DB with schema on first run |

### Batch 1: Engine Core (Sprint 3-4) — "It's useful"
> Goal: Multiple providers, basic tools, session persistence

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S007 | Multi-provider LLM adapter | OpenAI, Anthropic, Ollama, Google | configurable per agent |
| S008 | 3-tier smart routing | Cheap (heartbeat/cron), Standard (chat), Premium (complex tasks) |
| S009 | Tool system: web_search, web_fetch, exec | Sandboxed execution with approval for dangerous ops |
| S010 | Session persistence | Close browser → reopen → conversation is there |
| S011 | Agent CRUD | Create, edit, delete agents with name, emoji, system prompt, model |
| S012 | Settings UI | Providers, models, general config — all from web UI |

### Batch 2: Memory & Intelligence (Sprint 5-6) — "It remembers"
> Goal: Structured memory that survives compaction, playbook system

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S013 | Typed memory graph | 6 types: Fact, Preference, Decision, Goal, Todo, Event |
| S014 | Memory edges | RelatedTo, Updates, Contradicts — auto-managed by LLM |
| S015 | Vector search (SQLite vec) | Semantic recall from memory graph |
| S016 | Full-text search | Keyword-based recall (complement to vector) |
| S017 | Memory UI panel | Browse, search, edit, delete memories |
| S018 | Playbook capture | After successful task → auto-extract pattern → save |

### Batch 3: Background & Automation (Sprint 7-8) — "It works while you sleep"
> Goal: Persistent jobs, cron, circuit breaker, notifications

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S019 | Persistent job queue | Tasks survive server restart |
| S020 | Cron system with active hours | "Check email every 30min, only 9am-6pm" |
| S021 | Circuit breaker | 3 consecutive failures → auto-disable job |
| S022 | Push notifications (web) | Browser notification when job completes or needs attention |
| S023 | Approval workflow | Dangerous actions pause → user approves/rejects from UI |
| S024 | Job timeline | Visual timeline of all running/completed jobs |

### Batch 4: Multi-Agent & Squads (Sprint 9-10) — "They work together"
> Goal: Multiple agents, squads, @mention routing

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S025 | Multi-agent dispatch | Fan-out message to multiple agents |
| S026 | Squad creation & management | Create squads with selected agents |
| S027 | @mention routing (ARCHER v2) | @agent routes to specific agent |
| S028 | Concurrent worker execution | 2+ agents working in parallel on different tasks |
| S029 | Squad chat UI | Group chat view with agent avatars and responses |
| S030 | Agent-to-agent delegation | Agent can spawn sub-task to another agent |

### Batch 5: Extensibility (Sprint 11-12) — "Anyone can extend it"
> Goal: Skills, MCP, tool plugins, API

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S031 | Skill system (SKILL.md compatible) | Load skills from `skills/` directory |
| S032 | Skill store UI | Browse, install, update skills from registry |
| S033 | MCP client | Connect to external MCP servers (stdio + HTTP) |
| S034 | Custom tool registration API | POST /tools/register with schema |
| S035 | REST API with OpenAPI spec | Full API documentation, Swagger UI |
| S036 | Webhook system | Inbound webhooks trigger agent actions |

### Batch 6: Dashboard & Observability (Sprint 13-14) — "You see everything"
> Goal: Usage tracking, cost analytics, activity monitoring

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S037 | Token/cost tracking per session | Track input/output tokens, calculate cost |
| S038 | Usage dashboard | Charts: daily cost, token usage, model breakdown |
| S039 | Activity heatmap | When is the system most active? |
| S040 | Agent performance metrics | Success rate, avg response time, error rate |
| S041 | Export data (CSV/JSON) | Download usage data for analysis |
| S042 | Health monitoring | System status, LLM provider health, uptime |

### Batch 7: Channel Plugins (Sprint 15-16) — "Chat from anywhere"
> Goal: Connect external channels (Telegram, WhatsApp, Discord)

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S043 | Channel plugin architecture | Plugin interface for inbound/outbound messaging |
| S044 | Telegram plugin | Send/receive via Telegram bot |
| S045 | WhatsApp plugin (via Baileys) | Send/receive via WhatsApp |
| S046 | Discord plugin | Send/receive via Discord bot |
| S047 | Public chat (shareable links) | Generate link, guest can chat without account |
| S048 | Channel management UI | Connect/disconnect channels, see status |

### Batch 8: Polish & Ship (Sprint 17-18) — "Ready for the world"
> Goal: Documentation, onboarding, stability, v1.0 release

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| S049 | Documentation site | Getting started, API reference, skill authoring guide |
| S050 | Video walkthrough | 5-min setup video embedded in README |
| S051 | Migration guide from OpenClaw | Step-by-step: export OC data → import into SuperClaw |
| S052 | Docker image | `docker run -p 4070:4070 superclaw/pure` |
| S053 | Performance audit | < 100ms API responses, < 2s first paint |
| S054 | Security audit | OWASP top 10, dependency audit, sandboxed exec review |
| S055 | v1.0 release | GitHub release, npm publish, announcement |

---

## 4. Setup Wizard (Detail for Batch 0)

### Screen 1: Welcome
```
Welcome to SuperClaw ✨

Your personal AI assistant platform.
Let's get you set up in 3 easy steps.

[Get Started →]
```

### Screen 2: Choose your LLM
```
Where should your AI brain live?

◉ OpenAI (GPT-5, GPT-4o)          ← Most popular
○ Anthropic (Claude Sonnet, Opus)  ← Best for complex tasks
○ Google (Gemini Pro, Flash)       ← Free tier available
○ Ollama (Local, free, private)    ← No API key needed
○ OpenRouter (Access all models)   ← One key, all models

[Need help choosing?] → expandable comparison table

API Key: [________________] 🔑
[Verify & Continue →]
```

### Screen 3: Create your first agent
```
Let's create your first AI agent!

Name: [________________]  (e.g., "Atlas", "Friday", "Jarvis")
Emoji: [🤖] (click to pick)

What should this agent be good at?
□ General assistant (default)
□ Coding & development
□ Research & analysis  
□ Writing & content
□ Custom... [describe in a sentence]

[Create Agent →]
```

### Screen 4: Done!
```
🎉 You're all set!

Your agent [Atlas 🤖] is ready to chat.

Pro tips:
• Type naturally — your agent understands context
• Use @mentions in squads to direct messages
• Check Settings for advanced configuration

[Start Chatting →]
```

---

## 5. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Easier contributions than Rust, proven in 57 sprints |
| Runtime | Node.js 22+ | LTS, native ESM, good perf |
| Server | Fastify 5 | Proven, fast, plugin system |
| Frontend | Next.js 15 (static export) | SPA + PWA, no SSR needed |
| Database | SQLite (better-sqlite3) | Zero config, embedded, fast |
| Vectors | sqlite-vec extension | No separate vector DB needed |
| State | Zustand | Proven in SuperClaw, lightweight |
| Styling | CSS variables + inline | No CSS framework dependency |
| Package manager | pnpm | Fast, disk efficient, workspace support |
| Monorepo | pnpm workspaces | Simple, no turborepo overhead |
| License | MIT | Maximum adoption |
| LLM Adapter | Universal (OpenAI Chat Completions as base) | 90% of providers are OAI-compatible |

---

## 6. Success Metrics

| Metric | Target | How |
|--------|--------|-----|
| Time to first message | < 5 min | Setup wizard timed test |
| Setup completion rate | > 80% | Track wizard step completion |
| Daily active users (self-reported) | 100+ by month 3 | GitHub stars + Discord |
| Token cost reduction vs OpenClaw | > 50% | Smart routing benchmark |
| Memory recall accuracy | > 85% | Structured memory vs flat file test |
| GitHub stars | 500+ by month 3 | Organic + launch push |
| Test coverage | > 80% | CI enforced |

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Feature creep | Delays launch | Strict batch gates — QA >95% before next batch |
| Competing with OpenClaw community | Fragmentation | Compatibility layer (import skills, import memory) |
| Single maintainer burnout | Stall | Open source from day 1, contributor-friendly |
| LLM API breaking changes | Runtime failures | Adapter pattern + version pinning |
| SQLite scaling limits | Perf at scale | Sufficient for single-user; PostgreSQL adapter in v2 |

---

## 8. Timeline (Estimate)

| Batch | Sprints | Duration | Milestone |
|-------|---------|----------|-----------|
| 0: Foundation | 1-2 | 1 week | Repo + basic chat |
| 1: Engine Core | 3-4 | 1 week | Multi-provider + tools |
| 2: Memory | 5-6 | 1 week | Structured memory |
| 3: Background | 7-8 | 1 week | Cron + jobs |
| 4: Multi-Agent | 9-10 | 1 week | Squads |
| 5: Extensibility | 11-12 | 1 week | Skills + MCP |
| 6: Dashboard | 13-14 | 1 week | Analytics |
| 7: Channels | 15-16 | 1 week | Telegram/WhatsApp/Discord |
| 8: Polish & Ship | 17-18 | 1 week | v1.0 release |
| **Total** | **18 sprints** | **~9 weeks** | **v1.0** |

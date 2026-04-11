# 🏗️ Architecture

> Technical overview for developers who want to understand or contribute to HiveClaw.

---

## System Overview

```
┌─────────────────────────────────────────────────┐
│                   HiveClaw                       │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Web UI   │  │ Desktop  │  │   Channels    │  │
│  │ (Next.js) │  │(Electron)│  │ TG/WA/Discord │  │
│  └─────┬─────┘  └─────┬────┘  └──────┬───────┘  │
│        │              │               │          │
│        └──────────┬───┘───────────────┘          │
│                   │                              │
│           ┌───────▼────────┐                     │
│           │  Fastify Server │  ← Port 4070       │
│           │   (REST API)    │                     │
│           └───────┬────────┘                     │
│                   │                              │
│     ┌─────────────┼─────────────┐                │
│     │             │             │                │
│  ┌──▼───┐  ┌─────▼─────┐  ┌───▼────┐           │
│  │Engine │  │  Memory    │  │ Tools  │           │
│  │(LLM)  │  │  System    │  │(25+)   │           │
│  └──┬───┘  └─────┬─────┘  └───┬────┘           │
│     │             │             │                │
│     └─────────────┼─────────────┘                │
│                   │                              │
│           ┌───────▼────────┐                     │
│           │    SQLite DB    │  ← WAL mode        │
│           │ (~/.hiveclaw/)  │                     │
│           └────────────────┘                     │
└─────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
hiveclaw/
├── apps/
│   ├── web/          # Next.js static export (React 18, TypeScript)
│   ├── server/       # Fastify + better-sqlite3
│   └── desktop/      # Electron wrapper
├── packages/
│   └── shared/       # Shared types, utilities
├── docs/             # Documentation (you are here)
├── .env.example      # Environment template
├── pnpm-workspace.yaml
└── package.json      # Root — build/test/start scripts
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **SQLite (not PostgreSQL)** | Zero ops, single file, WAL for concurrency. Perfect for self-hosted. |
| **Static export (not SSR)** | Serve from anywhere — CDN, Electron, file://. No Node.js runtime needed for UI. |
| **Inline styles (not Tailwind)** | 82 TSX files, all inline CSS variables. Keeps bundle simple. |
| **Fastify (not Express)** | Faster, better TypeScript support, schema validation. |
| **pnpm (not npm/yarn)** | Faster installs, strict dependency resolution, workspace support. |

---

## Server Architecture

### Entry Point
`apps/server/src/index.ts` → starts Fastify, registers routes, connects DB.

### Route Organization
Routes are organized by domain in `apps/server/src/routes/`:

| Module | Endpoints | Responsibility |
|--------|-----------|---------------|
| `agents.ts` | CRUD agents | Agent management |
| `sessions.ts` | CRUD sessions + messaging | Conversations |
| `messages.ts` | Message history | Message retrieval |
| `memory.ts` | Agent memory CRUD + search | Persistent memory |
| `skills.ts` | Skill management | Agent capabilities |
| `squads.ts` | Squad CRUD + routing | Multi-agent teams |
| `channels.ts` | Channel connections | Telegram/WA/Discord |
| `nodes.ts` | Remote device management | Node control |
| `auth.ts` | Users, sessions, API keys | Authentication |
| `health.ts` | Server health | Monitoring |
| `tools.ts` | Tool registry | Available tools |

### Request Flow

```
Client → Fastify → Auth middleware → Route handler → Service → DB/LLM → Response
```

For chat messages:
```
POST /sessions/{id}/message
  → Validate session + agent
  → Load agent config (model, prompt, memory, skills)
  → Build message context (history + core memory + skills)
  → Call LLM provider (with fallback chain)
  → Parse response (extract tool calls, memory ops)
  → Execute tool calls (if any)
  → Store message + memory updates
  → Return response (+ stream if SSE)
```

---

## Engine (LLM Integration)

### Provider Abstraction

Each provider implements a common interface:

```typescript
interface LLMProvider {
  id: string;
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncIterable<ChatChunk>;
  listModels(): Promise<Model[]>;
}
```

### Supported Providers

| Provider | Module | Auth |
|----------|--------|------|
| Anthropic | `providers/anthropic.ts` | `ANTHROPIC_API_KEY` |
| OpenAI | `providers/openai.ts` | `OPENAI_API_KEY` |
| GitHub Copilot | `providers/github-copilot.ts` | `GITHUB_TOKEN` |
| Google AI | `providers/google.ts` | `GEMINI_API_KEY` |
| Ollama | `providers/ollama.ts` | `OLLAMA_URL` (no key) |

### Fallback Chain

If the primary provider fails, HiveClaw tries fallbacks in order:

```
Primary → Fallback 1 → Fallback 2 → Error
```

Configured per-agent via `fallbackProviders` array.

### Tool Calling

The engine supports function calling / tool use:

1. Agent declares available tools in the system prompt
2. LLM returns a tool call in its response
3. Engine executes the tool (bash, web_search, memory, etc.)
4. Result is fed back to the LLM
5. LLM generates final response

Currently 25 tools available (see `GET /api/tools`).

---

## Database

### SQLite + WAL Mode

- **File:** `~/.hiveclaw/hiveclaw.db`
- **Mode:** WAL (Write-Ahead Logging) — allows concurrent reads during writes
- **Driver:** `better-sqlite3` (synchronous, fast, no async overhead)

### Schema (v8)

Key tables:

| Table | Purpose |
|-------|---------|
| `agents` | Agent configurations |
| `sessions` | Conversation sessions |
| `messages` | Chat messages |
| `memories` | Agent long-term memory |
| `core_memories` | Core memory blocks (persona, human, project, scratchpad) |
| `skills` | Skill definitions |
| `squads` | Squad configurations |
| `squad_agents` | Agent ↔ Squad relationships |
| `channels` | External channel configs |
| `nodes` | Remote device registry |
| `users` | User accounts |
| `api_keys` | Authentication tokens |

### Migrations

Schema migrations are in `apps/server/src/db/migrations/`. They run automatically on startup.

> ⚠️ **Never reset the DB between deploys.** Migrations are additive — they preserve existing data.

> ⚠️ **SQLite CLI note:** `sqlite3` CLI cannot see WAL uncommitted writes. Use the API to query live data.

---

## Frontend Architecture

### Stack
- **React 18** with TypeScript
- **Next.js** (static export mode — `NEXT_OUTPUT=export`)
- **Inline CSS** with CSS custom properties (no Tailwind)
- **No external component library** — custom components

### Design System

CSS custom properties for theming:

```css
:root {
  --color-bg-primary: #0f1117;
  --color-bg-secondary: #1a1d27;
  --color-text-primary: #e8e8e8;
  --color-accent: #f59e0b;
  /* ... */
}
```

7 built-in themes (see `apps/web/src/styles/themes.ts`).

### UI Conventions

| Element | Style |
|---------|-------|
| User chat bubbles | Blue (cool tones) |
| Agent chat bubbles | Amber (warm tones) |
| Actions/buttons | Accent color |
| Sidebar | Dark background |

---

## Memory Architecture

### Two-Tier System

**Core Memory** (always in context):
- 4 blocks: `persona`, `human`, `project`, `scratchpad`
- 2500 char limit per block
- Always injected into the system prompt

**Agent Memory** (searchable):
- Unlimited entries
- Types: fact, correction, decision, goal, preference, entity, event, procedure
- Full-text search via FTS5
- Tagged and timestamped

### Memory Flow

```
Conversation → Agent creates memory → Stored in DB
                                    ↓
Next conversation → Core memory injected in prompt
                  → Agent searches relevant memories
                  → Context-enriched response
```

---

## Security Model

### Authentication
- **Local:** Username + password (bcrypt hashed)
- **API Keys:** Bearer token auth (`Authorization: Bearer hcw_xxx`)
- **OAuth tokens:** Support for `sk-ant-oat*` prefix tokens

### Sandboxing
- Tool execution is sandboxed (no arbitrary system access)
- Node commands have risk tiers (0-4)
- Channel configs support `allowedUsers`
- No credentials stored in plaintext (env vars only)

### Network
- Server binds to `localhost` by default
- External access requires explicit `HOST=0.0.0.0`
- Channels use polling (not webhooks) by default — no inbound ports needed

---

## Development

### Local Development

```bash
# Start server with hot reload
pnpm dev

# Start frontend with hot reload (separate terminal)
pnpm dev:web

# Run tests
pnpm test

# Type check
pnpm typecheck
```

### Testing

- **Framework:** Vitest
- **Tests:** 229+ tests in `apps/server/src/__tests__/`
- **Coverage:** API routes, engine, memory, tools

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm --filter @hiveclaw/server test -- agents.test.ts

# Watch mode
pnpm --filter @hiveclaw/server test -- --watch
```

### Git Workflow

- Branch: `main` (direct commits for now)
- Commits: descriptive messages
- Build must compile with 0 TypeScript errors
- All 229+ tests must pass before push

---

*HiveClaw v1.3 — [Getting Started](GETTING-STARTED.md) | [User Guide](USER-GUIDE.md) | [API Reference](API.md)*

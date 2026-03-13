# SuperClaw Pure

> Your private AI assistant — multi-agent, multi-model, runs anywhere.

SuperClaw Pure is a self-hosted personal AI assistant with native LLM support, conversation memory, and a curated skill library. No cloud dependency, no vendor lock-in — just you and your models.

## Features

- 🧠 **Multi-Model** — OpenAI, Anthropic, Google, Ollama, OpenRouter, and any OpenAI-compatible API
- 🤖 **Multi-Agent** — Create specialized agents with custom personas and skills
- 💬 **Chat Interface** — WhatsApp-like mobile experience + desktop layout
- 🧩 **18 Curated Skills** — Productivity, coding, search, communication, data, automation, creative, utilities
- 🔒 **Self-Hosted** — Your data stays on your hardware. SQLite database, zero external dependencies
- 📊 **Usage Dashboard** — Token usage, costs, model routing analytics
- 🔌 **External Channels** — Send/receive via Telegram, Discord, Slack, and webhooks
- 🧬 **Eidetic Memory** — 5-layer memory system with FTS5 search, knowledge graph, and working memory
- 🛡️ **Security Hardened** — Workspace sandbox, auth middleware, command blocking, circuit breaker
- 🐳 **Docker Ready** — `docker compose up` and you're running

## Quick Start

### Option 1: Node.js

```bash
# Prerequisites: Node.js 22+, pnpm
git clone https://github.com/danilocaffaro/superclaw-pure.git
cd superclaw-pure
pnpm install
pnpm build
pnpm start
# Open http://localhost:4070
```

### Option 2: Docker

```bash
docker run -d \
  --name superclaw \
  -p 4070:4070 \
  -v superclaw-data:/data \
  ghcr.io/danilocaffaro/superclaw-pure:latest
# Open http://localhost:4070
```

Or with Docker Compose:

```bash
docker compose up -d
# Open http://localhost:4070
```

## First Run

1. Open `http://localhost:4070` in your browser
2. The **Setup Wizard** will guide you through:
   - Creating your user account
   - Adding your first LLM provider (API key)
   - Creating your first agent
3. Start chatting!

## Architecture

```
superclaw-pure/
├── apps/
│   ├── server/     # Fastify + better-sqlite3 (port 4070)
│   └── web/        # Next.js static export (SPA)
├── config/         # Pricing, defaults, security
├── docs/           # Architecture docs, PRD, research
└── docker-compose.yml
```

### Server Stack
- **Runtime**: Node.js 22 (ESM)
- **Framework**: Fastify v5
- **Database**: SQLite via better-sqlite3 (zero config)
- **LLM**: Native streaming via `chat-engine.ts` (no SDK dependencies)
- **Memory**: 5-layer Eidetic Memory (session buffer → working memory → knowledge graph → FTS5 archival)
- **Routing**: Quality-aware model routing with 50+ model quality scores

### Frontend Stack
- **Framework**: Next.js 15 (static export)
- **State**: Zustand
- **Styling**: Tailwind CSS
- **Mobile**: Separate `MobileApp.tsx` with WhatsApp-style stack navigation

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4070` | Server port |
| `NODE_ENV` | No | `development` | `production` enables auth |
| `SUPERCLAW_DB_PATH` | No | `~/.superclaw/superclaw.db` | SQLite DB location |
| `SUPERCLAW_WEB_DIR` | No | auto-detected | Path to static frontend |
| `SUPERCLAW_WORKSPACE` | No | `./workspace` | Agent workspace directory |

### Provider Setup

Add providers via the Settings UI or API:

```bash
# Add OpenAI
curl -X POST http://localhost:4070/api/config/providers \
  -H "Content-Type: application/json" \
  -d '{"id":"openai","name":"OpenAI","type":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'
```

Supported providers: OpenAI, Anthropic, Google (Gemini), Ollama, OpenRouter, Groq, DeepSeek, Mistral, and any OpenAI-compatible endpoint.

## Memory System

SuperClaw uses a 5-layer memory architecture:

| Layer | Purpose | Persistence |
|-------|---------|-------------|
| **L1 Core** | Agent identity, persona, project notes | Permanent, agent-editable |
| **L2 Buffer** | Current conversation window | Session-scoped, auto-compacted |
| **L3 Working** | Task state between compactions | Cross-session, structured |
| **L4 Graph** | Facts, decisions, goals, entities | Permanent, knowledge graph with edges |
| **L5 Archival** | Full chat history (FTS5 indexed) | Unlimited, searchable |

## Security

- **Workspace sandbox**: File operations restricted to workspace root
- **Auth middleware**: API key required in production mode
- **Command blocking**: 25+ dangerous shell patterns blocked
- **Circuit breaker**: Auto-disables failing providers (3 strikes, 30min cooldown)
- **Loop detection**: Jaccard similarity check prevents infinite response loops
- **Security headers**: CSP, HSTS, X-Frame-Options, etc.

## API

Full REST API at `http://localhost:4070`:

| Endpoint | Description |
|----------|-------------|
| `GET /agents` | List agents |
| `POST /sessions` | Create chat session |
| `POST /sessions/:id/message` | Send message (SSE streaming) |
| `GET /marketplace/curated` | Browse skill library |
| `GET /channels` | List external channels |
| `GET /analytics/overview` | Usage dashboard data |
| `GET /memory/search?q=...` | Search memory graph |

See `docs/` for full API documentation.

## Development

```bash
# Dev mode (hot reload)
pnpm dev        # Server
pnpm dev:web    # Frontend

# Type checking
pnpm typecheck

# Tests
pnpm test

# Build
pnpm build
```

## License

MIT

## Credits

Built with ❤️ by the SuperClaw team.

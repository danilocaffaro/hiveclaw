# 🐝 HiveClaw

> Your private AI assistant — multi-agent, multi-model, self-hosted. Runs anywhere.

HiveClaw is a self-hosted personal AI platform with a native LLM engine, deep agent memory, and squad orchestration. No cloud dependency, no vendor lock-in — your data stays on your hardware.

## ✨ What Makes HiveClaw Different

### 🧠 Agent Identity System (Core Memory)
Every agent has persistent identity blocks that shape who they are — not just a system prompt. Agents know themselves, know you, and know the context they work in.

| Block | Purpose |
|-------|---------|
| 🎭 **Persona** | Who the agent is — personality, communication style, strengths |
| 👤 **Human** | Who you are — preferences, timezone, working style (learned over time) |
| 📁 **Context** | What you work on — business, project, routine, any domain |
| 📝 **Scratchpad** | Working notes — decisions, current state, things to remember |

These blocks are injected into every prompt automatically and persist across sessions. New agents get starter blocks on creation, then learn and adapt. You can edit them anytime via the UI.

### 🐝 Squad Orchestration
Multiple agents working together as a team. Sequential, round-robin, specialist, or debate routing. Agents can @mention each other, delegate tasks, and build on each other's work.

### 🧬 10-Layer Eidetic Memory
Not just chat history — a full cognitive architecture:

| Layer | What It Does |
|-------|-------------|
| Core Memory | Always-in-prompt identity (persona, human, context, scratchpad) |
| Session Buffer | Current conversation window |
| Working Memory | Structured task state across sessions |
| Episodic Memory | Key moments and consolidated insights |
| Knowledge Graph | Facts, entities, relationships with typed edges |
| FTS5 Archival | Full-text search across all history |
| Semantic Search | Vector similarity via sqlite-vec embeddings |
| Hybrid Search | RRF fusion of FTS5 + semantic for best results |
| Auto-Compaction | LLM-powered context compression when windows fill |
| Session Consolidation | End-of-session fact extraction into long-term memory |

### 🛡️ Smart Agents, Not Restricted Agents
No artificial command blocklists. Instead, agents have **Operational Awareness** — they understand their environment, know what's safe to do, and make intelligent decisions. Like giving someone training instead of handcuffs.

## Features

- 🤖 **Multi-Agent** — Create specialized agents with custom personas, skills, and core memory
- 🧠 **Multi-Model** — Anthropic (+ OAuth/Max plans), OpenAI, Google, Ollama, OpenRouter, any OpenAI-compatible API
- 💬 **Chat Interface** — WhatsApp-like mobile experience + full desktop layout
- 🐝 **Squad System** — Multi-agent teams with 4 routing strategies
- 🧬 **10-Layer Memory** — From session buffer to knowledge graph to semantic search
- 🎭 **Agent Identity** — Core memory blocks: persona, human, context, scratchpad
- 🔧 **16 Built-in Tools** — Bash, file ops, browser, web fetch, data analysis, memory, tasks, and more
- 🎨 **7 Color Themes** — shadcn/ui-inspired design system with CSS custom properties
- 🔒 **Self-Hosted** — SQLite database (WAL mode), zero external dependencies
- 📊 **Usage Dashboard** — Token usage, costs, model routing analytics
- 🔌 **External Channels** — Telegram, Discord, Slack, webhooks
- 🖥️ **Cross-Platform** — macOS, Linux, Windows (self-contained bundle with embedded Node.js)

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm
git clone https://github.com/danilocaffaro/hiveclaw.git
cd hiveclaw
pnpm install
pnpm build
pnpm start
# Open http://localhost:4070
```

### Windows

Download the self-contained bundle from [danilocaffaro.github.io/hiveclaw](https://danilocaffaro.github.io/hiveclaw/) — includes Node.js, no installation needed. Just unzip and run `start.bat`.

## First Run

1. Open `http://localhost:4070`
2. The **Setup Wizard** guides you through:
   - Adding your first LLM provider (API key or OAuth token)
   - Creating your first agent (with optional core memory)
3. Start chatting!

## Architecture

```
hiveclaw/
├── apps/
│   ├── server/     # Fastify + better-sqlite3 (port 4070)
│   ├── web/        # Next.js static export (SPA)
│   └── desktop/    # Electron wrapper
└── packages/
    └── shared/     # Shared types
```

### Server
- **Runtime**: Node.js 22 (ESM)
- **Framework**: Fastify v5
- **Database**: SQLite via better-sqlite3 (WAL mode, zero config)
- **LLM Engine**: Native streaming, no SDK dependencies
- **Memory**: 10-layer Eidetic Memory with FTS5 + sqlite-vec hybrid search

### Frontend
- **Framework**: Next.js 15 (static export)
- **State**: Zustand
- **Styling**: Inline CSS with custom properties (no Tailwind)
- **Mobile**: Dedicated `MobileApp.tsx` with WhatsApp-style navigation

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HIVECLAW_PORT` | `4070` | Server port |
| `HIVECLAW_DB_PATH` | `~/.hiveclaw/hiveclaw.db` | SQLite database |
| `HIVECLAW_WORKSPACE` | `./workspace` | Agent workspace directory |
| `NODE_ENV` | `development` | `production` enables auth |

Legacy `SUPERCLAW_*` env vars are supported as fallback.

## Supported Providers

Anthropic (API key + OAuth/Max/Pro plans), OpenAI, Google Gemini, Ollama, OpenRouter, Groq, DeepSeek, Mistral, GitHub Copilot, and any OpenAI-compatible endpoint.

## Development

```bash
pnpm dev          # Server (hot reload)
pnpm dev:web      # Frontend
pnpm test         # 229+ tests (vitest)
pnpm build        # Production build (0 TS errors required)
```

## License

MIT

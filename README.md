# 🐝 HiveClaw v1.0

> Your private AI team — multi-agent, multi-model, self-hosted. Runs anywhere.

HiveClaw is a self-hosted personal AI platform with a native LLM engine, deep agent memory, squad orchestration, and full desktop automation. No cloud dependency, no vendor lock-in — your data stays on your hardware.

[![Tests](https://img.shields.io/badge/tests-240%2F240-brightgreen)](https://github.com/danilocaffaro/hiveclaw)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/danilocaffaro/hiveclaw/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/danilocaffaro/hiveclaw)

---

## ✨ What Makes HiveClaw Different

### 🧠 Agent Identity System (Core Memory)
Every agent has persistent identity blocks — not just a system prompt. Agents know themselves, know you, and know the context they work in.

| Block | Purpose |
|-------|---------|
| 🎭 **Persona** | Who the agent is — personality, communication style, strengths |
| 👤 **Human** | Who you are — preferences, timezone, working style (learned over time) |
| 📁 **Context** | What you work on — business, project, routine, any domain |
| 📝 **Scratchpad** | Working notes — decisions, current state, things to remember |

These blocks inject into every prompt automatically and persist across sessions.

### 🐝 Squad Orchestration
Multiple agents working together as a team. Sequential, round-robin, specialist, or debate routing. Agents @mention each other and build on each other's work.

### 🧬 10-Layer Eidetic Memory
Not just chat history — a full cognitive architecture:

| Layer | What It Does |
|-------|-------------|
| Core Memory | Always-in-prompt identity blocks |
| Session Buffer | Current conversation window |
| Working Memory | Structured task state across sessions |
| Episodic Memory | Key moments and consolidated insights |
| Knowledge Graph | Facts, entities, relationships |
| FTS5 Archival | Full-text search across all history |
| Semantic Search | Vector similarity via sqlite-vec |
| Hybrid Search | RRF fusion of FTS5 + semantic |
| Auto-Compaction | LLM-powered context compression |
| Session Consolidation | End-of-session fact extraction |

### 🛠️ 19 Agent Tools
Full tool parity with production AI agents:

| Category | Tools |
|----------|-------|
| **Files** | bash, read, write, edit, glob, grep |
| **Web** | webfetch, web_search, browser (Playwright) |
| **Desktop** | screenshot, mac_control (click/type/AppleScript) |
| **Memory** | memory, visual_memory |
| **Planning** | task, todo, plans, data_analysis |
| **System** | credential, question |

### 🔐 Agent Bearer Tokens (v1.0)
Every agent has a unique `hc-agent-{id}-{token}` bearer token for authenticated inter-agent communication. Messages sent via bearer token automatically carry `sender_type: 'agent'` — agents know who's talking to them.

### 🛡️ Smart Agents, Not Restricted Agents
No artificial blocklists. Agents have **Operational Awareness** — they understand their environment and make intelligent decisions. Training instead of handcuffs.

### 🔬 Self-Learning Skills
When an agent hits a capability gap, it creates a new skill on the spot — searches, rebuilds from scratch, runs a 12-point security audit, and installs it.

### 🔭 Skill Scout (Auto-Discovery)
Weekly scan of GitHub, npm, and the AI ecosystem for trending agent skills. Recreated from scratch, audited for security, surfaced in the UI.

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- pnpm (`npm install -g pnpm`)

### Install & Run

```bash
git clone https://github.com/danilocaffaro/hiveclaw.git
cd hiveclaw
pnpm install
pnpm build
NODE_ENV=production PORT=4070 node apps/server/dist/index.js
```

Open `http://localhost:4070` and follow the Setup Wizard.

### Windows (Self-contained Bundle)
Download the standalone bundle from [Releases](https://github.com/danilocaffaro/hiveclaw/releases) — includes Node.js, no installation needed.

```powershell
# Extract and run
.\hiveclaw-standalone\start.bat
```

---

## 🤖 AI Providers

| Provider | Models | Auth |
|----------|--------|------|
| **Anthropic** | Claude Opus, Sonnet, Haiku | API key or OAuth token (`sk-ant-oat*`) |
| **GitHub Copilot** | Claude 3/4 series via Copilot | Bearer token |
| **OpenAI** | GPT-4o, o1, o3 | API key |
| **Google AI** | Gemini 1.5/2.0/2.5 | API key |
| **Ollama** | Any local model | Local (no key) |
| **Mistral** | Mistral Large/Small | API key |
| **Groq** | Llama, Mixtral | API key |
| **DeepSeek** | DeepSeek-R1, V3 | API key |

**Claude Max subscribers**: Use your OAuth token (`sk-ant-oat01-...`) — full 20x capacity, no separate API key needed.

---

## 🗄️ Architecture

```
apps/
  web/          Next.js static export (Chat UI, Settings, Panels)
  server/       Fastify + better-sqlite3 (LLM engine, tools, memory)
  desktop/      Electron wrapper (optional)
packages/
  shared/       TypeScript types shared across packages
```

**Database**: `~/.hiveclaw/hiveclaw.db` (SQLite, WAL mode)  
**Port**: 4070 (configurable via `PORT` env var)  
**Schema**: v4 (auto-migrated on startup)

---

## 🧪 Development

```bash
# Run tests
pnpm test         # 240 tests across 16 files

# Type check
pnpm build        # 0 TS errors

# Dev mode
pnpm dev          # Hot reload for web + server
```

---

## 📡 API

Full API documentation: [`docs/API.md`](docs/API.md) — 184 endpoints across 39 modules.

Key endpoints:
- `POST /api/sessions/:id/message` — Send message, get SSE stream
- `GET  /api/agents` — List agents
- `POST /api/agents/:id/token` — Generate agent bearer token
- `GET  /api/health` — Server health + provider status + tool count
- `POST /api/automations` — Create cron/event automations

---

## 🗺️ Roadmap

**v1.1 (next)**
- Docker/GHCR containers
- Agent templates marketplace
- Model routing (per-task model selection)
- Memory graph + forgetting curve

**v1.2**
- Multi-user collaboration (real-time)
- Session consolidator for squads
- Agent-to-agent direct sessions

---

## 📄 License

MIT — do whatever you want, just don't sue us.

---

*Built with 🐝 by the HiveClaw team*

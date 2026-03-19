# 🐝 HiveClaw v1.1

> Your private AI team — multi-agent, multi-model, self-hosted. Runs anywhere.

HiveClaw is a self-hosted personal AI platform with a native LLM engine, deep agent memory, squad orchestration, channel adapters, remote node execution, and full desktop automation. No cloud dependency, no vendor lock-in — your data stays on your hardware.

[![Tests](https://img.shields.io/badge/tests-424%2F424-brightgreen)](https://github.com/danilocaffaro/hiveclaw)
[![Version](https://img.shields.io/badge/version-1.1.0-blue)](https://github.com/danilocaffaro/hiveclaw/releases)
[![Tools](https://img.shields.io/badge/tools-21-orange)](https://github.com/danilocaffaro/hiveclaw)
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

### 🐝 Squad Orchestration
Multiple agents working as a team. Sequential, round-robin, specialist, or debate routing. Agents @mention each other and build on each other's work.

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

### 📡 4 Channel Adapters (v1.1)
Native multi-platform messaging — no external orchestrator required:

| Channel | Library | Key Features |
|---------|---------|-------------|
| **Telegram** | grammy | Streaming, inline keyboards, reactions, media, groups |
| **WhatsApp** | Baileys | Multi-device, QR pairing, auto-reconnect, media |
| **Discord** | discord.js v14 | Gateway, threads, buttons, streaming |
| **Slack** | @slack/bolt v4 | Socket Mode, Block Kit, threads, file upload |

### 🖥️ Remote Node Execution (v1.1)
Pair Mac/Linux devices as remote nodes. Agents can run commands, take screenshots, snap photos, and more — all with a 5-tier security model:

| Tier | Risk | Approval | Examples |
|------|------|----------|----------|
| 0 | Sensor | Auto | camera, screen, location |
| 1 | Safe | Auto | ls, pwd, cat, uptime |
| 2 | Side-effect | Agent | mkdir, cp, brew install |
| 3 | Destructive | Owner | rm, kill, sudo, reboot |
| 4 | Blocked | Never | pipe-to-shell, `$()` |

### 🎨 Canvas Host (v1.1)
Serve HTML dashboards, live-reload via WebSocket, push A2UI content from agents.

### 🛠️ 21 Agent Tools

| Category | Tools |
|----------|-------|
| **Files** | bash, read, write, edit, glob, grep |
| **Web** | webfetch, web_search, browser (Playwright) |
| **Desktop** | screenshot, mac_control (click/type/AppleScript) |
| **Memory** | memory, visual_memory |
| **Planning** | task, todo, plans, data_analysis |
| **System** | credential, question |
| **Platform** | canvas, node |

### 🔐 Agent Bearer Tokens
Every agent has a unique `hc-agent-{id}-{token}` bearer token for authenticated inter-agent communication.

### 🛡️ Smart Agents, Not Restricted Agents
No artificial blocklists. Agents have **Operational Awareness** — they understand their environment and make intelligent decisions.

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

### Pair a Remote Node (optional)

```bash
# On the server: generate a pairing code
curl -X POST http://localhost:4070/nodes/generate-code

# On the remote Mac/Linux:
npx hiveclaw-node pair --gateway https://your-server:4070
# Enter the 6-digit code → paired!

npx hiveclaw-node start
# Now agents can execute commands on this device
```

### Docker

```bash
docker compose up -d
# → http://localhost:4070
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
  web/             Next.js static export (Chat UI, Settings, Panels)
  server/          Fastify + better-sqlite3 (LLM engine, tools, memory)
    engine/
      channels/    4 adapters + ChannelRouter + hardening utilities
      canvas/      Canvas host (static + WebSocket live-reload)
      nodes/       Node pairing, RPC host, command classifier, approval flow
      tools/       21 agent tools
      memory/      10-layer eidetic memory
      strategies/  Squad routing (specialist, debate, relay, round-robin)
  desktop/         Electron wrapper (optional)
packages/
  node-client/     Remote node client (npx hiveclaw-node)
  shared/          TypeScript types shared across packages
```

**Database**: `~/.hiveclaw/hiveclaw.db` (SQLite, WAL mode)
**Port**: 4070 (configurable via `PORT` or `HIVECLAW_PORT`)
**Schema**: v4 (auto-migrated on startup)

---

## 🧪 Development

```bash
# Run tests
pnpm test         # 424 tests across 22 files

# Type check
pnpm build        # 0 TS errors

# Dev mode
pnpm dev          # Hot reload for web + server
```

---

## 📡 API

Full API documentation: [`docs/API.md`](docs/API.md)

Key endpoints:
- `POST /sessions/:id/message` — Send message, get SSE stream
- `POST /sessions/:id/cancel` — Cancel a running session
- `GET  /agents` — List agents
- `POST /agents/:id/token` — Generate agent bearer token
- `GET  /channels/v2/status` — Channel adapter status
- `POST /channels/v2/:id/start|stop|restart` — Manage channel lifecycle
- `POST /nodes/pair` — Pair a remote device
- `GET  /nodes/approvals` — Pending Tier 3 approvals
- `POST /canvas/push` — Push HTML/A2UI to canvas
- `GET  /health` — Server health + provider status + tool count

---

## 🗺️ Roadmap

**v1.2 (next)**
- Baileys SQLite auth adapter (replace filesystem)
- Per-adapter e2e tests
- Docker/GHCR containers
- Agent templates marketplace
- Multi-user collaboration

**Future**
- PWA node client (alternative to native apps)
- IRC adapter
- Memory graph + forgetting curve
- Agent-to-agent direct sessions

---

## 📄 License

MIT — do whatever you want, just don't sue us.

---

*Built with 🐝 by the HiveClaw team*

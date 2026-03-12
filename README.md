# SuperClaw Pure ✨

> The personal AI assistant that actually works out of the box.

**Zero-config start** · **Web-first** · **Structured memory** · **Governed execution**

---

## Quick Start

```bash
npx superclaw
```

Your browser opens. Setup wizard guides you through:
1. **Choose your LLM** (OpenAI, Anthropic, Google, Ollama, OpenRouter)
2. **Create your first agent** (name, emoji, personality)
3. **Start chatting** — you're done in under 5 minutes

---

## Why SuperClaw Pure?

| Problem | Solution |
|---------|----------|
| 🕐 "Setup took me 2 days" | One command. Browser wizard. < 5 min. |
| 🧠 "My agent forgets everything" | Typed memory graph (Fact, Decision, Goal, Preference…) with vector + full-text search |
| 🔥 "Burning $50/day on tokens" | 3-tier smart routing: cheap model for routine, premium for complex |
| 🔄 "Agent loops 8 times on same answer" | Circuit breakers, governed execution, approval gates |
| 😴 "Close the tab, agent stops working" | Persistent job queue that survives restarts |
| 📊 "No idea where my money goes" | Built-in usage dashboard with cost tracking |
| 🔒 "Security concerns" | Sandboxed execution, approval workflows, no telemetry |

---

## Features

### Core
- 🤖 **Multi-provider LLM** — OpenAI, Anthropic, Google, Ollama, OpenRouter, any OpenAI-compatible API
- 🧠 **Structured memory** — typed graph with 6 memory types and relationship edges
- 🔧 **Tool system** — web search, browser, shell, file ops — all sandboxed
- 📋 **Skill system** — load skills, browse skill store, compatible with OpenClaw skills
- 🔌 **MCP client** — connect any MCP server (stdio or HTTP)

### Agents & Teams
- 👥 **Multi-agent** — create specialized agents with different models and personalities
- 🏢 **Squads** — group agents for collaborative tasks
- 📣 **@mention routing** — direct messages to specific agents
- ⚡ **Concurrent execution** — multiple agents working in parallel

### Automation
- ⏰ **Cron jobs** — scheduled tasks with active hours
- 🔁 **Persistent job queue** — survives server restart
- ⚡ **Circuit breaker** — auto-disable failing jobs
- ✅ **Approval workflows** — human-in-the-loop for dangerous actions

### Observability
- 📊 **Usage dashboard** — token costs, model breakdown, activity heatmap
- 📈 **Agent metrics** — success rate, response time, error rate
- 🔔 **Push notifications** — browser alerts for job completion

### Channels
- 🌐 **Web UI** — primary interface (PWA mobile-ready)
- 📱 **Telegram** — chat from your phone
- 💬 **WhatsApp** — chat from your phone
- 🎮 **Discord** — chat from your server
- 🔗 **Public chat** — shareable links, no login needed

---

## Architecture

```
superclaw-pure/
├── packages/
│   ├── core/       ← Engine: LLM, memory, tools, sessions, skills
│   ├── server/     ← Fastify API + WebSocket + SSE
│   ├── web/        ← Next.js SPA (chat, dashboard, settings)
│   └── cli/        ← npx superclaw (start, config, doctor)
├── skills/         ← Bundled starter skills
├── docs/           ← Documentation
└── tests/          ← Test suite
```

**Tech stack:** TypeScript · Node.js 22+ · Fastify 5 · Next.js 15 · SQLite · Zustand · pnpm

---

## Born Virgin 🌱

SuperClaw Pure ships with **zero agents, zero config, zero assumptions**. 

No hardcoded API keys. No embedded personas. No "Alice" or "Jarvis" pre-installed.

Your first run is a blank canvas. The setup wizard helps you paint it.

---

## Migrating from OpenClaw?

```bash
npx superclaw migrate --from openclaw
```

Imports your agents, memory, skills, and conversation history.

---

## Development

```bash
git clone https://github.com/danilocaffaro/superclaw-pure.git
cd superclaw-pure
pnpm install
pnpm dev
```

---

## Roadmap

See [PRD.md](docs/PRD.md) for the full product requirements and delivery plan.

| Batch | Status | What |
|-------|--------|------|
| 0: Foundation | 🔨 | Repo, skeleton, basic chat |
| 1: Engine Core | 📋 | Multi-provider, tools, sessions |
| 2: Memory | 📋 | Typed graph + vector search |
| 3: Background | 📋 | Cron, jobs, circuit breaker |
| 4: Multi-Agent | 📋 | Squads, @mention, concurrent |
| 5: Extensibility | 📋 | Skills, MCP, API |
| 6: Dashboard | 📋 | Usage, analytics |
| 7: Channels | 📋 | Telegram, WhatsApp, Discord |
| 8: Ship v1.0 | 📋 | Docs, Docker, release |

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md).

---

## License

MIT © 2026 Danilo Caffaro

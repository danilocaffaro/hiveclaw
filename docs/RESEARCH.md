# SuperClaw Pure — Research & Strategic Analysis

## 1. Plano Existente (Resgate)

### Decisões já tomadas:
- SuperClaw Pure = novo repo, engine própria, sem dependência do Bridge/OpenClaw
- User-agnostic: nasce virgem, sem agentes embebidos
- Setup wizard user-friendly, passo a passo
- Dois SKUs: "SuperClaw OpenClaw Inside" (companion) e "SuperClaw Pure" (standalone)
- Tech: Next.js SPA + Fastify + SQLite (monorepo provado em 57 sprints)
- Cloudflare Tunnel + caffaro.dev para deploy
- Multi-gateway architecture confirmada (BridgePool pattern)

### Assets reutilizáveis do SuperClaw atual:
- UI/UX inteira (sidebar, chat, right panel, mobile stack, settings)
- Agent CRUD, squad management, @mention routing
- Public chat / shared links
- Gateway pairing system
- Preview panel com device chrome
- Browser panel com Playwright real
- Task/Kanban system

---

## 2. Pesquisa: Dores e Demandas dos Usuários

### Fontes: Reddit r/openclaw, GitHub issues, posts de heavy users

#### 🔴 Dores Críticas (reportadas repetidamente)

| # | Dor | Fonte | Frequência |
|---|-----|-------|-----------|
| D1 | **Setup infernal** — "first 72 hours determine if you keep using it" | Multiple posts | ⭐⭐⭐⭐⭐ |
| D2 | **Context window management** — "starts getting senile at 200K", compaction perde contexto | 2-month heavy user | ⭐⭐⭐⭐⭐ |
| D3 | **Agent loops** — repete a mesma resposta 8x sem progress | Tip posts | ⭐⭐⭐⭐ |
| D4 | **Token burn** — heartbeats/cron consumindo modelo caro desnecessariamente | Multiple | ⭐⭐⭐⭐ |
| D5 | **Memory persistence** — sessions are stateful only while open; close = forget | 72h guide | ⭐⭐⭐⭐ |
| D6 | **Security concerns** — prompt injection via web scraping, API key leaks | Security posts | ⭐⭐⭐⭐ |
| D7 | **"Vibe-coded" perception** — code quality concerns, "big piece of software" | Comparison post | ⭐⭐⭐ |
| D8 | **UI/UX nightmare** — "WhatsApp/Discord slash commands are a UX nightmare" | BotsChat builder | ⭐⭐⭐ |
| D9 | **No good web dashboard** — "everyone's first instinct is to build a dashboard" but OpenClaw doesn't have one | 72h guide | ⭐⭐⭐ |
| D10 | **Overnight work doesn't work** — "ask agent to work, close chat, it forgets" | Multiple | ⭐⭐⭐ |

#### 🟡 Demandas de Features

| # | Feature | Demanda |
|---|---------|---------|
| F1 | **Smart model routing** — automatic cheap/expensive based on task complexity | High |
| F2 | **Persistent background tasks** — queue-based, survives session close | High |
| F3 | **Better memory** — structured, graph-based, not just markdown files | High |
| F4 | **Usage dashboard** — cost tracking, token usage, activity heatmaps | Medium |
| F5 | **One-click deploy** — not 2 days of config before useful | High |
| F6 | **Multi-channel from web UI** — stop depending on Telegram/WhatsApp as primary | Medium |
| F7 | **Parallel agent execution** — coordinate 5-20 workers simultaneously | High |
| F8 | **Approval workflows** — sandboxed execution, human-in-the-loop | Medium |
| F9 | **Playbook system** — capture what works, auto-promote to skills | Medium |
| F10 | **Build mode** — idea → prototype phased workflow | Medium |

#### 💚 O Que Funciona Bem no OpenClaw (manter/melhorar)

| # | Ponto Forte |
|---|------------|
| S1 | Browser automation — "killer feature" |
| S2 | Multi-channel (WhatsApp, Telegram, Discord, Slack) |
| S3 | Self-evolving skills system |
| S4 | Tool use com Anthropic models |
| S5 | Cron/heartbeat system |
| S6 | "Colleague" mental model — own GitHub, Twitter, accounts |
| S7 | Governed agents > always-on agents |

---

## 3. Análise de Concorrentes

### CoWork-OS (MIT, Electron desktop app)
**Stars:** Growing fast, mencionado como superior ao OpenClaw

**Pontos fortes:**
- 30+ LLM providers, 15 channels, 139 skills out-of-box
- "Digital Twin Personas" — pre-built roles (engineer, PM, manager)
- "Zero-Human Company Ops" — founder-directed autonomous company
- Plugin Platform com 17 role-specific packs + Plugin Store
- Active Context sidebar — always-visible MCP connectors
- Build Mode — Concept → Plan → Scaffold → Iterate
- AI Playbook — auto-captures what works → auto-promotes to skills
- Evolving Intelligence — 6 memory subsystems merged
- Usage Insights dashboard (cost/token tracking, heatmaps)
- ChatGPT History Import (migrate existing context)
- 3200+ tests, security-first
- **Setup: npm install -g cowork-os && cowork-os** ← one command

**Fraquezas:**
- Electron only (no pure web), heavy desktop footprint
- Feature creep potential (too many features)
- New project, less battle-tested

### Spacebot (FSL License, Rust, by Spacedrive team)
**Stars:** 1.7K, growing

**Pontos fortes:**
- **Rust** — single binary, no Docker, no dependencies
- **Concurrent by design** — thinks, executes, responds simultaneously
- **Multi-user native** — Discord communities with 50+ concurrent users
- **Message coalescing** — batches rapid-fire messages, "reads the room"
- **Typed memory graph** — 8 memory types (Fact, Preference, Decision, Goal, Todo...) with edges (RelatedTo, Updates, Contradicts)
- **Smart routing** — 4-level: process-type → task-type → prompt complexity → fallback
- **OpenCode integration** — full coding agent as persistent worker
- **Cron with circuit breaker** — auto-disables after 3 failures
- **Skills.sh ecosystem** + OpenClaw skill compatibility
- **One-click deploy** via spacebot.sh (hosted option)
- **Active hours** for cron — restrict to time windows

**Fraquezas:**
- Rust = harder to contribute for average developer
- Newer, less ecosystem
- FSL license (not pure open source)

---

## 4. Inspiração: Wolf-Server (Proprietary Origin)

**wolf-server** é o Go binary proprietário (14MB, auto-contido) que foi o engine original do SuperClaw — originário do HubAI Nitro / PicPay. SuperClaw já é o clean-room TypeScript rewrite dele.

### O que aprendemos com Wolf (para levar ao Pure):
- **12 built-in tools** — bash, edit, glob, grep, read, write, webfetch, task, todo, memory, plans, question
- **40 endpoints REST** bem definidos (sessions, messages, memory, plans, skills, MCP, plugins, heartbeat)
- **SQLite como DB principal** com WAL mode — single-file, zero config
- **Plugin system** (`window.wolf` sandbox) com lifecycle hooks
- **SSE streaming** para respostas em tempo real (8 event types)
- **Port 4070** como padrão
- **`~/.superclaw/`** como diretório de dados (separado do `~/.wolf/` proprietário)

### Lições dos 57 sprints de SuperClaw:
1. **Bridge pattern funciona** — abstrair o engine permite trocar backends sem mudar UI
2. **SQLite > markdown files** para memória e planos — buscável, transacional
3. **BridgePool multi-gateway** permite conectar agentes de múltiplas máquinas
4. **ARCHER v2 @mention routing como code** + NEXUS v3 tags como prompt = melhor combo
5. **Setup wizard é essencial** — sem ele, 80% dos users desistem nos primeiros 3 dias
6. **Service Worker caching** causa mais problemas do que resolve — precisa de stamp versionado

---

## 5. Matriz de Comparação

| Aspecto | OpenClaw (atual) | CoWork-OS | Spacebot | **SuperClaw Pure (target)** |
|---------|-----------------|-----------|----------|---------------------------|
| **Linguagem** | TypeScript/Node.js | TypeScript/Electron | Rust | **TypeScript (Next.js + Fastify)** |
| **Deploy** | `npm i -g openclaw` + 30min config | `npm i -g cowork-os` + works | Binary or one-click hosted | **One-click web (npx) + Setup Wizard** |
| **Time-to-value** | 2-3 dias | ~30 min | ~10 min | **< 5 min (target)** |
| **UI** | CLI + chat channels | Electron desktop | Discord/Slack/Web embed | **Web-first SPA (PWA mobile)** |
| **Channels** | 9 (WhatsApp, TG, Discord...) | 15 | 5 (Discord, Slack, TG, Twitch, Web) | **Web native + channel plugins** |
| **LLM Providers** | ~15 | 30+ | ~10 + custom | **OpenAI-compatible universal + presets** |
| **Memory** | Markdown files (flat) | 6 subsystems merged | Typed graph (8 types + edges) | **Typed graph + vector + full-text** |
| **Agent concurrency** | Single-threaded session | Multi-agent collab | True concurrent (branch/worker) | **Worker pool + concurrent dispatch** |
| **Model routing** | Manual per-session | Auto per provider | 4-level auto-routing | **3-tier auto (cheap/standard/premium)** |
| **Background tasks** | Cron/heartbeat (session-bound) | Autonomous mode | Cron with circuit breaker | **Persistent job queue + cron** |
| **Security** | Basic (sandboxed tools) | 3200+ tests, approval gates | Configurable permissions | **Approval flows + sandboxed exec** |
| **Setup experience** | Edit JSON, configure manually | Works out of box (OpenRouter free) | Config TOML or hosted | **Guided wizard, zero-config start** |
| **Extensibility** | ClawHub skills | Plugin Store + packs | skills.sh + MCP | **Skill store + MCP + custom tools** |
| **Usage tracking** | None visual | Dashboard (cost/tokens/heatmaps) | None visual | **Built-in analytics dashboard** |
| **Self-hosted** | Yes (only) | Yes (only) | Yes or hosted | **Yes + optional cloud deploy** |
| **License** | Apache 2.0 | MIT | FSL (restricted) | **MIT** |
| **Multi-user** | No (single user) | No (single user) | Yes (communities) | **Single user (v1) → Multi (v2)** |
| **Build mode** | No | Concept→Plan→Scaffold→Iterate | No | **Yes (phased project canvas)** |
| **Playbook/learning** | Manual skills | Auto-capture + auto-promote | No | **Playbook → auto-skill pipeline** |

---

## 6. Pilares Arquiteturais do SuperClaw Pure

### 6.1 Core Principles
1. **Zero-config start** — `npx superclaw` → browser opens → setup wizard → chatting in < 5 min
2. **User-agnostic** — nasce virgem, sem agentes, sem config hardcoded
3. **Web-first** — SPA servida pelo próprio server (PWA mobile ready)
4. **Engine própria** — LLM routing direto, sem dependência de OpenClaw
5. **Typed memory** — structured graph + vector search + full-text
6. **Governed execution** — approval gates, sandboxed tools, circuit breakers
7. **Observable** — usage dashboard, cost tracking, session timeline

### 6.2 Tech Stack
- **Runtime:** Node.js + TypeScript (contribuição fácil, ecossistema rico)
- **Server:** Fastify (provado em 57 sprints)
- **Frontend:** Next.js static export (SPA, PWA)
- **DB:** SQLite (better-sqlite3) + SQLite vec extension (embeddings)
- **LLM:** Universal adapter (OpenAI-compatible + Anthropic + Ollama native)
- **Desktop:** Electron (optional, web é primary)

### 6.3 Module Map
```
superclaw-pure/
├── packages/
│   ├── core/              ← Engine: LLM routing, memory, tools, sessions
│   │   ├── llm/           ← Multi-provider adapter + smart routing
│   │   ├── memory/        ← Typed graph + vector + full-text
│   │   ├── tools/         ← Sandboxed tool execution + MCP client
│   │   ├── sessions/      ← Session lifecycle + persistence
│   │   └── skills/        ← Skill loader + registry client
│   ├── server/            ← Fastify API + WebSocket + SSE
│   ├── web/               ← Next.js SPA (chat, dashboard, settings)
│   └── cli/               ← npx superclaw (start, config, doctor)
├── skills/                ← Bundled starter skills
├── docs/
└── tests/
```

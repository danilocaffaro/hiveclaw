# Contributing to HiveClaw 🐝

Thanks for your interest in contributing! HiveClaw is a self-hosted AI assistant platform with multi-agent orchestration, 10-layer memory, 21 built-in tools, 4 channel adapters, remote node execution, and a canvas host.

## Quick Start

### Prerequisites
- **Node.js** 20+ (22 recommended)
- **pnpm** 9+ (`npm install -g pnpm`)
- **Git**
- An API key from at least one provider (Anthropic, OpenAI, Google, GitHub Copilot, etc.)

### Setup

```bash
git clone https://github.com/danilocaffaro/hiveclaw.git
cd hiveclaw
pnpm install
pnpm build
pnpm start         # → http://localhost:4070
```

First run opens the **Setup Wizard** — pick a provider, add your API key, and you're live.

### Development Mode

```bash
# Terminal 1: Server (auto-restart on changes)
cd apps/server && pnpm dev

# Terminal 2: Web UI (hot reload)
cd apps/web && pnpm dev
```

### Running Tests

```bash
pnpm test                    # All 432 tests (22 files)
pnpm test nodes              # Run specific test file
```

## Project Structure

```
hiveclaw/
├── apps/
│   ├── server/                  # Fastify + better-sqlite3 backend
│   │   └── src/
│   │       ├── api/             # REST routes (agents, sessions, nodes, channels, canvas)
│   │       ├── engine/
│   │       │   ├── channels/    # 4 adapters + ChannelRouter + hardening
│   │       │   ├── canvas/      # Canvas host (static + WS live-reload)
│   │       │   ├── nodes/       # Node pairing, RPC, classifier, approval flow
│   │       │   ├── tools/       # 21 agent tools
│   │       │   ├── memory/      # 10-layer eidetic memory
│   │       │   ├── strategies/  # Squad routing (specialist, debate, relay, round-robin)
│   │       │   └── providers/   # 8 LLM providers
│   │       └── __tests__/       # Vitest test files
│   ├── web/                     # Next.js static export (SPA)
│   └── desktop/                 # Electron wrapper
├── packages/
│   ├── node-client/             # Remote node client (npx hiveclaw-node)
│   └── shared/                  # Shared TypeScript types
├── docs/                        # API docs + security spec + landing page
└── pnpm-workspace.yaml
```

## Architecture

### Core Engine
- **Monorepo** managed with pnpm workspaces
- **Server**: Fastify, TypeScript, better-sqlite3 (WAL mode), sqlite-vec for embeddings
- **Web**: Next.js 15 with `NEXT_OUTPUT=export` (static SPA, served by server)
- **Agent Engine**: Multi-provider (8 providers), multi-model, tool-calling loop with anti-hallucination enforcement
- **Engine v2**: Provider-native tool loop (Anthropic/OpenAI format), graduated loop detection

### Channel Adapters v2
Four production adapters in `engine/channels/`:

| Adapter | Library | Mode |
|---------|---------|------|
| `telegram-adapter.ts` | grammy | Long polling or webhook |
| `whatsapp-adapter.ts` | Baileys | Multi-device WebSocket |
| `discord-adapter.ts` | discord.js v14 | Gateway (WebSocket) |
| `slack-adapter.ts` | @slack/bolt v4 | Socket Mode or HTTP |

- **`channel-router.ts`** — factory registry, lifecycle management, send/stream routing
- **`hardening.ts`** — InboundRateLimiter, CircuitBreaker, StreamingDebouncer, ReconnectManager, webhook validation (Telegram/Discord/Slack)
- **`adapter.ts`** — ChannelAdapter interface, all shared types

### Node Pairing + RPC
Remote device execution in `engine/nodes/`:

- **`command-classifier.ts`** — 5-tier blast radius (Tier 0 sensors → Tier 4 blocked). Binary extraction, blocked pattern detection. Unknown commands → Tier 3 (fail-closed).
- **`node-repository.ts`** — SQLite schema (`nodes`, `node_commands`), token auth (SHA-256 hashed), rotation, audit trail, pruning.
- **`rpc-host.ts`** — WebSocket server at `/api/nodes/connect`, HMAC per-command, rate limiting, concurrent limits.
- **`approval-flow.ts`** — Tier-based: auto (0-1), agent (2), owner (3, 5min timeout), blocked (4). SSE broadcast. Late result handling.
- **`node-tool.ts`** — Tool #21 with 8 actions (exec, camera, screen, location, notifications, list, status).

**Security spec**: `docs/NODE-EXEC-SECURITY-SPEC.md` — full specification approved by tech lead.

### Canvas Host
- `engine/canvas/canvas-host.ts` — static file server + WebSocket live-reload + A2UI push

### Approval Flow (Tier 3 Commands)
When an agent requests a destructive command (rm, kill, sudo, etc.):
1. Server creates a pending approval, broadcasts via SSE
2. Owner has 5 minutes to approve/deny via `POST /nodes/approvals/:id/resolve`
3. If timeout → command rejected, agent informed
4. Stale detection prevents executing commands on changed sessions

## Development Guidelines

### Code Style
- TypeScript strict mode — **0 TS errors** policy
- CSS variables for theming (no CSS-in-JS library)
- Inline styles in TSX (82 files, consistent pattern)

### Testing
- **Vitest** for all tests
- Tests live in `apps/server/src/__tests__/`
- Every commit must maintain **0 TS errors** and **all 432 tests passing**
- Key test files:
  - `nodes.test.ts` — command classifier (all 5 tiers) + node repository
  - `channel-hardening.test.ts` — rate limiter, circuit breaker, debouncer, webhook validation
  - `channels.test.ts` — adapter interface tests
  - `memory.test.ts` — eidetic memory layers
  - `engine-v2.test.ts` — tool loop, streaming, cancellation

### Commits
- Conventional commits: `feat(scope):`, `fix(scope):`, `sec(scope):`, `docs:`
- Sprint-tagged when applicable: `feat(R15):`, `fix(R14):`
- Push to `main` branch (no PR required for now, but clean commits expected)

### Database
- SQLite with WAL mode + auto-checkpoint
- Schema version tracked in `schema.ts` (currently v4)
- **Never** reset the DB between deploys — migrations only
- FTS5 for full-text search (auto-repaired on startup)

### Adding a New Channel Adapter
1. Create `engine/channels/my-adapter.ts` implementing `ChannelAdapter`
2. Register factory in `engine/channels/index.ts`
3. Add adapter type to `ChannelType` union in `adapter.ts`
4. Wire into `channel-router.ts` factory map
5. Add tests in `__tests__/channels.test.ts`
6. Update `.env.example` with required env vars

### Adding a New Tool
1. Create `engine/tools/my-tool.ts` implementing `Tool` interface
2. Add to `engine/tools/index.ts` — import, export, and add to `getToolRegistry()`
3. Add tests
4. Update tool count in README badges

## What to Contribute

### Good First Issues
- **UI improvements**: Themes, responsive fixes, accessibility
- **New tools**: Add tools to `engine/tools/`
- **Provider support**: New LLM providers in `engine/providers/`
- **Documentation**: API docs, user guides, examples
- **Tests**: Integration tests, edge cases, adapter e2e tests

### Architecture Areas
- **Agent Engine** (`engine/`) — tool loop, memory, anti-fabrication
- **Channels** (`engine/channels/`) — adapter hardening, new platforms
- **Nodes** (`engine/nodes/`) — node client improvements, new sensor types
- **Multi-Agent** (`engine/strategies/`) — specialist, debate, relay, round-robin
- **Memory** (`engine/memory/`) — 10-layer eidetic memory
- **Canvas** (`engine/canvas/`) — A2UI improvements, dashboard templates

### Security Contributions Welcome
- Auth layer (JWT/session) for multi-user support
- Credential encryption at rest
- CSP nonce headers
- Docker resource limits
- Adapter e2e security tests

## Agent Onboarding

When creating a new agent via the Settings UI or API:

1. **Engine version**: Choose v1 (legacy) or v2 (native tool loop) — v2 recommended
2. **Channel binding**: Optionally bind the agent to a channel (Telegram, WhatsApp, Discord, Slack)
3. **Node pairing**: Optionally allow the agent to control paired nodes (requires node tool enabled)
4. **Canvas**: Enable/disable canvas tool for the agent
5. **Heartbeat**: Configure optional health check (interval, prompt, alert thresholds)
6. **Core memory**: Set persona, human, context, and scratchpad blocks
7. **Skills**: Assign relevant skills from the Skill Hub

## Questions?

Open an issue on GitHub or check the [landing page](https://danilocaffaro.github.io/hiveclaw/) for overview and download links.

---

Built with 🐝 by the HiveClaw team

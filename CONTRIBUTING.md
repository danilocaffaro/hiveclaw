# Contributing to HiveClaw 🐝

Thanks for your interest in contributing! HiveClaw is a self-hosted AI assistant platform with multi-agent orchestration, 10-layer memory, and 19 built-in tools.

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
pnpm test                    # All 270 tests (17 files)
pnpm test url-security       # Run specific test file
```

## Project Structure

```
hiveclaw/
├── apps/
│   ├── server/     # Fastify + better-sqlite3 backend
│   ├── web/        # Next.js static export (SPA)
│   └── desktop/    # Electron wrapper
├── packages/
│   └── shared/     # Shared types & constants
├── docs/           # API docs + landing page (GitHub Pages)
└── pnpm-workspace.yaml
```

## Architecture

- **Monorepo** managed with pnpm workspaces
- **Server**: Fastify, TypeScript, better-sqlite3 (WAL mode), sqlite-vec for embeddings
- **Web**: Next.js 15 with `NEXT_OUTPUT=export` (static SPA, served by server)
- **3-Block Architecture**: Chat Layer → AI Engine → Config+API (decoupled)
- **Agent Engine**: Multi-provider (8 providers), multi-model, tool-calling loop with anti-hallucination enforcement

## Development Guidelines

### Code Style
- TypeScript strict mode — **0 TS errors** policy
- CSS variables for theming (no CSS-in-JS library)
- Inline styles in TSX (82 files, consistent pattern)

### Testing
- **Vitest** for all tests
- Tests live in `apps/server/src/__tests__/` and `apps/server/test/`
- Every PR must maintain **0 TS errors** and **all tests passing**
- Security tests in `test/url-security.test.ts`

### Commits
- Conventional commits: `feat(scope):`, `fix(scope):`, `sec(scope):`, `docs:`
- Sprint-tagged when applicable: `feat(R15):`, `fix(R14):`
- Push to `main` branch (no PR required for now, but clean commits expected)

### Database
- SQLite with WAL mode + auto-checkpoint
- Schema version tracked in `schema.ts` (currently v4)
- **Never** reset the DB between deploys — migrations only
- FTS5 for full-text search (auto-repaired on startup)

## What to Contribute

### Good First Issues
- **UI improvements**: Themes, responsive fixes, accessibility
- **New tools**: Add tools to `apps/server/src/engine/tools/`
- **Provider support**: New LLM providers in `apps/server/src/engine/providers/`
- **Documentation**: API docs, user guides, examples
- **Tests**: Integration tests, edge cases

### Architecture Areas
- **Agent Engine** (`apps/server/src/engine/`) — tool loop, memory, anti-fabrication
- **Multi-Agent** (`apps/server/src/engine/strategies/`) — specialist, debate, relay, round-robin
- **Memory System** (`apps/server/src/engine/memory/`) — 10-layer eidetic memory
- **Automations** (`apps/server/src/engine/automation/`) — cron scheduler, event triggers
- **API Routes** (`apps/server/src/api/`) — 184 endpoints, 39 modules

### Security Contributions Welcome
Recent security audit (Sherlock, Opus 4.6) scored us **7.5/10** overall, **5.5/10** security. Key areas for improvement:
- Auth layer (JWT/session) for multi-user support
- Credential encryption at rest
- CSP nonce headers
- Docker resource limits

## Running on Windows

HiveClaw runs on Windows via the standalone bundle (includes Node.js):

1. Download `hiveclaw-standalone-win.zip` from [Releases](https://github.com/danilocaffaro/hiveclaw/releases)
2. Extract anywhere
3. Double-click `START.bat`
4. Open `http://localhost:4070`

For development on Windows, use WSL2 or native Node.js + pnpm.

## Questions?

Open an issue on GitHub or check the [landing page](https://danilocaffaro.github.io/hiveclaw/) for overview and download links.

---

Built with 🐝 by the HiveClaw team

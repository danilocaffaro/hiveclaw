# 🚀 Getting Started with HiveClaw

> From zero to your first AI conversation in ~10 minutes.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Node.js** | 20+ | `node -v` |
| **pnpm** | 9+ | `pnpm -v` |
| **Git** | any | `git --version` |
| **LLM API key** | at least one | See [Providers](#3-configure-providers) |

### Supported Platforms
- macOS (Intel & Apple Silicon) ✅
- Linux (x64, ARM64) ✅
- Windows (WSL2 recommended) ✅

---

## 1. Clone & Install

```bash
git clone https://github.com/danilocaffaro/superclaw-pure.git hiveclaw
cd hiveclaw
pnpm install
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and set **at least one** LLM provider:

```bash
# Option A: GitHub Copilot (recommended — free tier available)
GITHUB_TOKEN=ghp_your_token_here

# Option B: Anthropic
ANTHROPIC_API_KEY=sk-ant-your_key_here

# Option C: OpenAI-compatible
OPENAI_API_KEY=sk-your_key_here

# Option D: Google AI
GEMINI_API_KEY=your_key_here

# Option E: Ollama (local, free)
OLLAMA_URL=http://localhost:11434
```

> 💡 You can configure multiple providers. HiveClaw will use them as fallbacks automatically.

## 3. Configure Providers

HiveClaw supports these LLM providers out of the box:

| Provider | Models | Free Tier | Setup |
|----------|--------|-----------|-------|
| **GitHub Copilot** | Claude, GPT-4o, Gemini | 300 req/month (Pro) | [github.com/settings/copilot](https://github.com/settings/copilot) |
| **Anthropic** | Claude 3.5/4 Sonnet, Opus | No | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | GPT-4o, o1, o3 | No | [platform.openai.com](https://platform.openai.com) |
| **Google AI** | Gemini 2.5 Pro/Flash | Yes (free tier) | [aistudio.google.dev](https://aistudio.google.dev) |
| **Ollama** | Llama, Mistral, Qwen, etc | Yes (local) | [ollama.ai](https://ollama.ai) |

## 4. Build & Start

```bash
# Build all packages
pnpm build

# Start the server
pnpm start
```

The server starts on **http://localhost:4070**.

> First launch creates the database at `~/.hiveclaw/hiveclaw.db` and runs the Setup Wizard.

## 5. Setup Wizard

Open your browser to **http://localhost:4070**. The Setup Wizard guides you through:

1. **Create your user account** — username + password
2. **Configure an LLM provider** — test the connection
3. **Create your first agent** — pick a name, model, and personality

After completing setup, you land on the chat interface.

## 6. Your First Conversation

1. Click your agent in the sidebar
2. Type a message and press Enter
3. The agent responds using your configured LLM

🎉 **You're running HiveClaw!**

---

## What's Next?

| Want to... | Read |
|------------|------|
| Create more agents | [User Guide → Agents](USER-GUIDE.md#agents) |
| Set up a squad (multi-agent) | [User Guide → Squads](USER-GUIDE.md#squads) |
| Connect Telegram/WhatsApp | [User Guide → Channels](USER-GUIDE.md#channels) |
| Use the API | [API Reference](API.md) |
| Understand the architecture | [Architecture](ARCHITECTURE.md) |
| Troubleshoot issues | [Troubleshooting](TROUBLESHOOTING.md) |
| Contribute code | [Contributing](../CONTRIBUTING.md) |

---

## Quick Reference

```bash
# Build
pnpm build

# Start (production)
pnpm start

# Development mode (hot reload)
pnpm dev          # server only
pnpm dev:web      # frontend only

# Run tests
pnpm test

# Type check
pnpm typecheck

# Check server health
curl http://localhost:4070/api/health
```

## Environment Variables Reference

See [.env.example](../.env.example) for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | One provider required | GitHub Copilot token |
| `ANTHROPIC_API_KEY` | One provider required | Anthropic API key |
| `OPENAI_API_KEY` | One provider required | OpenAI API key |
| `GEMINI_API_KEY` | One provider required | Google AI key |
| `OLLAMA_URL` | No | Ollama server URL |
| `PORT` | No | Server port (default: 4070) |
| `HIVECLAW_DB_PATH` | No | Database path (default: ~/.hiveclaw/hiveclaw.db) |
| `BRAVE_API_KEY` | No | Brave Search API for web search |
| `SERPER_API_KEY` | No | Google search via Serper |
| `TAVILY_API_KEY` | No | Tavily research API |

---

*HiveClaw v1.3 — Self-hosted AI platform*

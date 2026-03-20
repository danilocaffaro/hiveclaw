# Changelog

All notable changes to HiveClaw are documented here.

## [1.3.2] — 2026-03-20

### 🔧 Onboarding & Provider Fixes

#### Anthropic Model ID Fix (Bug 2 — Critical)
- **Root cause**: Model IDs like `claude-opus-4.6` (dot notation) sent raw to Anthropic API, which only accepts `claude-opus-4-6` (hyphens). Result: all Sonnet/Opus requests silently failed with "model not found".
- **normalizeModelId()** in `AnthropicAdapter` — automatically maps dot-notation aliases to valid API IDs
- Added official alias model IDs (`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`) to the provider catalog
- Updated context windows: Sonnet/Opus 4.6 → 1M tokens (was 200K)
- Updated max output: Opus 128K, Sonnet 64K, Haiku 64K (were 8–32K)
- Fixed pricing: Opus 4.6 is $5/$25 per MTok (was incorrectly $15/$75 from Opus 4.5)

#### Default Model Selector Fix (Bug 1)
- Users with Ollama running locally would get Llama as default even after configuring Anthropic
- Expanded preferred model list to cover all major providers (Anthropic, OpenAI, Google, DeepSeek)
- Added non-local fallback: if no preferred model found, pick first non-Ollama model before falling back to `fetched[0]`

#### Better Error Messages (Bug 2b)
- `agent-runner-v2.ts` now propagates actual adapter error details to frontend
- Before: "Provider returned an error" — After: "Provider error: Anthropic error 404: model not found"

#### Setup Wizard — Gemini Search Tip (Bug 3)
- When user configures a non-Google provider, a blue tip box appears recommending a free Google AI key for better search quality
- Links directly to [Google AI Studio](https://aistudio.google.com/apikey)
- Tip disappears once Google AI provider is added

## [1.2.0] — 2026-03-20

### 🎤 Audio Support — Inbound & Outbound

Platform-level audio handling for all agents — no per-agent configuration needed.

#### Inbound (Voice → Text)
- Voice messages and audio files auto-transcribed via OpenAI Whisper API
- Transcription injected as `[🎤 Voice message: "..."]` before the user's text
- Telegram adapter: `downloadFile()` downloads media by `file_id`
- Graceful fallback when Whisper unavailable

#### Outbound (Text → Voice)
- Agents include `[VOICE:/path/to/file]` in response → sent as voice message
- Remaining text sent as caption; falls back to text-only on failure

## [1.1.3] — 2026-03-20

### 📡 Channel Awareness + Agent Resourcefulness

- **Channel context injection** — agents know which channel they're on and what capabilities are available
- **Clark system prompt** — resourcefulness + media handling guidance

## [1.1.2] — 2026-03-20

### 🔌 Connection Resilience

- **Telegram connect retry** — `getMe()` and `bot.start()` now retry 3× with exponential backoff (5s/15s/30s) on transient failures (ETIMEDOUT, network blips). Previously a single timeout permanently disabled the channel.

## [1.1.1] — 2026-03-20

### 🛡️ R22 Reliability Sprint — "Clark Never Dies"

Comprehensive fix for agent tool-call truncation, context overflow, and message persistence bugs.
Root cause: oversized tool results (e.g. 666KB screenshot base64) blowing the provider's context window.

#### Context Overflow Defense (4 layers)
- **Tool result truncation** — results > 100K chars auto-truncated before entering messages array
- **Empty args detection** — tool calls with required params but `{}` args caught pre-execution
- **Overflow recovery** — when provider rejects with token limit, aggressively truncate tool results (2K) and retry
- **Recovery prompt** — `max_tokens_tool_call` finish reason triggers retry with chunking guidance

#### Message Persistence
- **Double-persist eliminated** — `__persisted` flag propagated on error paths (`provider-finish-error`, `all-providers-exhausted`)
- **FTS orphan rows** — `messages_fts` rebuilt after cascade delete to prevent constraint errors

#### Provider Adapters
- **Complete stop reason mapping** — all Anthropic (`pause_turn`, `stop_sequence`, `refusal`, `compaction`, `model_context_window_exceeded`) and OpenAI (`content_filter`) reasons now mapped
- **Ollama `done_reason=length`** — now correctly maps to `max_tokens`
- **Payload size logging** — every OpenAI/Copilot request logs chars, estimated tokens, message count, tool count
- **Unknown stop reasons** — logged with warning instead of silent default

#### Tool Resilience
- **Canvas graceful error** — `canvas({})` returns usage guide instead of cryptic "Unknown action: undefined"
- **Actionable error messages** — write, bash, canvas tools detect empty input and explain truncation cause + chunking suggestions

#### Security (Sherlock Audit)
- **Docker bind** — `0.0.0.0:4070` → `127.0.0.1:4070`
- **Interpreter blocking** — `python -c`, `node -e`, etc. classified as Tier 4 (blocked)

## [1.1.0] — 2026-03-19

### 🚀 Platform Blueprint — "Own Everything"

Self-contained platform with native channel adapters, canvas host, and remote node execution.
No external dependencies on OpenClaw or other orchestrators.

#### Engine v2 (R20 + R21)
- **Native tool-calling loop** — provider-native tool use (Anthropic/OpenAI format), replacing v1 manual construction
- **Graduated loop detection** — WARNING@3 → INJECT@5 → CIRCUIT_BREAKER@8
- **AbortController per run** — `POST /sessions/:id/cancel` for graceful cancellation
- **LLM compaction hardening** — 3-strategy parser, anti-preference rules, better prompt
- **Session locks** — 60s sweep, prevents concurrent runs on same session
- **Run registry** — stale sweep (10min max age), `RunEntry` with `createdAt`
- **Heartbeat executor** — timer-based, 60s timeout, structured JSON alert detection
- **Squad context isolation** — `squadContextIsolation` opt in `runAgentV2`
- **Write extension whitelist** — 20+ allowed dotfiles (`.gitignore`, `.env.*`, `.nvmrc`, etc.)

#### Channel Architecture v2 (Phase 1)
Four production-grade adapters using MIT-licensed libraries:

| Adapter | Library | Features |
|---------|---------|----------|
| **Telegram** | grammy | Streaming via editMessage, inline keyboards, reactions, media, groups, MarkdownV2 |
| **WhatsApp** | Baileys | Multi-device, QR→SSE, auto-reconnect (2s→60s backoff), reactions, media, JID whitelist |
| **Discord** | discord.js v14 | Gateway, message splitting (2000 chars), ActionRow buttons, threads, streaming |
| **Slack** | @slack/bolt v4 | Socket Mode, mrkdwn, Block Kit buttons, thread replies, filesUploadV2, streaming |

- **ChannelRouter** — factory-based adapter lifecycle management, `startAll`/`stopChannel`/`send`/`stream`
- **Management API** — `GET /channels/v2/status`, `POST /channels/v2/:id/start|stop|restart|send`, `GET /channels/v2/:id/qr`
- **Hard stop at 6 channel types** — Telegram, WhatsApp, Discord, Slack, Webhook, (IRC/Signal deferred)

#### Canvas Host (Phase 2)
- Static file server at `/canvas/*` from `~/.hiveclaw/canvas/`
- WebSocket live-reload at `/canvas/ws`
- `POST /canvas/push` — push HTML/A2UI content
- `POST /canvas/navigate` — navigate to URL
- `GET /canvas/status` — current canvas state

#### Node Pairing + RPC (Phase 3)
Remote device execution with 5-tier security:

| Tier | Risk | Approval | Examples |
|------|------|----------|----------|
| 0 | Sensor | Auto | camera_snap, screen_record, location_get |
| 1 | Safe | Auto | ls, pwd, cat, df, uptime |
| 2 | Side-effect | Agent | mkdir, cp, brew install, curl |
| 3 | Destructive | Owner (5min) | rm, kill, sudo, reboot |
| 4 | Blocked | Never | pipe-to-shell, command substitution, mkfs |

- **Command classifier** — binary extraction, blocked pattern detection (Adler Q1: `$()` and backticks blocked even in Tier 2)
- **Node repository** — SQLite schema, SHA-256 hashed auth tokens, token rotation, command audit trail
- **RPC host** — WebSocket at `/api/nodes/connect`, HMAC per-command anti-replay, rate limiting (10/min, 3 concurrent)
- **Approval flow** — SSE broadcast for Tier 3, 5-min timeout, stale detection (§10), late result handling
- **Node tool** — Tool #21, 8 actions: `exec`, `camera_snap`, `camera_list`, `screen_record`, `location_get`, `notifications_list`, `list_nodes`, `node_status`
- **Node client** — `npx hiveclaw-node pair|start|status`, macOS permission pre-request, local policy.json

#### Production Hardening (Phase 4)
- **InboundRateLimiter** — sliding window with per-sender limits
- **CircuitBreaker** — closed→open→half-open, configurable thresholds
- **StreamingDebouncer** — punctuation-terminal OR 500ms hard cap
- **ReconnectManager** — exponential backoff with max attempts
- **Webhook validation** — Telegram secret_token, Discord Ed25519, Slack HMAC-SHA256 (5-min replay protection)

#### Stats
- **Tests**: 270 → **424** (22 test files)
- **Tools**: 19 → **21** (canvas, node)
- **LOC**: ~35K server, ~26K web
- **Dependencies**: 12 → 18 server (6 new: grammy, baileys, discord.js, @slack/bolt, ws, chokidar)

---

## [0.1.0] — 2026-03-12

### 🎉 Initial Release

#### Core Engine
- Native LLM streaming via `chat-engine.ts` — OpenAI-compatible + Anthropic protocols
- `ProviderRouter.chatWithFallback()` — multi-provider routing with automatic fallback
- Quality-aware model routing — 50+ models scored 0-100, quality floors per system task
- Smart 3-tier routing — heartbeat/greeting/chat/complex classification
- Circuit breaker — 3 consecutive failures → 30min provider cooldown
- Loop detection — Jaccard similarity >0.85 prevents infinite loops

#### Memory (Eidetic Memory Layer)
- 5-layer architecture: Core → Buffer → Working → Graph → Archival
- Agent memory with 10 types: short_term, long_term, entity, preference, fact, decision, goal, event, procedure, correction
- Knowledge graph with 6 edge relations: related_to, updates, contradicts, supports, caused_by, part_of
- FTS5 full-text search on chat history (`porter unicode61 remove_diacritics 2`)
- Working memory — structured task state persisted across compactions
- Core memory blocks — agent-editable identity/persona/project notes
- Episodes — non-lossy event log with timestamps
- LLM-powered compaction with heuristic fallback
- Background fact extraction from conversations
- Budget-aware context injection (token budgets per layer)
- Bi-temporal model — `event_at` / `valid_until` for temporal reasoning

#### Security (Score: 7.3/10)
- Workspace sandbox — `validateToolPath()` restricts file operations
- Global auth middleware — API key in production, owner fallback for self-hosted
- Command blocking — 25+ dangerous shell patterns (rm -rf, env vars, sudo, etc.)
- Security headers — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- SSE connection limits — max 50 concurrent streams
- Path traversal protection — `guardPath()` blocks `..` in file operations

#### Agents
- Multi-agent with custom personas, system prompts, and skills
- Agent-specific memory — each agent maintains its own knowledge graph
- Public chat — shareable links for guest access to agents

#### Channels (Batch 7)
- Telegram Bot API — send/receive via webhook
- Discord Webhook — outbound messages
- Slack Webhook — outbound messages + event subscription
- Generic Webhook — configurable URL/method/secret
- Channel message history with direction tracking
- Config masking — bot tokens never exposed in API responses

#### Skill Hub (Batch 7.5)
- 18 curated, audited skills across 9 categories
- Categories: productivity, coding, search, communication, data, automation, creative, utilities
- Verification badges — all skills security-scored ≥ 8.5/10
- Marketplace API — browse, search, install, rate

#### Dashboard & Analytics
- 3-tab dashboard: Overview / Usage / Health
- 5 analytics endpoints: overview, usage-by-model, usage-by-agent, daily-stats, health
- Token usage tracking per session/agent/model
- Cost estimation with 38 model pricing entries

#### Infrastructure
- Docker support — multi-stage build, docker-compose, health checks
- SQLite database — zero-config, single-file persistence
- Pricing externalized to `config/pricing.ts` — 38 models, provider fallbacks
- Configuration defaults in `config/defaults.ts` — single source of truth
- 118 tests across 9 test files

#### Frontend
- WhatsApp-style mobile experience (`MobileApp.tsx`)
- Desktop chat + right sidebar (Code / Preview / Browser / Tasks / Automations)
- Kanban board for task management
- Settings UI with provider, agent, and channel configuration
- Setup wizard for first-run experience
- Service Worker with build-stamped versioning

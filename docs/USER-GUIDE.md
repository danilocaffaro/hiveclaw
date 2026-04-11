# 📖 HiveClaw User Guide

> Everything you need to know to use HiveClaw effectively.

---

## Table of Contents

- [Agents](#agents)
- [Conversations](#conversations)
- [Squads](#squads)
- [Channels (Telegram, WhatsApp, Discord)](#channels)
- [Memory System](#memory-system)
- [Skills](#skills)
- [Nodes (Remote Devices)](#nodes)
- [Settings](#settings)

---

## Agents

An **agent** is an AI personality with its own name, model, system prompt, and memory.

### Create an Agent

**Via UI:**
1. Open sidebar → click **"+ New Agent"**
2. Fill in:
   - **Name**: e.g., "Alice 🐕"
   - **Role**: e.g., "Team Lead"
   - **Model**: pick from available models (e.g., claude-sonnet-4.6)
   - **Provider**: which LLM provider to use
   - **System Prompt**: personality, rules, behavior
   - **Temperature**: 0.0 (deterministic) → 1.0 (creative)
3. Click **Save**

**Via API:**
```bash
curl -X POST http://localhost:4070/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "emoji": "🐕",
    "role": "Team Lead",
    "type": "generalist",
    "modelPreference": "claude-sonnet-4.6",
    "providerPreference": "github-copilot",
    "temperature": 0.7,
    "maxTokens": 4096,
    "systemPrompt": "You are Alice, a helpful team lead..."
  }'
```

### Agent Types

| Type | Use Case |
|------|----------|
| `generalist` | General purpose — can do anything |
| `specialist` | Focused on one domain (QA, marketing, etc.) |
| `coordinator` | Manages squads, delegates tasks |

### Agent Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `modelPreference` | Primary LLM model | claude-sonnet-4.6 |
| `providerPreference` | Primary provider | github-copilot |
| `fallbackProviders` | Backup providers (array) | [] |
| `temperature` | Creativity (0.0–1.0) | 0.7 |
| `maxTokens` | Max response length | 4096 |
| `engineVersion` | Engine version (1 or 2) | 1 |

---

## Conversations

### Start a Chat

1. Click an agent in the sidebar
2. Type your message
3. Press Enter (or click Send)

The agent sees:
- Your message
- Its system prompt
- Its memories (from previous conversations)
- Active skills

### Session Management

Each conversation is a **session**. Sessions are persistent — close the browser and come back, your history is there.

**Create a session via API:**
```bash
curl -X POST http://localhost:4070/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-uuid-here",
    "title": "Project Discussion"
  }'
```

**Send a message via API:**
```bash
curl -X POST http://localhost:4070/api/sessions/{sessionId}/message \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello, can you help me with..."
  }'
```

**List sessions:**
```bash
curl http://localhost:4070/api/sessions
```

### Message Formats

HiveClaw supports:
- **Text** — plain text or Markdown
- **Images** — paste or attach (sent as base64 or file reference)
- **Voice** — audio messages (transcribed automatically if STT configured)
- **Documents** — file attachments

---

## Squads

A **squad** is a team of agents that work together on tasks. Messages can be routed between agents automatically.

### Create a Squad

**Via UI:**
1. Open Settings → **Squads**
2. Click **"+ New Squad"**
3. Configure:
   - **Name**: e.g., "Dream Team 🚀"
   - **Agents**: pick 2+ agents
   - **Routing**: how messages flow between agents

**Via API:**
```bash
curl -X POST http://localhost:4070/api/squads \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dream Team",
    "emoji": "🚀",
    "agents": ["agent-id-1", "agent-id-2", "agent-id-3"],
    "routing": "sequential"
  }'
```

### Routing Modes

| Mode | How it works |
|------|-------------|
| `sequential` | Message goes Agent 1 → Agent 2 → Agent 3 in order |
| `parallel` | All agents receive the message simultaneously |
| `smart` | Router agent decides who should handle it |
| `round-robin` | Alternates between agents per message |

### Squad Roles (NEXUS Protocol)

When agents work in a squad, they assume roles by position:

| Position | Role | Responsibility |
|----------|------|---------------|
| 1st agent | PO | Requirements, acceptance |
| 2nd agent | Tech Lead | Architecture, implementation |
| 3rd agent | QA Lead | Testing, code review |
| 4th agent | SRE | Deploy, security |

---

## Channels

Connect HiveClaw to external messaging platforms so you can chat with your agents from your phone.

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. In HiveClaw, go to **Settings → Channels → Add Channel**
4. Select **Telegram**
5. Paste the bot token
6. Select which agent handles this channel
7. Click **Connect**

```bash
# Or via API:
curl -X POST http://localhost:4070/api/channels \
  -H "Content-Type: application/json" \
  -d '{
    "type": "telegram",
    "config": {
      "token": "123456:ABC-DEF...",
      "agentId": "agent-uuid"
    }
  }'
```

### WhatsApp

HiveClaw uses the WhatsApp Web protocol (no Meta Business API required):

1. Go to **Settings → Channels → Add Channel → WhatsApp**
2. Scan the QR code with your phone
3. Select the agent
4. Done — messages to that WhatsApp number go to your agent

> ⚠️ WhatsApp Web sessions can expire. If the agent stops responding, re-scan the QR code.

### Discord

1. Create a Discord bot at [discord.com/developers](https://discord.com/developers)
2. Copy the bot token
3. Add channel in HiveClaw → paste token → select agent
4. Invite the bot to your Discord server

### Allowed Users

For security, you can restrict which users can talk to your agent:

```bash
curl -X PUT http://localhost:4070/api/channels/{channelId} \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "allowedUsers": ["telegram_user_id_1", "telegram_user_id_2"]
    }
  }'
```

---

## Memory System

HiveClaw agents have persistent memory across conversations.

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `fact` | Learned information | "User prefers dark mode" |
| `correction` | Fixed mistake | "Actually, the deadline is Friday" |
| `decision` | Made choice | "Using PostgreSQL for this project" |
| `goal` | Active objective | "Ship v2.0 by March" |
| `preference` | User preference | "Respond in Portuguese" |
| `entity` | Person/place/thing | "Alice is the team lead" |
| `event` | Something that happened | "Server went down at 3am" |
| `procedure` | How to do something | "Deploy steps: build → test → push" |

### How Memory Works

1. **Automatic**: The agent creates memories during conversations
2. **Core Memory**: Always-visible blocks (persona, human, project, scratchpad) — limited to 2500 chars each
3. **Agent Memory**: Searchable long-term storage — unlimited
4. **Archival Search**: Full-text search across all past messages

### Memory via API

```bash
# List an agent's memories
curl http://localhost:4070/api/agents/{agentId}/memories

# Search memories
curl "http://localhost:4070/api/agents/{agentId}/memories/search?q=deployment"
```

---

## Skills

Skills are reusable capabilities that agents can learn and use.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `self-learning` | Agent learns from gaps and failures |
| `macos-control` | Control macOS (keyboard, mouse, windows) |
| `ui-qa` | Automated UI quality assurance |
| `voice-tts-stt` | Text-to-speech and speech-to-text |
| `image-analysis` | Analyze images with vision LLMs |
| `agent-messaging` | Authenticated agent-to-agent messaging |
| `team-protocols` | Squad operating protocols (NEXUS/AGECON) |

### Custom Skills

Create your own skill:

1. Create a folder: `~/.hiveclaw/workspace/skills/my-skill/`
2. Add a `SKILL.md` with:
   - Description
   - Usage examples
   - Scripts (in `scripts/` subfolder)
3. Assign to an agent in Settings

### Skill Structure

```
~/.hiveclaw/workspace/skills/my-skill/
├── SKILL.md          # Main documentation
├── scripts/
│   ├── run.sh        # Executable scripts
│   └── helper.py     # Support files
└── config.yaml       # Optional configuration
```

---

## Nodes

**Nodes** are remote devices that agents can control (run commands, take photos, get location, etc.).

### Pair a Node

1. Install the HiveClaw Node agent on the remote device
2. In HiveClaw, go to **Settings → Nodes → Add Node**
3. Enter the pairing code shown on the device
4. Set permissions (what the agent can do on that device)

### Node Actions

| Action | Description | Risk Tier |
|--------|-------------|-----------|
| `exec` | Run a shell command | 0-3 (depends on command) |
| `camera_snap` | Take a photo | 1 |
| `screen_record` | Take a screenshot | 1 |
| `location_get` | Get GPS coordinates | 2 |
| `notifications_list` | Read notifications | 2 |

### Security Tiers

| Tier | Policy | Examples |
|------|--------|---------|
| 0-1 | Automatic | `ls`, `pwd`, `date` |
| 2 | Agent-approved | `location_get`, read files |
| 3 | Owner approval (5min timeout) | Install software, system changes |
| 4 | Blocked | `rm -rf /`, shutdown, format |

---

## Settings

Access via the gear icon in the sidebar or **http://localhost:4070/settings**.

### Key Settings

| Section | What you configure |
|---------|--------------------|
| **Profile** | Your name, avatar |
| **Providers** | LLM API keys, model preferences |
| **Agents** | Create/edit agents |
| **Squads** | Team configurations |
| **Channels** | Telegram, WhatsApp, Discord |
| **Nodes** | Remote device management |
| **Security** | API keys, auth settings |
| **Appearance** | Theme (7 built-in themes), colors |

### Themes

HiveClaw includes 7 color themes:
- Default (amber/blue)
- Dark
- Light
- Nord
- Solarized
- Dracula
- Monokai

Change in **Settings → Appearance → Theme**.

---

## Tips & Best Practices

1. **Start simple** — one agent, one provider. Add complexity later.
2. **Use system prompts** — the more specific, the better the agent behaves.
3. **Set fallback providers** — if your primary LLM is down, the agent auto-switches.
4. **Keep core memory lean** — 2500 chars per block. Be concise.
5. **Use squads for complex tasks** — break work into roles (PO, dev, QA).
6. **Connect a channel** — Telegram is the easiest to set up.
7. **Check /api/health** — quick way to verify everything is running.

---

*HiveClaw v1.3 — [Getting Started](GETTING-STARTED.md) | [API Reference](API.md) | [Troubleshooting](TROUBLESHOOTING.md)*

# HiveClaw API Reference

> Auto-generated from route registrations. Base URL: `http://localhost:4070`
> All endpoints use `/api/` prefix in requests (e.g., `GET /api/health`).
> Version: 0.2.0 | Schema: 4

## Endpoints


### Agents (`agents.ts`)

| Method | Path |
|--------|------|
| `GET` | `/agents` |
| `POST` | `/agents` |
| `DELETE` | `/agents/:id` |
| `GET` | `/agents/:id` |
| `PATCH` | `/agents/:id` |
| `DELETE` | `/agents/:id/memory` |
| `POST` | `/agents/discover` |
| `GET` | `/agents/status/stream` |
| `GET` | `/agents/templates` |

### Analytics (`analytics.ts`)

| Method | Path |
|--------|------|
| `GET` | `/analytics/health` |
| `GET` | `/analytics/usage` |
| `GET` | `/analytics/usage/agent` |
| `GET` | `/analytics/usage/daily` |
| `GET` | `/analytics/usage/model` |

### Artifacts (`artifacts.ts`)

| Method | Path |
|--------|------|
| `GET` | `/artifacts` |
| `POST` | `/artifacts` |
| `DELETE` | `/artifacts/:id` |
| `GET` | `/artifacts/:id` |
| `PATCH` | `/artifacts/:id` |

### Auth (`auth.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/auth/api-keys` |
| `POST` | `/api/auth/api-keys` |
| `DELETE` | `/api/auth/api-keys/:id` |
| `POST` | `/api/auth/api-keys/:id/rotate` |
| `GET` | `/api/auth/sessions` |
| `DELETE` | `/api/auth/sessions/:id` |
| `GET` | `/audit` |
| `GET` | `/auth/me` |
| `GET` | `/auth/users` |
| `DELETE` | `/auth/users/:id` |
| `POST` | `/auth/users/:id/api-key` |

### Automations (`automations.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/automations` |
| `DELETE` | `/api/automations/:id` |
| `POST` | `/api/automations/:id/run` |

### Backlog (`backlog.ts`)

| Method | Path |
|--------|------|
| `DELETE` | `/backlog/:id` |
| `GET` | `/backlog/:id` |

### Browser (`browser.ts`)

| Method | Path |
|--------|------|
| `POST` | `/browser/screenshot` |
| `GET` | `/browser/sessions` |
| `POST` | `/browser/sessions` |
| `DELETE` | `/browser/sessions/:id` |
| `GET` | `/browser/sessions/:id/screenshot` |
| `GET` | `/browser/status` |

### Channels (`channels.ts`)

| Method | Path |
|--------|------|
| `GET` | `/channels` |
| `DELETE` | `/channels/:id` |
| `GET` | `/channels/:id` |
| `POST` | `/channels/:id/test` |

### Config (`config.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/config/database` |
| `GET` | `/api/config/database/export` |
| `POST` | `/api/config/database/import` |
| `POST` | `/api/config/database/purge` |
| `GET` | `/api/config/integrations` |
| `PUT` | `/api/config/integrations` |
| `GET` | `/config` |
| `GET` | `/config/mode` |
| `PATCH` | `/config/mode` |
| `GET` | `/models` |

### Console (`console.ts`)

| Method | Path |
|--------|------|
| `POST` | `/api/console/clear` |
| `GET` | `/api/console/history` |
| `GET` | `/api/console/stream` |

### Credentials (`credentials.ts`)

| Method | Path |
|--------|------|
| `POST` | `/credentials/cleanup` |
| `GET` | `/credentials/requests/:id` |
| `GET` | `/credentials/vault` |
| `DELETE` | `/credentials/vault/:id` |
| `GET` | `/credentials/vault/:id` |

### Data (`data.ts`)

| Method | Path |
|--------|------|
| `POST` | `/data/analyze` |

### Embeddings (`embeddings.ts`)

| Method | Path |
|--------|------|
| `GET` | `/embeddings/status` |

### External Agents (`external-agents.ts`)

| Method | Path |
|--------|------|
| `GET` | `/external-agents` |
| `POST` | `/external-agents` |
| `DELETE` | `/external-agents/:id` |
| `GET` | `/external-agents/:id` |
| `GET` | `/external-agents/:id/protocol-pack` |
| `POST` | `/external-agents/:id/test` |
| `DELETE` | `/external-agents/:id/token` |
| `POST` | `/external-agents/:id/upgrade` |

### Files (`files.ts`)

| Method | Path |
|--------|------|
| `POST` | `/api/files/upload` |
| `POST` | `/files/upload` |
| `GET` | `/files/uploads/:filename` |

### Finetune (`finetune.ts`)

| Method | Path |
|--------|------|
| `GET` | `/finetune/datasets` |
| `POST` | `/finetune/datasets` |
| `DELETE` | `/finetune/datasets/:id` |
| `GET` | `/finetune/datasets/:id` |
| `GET` | `/finetune/jobs` |
| `POST` | `/finetune/jobs` |
| `GET` | `/finetune/jobs/:id` |

### Health (`health.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/health` |
| `GET` | `/api/update` |
| `GET` | `/api/version` |
| `GET` | `/healthz` |
| `GET` | `/status` |

### Heartbeat (`heartbeat.ts`)

| Method | Path |
|--------|------|
| `POST` | `/heartbeat/run` |
| `GET` | `/heartbeat/status` |

### Invites (`invites.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/invites` |
| `GET` | `/api/invites/:code/info` |
| `DELETE` | `/api/invites/:id` |

### Marketplace (`marketplace.ts`)

| Method | Path |
|--------|------|
| `GET` | `/marketplace/:id` |
| `POST` | `/marketplace/:id/install` |
| `POST` | `/marketplace/:id/uninstall` |
| `GET` | `/marketplace/curated/:slug` |

### Mcp (`mcp.ts`)

| Method | Path |
|--------|------|
| `POST` | `/mcp/connect` |
| `POST` | `/mcp/disconnect` |
| `GET` | `/mcp/servers` |

### Memory (`memory.ts`)

| Method | Path |
|--------|------|
| `DELETE` | `/memory/:id` |
| `DELETE` | `/memory/edges/:edgeId` |
| `GET` | `/memory/types` |

### Messages (`messages.ts`)

| Method | Path |
|--------|------|
| `GET` | `/messages/:id/reactions` |
| `POST` | `/messages/:id/star` |
| `GET` | `/starred` |

### N8N (`n8n.ts`)

| Method | Path |
|--------|------|
| `GET` | `/n8n/config` |
| `PUT` | `/n8n/config` |
| `GET` | `/n8n/status` |
| `POST` | `/n8n/trigger/:id` |
| `GET` | `/n8n/workflows` |
| `POST` | `/n8n/workflows/:id/activate` |

### Plans (`plans.ts`)

| Method | Path |
|--------|------|
| `DELETE` | `/plans/:id` |
| `GET` | `/plans/:id` |

### Presentations (`presentations.ts`)

| Method | Path |
|--------|------|
| `GET` | `/presentations` |
| `POST` | `/presentations` |
| `DELETE` | `/presentations/:id` |
| `GET` | `/presentations/:id` |
| `GET` | `/presentations/:id/export` |

### Preview (`preview.ts`)

| Method | Path |
|--------|------|
| `GET` | `/api/preview/events` |
| `POST` | `/api/preview/watch` |

### Providers (`providers.ts`)

| Method | Path |
|--------|------|
| `GET` | `/config/models` |
| `GET` | `/config/models/default` |
| `PUT` | `/config/models/default` |
| `GET` | `/config/providers` |
| `DELETE` | `/config/providers/:id` |
| `GET` | `/config/providers/:id` |
| `POST` | `/config/providers/:id/test` |
| `GET` | `/providers` |
| `GET` | `/providers/:id` |

### Public Chat (`public-chat.ts`)

| Method | Path |
|--------|------|
| `GET` | `/public/chat/:token` |
| `GET` | `/shared-links` |
| `DELETE` | `/shared-links/:id` |
| `PUT` | `/shared-links/:id/toggle` |
| `GET` | `/shared-links/agent/:agentId` |

### Questions (`questions.ts`)

| Method | Path |
|--------|------|
| `GET` | `/questions/:id` |
| `POST` | `/questions/:id/reject` |

### Routing (`routing.ts`)

| Method | Path |
|--------|------|
| `GET` | `/routing/circuits` |
| `POST` | `/routing/circuits/:key/reset` |
| `GET` | `/routing/tiers` |

### Sessions (`sessions.ts`)

| Method | Path |
|--------|------|
| `GET` | `/sessions` |
| `DELETE` | `/sessions/:id` |
| `GET` | `/sessions/:id` |
| `POST` | `/sessions/:id/compact` |
| `GET` | `/sessions/:id/events` |
| `GET` | `/sessions/:id/usage` |

### Setup (`setup.ts`)

| Method | Path |
|--------|------|
| `POST` | `/setup/complete` |
| `POST` | `/setup/copilot/device-code` |
| `GET` | `/setup/status` |

### Skill Scout (`skill-scout.ts`)

| Method | Path |
|--------|------|
| `GET` | `/skills/recommended` |
| `POST` | `/skills/recommended/:id/activate` |
| `GET` | `/skills/recommended/all` |
| `POST` | `/skills/scout/run` |
| `GET` | `/skills/scout/status` |

### Skills (`skills.ts`)

| Method | Path |
|--------|------|
| `GET` | `/skills` |
| `DELETE` | `/skills/:slug` |
| `GET` | `/skills/:slug` |
| `POST` | `/skills/reload` |

### Squads (`squads.ts`)

| Method | Path |
|--------|------|
| `GET` | `/squads` |
| `POST` | `/squads` |
| `DELETE` | `/squads/:id` |
| `GET` | `/squads/:id` |
| `PATCH` | `/squads/:id` |
| `GET` | `/squads/:id/events` |
| `GET` | `/squads/:id/members` |
| `GET` | `/squads/templates` |

### Sse (`sse.ts`)

| Method | Path |
|--------|------|
| `GET` | `/engine/events/:sessionId` |
| `GET` | `/events` |

### Tasks (`tasks.ts`)

| Method | Path |
|--------|------|
| `GET` | `/tasks` |
| `POST` | `/tasks` |
| `DELETE` | `/tasks/:id` |
| `GET` | `/tasks/:id` |
| `PATCH` | `/tasks/:id` |
| `POST` | `/tasks/:id/move` |

### Workflows (`workflows.ts`)

| Method | Path |
|--------|------|
| `GET` | `/workflow-runs` |
| `GET` | `/workflow-runs/:id` |
| `POST` | `/workflow-runs/:id/cancel` |
| `GET` | `/workflow-runs/:id/stream` |
| `GET` | `/workflows` |
| `POST` | `/workflows` |
| `DELETE` | `/workflows/:id` |
| `GET` | `/workflows/:id` |
| `PUT` | `/workflows/:id` |
| `POST` | `/workflows/:id/run` |

---

**Total: 184 endpoints across 39 modules.**

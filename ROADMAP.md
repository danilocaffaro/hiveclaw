# SuperClaw Pure — Consolidated Roadmap

> Consolidado em 2026-03-13 a partir de: Clark (code audit), Alice (PO review), Dream Team squad discussion.
> Score atual: **7.2/10** (Clark) — "problemas cirúrgicos, não estruturais"

---

## 🔴 Tier 1 — Critical (bugs, security, debt)

| # | Item | Justificativa | Esforço | Owner |
|---|------|---------------|---------|-------|
| **1.1** | **Unificar runners** — deprecar `native-session-runner.ts` (143L), tudo via `agent-runner.ts` | 2 caminhos de execução paralelos, features dessincronizadas | ~3h | Clark |
| **1.2** | **Remover `squad-bridge-runner.ts`** — extrair `SquadAgent` pra `types/squad.ts`, atualizar `archer-router.ts` | 421L de código morto, tipo duplicado importado por router ativo = bomba-relógio | ~2h | Clark |
| **1.3** | **Rate limiting** — `@fastify/rate-limit` em todos endpoints | Zero rate limiting hoje. Risco de abuse/DDoS em endpoints públicos | ~1h | Clark |
| **1.4** | **Fix agentId na criação de sessão** — `POST /sessions` aceita `agent_id` mas não persiste efetivamente | Sessions órfãs, sem vínculo com agente | ~1h | Clark |
| **1.5** | **`/health` endpoint** — JSON puro com versão, uptime, DB status | Hoje retorna HTML ou nada. Essencial pra monitoring/Docker | ~30m | Clark |
| **1.6** | **Memory extraction: negation-aware** — `"I never use tabs"` salva como preferência positiva (score 0.9) | Bug silencioso que inverte preferências do usuário | ~2h | Clark |

**Estimativa Tier 1: ~10h (1-2 sprints)**

---

## 🟡 Tier 2 — Important (stability, quality)

| # | Item | Justificativa | Esforço | Owner |
|---|------|---------------|---------|-------|
| **2.1** | **Tool calling E2E tests** — testar agentic loop completo (tool_use → execute → result → continue) | Hoje só tem testes unitários. Sem E2E, regressão é invisível | ~4h | Clark |
| **2.2** | **Loop detector com decay temporal** — resetar janela após N min de inatividade | Hoje loop detection não considera gaps temporais | ~2h | Clark |
| **2.3** | **Limpar schema** — identificar e remover tabelas fantasma do fork OI→Pure | Dados orphan, confusão em queries, migration debt | ~2h | Clark |
| **2.4** | **UI External Agents** — CRUD + test + status/circuit breaker na interface | Backend 100% pronto, zero exposição na UI | ~4h | — |
| **2.5** | **`streamGoogle` nativo** — 3º streaming mode no chat-engine.ts | Workaround via OpenRouter existe, mas latência extra | ~3h | Clark |
| **2.6** | **MAX_TOOL_ITERATIONS adaptativo + UI** — **(a)** Expor setting na UI do agent config (backend pronto); **(b)** Progressive extension: começar com default (40), ao atingir 80% do limite, checar progresso real (file changes no workdir, commits, test results) — se houve progresso, estender +N iterações automaticamente; **(c)** Checkpoint-based reset: agent emite `[CHECKPOINT]` tag → contador reseta; sem checkpoint em X iterações → timeout. Elimina hard caps arbitrários | ✅ Backend pronto (commit `9a39882`), falta UI + heurística adaptativa | ~4h | Clark |
| **2.7** | **Squad Intelligence — Plugar ARCHER v2 no squad-runner** | ARCHER v2 existe (258L) mas NINGUÉM chama. `parseMentions` + `detectPullThrough` são código morto. Plugar no squad-runner: @mention routing real, PO pull-through, smart skip | ~4h | Clark |
| **2.8** | **Agent-to-agent dentro de squad** — resposta de um agente pode @mencionar outro → sistema roteia automaticamente | Hoje são N respostas independentes. Com isso, viram conversa real | ~3h | Clark |
| **2.9** | **Smart skip** — se step N já resolveu, step N+1 pode avaliar e pular ou complementar | Evita respostas redundantes no sequential mode | ~2h | Clark |

| **2.10** | **Multi-user access + Public Agent Interface** — 3 camadas: **(a)** Share Link v2: link público com branding do agente (avatar, nome, cor), chat polido, sem login (descartável, tipo widget de suporte); **(b)** Invited Users: auth por PIN (acesso rápido) ou magic link por email (persistente), acesso a agentes específicos, histórico persistente, rate limit por user; **(c)** Squad Guest: humano externo entra em squad chat via invite link + PIN/magic link, participa como membro com role "guest". Auth: tabela `users` com roles (owner/invited/guest), session tokens, admin panel pra owner gerenciar acessos/limites/revogação. Sem OAuth na v1 | Transforma SuperClaw de tool pessoal em plataforma. Qualquer pessoa usa via link sem instalar nada | ~14h | Clark |

**Estimativa Tier 2: ~37h (5-6 sprints)**

---

## 🟢 Tier 3 — Growth (features, differentiators)

| # | Item | Justificativa | Esforço | Owner |
|---|------|---------------|---------|-------|
| **3.1** | **MCP Client na UI** — expor MCP tools (se backend pronto) na interface | Diferencial competitivo enorme. PicoClaw/OpenClaw não têm UI pra isso | ~4h | — |
| **3.2** | **Docker + GHCR** — imagem publicada, `docker run` funcional | Destrava distribuição. 100% independente, pode rodar em paralelo | ~3h | — |
| **3.3** | **Agent templates** — Tutor, Planner, Translator, Coach, Shopper | Valor de onboarding, zero risco técnico | ~1h | — |
| **3.4** | **Squads + Debate UI completa** — visualizar turns, routing strategy, agent status ao vivo | Squad funciona mas UI é mínima | ~6h | — |
| **3.5** | **Presentations API + reveal.js** — agente cria slides | Feature de wow factor | ~4h | — |
| **3.6** | **Visual Memory L6** — describe-then-store para imagens | Memória de longo prazo visual | ~3h | — |
| **3.7** | **Topic-based segmentation** — clustering de conversas por tema via embeddings | Melhor retrieval, UX de "pastas" de contexto | ~3h | — |
| **3.8** | **Doctor API** — `/api/doctor` endpoint: DB integrity (FKs, orphans), provider connectivity test, agent health (sem provider válido), disk/memory usage, schema version check. Inspirado no `openclaw doctor`. Opcional: `POST /api/doctor/fix` pra auto-correção | Self-healing, monitoring, onboarding confidence | ~4h | — |
| **3.9** | **Starter Kit + Skill Intelligence** — 3 camadas: **(a)** Starter Package: todo novo agente nasce com pacote base de skills essenciais (web search, browser, file ops, memory, calendar, email, code execution, data analysis) pré-instaladas e ativas. Marketplace é para skills EXTRAS, não para o básico; **(b)** Auto-Discovery: rotina periódica (cron/background) que pesquisa comunidades especializadas (ClawHub, PicoClaw registry, GitHub trending, HuggingFace, Reddit r/agents) por skills novas/populares, analisa utilidade, rankeia por adoção/reviews; **(c)** Reverse Engineering Pipeline: ao identificar skill útil de outra plataforma, faz análise funcional (não copia código), entende o que faz, e cria versão nativa SuperClaw (clean-room rewrite) com testes, docs e verificação. Skills criadas assim recebem badge "🔄 Inspired by [source]" | Experiência out-of-box vs configuração manual. Ninguém quer montar agente skill por skill. Diferencial competitivo: ecossistema auto-evolutivo | ~16h | — |
| **3.10** | **Config Architecture: Platform → Default Kit → Per-Agent** — 3 camadas de configuração: **(a)** Platform-level (global): provider keys, security, rate limits — herança automática pra todos; **(b)** Default Agent Kit: template padrão que todo novo agente herda (starter skills, tools, temperature, max tokens) — editável pelo owner; **(c)** Per-Agent Override: customização específica (Clark=bash+code, Hawk=browser+curl, Tutor=sem bash). Skills: instalar = disponível no catálogo global; ativar = per-agent. Hoje é tudo-ou-nada (skills `[]`, tools globais pra todos). Inclui UI de "Agent Kit Editor" | Sem isso, não tem como dar bash pro Clark e negar pro Tutor. Segurança + UX | ~8h | — |
| **3.11** | **Appearance Overhaul** — **(a)** Default theme = Light (não dark). Maioria dos produtos B2C default light; **(b)** Adotar paleta **Radix Colors** (sistema de 12 steps com contraste garantido WCAG AA). Substituir paleta GitHub Dark atual por Radix scales; **(c)** Múltiplos temas pré-built: Light (Radix Slate), Dark (Radix Slate Dark), Warm (Radix Sand), Cool (Radix Blue), Midnight (Radix Mauve Dark) — mínimo 5 opções; **(d)** Accent color picker: usuário escolhe cor primária (purple, blue, teal, green, orange, pink) — aplica em botões, links, badges; **(e)** Font size preference (compact/default/comfortable); **(f)** Preview em tempo real no Settings → Appearance | Produto B2C precisa ser bonito out-of-box. Dark default afasta maioria dos users. Paleta atual é funcional mas genérica | ~10h | — |

**Estimativa Tier 3: ~78h (10-13 sprints)**

---

## 📐 Princípios de Execução

1. **Tier 1 ANTES de qualquer Tier 2/3** — segurança e estabilidade primeiro
2. **QA >95% antes de avançar sprint** — padrão mantido desde Sprint 22
3. **Docker (3.2) roda em paralelo** desde já — independente do resto
4. **0 erros TypeScript** — gate obrigatório em todo commit
5. **Git commit em `main`** com mensagens detalhadas

---

## 📊 Tracking

| Sprint | Itens | Status |
|--------|-------|--------|
| **Sprint 69** | 1.1, 1.2, 1.3 | ✅ Done |
| **Sprint 70** | 1.4, 1.5, 1.6 | ✅ Done |
| **Sprint 71** | 2.1, 2.2, 2.3 | ✅ Done |
| **Sprint 72** | 2.4, 2.5, 2.6 | 🔲 Planned |
| **Sprint 73** | 2.7, 2.8, 2.9 (Squad Intelligence) | ✅ Done |
| **Sprint 74** | Structural fixes (launchd, watchdog, playwright, anti-fabrication) | ✅ Done |
| **Sprint 75+** | 2.4, 2.5, 2.6 + QA fixes | 🔲 Planned |
| **Sprint 76+** | Tier 3 (incl. 3.8 Doctor, 3.9 Starter Kit) | 🔲 Backlog |

---

*Última atualização: 2026-03-13*
*Fontes: Clark code audit (7.2/10), Alice PO review, Dream Team squad session*

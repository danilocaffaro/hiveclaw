# 🏃 Sprint Plan — SuperClaw Pure

## Ciclo de Execução (obrigatório)

```
┌─────────────────────────────────────────────────────────────────┐
│  🐕 Alice (PO) planeja sprint → items do QA-CONSOLIDATED.md    │
│  ↓                                                               │
│  🐙🐕🦅 Discussão no Dream Team squad → consenso (AGECON)       │
│  ↓                                                               │
│  🐙 Clark implementa (1 item por dispatch, max 80 iterations)   │
│  ↓                                                               │
│  🐕 Alice review como PO → approve/reject                       │
│  ↓                                                               │
│  🦅 Hawk QA real (agent-browser, screenshots, curl)              │
│  ↓                                                               │
│  Score >95%? → ✅ Próximo sprint                                  │
│  Score <95%? → 🔄 Fix cycle até atingir                          │
└─────────────────────────────────────────────────────────────────┘
```

## Regras

1. **1 item por dispatch ao Clark** — nunca bundle 3+ items (risco de perda por iteration exhaustion)
2. **Clark usa `agent-browser` pra verificar UI** depois de cada mudança
3. **Hawk usa `agent-browser` pra QA visual** — screenshots obrigatórios, zero fabricação
4. **Alice faz review de PO** — verifica se o item realmente resolve o problema do HUMANO
5. **Commit após cada item aprovado** — não acumular
6. **Sprint de QA Full (Sprint 78)** — dedicado 100% a teste end-to-end com roteiros

---

## Sprint 75 — Criticals 🔴

**Objetivo:** Eliminar os 4 bugs críticos que bloqueiam release

| # | Item | Assignee | Descrição |
|---|------|----------|-----------|
| C1 | Auto-scroll to bottom | Clark | Ao abrir DM/Squad, scroll vai pra mensagem mais recente. `scrollTo({ top: el.scrollHeight })` no mount + ao receber nova mensagem |
| C2 | Auth no DB export | Clark | `GET /api/config/database/export` deve exigir API key header. Sem auth = 401 |
| C3 | Input sanitization (XSS) | Clark | Sanitizar `name`, `role`, `system_prompt` no POST/PUT de agents. Strip HTML tags no input. DOMPurify ou regex `<[^>]*>` |
| C4 | Provider configured flag | Clark | `providers.ts:116` — checar raw key (antes de mascarar), não masked key. `const configured = !!rawKey && rawKey.length > 10` |

**Critério de aceite:** 0 critical restante no QA retest

---

## Sprint 76 — Major Fixes 🟡 (técnico)

**Objetivo:** Limpar dados podres + corrigir tabs/APIs quebradas

| # | Item | Assignee | Descrição |
|---|------|----------|-----------|
| M1 | Loading models fix | Clark | Model selector no sidebar bottom-left mostra "Loading models..." eterno. Debugar fetch de modelos — provavelmente endpoint retorna erro silencioso ou provider flag false impede fetch |
| M7 | Data & Storage tab | Clark | Settings > Data & Storage renderiza só título. Implementar conteúdo: DB size, session count, export button, purge button |
| M8 | Squad list expand agents | Clark | `GET /api/squads` deve incluir array de agent objects (não só IDs). Expandir `agent_ids` JSON no query |
| M9 | Session cleanup | Clark | Script/migration que deleta as 18+ sessões teste/órfãs. Adicionar FK validation em POST /api/sessions |
| M10 | Blue bubbles migration | Clark | UPDATE das 6 mensagens com `role='user'` que são respostas de external agent → `role='assistant'` |
| M11 | sw.js stamp fix | Clark | Garantir que build pipeline executa o stamp `v__BUILD_TS__` → `v{timestamp}` em `out/sw.js` |
| M13 | Squad agent identity | Clark | Mensagens no squad devem mostrar nome/emoji do agente real, não "🤖 Assistant" genérico |

**Critério de aceite:** Todas 7 tabs de Settings funcionam; sidebar limpa; squad mostra agentes corretos

---

## Sprint 77 — Messenger-Grade UX 💬

**Objetivo:** SuperClaw parece messenger real, não protótipo de dev

| # | Item | Assignee | Descrição |
|---|------|----------|-----------|
| M2 | Typing indicator | Clark | Animação "..." pulsante quando agente está gerando resposta. SSE event `typing.start` / `typing.stop` |
| M3 | Unread count badges | Clark | Sidebar mostra badge numérico com mensagens não lidas por DM/squad. Counter incrementa em real-time via SSE |
| M5+M6 | Create Agent + Squad wizards | Clark | Step-by-step guiado: (1) Nome+emoji, (2) Provider/model, (3) System prompt com templates, (4) Skills/tools, (5) Test chat rápido. Squad: (1) Nome, (2) Add agents, (3) Strategy, (4) Preview |
| N7 | Scroll-to-bottom FAB | Clark | Botão flutuante "↓" aparece quando user scrollou pra cima, com badge "N novas mensagens" |
| N9 | Message timestamps | Clark | Agrupamento por data ("Today", "Yesterday", "Mar 12"), hover mostra hora exata |

**Critério de aceite:** Typing indicator visível; unread badges funcionando; wizards step-by-step; scroll FAB aparece quando necessário

---

## Sprint 78 — QA Full 🦅🔍 (100% teste)

**Objetivo:** Sprint inteiro dedicado a QA end-to-end. Zero implementação. Só teste.

### Roteiros de Teste

#### RT-01: Onboarding (usuário virgem)
1. Abrir SuperClaw pela primeira vez (limpar cookies)
2. O que aparece? É óbvio o que fazer?
3. Criar primeiro agente via wizard
4. Enviar primeira mensagem
5. Receber resposta
6. **Expectativa:** Usuário leigo completa em <2 min sem manual

#### RT-02: Chat DM completo
1. Abrir DM com Clark
2. Verificar: scroll está no fim (mensagens recentes)?
3. Enviar mensagem de texto simples
4. Verificar: typing indicator aparece?
5. Verificar: resposta chega via streaming?
6. Verificar: markdown renderiza? (bold, code, tables, lists)
7. Enviar mensagem longa (500+ chars)
8. Enviar mensagem com código
9. Enviar mensagem com emojis
10. Scrollar pra cima → verificar: FAB "↓" aparece?
11. Receber mensagem enquanto scrollado pra cima → badge "N novas" aparece?
12. Clicar FAB → scroll desce pro fim?
13. **Expectativa:** Flow completo sem bugs, <3s latência

#### RT-03: Squad Chat
1. Entrar no Dream Team
2. Verificar: 3 agents listados no header (Clark, Alice, Hawk)?
3. Verificar: mensagens mostram nome+emoji do agent correto (não "Assistant")?
4. Enviar mensagem
5. Verificar: cada agente responde na ordem (sequential)?
6. Verificar: cores das bubbles são distintas por agente?
7. Verificar: sem mensagens duplicadas?
8. Verificar: sem mensagens de sistema vazando pro chat?
9. **Expectativa:** Conversa multi-agente funciona sem confusão visual

#### RT-04: Criar Agente (wizard)
1. Clicar "+" ou "New Agent"
2. Step 1: Nome + emoji → preencher
3. Step 2: Provider/model → selecionar
4. Step 3: System prompt → usar template sugerido
5. Step 4: Skills → selecionar web search + code
6. Step 5: Test chat → mandar "olá" → receber resposta
7. Confirmar criação
8. Verificar: agente aparece na sidebar?
9. Abrir DM com novo agente → funciona?
10. Deletar agente de teste
11. **Expectativa:** Wizard completo, agente funcional

#### RT-05: Criar Squad (wizard)
1. Clicar "+" em Squads
2. Preencher nome
3. Adicionar 2+ agentes
4. Escolher strategy (sequential)
5. Preview do squad
6. Confirmar criação
7. Verificar: squad aparece na sidebar com member count correto?
8. Enviar mensagem no squad → todos agentes respondem?
9. **Expectativa:** Squad funcional em <1 min

#### RT-06: Settings (todas as tabs)
1. Abrir Settings (⌘,)
2. **General:** Language, Response style, Markdown toggle, Workspace dir → mudar cada um → Save → reabrir → persistiu?
3. **Appearance:** Mudar tema Dark→Light→System. Mudar Interface Mode. Compact mode toggle → tudo aplica em real-time?
4. **Providers:** Listar providers. Status correto (configured/not)? Adicionar API key → Test connection → funciona?
5. **Models:** Lista de modelos carrega? (não fica "Loading models..." eterno)
6. **Agents:** Lista de agentes. Clicar em Edit → editar nome → salvar → persistiu?
7. **MCP Servers:** Carrega? (mesmo que vazio)
8. **Skills:** Lista skills instaladas?
9. **Keybindings:** Mostra atalhos?
10. **Security:** Mostra configs de segurança?
11. **Data & Storage:** Mostra DB info, Export, Purge?
12. **Integrations:** Mostra integrações?
13. **Vault:** Mostra credentials?
14. **Advanced:** Mostra configs avançadas?
15. **Deploys:** Mostra info de deploy?
16. **Expectativa:** Todas 14 tabs carregam com conteúdo real, nenhuma fica em "Loading..." ou vazia

#### RT-07: API Consistency
1. `GET /api/health` → 200, version, uptime
2. `GET /api/agents` → lista com model/provider info
3. `GET /api/sessions` → lista sem sessões fantasma
4. `GET /api/squads` → lista com agents expandidos (não array vazio)
5. `GET /api/providers` → configured flag correto
6. `GET /api/skills` → lista skills
7. `GET /status` → watchdog healthy
8. `POST /api/agents` com XSS no name → rejeitado (400)
9. `POST /api/sessions` com agentId inválido → rejeitado (400)
10. `GET /api/config/database/export` sem auth → 401
11. **Expectativa:** Todos endpoints consistentes, validation funciona, sem leaks

#### RT-08: Mobile (viewport)
1. Resize browser pra 375x812 (iPhone viewport)
2. Sidebar abre/fecha?
3. Chat funciona? Input no bottom?
4. Settings abre?
5. Navegação back button funciona?
6. **Expectativa:** Usável em mobile (mesmo que não perfeito)

#### RT-09: Performance
1. `time curl /api/health` → <100ms
2. `time curl /api/agents` → <200ms
3. Enviar mensagem → first token chega em <2s?
4. Abrir DM com 100+ mensagens → renderiza em <1s?
5. Memory do server após 30min: `GET /status` → RSS <300MB?
6. **Expectativa:** Responsivo, sem memory leaks

#### RT-10: Segurança
1. XSS: `<img src=x onerror=alert(1)>` em chat input → renderiza escaped?
2. XSS: agent name com HTML → renderiza escaped?
3. Path traversal: `GET /api/sessions/../../../etc/passwd` → 400/403?
4. Rate limit: burst 50 requests → rate limited após 200?
5. CSP header presente?
6. API key mascarada em responses?
7. **Expectativa:** Nenhum vetor de ataque funciona

### Execução do Sprint 78

- **Hawk** executa RT-01 a RT-10 via `agent-browser` (screenshots obrigatórios)
- **Alice** executa RT-01 a RT-05 via browser tool (perspectiva de PO/humano)
- **Clark** executa RT-07 a RT-10 via curl + `agent-browser` (perspectiva técnica)
- Cada roteiro produz: PASS ✅ / FAIL ❌ + evidência + screenshot
- Score final = (roteiros PASS / total) × 100
- **Meta: >95%** — se <95%, fix cycle e retest

---

## Sprint 79+ — Backlog restante

Após Sprint 78 PASS:
- M4: Swipe-to-reply + threading
- M14: External agents na sidebar
- N1-N9: Appearance, language, analytics
- Roadmap Tier 3 items (3.9-3.14)

---

## Histórico

| Sprint | Items | Status |
|--------|-------|--------|
| 75 | C1-C4 (4 criticals) | 🔲 Next |
| 76 | M1,M7-M11,M13 (7 majors) | 🔲 Planned |
| 77 | M2,M3,M5+M6,N7,N9 (messenger UX) | 🔲 Planned |
| 78 | QA Full — 10 roteiros end-to-end | 🔲 Planned |
| 79+ | Backlog restante | 🔲 Backlog |

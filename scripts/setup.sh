#!/usr/bin/env bash
# HiveClaw Setup Script
# Usage: ./scripts/setup.sh
# Guides new users through installation and first-run setup.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helpers
info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✅${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠️${NC}  $*"; }
fail()  { echo -e "${RED}❌${NC} $*"; }
step()  { echo -e "\n${BOLD}${CYAN}── Step $1: $2 ──${NC}\n"; }

echo -e "\n${BOLD}🐝 HiveClaw Setup${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

ERRORS=0

# ── Step 1: Check Prerequisites ──────────────────────────

step 1 "Check Prerequisites"

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
        ok "Node.js $NODE_VERSION"
    else
        fail "Node.js $NODE_VERSION (need 20+)"
        ERRORS=$((ERRORS + 1))
    fi
else
    fail "Node.js not found"
    echo "   Install: https://nodejs.org or 'brew install node'"
    ERRORS=$((ERRORS + 1))
fi

# pnpm
if command -v pnpm &>/dev/null; then
    PNPM_VERSION=$(pnpm -v)
    PNPM_MAJOR=$(echo "$PNPM_VERSION" | cut -d. -f1)
    if [ "$PNPM_MAJOR" -ge 9 ]; then
        ok "pnpm $PNPM_VERSION"
    else
        fail "pnpm $PNPM_VERSION (need 9+)"
        ERRORS=$((ERRORS + 1))
    fi
else
    fail "pnpm not found"
    echo "   Install: 'npm install -g pnpm' or 'brew install pnpm'"
    ERRORS=$((ERRORS + 1))
fi

# Git
if command -v git &>/dev/null; then
    ok "Git $(git --version | awk '{print $3}')"
else
    fail "Git not found"
    echo "   Install: 'brew install git' or https://git-scm.com"
    ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    fail "Fix $ERRORS issue(s) above before continuing."
    exit 1
fi

# ── Step 2: Install Dependencies ─────────────────────────

step 2 "Install Dependencies"

if [ -d "node_modules" ] && [ -d "apps/server/node_modules" ]; then
    ok "Dependencies already installed"
    read -rp "   Reinstall? [y/N] " REINSTALL
    if [[ "$REINSTALL" =~ ^[Yy]$ ]]; then
        info "Installing dependencies..."
        pnpm install
        ok "Dependencies installed"
    fi
else
    info "Installing dependencies (this may take a minute)..."
    pnpm install
    ok "Dependencies installed"
fi

# ── Step 3: Configure Environment ────────────────────────

step 3 "Configure Environment"

if [ -f ".env" ]; then
    ok ".env file exists"
    
    # Check for at least one provider
    HAS_PROVIDER=false
    for KEY in GITHUB_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY OLLAMA_URL; do
        VALUE=$(grep "^${KEY}=" .env 2>/dev/null | cut -d= -f2- || true)
        if [ -n "$VALUE" ] && [ "$VALUE" != "sk-..." ] && [ "$VALUE" != "sk-ant-..." ] && [ "$VALUE" != "ghp_your_token_here" ] && [ "$VALUE" != "your_key_here" ] && [ "$VALUE" != "http://localhost:11434" ]; then
            ok "Provider configured: $KEY"
            HAS_PROVIDER=true
        fi
    done
    
    if [ "$HAS_PROVIDER" = false ]; then
        # Check if Ollama is running locally
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            ok "Ollama detected locally — you can use it as a provider"
            HAS_PROVIDER=true
        else
            warn "No LLM provider configured in .env"
            echo "   Edit .env and add at least one API key."
            echo "   See docs/GETTING-STARTED.md for provider options."
        fi
    fi
else
    info "Creating .env from template..."
    cp .env.example .env
    ok ".env created"
    
    echo ""
    warn "You need to configure at least one LLM provider."
    echo ""
    echo "   Options (pick one or more):"
    echo "   1. ${BOLD}GitHub Copilot${NC} — GITHUB_TOKEN=ghp_..."
    echo "   2. ${BOLD}Anthropic${NC}     — ANTHROPIC_API_KEY=sk-ant-..."
    echo "   3. ${BOLD}OpenAI${NC}        — OPENAI_API_KEY=sk-..."
    echo "   4. ${BOLD}Google AI${NC}     — GEMINI_API_KEY=..."
    echo "   5. ${BOLD}Ollama${NC}        — OLLAMA_URL=http://localhost:11434 (free, local)"
    echo ""
    read -rp "   Edit .env now? [Y/n] " EDIT_ENV
    if [[ ! "$EDIT_ENV" =~ ^[Nn]$ ]]; then
        "${EDITOR:-nano}" .env
    fi
fi

# ── Step 4: Build ─────────────────────────────────────────

step 4 "Build"

# Check if build exists and is recent
SERVER_BUILD="apps/server/dist/index.js"
WEB_BUILD="apps/web/out/index.html"

NEED_BUILD=false
if [ ! -f "$SERVER_BUILD" ]; then
    info "Server build not found — need to build"
    NEED_BUILD=true
elif [ ! -f "$WEB_BUILD" ]; then
    info "Web build not found — need to build"
    NEED_BUILD=true
fi

if [ "$NEED_BUILD" = true ]; then
    info "Building all packages (this takes ~30s)..."
    pnpm build
    ok "Build complete"
else
    ok "Build exists"
    read -rp "   Rebuild? [y/N] " REBUILD
    if [[ "$REBUILD" =~ ^[Yy]$ ]]; then
        info "Rebuilding..."
        pnpm build
        ok "Build complete"
    fi
fi

# ── Step 5: Run Tests ─────────────────────────────────────

step 5 "Run Tests"

read -rp "   Run test suite? [Y/n] " RUN_TESTS
if [[ ! "$RUN_TESTS" =~ ^[Nn]$ ]]; then
    info "Running tests..."
    if pnpm test 2>&1 | tail -5; then
        ok "Tests passed"
    else
        warn "Some tests failed — check output above"
    fi
else
    info "Skipping tests"
fi

# ── Step 6: Start ─────────────────────────────────────────

step 6 "Ready!"

echo ""
echo -e "${BOLD}🎉 HiveClaw is ready to run!${NC}"
echo ""
echo "   Start the server:"
echo -e "   ${CYAN}pnpm start${NC}"
echo ""
echo "   Then open:"
echo -e "   ${CYAN}http://localhost:4070${NC}"
echo ""
echo "   The Setup Wizard will guide you through creating"
echo "   your first user account and agent."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   📖 Docs:           docs/GETTING-STARTED.md"
echo "   📖 User Guide:     docs/USER-GUIDE.md"
echo "   📖 API Reference:  docs/API.md"
echo "   📖 Troubleshoot:   docs/TROUBLESHOOTING.md"
echo ""

read -rp "   Start the server now? [Y/n] " START_NOW
if [[ ! "$START_NOW" =~ ^[Nn]$ ]]; then
    echo ""
    info "Starting HiveClaw on http://localhost:4070 ..."
    echo ""
    pnpm start
fi

# SuperClaw Pure — Multi-stage Docker build
# Usage:
#   docker build -t superclaw-pure .
#   docker run -p 4070:4070 -v superclaw-data:/data superclaw-pure

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# Copy package files first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install ALL dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY tsconfig.json ./

# Build shared package first
RUN pnpm --filter @superclaw/shared build

# Build server (TypeScript → dist/)
RUN pnpm --filter @superclaw/server build

# Build frontend (Next.js static export → out/)
ENV NEXT_OUTPUT=export
RUN pnpm --filter @superclaw/web build

# Stamp service worker with build timestamp
RUN node -e "\
  const fs=require('fs');\
  const ts=Date.now();\
  const f='apps/web/public/sw.js';\
  if(fs.existsSync(f)){\
    let c=fs.readFileSync(f,'utf8');\
    c=c.replace(/v[0-9]+/,'v'+ts);\
    fs.writeFileSync('apps/web/out/sw.js',c);\
    console.log('SW stamped',ts);\
  }"

# ── Stage 2: Production deps ─────────────────────────────────────────────────
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --prod

# ── Stage 3: Runtime (minimal) ───────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Security: non-root user
RUN addgroup -S superclaw && adduser -S superclaw -G superclaw

# Copy built artifacts only (no source, no devDeps)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/web/out ./apps/web/out
COPY --from=deps /app/node_modules ./node_modules

# Copy root package.json
COPY package.json ./

# Data volume for SQLite DB
RUN mkdir -p /data && chown superclaw:superclaw /data
VOLUME ["/data"]

# Workspace volume for agent files
RUN mkdir -p /workspace && chown superclaw:superclaw /workspace
VOLUME ["/workspace"]

# Environment
ENV NODE_ENV=production
ENV PORT=4070
ENV HOST=0.0.0.0
ENV SUPERCLAW_DB_PATH=/data/superclaw.db
ENV SUPERCLAW_WEB_DIR=/app/apps/web/out
ENV SUPERCLAW_WORKSPACE=/workspace

# Switch to non-root
USER superclaw

EXPOSE 4070

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4070/api/health || exit 1

CMD ["node", "apps/server/dist/index.js"]

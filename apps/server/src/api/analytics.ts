/**
 * api/analytics.ts — Usage analytics & observability
 *
 * Endpoints:
 *   GET /analytics/usage         — total usage summary (all time)
 *   GET /analytics/usage/daily   — usage grouped by day (last 30d)
 *   GET /analytics/usage/model   — usage grouped by model
 *   GET /analytics/usage/agent   — usage grouped by agent
 *   GET /analytics/health        — server health + runtime metrics
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getEngineService } from '../engine/engine-service.js';

interface UsageRow {
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_at: string;
  session_id: string;
}

const startTime = Date.now();

export function registerAnalyticsRoutes(app: FastifyInstance, db: Database.Database): void {

  // GET /analytics/usage — total summary + top models + cost trend
  app.get('/analytics/usage', async (_req, reply) => {
    try {
      const totals = db.prepare(`
        SELECT
          COUNT(DISTINCT session_id) as sessions,
          SUM(tokens_in)  as totalIn,
          SUM(tokens_out) as totalOut,
          SUM(cost_usd)   as totalCost,
          COUNT(*)        as records
        FROM session_usage
      `).get() as { sessions: number; totalIn: number; totalOut: number; totalCost: number; records: number };

      return {
        data: {
          sessions: totals.sessions ?? 0,
          totalTokensIn: totals.totalIn ?? 0,
          totalTokensOut: totals.totalOut ?? 0,
          totalTokens: (totals.totalIn ?? 0) + (totals.totalOut ?? 0),
          totalCostUsd: Math.round((totals.totalCost ?? 0) * 1_000_000) / 1_000_000,
          records: totals.records ?? 0,
        },
      };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /analytics/usage/daily?days=30 — per-day usage
  app.get<{ Querystring: { days?: string } }>('/analytics/usage/daily', async (req, reply) => {
    try {
      const days = Math.min(parseInt(req.query.days ?? '30', 10), 365);
      const rows = db.prepare(`
        SELECT
          date(created_at) as day,
          SUM(tokens_in)   as tokensIn,
          SUM(tokens_out)  as tokensOut,
          SUM(cost_usd)    as cost,
          COUNT(*)         as calls
        FROM session_usage
        WHERE created_at >= datetime('now', ?)
        GROUP BY date(created_at)
        ORDER BY day ASC
      `).all(`-${days} days`) as Array<{ day: string; tokensIn: number; tokensOut: number; cost: number; calls: number }>;

      return { data: rows };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /analytics/usage/model — usage grouped by model
  app.get('/analytics/usage/model', async (_req, reply) => {
    try {
      const rows = db.prepare(`
        SELECT
          provider,
          model,
          SUM(tokens_in)  as tokensIn,
          SUM(tokens_out) as tokensOut,
          SUM(cost_usd)   as cost,
          COUNT(*)        as calls
        FROM session_usage
        GROUP BY provider, model
        ORDER BY cost DESC
        LIMIT 20
      `).all() as Array<{ provider: string; model: string; tokensIn: number; tokensOut: number; cost: number; calls: number }>;

      return { data: rows };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /analytics/usage/agent — usage grouped by agent (via session join)
  app.get('/analytics/usage/agent', async (_req, reply) => {
    try {
      const rows = db.prepare(`
        SELECT
          s.agent_id,
          a.name as agentName,
          a.emoji,
          SUM(su.tokens_in)  as tokensIn,
          SUM(su.tokens_out) as tokensOut,
          SUM(su.cost_usd)   as cost,
          COUNT(su.id)       as calls
        FROM session_usage su
        JOIN sessions s  ON s.id = su.session_id
        LEFT JOIN agents a ON a.id = s.agent_id
        GROUP BY s.agent_id
        ORDER BY cost DESC
        LIMIT 20
      `).all() as Array<{ agent_id: string; agentName: string; emoji: string; tokensIn: number; tokensOut: number; cost: number; calls: number }>;

      return { data: rows };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /analytics/health — runtime observability
  app.get('/analytics/health', async (_req, reply) => {
    try {
      const uptimeMs = Date.now() - startTime;
      const mem = process.memoryUsage();
      const breaker = getEngineService().circuits.getBreaker();
      const circuits = breaker.listAll();
      const openCircuits = circuits.filter((c) => c.state === 'open').length;

      // DB stats
      const agentCount = (db.prepare('SELECT COUNT(*) as n FROM agents').get() as { n: number }).n;
      const sessionCount = (db.prepare('SELECT COUNT(*) as n FROM sessions').get() as { n: number }).n;
      const memoryCount = (db.prepare('SELECT COUNT(*) as n FROM agent_memory').get() as { n: number }).n;

      return {
        data: {
          status: openCircuits > 3 ? 'degraded' : 'ok',
          uptime: {
            ms: uptimeMs,
            human: formatUptime(uptimeMs),
          },
          memory: {
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            rssMb: Math.round(mem.rss / 1024 / 1024),
          },
          database: {
            agents: agentCount,
            sessions: sessionCount,
            memoryEntries: memoryCount,
          },
          circuits: {
            total: circuits.length,
            open: openCircuits,
            closed: circuits.filter((c) => c.state === 'closed').length,
            halfOpen: circuits.filter((c) => c.state === 'half-open').length,
          },
          node: {
            version: process.version,
            platform: process.platform,
            arch: process.arch,
          },
        },
      };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (day > 0) return `${day}d ${hr % 24}h`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}

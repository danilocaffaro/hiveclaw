/**
 * api/routing.ts — Smart routing info endpoint
 */

import type { FastifyInstance } from 'fastify';
import { ProviderRepository } from '../db/index.js';
import { buildTierConfig, classifyComplexity, type ModelTier } from '../engine/smart-router.js';
import { getCircuitBreaker } from '../engine/circuit-breaker.js';

export function registerRoutingRoutes(app: FastifyInstance, providers: ProviderRepository): void {
  // GET /routing/tiers — show current tier configuration
  app.get('/routing/tiers', async () => {
    const tierConfig = buildTierConfig(providers);
    return { data: tierConfig };
  });

  // POST /routing/classify — classify a message's complexity
  app.post<{ Body: { message: string; historyLength?: number; isHeartbeat?: boolean } }>(
    '/routing/classify',
    async (req) => {
      const { message, historyLength, isHeartbeat } = req.body ?? {};
      if (!message) return { error: { code: 'VALIDATION', message: 'message required' } };

      const result = classifyComplexity({
        userMessage: message,
        historyLength: historyLength ?? 0,
        isHeartbeat,
      });
      return { data: result };
    },
  );

  // GET /routing/circuits — list all circuit breaker states
  app.get('/routing/circuits', async () => {
    const breaker = getCircuitBreaker();
    return { data: breaker.listAll() };
  });

  // POST /routing/circuits/:key/reset — manually reset a circuit
  app.post<{ Params: { key: string } }>('/routing/circuits/:key/reset', async (req) => {
    const breaker = getCircuitBreaker();
    breaker.reset(req.params.key);
    return { data: { success: true, key: req.params.key } };
  });
}

/**
 * Federation API routes — REST endpoints for pairing, link management, and status.
 */
import type { FastifyInstance } from 'fastify';
import { FederationRepository } from '../db/federation.js';
import { getFederationManager } from '../engine/federation/federation-manager.js';
import { FEDERATION_ENABLED } from '../engine/federation/federation-protocol.js';

export function registerFederationRoutes(app: FastifyInstance, repo: FederationRepository): void {
  // Register in an encapsulated plugin scope so the preHandler guard
  // only applies to /federation/* routes — NOT the entire app.
  app.register(async (scope) => {
    scope.addHook('preHandler', async (_req, reply) => {
      if (!FEDERATION_ENABLED) {
        return reply.status(403).send({
          error: { code: 'FEDERATION_DISABLED', message: 'Federation is not enabled. Set ENABLE_FEDERATION=true to enable.' },
        });
      }
    });

  // ── POST /api/federation/pair — Create pairing token ─────────────────────
  app.post<{ Body: { squadId: string; agentIds: string[]; expiresInMinutes?: number } }>(
    '/federation/pair',
    async (req, reply) => {
      const { squadId, agentIds, expiresInMinutes } = req.body ?? {} as { squadId?: string; agentIds?: string[]; expiresInMinutes?: number };

      if (!squadId || !agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'squadId and agentIds[] are required' },
        });
      }

      try {
        const result = repo.createPairingToken(squadId, agentIds, expiresInMinutes ?? 30);
        const baseUrl = `${req.protocol}://${req.hostname}`;

        return reply.send({
          data: {
            token: result.token,
            inviteUrl: `${baseUrl}/federation/join?token=${encodeURIComponent(result.token)}`,
            expiresAt: result.expiresAt,
            expiresIn: expiresInMinutes ?? 30,
          },
        });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── GET /api/federation/pair/:token/info — Invite info (before accepting) ─
  app.get<{ Params: { token: string } }>(
    '/federation/pair/:token/info',
    async (req, reply) => {
      try {
        const raw = repo.getPairingRaw(req.params.token);
        if (!raw) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Pairing token not found' },
          });
        }

        if (raw.consumed) {
          return reply.status(409).send({
            error: { code: 'ALREADY_CONSUMED', message: 'This invite has already been accepted' },
          });
        }

        if (raw.expired) {
          return reply.status(410).send({
            error: { code: 'EXPIRED', message: 'This invite has expired' },
          });
        }

        return reply.send({
          data: {
            squadId: raw.pairing.squadId,
            agentCount: raw.pairing.contributedAgentIds.length,
            expiresAt: raw.pairing.expiresAt,
          },
        });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── POST /api/federation/accept — Accept invite and connect ───────────────
  app.post<{ Body: { token: string; agentIds: string[] } }>(
    '/federation/accept',
    async (req, reply) => {
      const { token, agentIds } = req.body ?? {} as { token?: string; agentIds?: string[] };

      if (!token || !agentIds || !Array.isArray(agentIds)) {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'token and agentIds[] are required' },
        });
      }

      try {
        const raw = repo.getPairingRaw(token);
        if (!raw) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Pairing token not found' },
          });
        }
        if (raw.consumed) {
          return reply.status(409).send({
            error: { code: 'ALREADY_CONSUMED', message: 'This invite has already been accepted' },
          });
        }
        if (raw.expired) {
          return reply.status(410).send({
            error: { code: 'EXPIRED', message: 'This invite has expired' },
          });
        }

        // For now, return the info needed for the guest to connect via WS
        // The actual WS connection happens client-side
        return reply.send({
          data: {
            squadId: raw.pairing.squadId,
            token, // pass back for WS auth
            message: 'Use WebSocket to complete federation',
          },
        });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── GET /api/federation/links — List all federation links ─────────────────
  app.get<{ Querystring: { status?: string } }>(
    '/federation/links',
    async (req, reply) => {
      try {
        const status = req.query.status as 'pending' | 'active' | 'disconnected' | 'revoked' | undefined;
        const links = repo.listLinks(status);
        const manager = getFederationManager();

        const data = links.map(link => ({
          ...link,
          connected: manager.isLinkActive(link.id),
        }));

        return reply.send({ data });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── GET /api/federation/links/:id/status — Link connection status ─────────
  app.get<{ Params: { id: string } }>(
    '/federation/links/:id/status',
    async (req, reply) => {
      try {
        const manager = getFederationManager();
        const status = manager.getLinkStatus(req.params.id);

        if (!status) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Link not found' },
          });
        }

        return reply.send({ data: status });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── DELETE /api/federation/links/:id — Revoke a federation link ───────────
  app.delete<{ Params: { id: string } }>(
    '/federation/links/:id',
    async (req, reply) => {
      try {
        const revoked = repo.revokeLink(req.params.id);
        if (!revoked) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Link not found' },
          });
        }

        return reply.send({ data: { id: req.params.id, revoked: true } });
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    },
  );
  }); // end encapsulated scope
}

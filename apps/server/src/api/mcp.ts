import type { FastifyInstance } from 'fastify';
import type { MCPServerConfig } from '../engine/engine-service.js';
import { getEngineService } from '../engine/engine-service.js';

export function registerMCPRoutes(app: FastifyInstance): void {
  // GET /mcp/servers — list connected servers + tools
  app.get('/mcp/servers', async (_req, reply) => {
    const client = getEngineService().mcp.getClient();
    return reply.send({
      data: {
        connected: client.getConnectedServers(),
        tools: client.getTools(),
      },
    });
  });

  // POST /mcp/connect — connect to an MCP server
  app.post<{ Body: MCPServerConfig }>('/mcp/connect', async (req, reply) => {
    const config = req.body;
    if (!config?.id || !config?.transport) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'id and transport required' } });
    }
    const client = getEngineService().mcp.getClient();
    try {
      await client.connect({ ...config, enabled: true });
      return reply.send({
        data: {
          status: 'connected',
          serverId: config.id,
          tools: client.getTools().filter((t) => t.serverId === config.id),
        },
      });
    } catch (e) {
      return reply
        .status(500)
        .send({ error: { code: 'MCP_ERROR', message: (e as Error).message } });
    }
  });

  // POST /mcp/disconnect — disconnect from server
  app.post<{ Body: { serverId: string } }>('/mcp/disconnect', async (req, reply) => {
    const { serverId } = req.body || {};
    if (!serverId) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION', message: 'serverId required' } });
    }
    const client = getEngineService().mcp.getClient();
    await client.disconnect(serverId);
    return reply.send({ data: { status: 'disconnected', serverId } });
  });

  // POST /mcp/call — call a tool on an MCP server
  app.post<{ Body: { serverId: string; tool: string; args?: Record<string, unknown> } }>(
    '/mcp/call',
    async (req, reply) => {
      const { serverId, tool, args } = req.body || {};
      if (!serverId || !tool) {
        return reply
          .status(400)
          .send({ error: { code: 'VALIDATION', message: 'serverId and tool required' } });
      }
      const client = getEngineService().mcp.getClient();
      try {
        const result = await client.callTool(serverId, tool, args || {});
        return reply.send({ data: { result } });
      } catch (e) {
        return reply
          .status(500)
          .send({ error: { code: 'MCP_ERROR', message: (e as Error).message } });
      }
    },
  );
}

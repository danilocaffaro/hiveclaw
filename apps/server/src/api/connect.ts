/**
 * HiveClaw Connect — API Routes
 *
 * POST /api/connect/setup       — Initialize MQTT connection
 * POST /api/connect/token        — Generate user remote token
 * GET  /api/connect/status       — Connection status
 * GET  /api/connect/devices      — List paired devices
 * DELETE /api/connect/devices/:id — Revoke a device
 * POST /api/connect/enable       — Enable remote access
 * POST /api/connect/disable      — Disable remote access
 */

import type { FastifyInstance } from 'fastify';
import { getMqttBridge } from '../lib/connect/mqtt-bridge.js';
import { getActiveDevices, getDevicesByUser, revokeDevice, revokeAllDevices, initDevicesTable } from '../lib/connect/device-manager.js';
import { decodeToken, isValidTokenFormat } from '../lib/connect/token.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'api:connect' });

export function registerConnectRoutes(app: FastifyInstance) {
  // Ensure devices table exists
  initDevicesTable();

  const bridge = getMqttBridge();

  // Helper: get/set settings
  const getSetting = (key: string): string | null => {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const setSetting = (key: string, value: string): void => {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  };

  /**
   * POST /api/connect/enable — Enable remote access and connect to MQTT
   */
  app.post('/api/connect/enable', async () => {
    try {
      const config = await bridge.loadOrCreateConfig();
      await bridge.connect();

      setSetting('connect_enabled', 'true');

      // Register chat message handler
      bridge.onMessage('chat', async (deviceId, device, message) => {
        log.info(`Chat message from device ${deviceId} (user: ${device.userId})`);
        // This will be wired to agent-runner in the integration step
      });

      return {
        data: {
          status: 'connected',
          instanceId: config.instanceId,
          broker: config.broker,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'Failed to enable connect');
      return { error: msg };
    }
  });

  /**
   * POST /api/connect/disable — Disable remote access
   */
  app.post('/api/connect/disable', async () => {
    await bridge.disconnect();
    setSetting('connect_enabled', 'false');
    return { data: { status: 'disconnected' } };
  });

  /**
   * GET /api/connect/status — Get connection status
   */
  app.get('/api/connect/status', async () => {
    const enabled = getSetting('connect_enabled') === 'true';
    const devices = getActiveDevices();

    return {
      data: {
        enabled,
        connected: bridge.connected,
        instanceId: bridge.instanceId,
        broker: getSetting('connect_broker'),
        devicesCount: devices.length,
      },
    };
  });

  /**
   * POST /api/connect/token — Generate a remote access token for a user
   */
  app.post('/api/connect/token', async (req) => {
    const body = req.body as { userId?: string; role?: string; agents?: string[] } | undefined;
    const userId = body?.userId || 'default';
    const role = body?.role || 'member';
    const agents = body?.agents;

    if (!bridge.connected) {
      // Load config even if not connected (for token generation)
      await bridge.loadOrCreateConfig();
    }

    try {
      const token = bridge.generateUserToken(userId, role, agents);
      return { data: { token, userId, role, agents: agents || [] } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  });

  /**
   * POST /api/connect/token/validate — Validate a token (for debugging)
   */
  app.post('/api/connect/token/validate', async (req) => {
    const body = req.body as { token?: string } | undefined;
    if (!body?.token) return { error: 'Token required' };

    if (!isValidTokenFormat(body.token)) {
      return { data: { valid: false, reason: 'Invalid format' } };
    }

    const decoded = decodeToken(body.token);
    if (!decoded) {
      return { data: { valid: false, reason: 'Failed to decode' } };
    }

    return {
      data: {
        valid: true,
        instance: decoded.instance,
        broker: decoded.broker,
        userId: decoded.userId,
        role: decoded.role,
        v: decoded.v,
      },
    };
  });

  /**
   * GET /api/connect/devices — List all paired devices
   */
  app.get('/api/connect/devices', async (req) => {
    const query = req.query as { userId?: string };
    const devices = query.userId
      ? getDevicesByUser(query.userId)
      : getActiveDevices();

    return {
      data: devices.map(d => ({
        id: d.id,
        name: d.name,
        userId: d.userId,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        revoked: d.revoked,
        userAgent: d.userAgent,
      })),
    };
  });

  /**
   * DELETE /api/connect/devices/:id — Revoke a device
   */
  app.delete('/api/connect/devices/:id', async (req) => {
    const params = req.params as { id: string };
    const revoked = revokeDevice(params.id);

    if (!revoked) {
      return { error: 'Device not found' };
    }

    return { data: { revoked: true, deviceId: params.id } };
  });

  /**
   * POST /api/connect/devices/revoke-all — Revoke all devices for a user
   */
  app.post('/api/connect/devices/revoke-all', async (req) => {
    const body = req.body as { userId?: string } | undefined;
    const userId = body?.userId || 'default';
    const count = revokeAllDevices(userId);
    return { data: { revoked: count, userId } };
  });
}

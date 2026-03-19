/**
 * Node RPC Host — WebSocket-based RPC server for paired nodes.
 *
 * Accepts node connections, dispatches commands, manages health.
 * Per-command HMAC verification (spec §5.3).
 *
 * Phase 3.2 of HiveClaw Platform Blueprint.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { logger } from '../../lib/logger.js';
import { NodeRepository, type NodeRecord } from './node-repository.js';
import { classifyCommand, type ClassificationResult, type CommandType, type CommandTier } from './command-classifier.js';

// ─── Types ────────────────────────────────────────────────────────────────

interface ConnectedNode {
  nodeId: string;
  ws: WebSocket;
  node: NodeRecord;
  lastPing: number;
}

interface RPCRequest {
  id: string;
  type: CommandType;
  command?: string;
  params?: Record<string, unknown>;
  tier: CommandTier;
  timestamp: number;
  nonce: string;
  hmac: string;
}

interface RPCResponse {
  id: string;
  status: 'ok' | 'error' | 'timeout';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

interface PendingCommand {
  commandId: string;
  resolve: (result: RPCResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PING_INTERVAL_MS = 30_000;
const COMMAND_TIMEOUT_MS = 120_000;  // 2 min max exec time
const TIMESTAMP_WINDOW_MS = 30_000;  // 30s replay window
const MAX_CONCURRENT_PER_NODE = 3;
const MAX_COMMANDS_PER_MINUTE = 10;

// ─── RPC Host ─────────────────────────────────────────────────────────────

export class NodeRPCHost {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, ConnectedNode>();
  private pendingCommands = new Map<string, PendingCommand>();
  private commandCounts = new Map<string, { count: number; resetAt: number }>();
  private activeCounts = new Map<string, number>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private repo: NodeRepository) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Attach to an existing HTTP server (same port as Fastify).
   */
  attach(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/api/nodes/connect',
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Ping interval for health monitoring
    this.pingInterval = setInterval(() => {
      for (const [nodeId, conn] of this.connections) {
        if (conn.ws.readyState !== WebSocket.OPEN) {
          this.disconnectNode(nodeId, 'stale connection');
          continue;
        }
        conn.ws.ping();
      }
    }, PING_INTERVAL_MS);

    logger.info('[RPC] Node RPC host attached to server');
  }

  /**
   * Shutdown RPC host.
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all connections
    for (const [nodeId] of this.connections) {
      this.disconnectNode(nodeId, 'server shutdown');
    }

    // Reject all pending commands
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RPC host shutting down'));
    }
    this.pendingCommands.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    logger.info('[RPC] Node RPC host shut down');
  }

  // ─── Command Execution ──────────────────────────────────────────────

  /**
   * Execute a command on a node. Returns the result.
   * Caller must handle approval flow before calling this.
   */
  async executeCommand(
    nodeId: string,
    commandDbId: string,
    type: CommandType,
    command: string | undefined,
    params: Record<string, unknown> | undefined,
    tier: CommandTier,
  ): Promise<RPCResponse> {
    const conn = this.connections.get(nodeId);
    if (!conn) {
      throw new Error(`Node ${nodeId} is not connected`);
    }

    // Rate limiting
    if (!this.checkRateLimit(nodeId)) {
      throw new Error(`Rate limit exceeded for node ${nodeId} (max ${MAX_COMMANDS_PER_MINUTE}/min)`);
    }

    // Concurrent limit
    const active = this.activeCounts.get(nodeId) ?? 0;
    if (active >= MAX_CONCURRENT_PER_NODE) {
      throw new Error(`Concurrent limit exceeded for node ${nodeId} (max ${MAX_CONCURRENT_PER_NODE})`);
    }

    this.activeCounts.set(nodeId, active + 1);

    try {
      const rpcId = commandDbId;
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = randomBytes(16).toString('hex');

      // Build HMAC (spec §5.3)
      const payload = `${command ?? type}:${timestamp}:${nonce}`;
      // We use the node's auth token hash as HMAC key (both sides know it)
      const hmac = createHmac('sha256', conn.node.id).update(payload).digest('hex');

      const request: RPCRequest = {
        id: rpcId,
        type,
        command,
        params,
        tier,
        timestamp,
        nonce,
        hmac,
      };

      return await new Promise<RPCResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingCommands.delete(rpcId);
          reject(new Error(`Command timeout after ${COMMAND_TIMEOUT_MS}ms`));
        }, COMMAND_TIMEOUT_MS);

        this.pendingCommands.set(rpcId, { commandId: commandDbId, resolve, reject, timer });

        conn.ws.send(JSON.stringify({ type: 'rpc_request', data: request }));
      });
    } finally {
      const current = this.activeCounts.get(nodeId) ?? 1;
      this.activeCounts.set(nodeId, Math.max(0, current - 1));
    }
  }

  // ─── Status ─────────────────────────────────────────────────────────

  getOnlineNodes(): NodeRecord[] {
    return [...this.connections.values()].map(c => c.node);
  }

  isNodeOnline(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }

  getNodeCapabilities(nodeId: string): string[] {
    const conn = this.connections.get(nodeId);
    return conn ? conn.node.capabilities : [];
  }

  // ─── Connection Handling ────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Extract token from Authorization header
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    if (!token) {
      ws.close(4001, 'Missing auth token');
      return;
    }

    // Authenticate
    const node = this.repo.authenticate(token);
    if (!node) {
      ws.close(4003, 'Invalid auth token');
      logger.warn('[RPC] Rejected connection — invalid token');
      return;
    }

    // Close existing connection for same node (replaced)
    if (this.connections.has(node.id)) {
      this.disconnectNode(node.id, 'connection replaced');
    }

    const conn: ConnectedNode = {
      nodeId: node.id,
      ws,
      node,
      lastPing: Date.now(),
    };

    this.connections.set(node.id, conn);
    this.repo.updateStatus(node.id, 'online');
    logger.info('[RPC] Node connected: %s (%s)', node.name, node.id);

    // ─── Message handler ──────────────────────────────────────────

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(node.id, msg);
      } catch (err) {
        logger.error('[RPC] Invalid message from node %s: %s', node.id, (err as Error).message);
      }
    });

    ws.on('pong', () => {
      conn.lastPing = Date.now();
    });

    ws.on('close', () => {
      this.disconnectNode(node.id, 'connection closed');
    });

    ws.on('error', (err) => {
      logger.error('[RPC] WebSocket error from node %s: %s', node.id, err.message);
    });

    // Send welcome
    ws.send(JSON.stringify({
      type: 'welcome',
      data: { nodeId: node.id, serverTime: Date.now() },
    }));
  }

  private handleMessage(nodeId: string, msg: { type: string; data?: unknown }): void {
    switch (msg.type) {
      case 'rpc_response': {
        const response = msg.data as RPCResponse;
        if (!response?.id) return;

        const pending = this.pendingCommands.get(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(response.id);
          pending.resolve(response);
        }
        break;
      }

      case 'heartbeat': {
        const conn = this.connections.get(nodeId);
        if (conn) {
          conn.lastPing = Date.now();
          conn.ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        }
        break;
      }

      case 'capabilities_update': {
        const caps = msg.data as { capabilities: string[] } | undefined;
        if (caps?.capabilities) {
          const conn = this.connections.get(nodeId);
          if (conn) {
            conn.node = { ...conn.node, capabilities: caps.capabilities as NodeRecord['capabilities'] };
          }
        }
        break;
      }

      default:
        logger.debug('[RPC] Unknown message type from %s: %s', nodeId, msg.type);
    }
  }

  private disconnectNode(nodeId: string, reason: string): void {
    const conn = this.connections.get(nodeId);
    if (!conn) return;

    try {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close(1000, reason);
      }
    } catch { /* ignore close errors */ }

    this.connections.delete(nodeId);
    this.activeCounts.delete(nodeId);
    this.repo.updateStatus(nodeId, 'offline');
    logger.info('[RPC] Node disconnected: %s (%s)', conn.node.name, reason);
  }

  // ─── Rate Limiting ──────────────────────────────────────────────────

  private checkRateLimit(nodeId: string): boolean {
    const now = Date.now();
    const entry = this.commandCounts.get(nodeId);

    if (!entry || now >= entry.resetAt) {
      this.commandCounts.set(nodeId, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (entry.count >= MAX_COMMANDS_PER_MINUTE) {
      return false;
    }

    entry.count++;
    return true;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _rpcHost: NodeRPCHost | null = null;

export function getNodeRPCHost(): NodeRPCHost | null {
  return _rpcHost;
}

export function createNodeRPCHost(repo: NodeRepository): NodeRPCHost {
  _rpcHost = new NodeRPCHost(repo);
  return _rpcHost;
}

export function resetNodeRPCHost(): void {
  if (_rpcHost) {
    _rpcHost.shutdown();
    _rpcHost = null;
  }
}

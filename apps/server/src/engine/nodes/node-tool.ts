/**
 * Node Control Tool — Agent tool for executing commands on paired nodes.
 *
 * Actions: exec, camera_snap, camera_list, screen_record, location_get,
 *          notifications_list, list_nodes, node_status
 *
 * Tool #21 in HiveClaw's tool registry.
 * Phase 3.4 of HiveClaw Platform Blueprint.
 */

import { logger } from '../../lib/logger.js';
import { initDatabase } from '../../db/index.js';
import { NodeRepository } from './node-repository.js';
import { classifyCommand, type CommandType } from './command-classifier.js';
import { requestApproval } from './approval-flow.js';
import { getNodeRPCHost } from './rpc-host.js';
import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from '../tools/types.js';

// ─── Tool ─────────────────────────────────────────────────────────────────

export class NodeControlTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'node',
    description: `Execute commands on paired remote devices (Mac, Linux, etc.).

Actions:
  - exec: Run a shell command on a node (requires nodeId + command)
  - camera_snap: Take a photo (requires nodeId; optional params.facing: front/back)
  - camera_list: List available cameras (requires nodeId)
  - screen_record: Take a screenshot (requires nodeId)
  - location_get: Get GPS coordinates (requires nodeId)
  - notifications_list: Read recent notifications (requires nodeId)
  - list_nodes: List all paired nodes with status (no nodeId needed)
  - node_status: Get detailed status of a specific node (requires nodeId)

Commands are classified by risk tier:
  Tier 0-1: automatic | Tier 2: agent-approved | Tier 3: owner approval (5min timeout) | Tier 4: blocked`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['exec', 'camera_snap', 'camera_list', 'screen_record',
                 'location_get', 'notifications_list', 'list_nodes', 'node_status'],
          description: 'The action to perform',
        },
        nodeId: {
          type: 'string',
          description: 'Target node ID (not needed for list_nodes)',
        },
        command: {
          type: 'string',
          description: 'Shell command to execute (only for exec action)',
        },
        params: {
          type: 'object',
          description: 'Additional parameters (e.g., { facing: "front" } for camera_snap)',
        },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, context?: ToolContext): Promise<ToolOutput> {
    const action = input.action as string;
    const nodeId = input.nodeId as string | undefined;
    const command = input.command as string | undefined;
    const params = input.params as Record<string, unknown> | undefined;

    const db = context?.db ?? initDatabase();
    const repo = new NodeRepository(db);

    // ─── Meta actions ─────────────────────────────────────────────

    if (action === 'list_nodes') {
      const nodes = repo.list();
      const rpcHost = getNodeRPCHost();
      const result = nodes.map(n => ({
        id: n.id,
        name: n.name,
        deviceType: n.deviceType,
        capabilities: n.capabilities,
        status: rpcHost?.isNodeOnline(n.id) ? 'online' : 'offline',
        lastSeen: n.lastSeen,
      }));
      return { success: true, result };
    }

    if (action === 'node_status') {
      if (!nodeId) return { success: false, error: 'nodeId required for node_status' };
      const node = repo.get(nodeId);
      if (!node) return { success: false, error: `Node ${nodeId} not found` };
      const rpcHost = getNodeRPCHost();
      const recent = repo.listCommands(nodeId, { limit: 5 });
      return {
        success: true,
        result: {
          ...node,
          online: rpcHost?.isNodeOnline(nodeId) ?? false,
          recentCommands: recent.map(c => ({
            id: c.id, command: c.command, tier: c.tier,
            status: c.status, durationMs: c.durationMs, createdAt: c.createdAt,
          })),
        },
      };
    }

    // ─── Command actions ──────────────────────────────────────────

    if (!nodeId) return { success: false, error: 'nodeId required' };

    const node = repo.get(nodeId);
    if (!node) return { success: false, error: `Node ${nodeId} not found` };

    const rpcHost = getNodeRPCHost();
    if (!rpcHost || !rpcHost.isNodeOnline(nodeId)) {
      return { success: false, error: `Node ${node.name} is offline` };
    }

    if (action === 'exec' && !command) {
      return { success: false, error: 'command required for exec action' };
    }

    // Classify
    const commandType = action as CommandType;
    const classification = classifyCommand(commandType, command);

    logger.info('[NodeTool] %s on %s — Tier %d: %s',
      action, node.name, classification.tier, classification.reason);

    // Audit record
    const cmdRecord = repo.createCommand({
      nodeId,
      agentId: context?.agentId,
      sessionId: context?.sessionId,
      command: command ?? action,
      commandType,
      params,
      tier: classification.tier,
    });

    // Approval
    const approval = await requestApproval(repo, cmdRecord, classification);

    if (!approval.approved) {
      repo.updateCommand(cmdRecord.id, {
        status: approval.status === 'blocked' ? 'denied' : approval.status,
        approvalStatus: approval.status,
        approvalReason: approval.reason,
      });

      if (approval.status === 'timeout') {
        return {
          success: false,
          error: `⏳ Owner did not approve in time: ${command ?? action}. Command NOT executed.`,
        };
      }

      return {
        success: false,
        error: `Command not approved (${approval.status}): ${approval.reason}`,
      };
    }

    // Update audit
    repo.updateCommand(cmdRecord.id, {
      status: 'running',
      approvalStatus: approval.status,
      approvalBy: approval.status === 'owner_approved' ? 'owner'
        : (approval.status === 'agent_approved' ? (context?.agentId ?? 'agent') : 'system'),
      approvalReason: approval.reason,
      startedAt: new Date().toISOString(),
    });

    // Execute via RPC
    try {
      const result = await rpcHost.executeCommand(
        nodeId, cmdRecord.id, commandType, command, params, classification.tier,
      );

      const completedAt = new Date().toISOString();
      const resultStr = JSON.stringify(result.result);

      repo.updateCommand(cmdRecord.id, {
        status: result.status === 'ok' ? 'completed' : 'failed',
        result: result.result,
        resultSizeBytes: Buffer.byteLength(resultStr, 'utf8'),
        error: result.error,
        completedAt,
        durationMs: result.durationMs,
      });

      if (result.status === 'ok') {
        return { success: true, result: result.result };
      }
      return { success: false, error: result.error ?? 'Command failed' };

    } catch (err) {
      repo.updateCommand(cmdRecord.id, {
        status: 'failed',
        error: (err as Error).message,
        completedAt: new Date().toISOString(),
      });
      return { success: false, error: (err as Error).message };
    }
  }
}

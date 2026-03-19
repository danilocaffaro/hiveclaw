/**
 * Approval Flow — Tier-based command approval for node exec.
 *
 * Tier 0-1: Auto-approve
 * Tier 2: Agent-level (LLM confirms intent)
 * Tier 3: Owner approval (push notification, 5min timeout)
 * Tier 4: Always blocked
 *
 * Includes late result handling (spec §10) and stale detection.
 *
 * Phase 3 of HiveClaw Platform Blueprint.
 */

import { logger } from '../../lib/logger.js';
import { broadcastSSE } from '../../api/sse.js';
import { NodeRepository, type NodeCommandRecord } from './node-repository.js';
import { type ClassificationResult, type CommandTier } from './command-classifier.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ApprovalResult {
  approved: boolean;
  status: 'auto' | 'agent_approved' | 'owner_approved' | 'denied' | 'timeout' | 'expired' | 'stale' | 'blocked';
  reason: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const OWNER_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes (spec §3.4)
const MAX_TIER3_PER_HOUR = 5;                       // spec §8

// ─── Pending Owner Approvals ──────────────────────────────────────────────

interface PendingApproval {
  commandId: string;
  nodeId: string;
  agentId: string;
  command: string;
  tier: CommandTier;
  createdAt: number;
  resolve: (result: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();
const tier3Counts = new Map<string, { count: number; resetAt: number }>();

// ─── Main Approval Function ───────────────────────────────────────────────

/**
 * Run the approval flow for a classified command.
 * Returns when approval is resolved (approved/denied/timeout/blocked).
 */
export async function requestApproval(
  repo: NodeRepository,
  commandRecord: NodeCommandRecord,
  classification: ClassificationResult,
): Promise<ApprovalResult> {
  const { tier } = classification;

  // Tier 4: Always blocked
  if (tier === 4 || classification.blocked) {
    return {
      approved: false,
      status: 'blocked',
      reason: classification.reason,
    };
  }

  // Tier 0-1: Auto-approve
  if (tier <= 1) {
    return {
      approved: true,
      status: 'auto',
      reason: 'Tier 0-1: automatic approval',
    };
  }

  // Tier 2: Agent-level approval (the agent already decided to call this tool — implicit approval)
  // The classification reason is logged, but no human in the loop
  if (tier === 2) {
    return {
      approved: true,
      status: 'agent_approved',
      reason: `Agent-approved: ${classification.reason}`,
    };
  }

  // Tier 3: Owner approval required
  return requestOwnerApproval(repo, commandRecord, classification);
}

// ─── Owner Approval Flow ──────────────────────────────────────────────────

async function requestOwnerApproval(
  repo: NodeRepository,
  commandRecord: NodeCommandRecord,
  classification: ClassificationResult,
): Promise<ApprovalResult> {
  // Rate limit Tier 3 per hour (spec §8)
  const hourKey = commandRecord.agentId ?? 'unknown';
  const now = Date.now();
  const counter = tier3Counts.get(hourKey);
  if (counter && now < counter.resetAt && counter.count >= MAX_TIER3_PER_HOUR) {
    return {
      approved: false,
      status: 'denied',
      reason: `Tier 3 rate limit: max ${MAX_TIER3_PER_HOUR}/hour exceeded`,
    };
  }
  if (!counter || now >= (counter?.resetAt ?? 0)) {
    tier3Counts.set(hourKey, { count: 1, resetAt: now + 3600_000 });
  } else {
    counter.count++;
  }

  // Update command to pending_approval
  repo.updateCommand(commandRecord.id, {
    status: 'pending_approval',
    approvalStatus: 'pending_approval' as string,
  });

  // Broadcast approval request via SSE (frontend + notification channels)
  broadcastSSE(null, 'node_approval_request', {
    commandId: commandRecord.id,
    nodeId: commandRecord.nodeId,
    agentId: commandRecord.agentId,
    command: commandRecord.command,
    tier: classification.tier,
    reason: classification.reason,
    timestamp: new Date().toISOString(),
    timeoutMs: OWNER_APPROVAL_TIMEOUT_MS,
  });

  logger.warn('[Approval] Tier 3 — awaiting owner for: %s (node: %s, agent: %s)',
    commandRecord.command, commandRecord.nodeId, commandRecord.agentId);

  // Wait for owner response or timeout
  return new Promise<ApprovalResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(commandRecord.id);
      repo.updateCommand(commandRecord.id, {
        status: 'timeout',
        approvalStatus: 'timeout',
      });

      logger.warn('[Approval] Tier 3 timeout for command %s', commandRecord.id);

      resolve({
        approved: false,
        status: 'timeout',
        reason: `Owner did not respond within ${OWNER_APPROVAL_TIMEOUT_MS / 1000}s`,
      });
    }, OWNER_APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(commandRecord.id, {
      commandId: commandRecord.id,
      nodeId: commandRecord.nodeId,
      agentId: commandRecord.agentId ?? '',
      command: commandRecord.command,
      tier: classification.tier,
      createdAt: now,
      resolve,
      timer,
    });
  });
}

// ─── External: Resolve an approval (called by API) ────────────────────────

/**
 * Owner approves or denies a pending command.
 * Called from the /nodes/approvals/:id/resolve API endpoint.
 */
export function resolveApproval(
  repo: NodeRepository,
  commandId: string,
  approved: boolean,
  reason?: string,
): { resolved: boolean; message: string } {
  const pending = pendingApprovals.get(commandId);
  if (!pending) {
    return { resolved: false, message: 'No pending approval for this command (may have timed out)' };
  }

  clearTimeout(pending.timer);
  pendingApprovals.delete(commandId);

  // Stale detection (spec §10.2)
  if (approved) {
    const isStale = repo.hasSubsequentOverlap(commandId, pending.nodeId, pending.agentId);
    if (isStale) {
      repo.updateCommand(commandId, {
        status: 'expired',
        approvalStatus: 'stale',
        approvalBy: 'owner',
        approvalReason: 'Approved but context has advanced — stale',
      });

      pending.resolve({
        approved: false,
        status: 'stale',
        reason: 'Command expired — agent context has advanced since request',
      });

      logger.warn('[Approval] Stale detection triggered for %s', commandId);

      return { resolved: true, message: 'Command was stale — agent has advanced. Not executed.' };
    }
  }

  const status = approved ? 'owner_approved' : 'denied';
  repo.updateCommand(commandId, {
    status: approved ? 'running' : 'denied',
    approvalStatus: status,
    approvalBy: 'owner',
    approvalReason: reason ?? (approved ? 'Owner approved' : 'Owner denied'),
  });

  pending.resolve({
    approved,
    status,
    reason: reason ?? (approved ? 'Owner approved' : 'Owner denied'),
  });

  logger.info('[Approval] Owner %s command %s: %s', approved ? 'approved' : 'denied', commandId, reason ?? '');

  return {
    resolved: true,
    message: approved ? 'Command approved and executing' : 'Command denied',
  };
}

/**
 * Get all currently pending approvals.
 */
export function listPendingApprovals(): Array<{
  commandId: string;
  nodeId: string;
  agentId: string;
  command: string;
  tier: CommandTier;
  createdAt: number;
  remainingMs: number;
}> {
  const now = Date.now();
  return [...pendingApprovals.values()].map(p => ({
    commandId: p.commandId,
    nodeId: p.nodeId,
    agentId: p.agentId,
    command: p.command,
    tier: p.tier,
    createdAt: p.createdAt,
    remainingMs: Math.max(0, OWNER_APPROVAL_TIMEOUT_MS - (now - p.createdAt)),
  }));
}

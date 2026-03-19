/**
 * Node Pairing + RPC — Module index.
 * Phase 3 of HiveClaw Platform Blueprint.
 */

export { classifyCommand, getExecMethod, type CommandTier, type CommandType, type ClassificationResult } from './command-classifier.js';
export { NodeRepository, type NodeRecord, type NodeCommandRecord, type NodeStatus, type DeviceType, type NodeCapability } from './node-repository.js';
export { NodeRPCHost, getNodeRPCHost, createNodeRPCHost, resetNodeRPCHost } from './rpc-host.js';
export { requestApproval, resolveApproval, listPendingApprovals, type ApprovalResult } from './approval-flow.js';
export { NodeControlTool } from './node-tool.js';

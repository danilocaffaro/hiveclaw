// ============================================================
// Tool Interface
// ============================================================

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  success: boolean;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: ToolInput, context?: ToolContext): Promise<ToolOutput>;
}

export interface ToolContext {
  sessionId?: string;
  agentId?: string;
  db?: import('better-sqlite3').Database;
}

export function formatToolResult(output: ToolOutput): string {
  if (!output.success) {
    return `ERROR: ${output.error ?? 'Unknown error'}`;
  }
  if (typeof output.result === 'string') return output.result;
  return JSON.stringify(output.result, null, 2);
}

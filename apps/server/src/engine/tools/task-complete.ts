// ============================================================
// TaskCompleteTool — Signal task completion in proactive mode
//
// A simple tool that signals the current task is finished.
// When the model calls this, the proactive tick loop stops.
// ============================================================

import type { Tool, ToolInput, ToolOutput } from './types.js';

export class TaskCompleteTool implements Tool {
  readonly definition = {
    name: 'task_complete',
    description: 'Signal that the current task is finished. Use when you have completed what the user asked for. Include a brief summary of what was done.',
    parameters: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished',
        },
      },
      required: ['summary'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const summary = (input.summary as string) || 'Task completed';
    return {
      success: true,
      result: `Task completed: ${summary}`,
    };
  }
}

// ============================================================
// BriefTool — Route messages to the user explicitly.
//
// Inspired by Claude Code's BriefTool / SendUserMessage pattern.
// Separates "thinking" output from "user-facing" output.
//
// In proactive/background mode, the model's regular text output is
// treated as internal thinking (not shown to the user). To actually
// reach the user, the model MUST call this tool.
//
// The status field determines notification behavior:
//   'normal'    → standard reply (default)
//   'proactive' → background update (silent/low-priority notification)
//   'alert'     → important notification (high-priority push)
// ============================================================

import type { Tool, ToolInput, ToolOutput } from './types.js';

export class BriefTool implements Tool {
  readonly definition = {
    name: 'send_user_message',
    description: `Send a message directly to the user. In proactive mode, this is the ONLY way your message reaches the user.
Regular text output is treated as internal thinking and may not be shown.
Use status to control notification priority:
- 'normal': standard reply (default)
- 'proactive': background update (silent notification)
- 'alert': important notification (push notification)`,
    parameters: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The message to send to the user',
        },
        status: {
          type: 'string',
          enum: ['normal', 'proactive', 'alert'],
          description: "Message priority/type. Defaults to 'normal'.",
        },
      },
      required: ['message'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const message = input.message as string;
    const status = (input.status as string) || 'normal';

    return {
      success: true,
      result: message,
      metadata: {
        briefStatus: status,
        isUserFacing: true,
      },
    };
  }
}

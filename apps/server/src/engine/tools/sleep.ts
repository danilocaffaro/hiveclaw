// ============================================================
// SleepTool — Yield control during proactive mode (KAIROS-inspired)
//
// The model decides how long to sleep based on:
// - If nothing to do: sleep longer (save API cost)
// - If waiting for a process: sleep shorter
// - Trade-off: sleeping too long may expire prompt cache
// ============================================================

import type { Tool, ToolInput, ToolOutput } from './types.js';

export class SleepTool implements Tool {
  readonly definition = {
    name: 'sleep',
    description: `Yield control and pause proactive ticks for a specified duration.
Use this when there is no immediate work to do. The tick loop will resume after the sleep period.
Choose duration wisely:
- 30s: waiting for a running process to complete
- 60s: light monitoring, nothing urgent
- 300s: idle, no pending work
- 600s: deep idle, will check back later
Sleeping too long may cause the prompt cache to expire (rebuild cost ~$0.01).`,
    parameters: {
      type: 'object' as const,
      properties: {
        seconds: {
          type: 'number',
          description: 'Seconds to sleep (30-600)',
          minimum: 30,
          maximum: 600,
        },
        reason: {
          type: 'string',
          description: 'Why sleeping (logged for observability)',
        },
      },
      required: ['seconds'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const seconds = Math.min(Math.max(input.seconds as number || 60, 30), 600);
    const reason = (input.reason as string) || 'no pending work';
    return {
      success: true,
      result: JSON.stringify({ action: 'sleep', seconds, reason }),
      metadata: { sleepSeconds: seconds, sleepReason: reason },
    };
  }
}

/**
 * Canvas Tool — allows agents to render visual content (HTML, charts, dashboards).
 *
 * Actions:
 *   present  → push HTML content to canvas, auto-navigate
 *   update   → update existing canvas file (no navigate)
 *   navigate → switch active canvas to existing path
 *   status   → get current canvas state (file list, active path)
 */

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { getCanvasHost, CanvasError } from '../canvas/canvas-host.js';

export class CanvasTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'canvas',
    description: [
      'Render visual content in the Canvas viewer.',
      'Use "present" to push new HTML and open it, "update" to modify without navigating,',
      '"navigate" to switch to an existing canvas, or "status" to list all canvas files.',
      'Content can be full HTML documents with embedded CSS/JS, charts, dashboards, etc.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['present', 'update', 'navigate', 'status'],
          description: 'Action to perform',
        },
        content: {
          type: 'string',
          description: 'HTML content to push (for present/update)',
        },
        path: {
          type: 'string',
          description: 'File path within canvas (e.g. "dashboard.html"). Auto-generated if omitted.',
        },
        title: {
          type: 'string',
          description: 'Human-readable title for the canvas entry',
        },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, _context?: ToolContext): Promise<ToolOutput> {
    const action = input.action as string;
    const content = input.content as string | undefined;
    const path = input.path as string | undefined;
    const title = input.title as string | undefined;

    const canvas = getCanvasHost();

    try {
      switch (action) {
        case 'present': {
          if (!content) {
            return { success: false, error: 'content is required for "present" action' };
          }
          const result = canvas.pushContent({ content, path, title, contentType: 'text/html' });
          canvas.navigate(result.path);
          return {
            success: true,
            result: `Canvas presented at ${result.url} — viewers will auto-reload.`,
          };
        }

        case 'update': {
          if (!content) {
            return { success: false, error: 'content is required for "update" action' };
          }
          if (!path) {
            return { success: false, error: 'path is required for "update" action (specify which canvas to update)' };
          }
          const result = canvas.pushContent({ content, path, title, contentType: 'text/html' });
          return {
            success: true,
            result: `Canvas updated at ${result.url} — viewers will auto-reload.`,
          };
        }

        case 'navigate': {
          if (!path) {
            return { success: false, error: 'path is required for "navigate" action' };
          }
          canvas.navigate(path);
          return {
            success: true,
            result: `Canvas navigated to /canvas/${path}`,
          };
        }

        case 'status': {
          const state = canvas.getState();
          if (state.entries.length === 0) {
            return {
              success: true,
              result: 'Canvas is empty. Use "present" to push content.',
            };
          }
          const lines = [
            `Canvas: ${state.entries.length} file(s), ${(state.totalSizeBytes / 1024).toFixed(1)} KB total`,
            `Active: ${state.activePath ?? '(none)'}`,
            '',
            'Files:',
            ...state.entries.map(e =>
              `  ${e.path} (${(e.sizeBytes / 1024).toFixed(1)} KB, ${e.contentType})`,
            ),
          ];
          return { success: true, result: lines.join('\n') };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Use present, update, navigate, or status.` };
      }
    } catch (err) {
      if (err instanceof CanvasError) {
        return { success: false, error: `${err.code}: ${err.message}` };
      }
      return { success: false, error: (err as Error).message };
    }
  }
}

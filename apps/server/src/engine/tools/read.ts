import { readFileSync } from 'fs';
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { validateToolPath } from '../../config/security.js';

const MAX_CHARS = 100_000;

export class ReadTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'read',
    description: 'Read the contents of a file. Supports optional line range with offset and limit.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed). Defaults to 1.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return. Defaults to all lines.',
        },
      },
      required: ['path'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const filePath = input['path'] as string;
    const offset = (input['offset'] as number | undefined) ?? 1;
    const limit = input['limit'] as number | undefined;

    if (!filePath) {
      return { success: false, error: 'path is required' };
    }

    // Workspace sandbox check
    const pathCheck = validateToolPath(filePath, 'read');
    if (!pathCheck.allowed) {
      return { success: false, error: pathCheck.reason };
    }

    try {
      const raw = readFileSync(pathCheck.resolved, 'utf-8');

      let content: string;

      if (offset !== 1 || limit !== undefined) {
        const lines = raw.split('\n');
        const startIdx = Math.max(0, offset - 1); // convert 1-indexed to 0-indexed
        const endIdx = limit !== undefined ? startIdx + limit : lines.length;
        content = lines.slice(startIdx, endIdx).join('\n');
      } else {
        content = raw;
      }

      if (content.length > MAX_CHARS) {
        content = content.slice(0, MAX_CHARS) + `\n[truncated at ${MAX_CHARS} chars]`;
      }

      return { success: true, result: content };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}

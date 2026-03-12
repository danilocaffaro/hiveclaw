import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { validateToolPath } from '../../config/security.js';

export class WriteTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'write',
    description: 'Write content to a file. Creates the file (and any parent directories) if they do not exist. Overwrites existing content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;

    if (!filePath) {
      return { success: false, error: 'path is required' };
    }
    if (content === undefined || content === null) {
      return { success: false, error: 'content is required' };
    }

    // Workspace sandbox check (write mode — stricter)
    const pathCheck = validateToolPath(filePath, 'write');
    if (!pathCheck.allowed) {
      return { success: false, error: pathCheck.reason };
    }

    try {
      const dir = dirname(pathCheck.resolved);
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathCheck.resolved, content, 'utf-8');
      return { success: true, result: `Successfully wrote ${content.length} bytes to ${pathCheck.resolved}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}

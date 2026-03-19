import { readFileSync, writeFileSync } from 'fs';
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { validateToolPath, isWriteExtensionAllowed } from '../../config/security.js';

export class EditTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'edit',
    description: 'Edit a file by replacing an exact block of text with new text. The old_text must match exactly (including whitespace).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_text: { type: 'string', description: 'Exact text to find and replace (must match exactly)' },
        new_text: { type: 'string', description: 'New text to replace the old text with' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const filePath = input['path'] as string;
    const oldText = input['old_text'] as string;
    const newText = input['new_text'] as string;

    if (!filePath || !oldText) {
      return { success: false, error: 'path and old_text are required' };
    }

    // Workspace sandbox check (write mode — file will be modified)
    const pathCheck = validateToolPath(filePath, 'write');
    if (!pathCheck.allowed) {
      return { success: false, error: pathCheck.reason };
    }

    // R21/P7: Extension whitelist — prevent editing binaries or unknown file types
    const extCheck = isWriteExtensionAllowed(pathCheck.resolved);
    if (!extCheck.allowed) {
      return { success: false, error: extCheck.reason };
    }

    try {
      const content = readFileSync(pathCheck.resolved, 'utf-8');

      if (!content.includes(oldText)) {
        return {
          success: false,
          error: `old_text not found in file. The text must match exactly including whitespace and newlines.`,
        };
      }

      const newContent = content.replace(oldText, newText);
      writeFileSync(pathCheck.resolved, newContent, 'utf-8');

      return { success: true, result: `Successfully edited ${pathCheck.resolved}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}

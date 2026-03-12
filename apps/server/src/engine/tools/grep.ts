import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { validateToolPath } from '../../config/security.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 50_000;

export class GrepTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'grep',
    description: 'Search for a text pattern in files using grep or ripgrep. Returns matching lines with file:line format.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The search pattern (regex supported)' },
        path: { type: 'string', description: 'File or directory path to search in' },
        options: {
          type: 'string',
          description: 'Additional grep flags, e.g. "-i" for case-insensitive, "-l" for filenames only',
        },
      },
      required: ['pattern', 'path'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const pattern = input['pattern'] as string;
    const searchPath = input['path'] as string;
    const options = (input['options'] as string | undefined) ?? '';

    if (!pattern || !searchPath) {
      return { success: false, error: 'pattern and path are required' };
    }

    // Validate search path is within allowed paths
    const pathCheck = validateToolPath(searchPath, 'read');
    if (!pathCheck.allowed) {
      return { success: false, error: `Search path blocked: ${pathCheck.reason}` };
    }

    // Try ripgrep first, fall back to grep
    const useRipgrep = await this.#ripgrepAvailable();

    try {
      let stdout: string;

      if (useRipgrep) {
        const args = ['--line-number', '--no-heading', '--color=never'];
        if (options) args.push(...options.split(' ').filter(Boolean));
        args.push(pattern, pathCheck.resolved);
        ({ stdout } = await execFileAsync('rg', args, { maxBuffer: MAX_OUTPUT * 4 }));
      } else {
        const args = ['-rn', '--color=never'];
        if (options) args.push(...options.split(' ').filter(Boolean));
        args.push(pattern, pathCheck.resolved);
        ({ stdout } = await execFileAsync('grep', args, { maxBuffer: MAX_OUTPUT * 4 }));
      }

      const output = stdout.length > MAX_OUTPUT
        ? stdout.slice(0, MAX_OUTPUT) + `\n[output truncated at ${MAX_OUTPUT} chars]`
        : stdout;

      return { success: true, result: output.trim() || 'No matches found.' };
    } catch (err: unknown) {
      const error = err as Error & { code?: number; stdout?: string };
      // grep/rg exit code 1 = no matches (not an error)
      if (error.code === 1) {
        return { success: true, result: 'No matches found.' };
      }
      return { success: false, error: error.message };
    }
  }

  async #ripgrepAvailable(): Promise<boolean> {
    try {
      await execFileAsync('rg', ['--version']);
      return true;
    } catch {
      return false;
    }
  }
}

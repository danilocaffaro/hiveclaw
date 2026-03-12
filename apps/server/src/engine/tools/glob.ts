import fg from 'fast-glob';
const glob = fg.glob ?? fg;
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { validateToolPath } from '../../config/security.js';

export class GlobTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts", "**/*.json")' },
        cwd: { type: 'string', description: 'Working directory for the search (default: current dir)' },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Patterns to ignore (e.g., ["node_modules/**", "dist/**"])',
        },
        limit: { type: 'number', description: 'Maximum number of results (default 500)' },
      },
      required: ['pattern'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const pattern = input['pattern'] as string;
    const cwd = (input['cwd'] as string) || process.cwd();
    const ignore = (input['ignore'] as string[]) || ['node_modules/**', '.git/**', 'dist/**'];
    const limit = Math.min((input['limit'] as number) ?? 500, 2000);

    if (!pattern) {
      return { success: false, error: 'pattern is required' };
    }

    // Validate cwd is within allowed paths
    const cwdCheck = validateToolPath(cwd, 'read');
    if (!cwdCheck.allowed) {
      return { success: false, error: `Search directory blocked: ${cwdCheck.reason}` };
    }

    try {
      const files = await glob(pattern, {
        cwd: cwdCheck.resolved,
        ignore,
        onlyFiles: false,
        dot: false,
        absolute: false,
      });

      const results = files.slice(0, limit);
      const truncated = files.length > limit;

      return {
        success: true,
        result: truncated
          ? `${results.join('\n')}\n[truncated: showing ${limit} of ${files.length} matches]`
          : results.join('\n') || '(no matches)',
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}

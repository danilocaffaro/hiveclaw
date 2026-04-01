import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';
import { isCommandSafe, getWorkspaceRoot, validateToolPath } from '../../config/security.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 50_000; // chars
const DEFAULT_TIMEOUT = 30_000; // ms
const BLOCKING_BUDGET_MS = 15_000; // S1.5: auto-background after this
const IS_WINDOWS = process.platform === 'win32';

/**
 * Resolve the shell executable and args for the current platform.
 * - macOS/Linux: bash -c "<command>"
 * - Windows: cmd.exe /d /s /c "<command>"  (falls back to powershell if HIVECLAW_SHELL=powershell)
 */
function getShellArgs(command: string): [string, string[]] {
  if (!IS_WINDOWS) {
    return ['bash', ['-c', command]];
  }
  const preferPowershell = (process.env.HIVECLAW_SHELL ?? '').toLowerCase() === 'powershell';
  if (preferPowershell) {
    return ['powershell', ['-NoProfile', '-NonInteractive', '-Command', command]];
  }
  return ['cmd.exe', ['/d', '/s', '/c', command]];
}

export class BashTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'bash',
    description: 'Run a shell command and return its output. Use for file operations, running scripts, installing packages, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000, max 120000)' },
        cwd: { type: 'string', description: 'Working directory for the command' },
      },
      required: ['command'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const command = input['command'] as string;
    const timeout = Math.min((input['timeout'] as number) ?? DEFAULT_TIMEOUT, 120_000);
    const cwd = (input['cwd'] as string) ?? process.cwd();

    if (!command || typeof command !== 'string') {
      return {
        success: false,
        error: 'command must be a non-empty string. '
          + 'If your command is very long, consider splitting into multiple bash calls. '
          + 'Usage: bash({ command: "your-command-here" })',
      };
    }

    // Safety: block dangerous commands
    const safety = isCommandSafe(command);
    if (!safety.safe) {
      return { success: false, error: safety.reason };
    }

    // Validate cwd is within allowed paths
    const cwdCheck = validateToolPath(cwd, 'read');
    if (!cwdCheck.allowed) {
      return { success: false, error: `Working directory blocked: ${cwdCheck.reason}` };
    }

    try {
      const [shell, shellArgs] = getShellArgs(command);

      // S1.5: Blocking Budget — race execution against 15s budget.
      // If command finishes within budget, return normally.
      // If it exceeds budget, return early with "backgrounded" status
      // and let the process continue (agent can check later).
      const execPromise = execFileAsync(shell, shellArgs, {
        timeout,
        cwd: cwdCheck.resolved,
        env: { ...process.env },
        maxBuffer: MAX_OUTPUT * 4,
      });

      const budgetTimer = new Promise<'backgrounded'>((resolve) => {
        const timer = setTimeout(() => resolve('backgrounded'), BLOCKING_BUDGET_MS);
        timer.unref(); // Don't keep Node alive just for this timer
      });

      const raceResult = await Promise.race([
        execPromise.then(r => ({ type: 'done' as const, ...r })),
        budgetTimer.then(type => ({ type })),
      ]);

      if (raceResult.type === 'backgrounded') {
        // Command still running — let it continue in background, notify agent
        return {
          success: true,
          result: `[Command still running after ${BLOCKING_BUDGET_MS / 1000}s — backgrounded. It will continue to completion. You can proceed with other work and check back later with: bash({ command: "ps aux | grep '${command.slice(0, 30).replace(/'/g, '')}'" })]`,
        };
      }

      const { stdout, stderr } = raceResult as { stdout: string; stderr: string };

      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += stderr ? `\n[stderr]\n${stderr}` : '';

      // Truncate if too long
      if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + `\n[output truncated at ${MAX_OUTPUT} chars]`;
      }

      return { success: true, result: output.trim() };
    } catch (err: unknown) {
      const error = err as Error & { stdout?: string; stderr?: string; code?: number; killed?: boolean };

      if (error.killed) {
        return { success: false, error: `Command timed out after ${timeout}ms` };
      }

      let msg = error.message ?? 'Command failed';
      if (error.stdout) msg += `\n[stdout]\n${error.stdout.slice(0, 5000)}`;
      if (error.stderr) msg += `\n[stderr]\n${error.stderr.slice(0, 5000)}`;

      return { success: false, error: msg };
    }
  }
}

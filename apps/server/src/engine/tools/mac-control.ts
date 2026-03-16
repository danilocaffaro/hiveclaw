// ============================================================
// Mac Control Tool — Desktop automation via cliclick + osascript
// Mouse clicks, keyboard input, window management, app control
// ============================================================

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { platform } from 'os';
import { logger } from '../../lib/logger.js';

export class MacControlTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'mac_control',
    description:
      'Control the macOS desktop: click, type, press keys, take screenshots, manage windows, run AppleScript. ' +
      'Requires macOS with cliclick installed. Actions: click, doubleclick, rightclick, type, key, move, ' +
      'screenshot, applescript, window_list, window_focus, window_resize, get_mouse_position.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'click', 'doubleclick', 'rightclick', 'type', 'key', 'move',
            'screenshot', 'applescript', 'window_list', 'window_focus',
            'window_resize', 'get_mouse_position', 'drag',
          ],
          description: 'Desktop action to perform',
        },
        x: { type: 'number', description: 'X coordinate for click/move/drag' },
        y: { type: 'number', description: 'Y coordinate for click/move/drag' },
        endX: { type: 'number', description: 'End X coordinate for drag' },
        endY: { type: 'number', description: 'End Y coordinate for drag' },
        text: { type: 'string', description: 'Text to type or keys to press (e.g., "cmd+c", "return", "escape")' },
        script: { type: 'string', description: 'AppleScript code to execute' },
        app: { type: 'string', description: 'Application name for window operations' },
        width: { type: 'number', description: 'Window width for resize' },
        height: { type: 'number', description: 'Window height for resize' },
        delay: { type: 'number', description: 'Delay in milliseconds between keystrokes (default: 0)' },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, _context?: ToolContext): Promise<ToolOutput> {
    if (platform() !== 'darwin') {
      return { success: false, error: 'mac_control is only available on macOS' };
    }

    const action = input['action'] as string;

    try {
      switch (action) {
        case 'click':
        case 'doubleclick':
        case 'rightclick': {
          const x = input['x'] as number;
          const y = input['y'] as number;
          if (x == null || y == null) return { success: false, error: 'x and y coordinates required' };
          const cmd = action === 'doubleclick' ? 'dc' : action === 'rightclick' ? 'rc' : 'c';
          execSync(`cliclick ${cmd}:${x},${y}`, { timeout: 5_000 });
          return { success: true, result: { action, x, y } };
        }

        case 'move': {
          const x = input['x'] as number;
          const y = input['y'] as number;
          if (x == null || y == null) return { success: false, error: 'x and y required' };
          execSync(`cliclick m:${x},${y}`, { timeout: 5_000 });
          return { success: true, result: { action: 'move', x, y } };
        }

        case 'drag': {
          const x = input['x'] as number;
          const y = input['y'] as number;
          const endX = input['endX'] as number;
          const endY = input['endY'] as number;
          if (x == null || y == null || endX == null || endY == null) {
            return { success: false, error: 'x, y, endX, endY required for drag' };
          }
          execSync(`cliclick dd:${x},${y} du:${endX},${endY}`, { timeout: 10_000 });
          return { success: true, result: { action: 'drag', from: { x, y }, to: { x: endX, y: endY } } };
        }

        case 'type': {
          const text = input['text'] as string;
          if (!text) return { success: false, error: 'text required for type' };
          const delay = (input['delay'] as number) ?? 0;
          // cliclick t: for typing text
          const escaped = text.replace(/'/g, "'\\''");
          execSync(`cliclick ${delay > 0 ? `-e ${delay} ` : ''}t:'${escaped}'`, { timeout: 30_000 });
          return { success: true, result: { action: 'type', text: text.slice(0, 100) } };
        }

        case 'key': {
          const text = input['text'] as string;
          if (!text) return { success: false, error: 'text (key combo) required, e.g., "cmd+c", "return", "escape"' };
          // Map common key names to cliclick format
          const keyMap: Record<string, string> = {
            'return': 'kp:return', 'enter': 'kp:return', 'escape': 'kp:escape', 'esc': 'kp:escape',
            'tab': 'kp:tab', 'space': 'kp:space', 'delete': 'kp:delete', 'backspace': 'kp:delete',
            'up': 'kp:arrow-up', 'down': 'kp:arrow-down', 'left': 'kp:arrow-left', 'right': 'kp:arrow-right',
            'home': 'kp:home', 'end': 'kp:end', 'pageup': 'kp:page-up', 'pagedown': 'kp:page-down',
            'f1': 'kp:f1', 'f2': 'kp:f2', 'f3': 'kp:f3', 'f4': 'kp:f4', 'f5': 'kp:f5',
          };

          // Handle modifier combos like "cmd+c", "cmd+shift+s"
          if (text.includes('+')) {
            const parts = text.toLowerCase().split('+');
            const key = parts.pop()!;
            const mods = parts;
            let cliclickCmd = '';

            // Build key down/up sequence for modifiers
            for (const mod of mods) {
              const modKey = mod === 'cmd' || mod === 'command' ? 'command'
                : mod === 'ctrl' || mod === 'control' ? 'control'
                : mod === 'alt' || mod === 'option' ? 'option'
                : mod === 'shift' ? 'shift' : mod;
              cliclickCmd += `kd:${modKey} `;
            }
            cliclickCmd += keyMap[key] ?? `kp:${key}`;
            for (const mod of [...mods].reverse()) {
              const modKey = mod === 'cmd' || mod === 'command' ? 'command'
                : mod === 'ctrl' || mod === 'control' ? 'control'
                : mod === 'alt' || mod === 'option' ? 'option'
                : mod === 'shift' ? 'shift' : mod;
              cliclickCmd += ` ku:${modKey}`;
            }
            execSync(`cliclick ${cliclickCmd}`, { timeout: 5_000 });
          } else {
            const mapped = keyMap[text.toLowerCase()] ?? `kp:${text}`;
            execSync(`cliclick ${mapped}`, { timeout: 5_000 });
          }
          return { success: true, result: { action: 'key', key: text } };
        }

        case 'screenshot': {
          return this.takeScreenshot();
        }

        case 'applescript': {
          const script = input['script'] as string;
          if (!script) return { success: false, error: 'script required for applescript action' };
          // Security: limit script length
          if (script.length > 5_000) return { success: false, error: 'AppleScript too long (max 5000 chars)' };
          const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
            timeout: 30_000,
            encoding: 'utf-8',
          }).trim();
          return { success: true, result: { action: 'applescript', output: result.slice(0, 2000) } };
        }

        case 'window_list': {
          const script = `
            tell application "System Events"
              set windowList to {}
              repeat with proc in (every process whose visible is true)
                set procName to name of proc
                repeat with win in (every window of proc)
                  set winName to name of win
                  set winPos to position of win
                  set winSize to size of win
                  set end of windowList to procName & " | " & winName & " | " & (item 1 of winPos as text) & "," & (item 2 of winPos as text) & " | " & (item 1 of winSize as text) & "x" & (item 2 of winSize as text)
                end repeat
              end repeat
              return windowList as text
            end tell
          `;
          const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
            timeout: 10_000, encoding: 'utf-8',
          }).trim();
          const windows = output.split(', ').map(w => {
            const [app, title, pos, size] = w.split(' | ');
            return { app, title, position: pos, size };
          });
          return { success: true, result: { action: 'window_list', windows } };
        }

        case 'window_focus': {
          const app = input['app'] as string;
          if (!app) return { success: false, error: 'app name required' };
          execSync(`osascript -e 'tell application "${app}" to activate'`, { timeout: 5_000 });
          return { success: true, result: { action: 'window_focus', app } };
        }

        case 'window_resize': {
          const app = input['app'] as string;
          const width = input['width'] as number;
          const height = input['height'] as number;
          if (!app || !width || !height) return { success: false, error: 'app, width, height required' };
          const script = `tell application "System Events" to tell process "${app}" to set size of front window to {${width}, ${height}}`;
          execSync(`osascript -e '${script}'`, { timeout: 5_000 });
          return { success: true, result: { action: 'window_resize', app, width, height } };
        }

        case 'get_mouse_position': {
          const output = execSync('cliclick p:', { timeout: 5_000, encoding: 'utf-8' }).trim();
          const [x, y] = output.split(',').map(Number);
          return { success: true, result: { action: 'get_mouse_position', x, y } };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, error: `mac_control error: ${(err as Error).message}` };
    }
  }

  private takeScreenshot(): ToolOutput {
    const tmpDir = join(process.env['HOME'] ?? '/tmp', '.hiveclaw', 'screenshots');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, `mac-${randomUUID()}.png`);

    try {
      execSync(`/usr/sbin/screencapture -x "${filePath}"`, { timeout: 10_000 });
      const buf = readFileSync(filePath);
      unlinkSync(filePath);
      return {
        success: true,
        result: {
          action: 'screenshot',
          format: 'png',
          size: buf.length,
          base64: buf.toString('base64'),
        },
      };
    } catch (err) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
      return { success: false, error: `Screenshot failed: ${(err as Error).message}` };
    }
  }
}

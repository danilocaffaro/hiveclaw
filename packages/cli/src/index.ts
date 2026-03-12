#!/usr/bin/env node

// SuperClaw CLI — `npx superclaw`

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] ?? 'start';

switch (command) {
  case 'start': {
    const port = process.env.PORT ?? '4070';
    console.log(`\n  ✨ Starting SuperClaw Pure on port ${port}...\n`);

    // Open browser after a short delay
    setTimeout(() => {
      const url = `http://localhost:${port}`;
      try {
        if (process.platform === 'darwin') execSync(`open ${url}`);
        else if (process.platform === 'win32') execSync(`start ${url}`);
        else execSync(`xdg-open ${url}`);
      } catch { /* browser open failed, not critical */ }
    }, 2000);

    // Start server
    await import('@superclaw/server');
    break;
  }

  case 'doctor':
    console.log('SuperClaw Doctor — checking your setup...\n');
    // TODO: Check Node version, DB status, provider connectivity
    console.log('  ✅ Node.js:', process.version);
    console.log('  📁 Data dir:', resolve(process.env.HOME ?? '.', '.superclaw'));
    break;

  case 'version':
    console.log('superclaw-pure 0.1.0');
    break;

  default:
    console.log(`Unknown command: ${command}\n`);
    console.log('Usage: superclaw [start|doctor|version]');
    process.exit(1);
}

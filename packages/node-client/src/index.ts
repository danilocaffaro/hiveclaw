#!/usr/bin/env node
/**
 * HiveClaw Node Client
 *
 * Pairs a Mac/Linux machine as a remote node and executes commands sent by agents.
 *
 * Usage:
 *   npx hiveclaw-node pair --gateway https://hiveclaw.local:4070
 *   npx hiveclaw-node start --gateway https://hiveclaw.local:4070 --token hc-node-xxx
 *
 * Phase 3.3 of HiveClaw Platform Blueprint.
 */

import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import * as readline from 'node:readline';

const execFileAsync = promisify(execFile);

// ─── Config ───────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.hiveclaw-node');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const POLICY_FILE = join(CONFIG_DIR, 'policy.json');

interface NodeConfig {
  gateway: string;
  nodeId: string;
  token: string;
  name: string;
  pairedAt: string;
}

interface NodePolicy {
  allowExec: boolean;
  allowCamera: boolean;
  allowScreen: boolean;
  allowLocation: boolean;
  maxTier: number;
  maxConcurrent: number;
  requireTLS: boolean;
}

const DEFAULT_POLICY: NodePolicy = {
  allowExec: true,
  allowCamera: true,
  allowScreen: true,
  allowLocation: false,
  maxTier: 3,
  maxConcurrent: 3,
  requireTLS: false,  // false for dev; set true in prod
};

// ─── Constants ────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const EXEC_TIMEOUT_MS = 120_000;      // 2 min

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'pair':
      await runPair(parseArgs(args.slice(1)));
      break;
    case 'start':
      await runStart(parseArgs(args.slice(1)));
      break;
    case 'status':
      await runStatus();
      break;
    default:
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

// ─── Pair Command ─────────────────────────────────────────────────────────

async function runPair(args: Record<string, string>): Promise<void> {
  const gateway = args.gateway;
  const name = args.name ?? hostname();

  if (!gateway) {
    console.error('Error: --gateway is required');
    console.error('Example: npx hiveclaw-node pair --gateway https://hiveclaw.local:4070');
    process.exit(1);
  }

  console.log(`\n🐾 HiveClaw Node Client — Pairing\n`);
  console.log(`Gateway: ${gateway}`);
  console.log(`Device name: ${name}`);
  console.log('');

  // Pre-request macOS permissions (Adler Q4)
  await preRequestPermissions();

  // Detect capabilities
  const capabilities = await detectCapabilities();
  console.log(`Capabilities: ${capabilities.join(', ')}\n`);

  // Get pairing code from user
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise<string>((resolve) => {
    rl.question('Enter pairing code from HiveClaw dashboard: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!code.match(/^\d{6}$/)) {
    console.error('Error: pairing code must be 6 digits');
    process.exit(1);
  }

  // Pair with server
  console.log('\nPairing...');
  try {
    const res = await fetch(`${gateway}/nodes/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        name,
        deviceType: detectDeviceType(),
        capabilities,
        metadata: {
          hostname: hostname(),
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json() as Record<string, unknown>;
      console.error(`❌ Pairing failed: ${JSON.stringify(err)}`);
      process.exit(1);
    }

    const data = await res.json() as { data: { nodeId: string; token: string; message: string } };
    const { nodeId, token, message } = data.data;

    // Save config
    ensureConfigDir();
    const config: NodeConfig = {
      gateway,
      nodeId,
      token,
      name,
      pairedAt: new Date().toISOString(),
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });

    // Write default policy
    if (!existsSync(POLICY_FILE)) {
      writeFileSync(POLICY_FILE, JSON.stringify(DEFAULT_POLICY, null, 2));
    }

    console.log(`\n✅ ${message}`);
    console.log(`Node ID: ${nodeId}`);
    console.log(`Config: ${CONFIG_FILE}`);
    console.log('');
    console.log('Start the node client with:');
    console.log('  npx hiveclaw-node start');

  } catch (err) {
    console.error(`❌ Pairing error: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ─── Start Command ────────────────────────────────────────────────────────

async function runStart(args: Record<string, string>): Promise<void> {
  // Load config from file or args
  let config: NodeConfig;

  if (args.gateway && args.token) {
    config = {
      gateway: args.gateway,
      token: args.token,
      nodeId: args.nodeId ?? '',
      name: args.name ?? hostname(),
      pairedAt: new Date().toISOString(),
    };
  } else if (existsSync(CONFIG_FILE)) {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } else {
    console.error('Error: No config found. Run "hiveclaw-node pair" first.');
    process.exit(1);
  }

  const policy = existsSync(POLICY_FILE)
    ? { ...DEFAULT_POLICY, ...JSON.parse(readFileSync(POLICY_FILE, 'utf8')) }
    : DEFAULT_POLICY;

  console.log(`\n🐾 HiveClaw Node Client — Starting`);
  console.log(`Gateway: ${config.gateway}`);
  console.log(`Node: ${config.name} (${config.nodeId})`);
  console.log('');

  await runClient(config, policy);
}

// ─── Status Command ───────────────────────────────────────────────────────

async function runStatus(): Promise<void> {
  if (!existsSync(CONFIG_FILE)) {
    console.log('Not paired. Run "hiveclaw-node pair" first.');
    process.exit(1);
  }

  const config: NodeConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  console.log('\n📊 HiveClaw Node Status');
  console.log(`  Node ID: ${config.nodeId}`);
  console.log(`  Name: ${config.name}`);
  console.log(`  Gateway: ${config.gateway}`);
  console.log(`  Paired: ${config.pairedAt}`);
  console.log(`  Config: ${CONFIG_FILE}`);
  console.log('');
}

// ─── WebSocket Client Loop ────────────────────────────────────────────────

async function runClient(config: NodeConfig, policy: NodePolicy): Promise<void> {
  let attempt = 0;
  let running = true;

  process.on('SIGINT', () => { running = false; process.exit(0); });
  process.on('SIGTERM', () => { running = false; process.exit(0); });

  while (running) {
    try {
      await connect(config, policy);
      attempt = 0; // Reset on successful connection
    } catch (err) {
      if (!running) break;
      attempt++;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_MS);
      console.error(`[Client] Disconnected (${(err as Error).message}). Reconnecting in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

function connect(config: NodeConfig, policy: NodePolicy): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = config.gateway.replace(/^http/, 'ws') + '/api/nodes/connect';

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${config.token}` },
      rejectUnauthorized: false, // Allow self-signed certs in dev
    });

    let connected = false;
    const activeCmds = new Map<string, ReturnType<typeof setTimeout>>();

    ws.on('open', () => {
      connected = true;
      console.log(`[Client] Connected to ${config.gateway}`);
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; data?: unknown };

        switch (msg.type) {
          case 'welcome':
            console.log('[Client] Ready to receive commands');
            break;

          case 'rpc_request': {
            const req = msg.data as {
              id: string; type: string; command?: string; params?: Record<string, unknown>;
              tier: number; timestamp: number; nonce: string; hmac: string;
            };

            // Timestamp window check (anti-replay, spec §5.3)
            const age = Math.abs(Date.now() / 1000 - req.timestamp);
            if (age > 30) {
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: { id: req.id, status: 'error', error: 'Request expired (replay protection)' },
              }));
              return;
            }

            // Policy check
            if (req.tier > policy.maxTier) {
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: { id: req.id, status: 'error', error: `Tier ${req.tier} exceeds local policy maxTier ${policy.maxTier}` },
              }));
              return;
            }

            if (activeCmds.size >= policy.maxConcurrent) {
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: { id: req.id, status: 'error', error: 'Max concurrent commands reached' },
              }));
              return;
            }

            // Execute
            const cmdTimer = setTimeout(() => {
              activeCmds.delete(req.id);
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: { id: req.id, status: 'timeout', error: 'Command timed out' },
              }));
            }, EXEC_TIMEOUT_MS);

            activeCmds.set(req.id, cmdTimer);

            const startMs = Date.now();
            try {
              const result = await executeCommand(req.type, req.command, req.params, policy);
              clearTimeout(cmdTimer);
              activeCmds.delete(req.id);
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: {
                  id: req.id,
                  status: 'ok',
                  result,
                  durationMs: Date.now() - startMs,
                },
              }));
            } catch (err) {
              clearTimeout(cmdTimer);
              activeCmds.delete(req.id);
              ws.send(JSON.stringify({
                type: 'rpc_response',
                data: {
                  id: req.id,
                  status: 'error',
                  error: (err as Error).message,
                  durationMs: Date.now() - startMs,
                },
              }));
            }
            break;
          }

          case 'heartbeat_ack':
            break;
        }
      } catch (err) {
        console.error('[Client] Message parse error:', (err as Error).message);
      }
    });

    ws.on('close', (code, reason) => {
      if (connected) {
        reject(new Error(`Closed: ${code} ${reason}`));
      } else {
        reject(new Error('Connection failed'));
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

// ─── Command Executor ─────────────────────────────────────────────────────

async function executeCommand(
  type: string,
  command: string | undefined,
  params: Record<string, unknown> | undefined,
  policy: NodePolicy,
): Promise<unknown> {
  switch (type) {
    case 'exec':
      if (!policy.allowExec) throw new Error('exec disabled in local policy');
      if (!command) throw new Error('No command provided');
      return executeShell(command);

    case 'screen_record':
      if (!policy.allowScreen) throw new Error('screen capture disabled in local policy');
      return takeScreenshot(params);

    case 'camera_snap':
      if (!policy.allowCamera) throw new Error('camera disabled in local policy');
      return cameraSnap(params);

    case 'camera_list':
      return listCameras();

    case 'location_get':
      if (!policy.allowLocation) throw new Error('location disabled in local policy');
      return getLocation();

    case 'notifications_list':
      return listNotifications();

    default:
      throw new Error(`Unknown command type: ${type}`);
  }
}

async function executeShell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      timeout: EXEC_TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';
    let totalBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? 0,
      });
    });

    child.on('error', reject);
  });
}

async function takeScreenshot(params?: Record<string, unknown>): Promise<{ path: string; base64: string }> {
  const outPath = `/tmp/hiveclaw-screenshot-${Date.now()}.png`;
  await execFileAsync('screencapture', ['-x', outPath]);

  const buf = readFileSync(outPath);
  const base64 = buf.toString('base64');
  // Clean up
  await execFileAsync('rm', [outPath]).catch(() => {});

  return { path: outPath, base64: `data:image/png;base64,${base64}` };
}

async function cameraSnap(params?: Record<string, unknown>): Promise<{ base64: string }> {
  const outPath = `/tmp/hiveclaw-camera-${Date.now()}.jpg`;
  try {
    await execFileAsync('imagesnap', ['-q', outPath]);
  } catch {
    // imagesnap not installed — try ffmpeg
    await execFileAsync('ffmpeg', ['-f', 'avfoundation', '-i', '0', '-vframes', '1', '-q:v', '2', outPath]);
  }

  const buf = readFileSync(outPath);
  const base64 = buf.toString('base64');
  await execFileAsync('rm', [outPath]).catch(() => {});

  return { base64: `data:image/jpeg;base64,${base64}` };
}

async function listCameras(): Promise<{ cameras: string[] }> {
  if (process.platform !== 'darwin') {
    return { cameras: ['default'] };
  }
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPCameraDataType', '-json']);
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const cameras = (data.SPCameraDataType as Array<{ _name: string }> ?? []).map(c => c._name);
    return { cameras };
  } catch {
    return { cameras: ['default'] };
  }
}

async function getLocation(): Promise<{ lat: number; lon: number; accuracy: number }> {
  // macOS CoreLocation via AppleScript (requires permission)
  const script = `
    use framework "CoreLocation"
    set mgr to current application's CLLocationManager's alloc()'s init()
    set loc to mgr's location()
    set coord to loc's coordinate()
    return {|latitude| of coord, |longitude| of coord}
  `;
  const { stdout } = await execFileAsync('osascript', ['-e', script]);
  const parts = stdout.trim().replace(/[{}]/g, '').split(',').map(s => parseFloat(s.trim()));
  return { lat: parts[0], lon: parts[1], accuracy: 10 };
}

async function listNotifications(): Promise<{ notifications: unknown[] }> {
  // macOS: read Notification Center via SQLite (limited)
  // For now, return empty (real impl requires notification entitlements)
  return { notifications: [] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function detectCapabilities(): Promise<string[]> {
  const caps: string[] = ['exec', 'screen'];

  if (process.platform === 'darwin') {
    try {
      await execFileAsync('imagesnap', ['--version']).catch(() =>
        execFileAsync('ffmpeg', ['-version'])
      );
      caps.push('camera');
    } catch { /* no camera tool */ }
    caps.push('notifications');
  }

  return caps;
}

function detectDeviceType(): string {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

function hostname(): string {
  try {
    return require('os').hostname();
  } catch {
    return 'unknown-host';
  }
}

async function preRequestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return;

  console.log('Requesting macOS permissions (you may see system dialogs)...');

  // Screen capture permission
  try {
    await execFileAsync('screencapture', ['-x', '/tmp/hiveclaw-perm-test.png']);
    await execFileAsync('rm', ['/tmp/hiveclaw-perm-test.png']).catch(() => {});
    console.log('  ✅ Screen capture: OK');
  } catch {
    console.log('  ⚠️  Screen capture: requires permission in System Settings → Privacy');
  }

  // Camera permission via imagesnap
  try {
    await execFileAsync('imagesnap', ['-q', '/tmp/hiveclaw-cam-test.jpg']);
    await execFileAsync('rm', ['/tmp/hiveclaw-cam-test.jpg']).catch(() => {});
    console.log('  ✅ Camera: OK');
  } catch {
    console.log('  ⚠️  Camera: imagesnap not found or requires permission');
  }
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      result[key] = value;
      if (value !== 'true') i++;
    }
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`
🐾 HiveClaw Node Client v1.0.0

Commands:
  pair    --gateway <url>              Pair this device with a HiveClaw server
  start   [--gateway <url> --token <t>] Start the node client
  status                               Show current pairing status

Options:
  --gateway   HiveClaw server URL (e.g. https://hiveclaw.local:4070)
  --token     Node auth token (from pairing)
  --name      Device name (default: hostname)

Examples:
  npx hiveclaw-node pair --gateway https://hiveclaw.local:4070
  npx hiveclaw-node start
  npx hiveclaw-node status
`);
}

// ─── Entry ────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

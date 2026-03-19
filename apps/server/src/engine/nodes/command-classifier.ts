/**
 * Command Classifier — Blast radius tier assignment for node exec commands.
 *
 * Tier 0: Sensors (camera, screen, location) — automatic
 * Tier 1: Safe exec (read-only, in allowlist) — automatic
 * Tier 2: Side-effect exec (writes, installs) — agent approval
 * Tier 3: Destructive / unknown — owner approval
 * Tier 4: Always blocked — rejected
 *
 * Security spec: docs/NODE-EXEC-SECURITY-SPEC.md §2
 * Adler Q1 amendment: command substitution ($(), backticks) blocked even in Tier 2.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type CommandTier = 0 | 1 | 2 | 3 | 4;

export type CommandType = 'exec' | 'camera_snap' | 'camera_list' | 'screen_record' | 'location_get' | 'notifications_list';

export interface ClassificationResult {
  tier: CommandTier;
  type: CommandType;
  binary: string;
  reason: string;
  blocked: boolean;
  blockedPattern?: string;
}

// ─── Sensor Commands (Tier 0) ─────────────────────────────────────────────

const SENSOR_COMMANDS = new Set<CommandType>([
  'camera_snap', 'camera_list', 'screen_record', 'location_get', 'notifications_list',
]);

// ─── Blocked Patterns (Tier 4) ────────────────────────────────────────────
// Checked against original string BEFORE shell expansion (Adler Q1)

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\|\s*(sh|bash|zsh|eval)\b/, label: 'pipe to shell' },
  { pattern: />\s*\/dev\/sd/, label: 'write to block device' },
  { pattern: /sudo\s+rm\s+-rf\s+\/\s*$/, label: 'sudo rm -rf /' },
  { pattern: /curl.*\|\s*(sh|bash)/, label: 'curl pipe to shell' },
  { pattern: /wget.*\|\s*(sh|bash)/, label: 'wget pipe to shell' },
  { pattern: /\$\(/, label: 'command substitution $()' },
  { pattern: /`[^`]+`/, label: 'backtick command substitution' },
  { pattern: /\$\{[^}]*(PATH|HOME|USER|SHELL|SSH|AWS|TOKEN|KEY|SECRET|PASSWORD|CRED)/i, label: 'sensitive env var expansion' },
  { pattern: /:\(\)\s*\{/, label: 'fork bomb' },
  { pattern: /rm\s+-rf\s+\/\s*$/, label: 'rm -rf /' },
  { pattern: /mkfs\b/, label: 'mkfs (format disk)' },
  { pattern: /dd\s+if=.*of=\/dev\//, label: 'dd to device' },
  // R22: Interpreter code execution (Sherlock audit finding #3)
  { pattern: /\b(python3?|ruby|perl|node|lua|php)\s+(-c|-e)\s/, label: 'interpreter code exec' },
];

// ─── Command Lists ────────────────────────────────────────────────────────

const BLOCKED_BINARIES = new Set([
  'mkfs', 'fdisk', 'parted', 'format',
]);

const DESTRUCTIVE_BINARIES = new Set([
  'rm', 'rmdir', 'kill', 'killall', 'pkill',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'sudo', 'su', 'chown', 'launchctl',
  'systemctl', 'service',
]);

const SIDE_EFFECT_BINARIES = new Set([
  'mkdir', 'cp', 'mv', 'touch', 'chmod', 'ln',
  'brew', 'npm', 'pnpm', 'yarn', 'pip', 'pip3',
  'open', 'osascript', 'defaults',
  'git', 'curl', 'wget',
  'tar', 'unzip', 'zip', 'gzip',
  'sed', 'awk',  // can write with -i flag
  'tee',
]);

const SAFE_BINARIES = new Set([
  'ls', 'pwd', 'whoami', 'date', 'cal', 'cat', 'head', 'tail',
  'grep', 'find', 'wc', 'sort', 'uniq', 'diff',
  'df', 'du', 'uptime', 'uname', 'hostname',
  'ps', 'top', 'htop', 'free', 'vmstat',
  'echo', 'printf', 'which', 'type', 'file', 'stat',
  'env', 'printenv', 'id', 'groups',
  'screencapture', 'imagesnap', 'system_profiler',
  'sw_vers', 'arch', 'sysctl', 'ioreg',
  'realpath', 'dirname', 'basename',
  'true', 'false', 'test',
  'jq', 'yq',
]);

// ─── Classifier ───────────────────────────────────────────────────────────

/**
 * Classify a command or sensor request into a blast radius tier.
 */
export function classifyCommand(type: CommandType, command?: string): ClassificationResult {
  // Tier 0: Sensors
  if (SENSOR_COMMANDS.has(type)) {
    return {
      tier: 0,
      type,
      binary: type,
      reason: 'Sensor command — automatic',
      blocked: false,
    };
  }

  // Exec commands require a command string
  if (!command || !command.trim()) {
    return {
      tier: 4,
      type: 'exec',
      binary: '',
      reason: 'Empty command',
      blocked: true,
    };
  }

  const trimmed = command.trim();

  // Check blocked patterns first (on original string, before any parsing)
  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        tier: 4,
        type: 'exec',
        binary: extractBinary(trimmed),
        reason: `Blocked pattern: ${label}`,
        blocked: true,
        blockedPattern: label,
      };
    }
  }

  // Extract the first binary
  const binary = extractBinary(trimmed);

  // Tier 4: Blocked binaries
  if (BLOCKED_BINARIES.has(binary)) {
    return {
      tier: 4,
      type: 'exec',
      binary,
      reason: `Blocked binary: ${binary}`,
      blocked: true,
    };
  }

  // Tier 3: Destructive
  if (DESTRUCTIVE_BINARIES.has(binary)) {
    return {
      tier: 3,
      type: 'exec',
      binary,
      reason: `Destructive command: ${binary}`,
      blocked: false,
    };
  }

  // Tier 2: Side-effect
  if (SIDE_EFFECT_BINARIES.has(binary)) {
    return {
      tier: 2,
      type: 'exec',
      binary,
      reason: `Side-effect command: ${binary}`,
      blocked: false,
    };
  }

  // Tier 1: Safe
  if (SAFE_BINARIES.has(binary)) {
    return {
      tier: 1,
      type: 'exec',
      binary,
      reason: `Safe command: ${binary}`,
      blocked: false,
    };
  }

  // Unknown → Tier 3 (fail-closed, per spec §2.2 step 7)
  return {
    tier: 3,
    type: 'exec',
    binary,
    reason: `Unknown command: ${binary} — classified as Tier 3 (fail-closed)`,
    blocked: false,
  };
}

/**
 * Check if a command would be executed via execFile (Tier 1) or sh -c (Tier 2+).
 * Per Adler Q1: execFile for Tier 1, sh -c for Tier 2+ with pattern analysis.
 */
export function getExecMethod(tier: CommandTier): 'execFile' | 'shell' {
  return tier <= 1 ? 'execFile' : 'shell';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the first binary from a command string.
 * Handles: `binary args`, `env VAR=val binary`, `/full/path/binary`
 */
function extractBinary(command: string): string {
  const parts = command.trim().split(/\s+/);
  let idx = 0;

  // Skip env var assignments (VAR=value)
  while (idx < parts.length && /^[A-Z_]+=/.test(parts[idx])) {
    idx++;
  }

  // Skip 'env' command prefix
  if (parts[idx] === 'env') {
    idx++;
    while (idx < parts.length && /^[A-Z_]+=/.test(parts[idx])) {
      idx++;
    }
  }

  const raw = parts[idx] ?? '';
  // Extract basename from full path (/usr/bin/ls → ls)
  const slash = raw.lastIndexOf('/');
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

export { extractBinary as _extractBinary }; // exported for testing

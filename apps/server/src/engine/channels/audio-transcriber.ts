/**
 * Audio Transcriber — converts voice/audio files to text.
 *
 * Used by Channel Router to auto-transcribe inbound voice messages before
 * passing them to the agent engine.
 *
 * Strategy (in order):
 *   1. Local whisper-cli (whisper.cpp) — free, offline, fast on Apple Silicon
 *   2. OpenAI Whisper API — cloud fallback if local unavailable
 *   3. Returns null — graceful degradation
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';

// ─── Local whisper-cli paths ───
const WHISPER_CLI_PATHS = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  '/usr/bin/whisper-cli',
];

const WHISPER_MODEL_PATHS = [
  join(homedir(), '.hiveclaw', 'models', 'ggml-base.bin'),
  join(homedir(), '.hiveclaw', 'models', 'ggml-small.bin'),
  join(homedir(), '.hiveclaw', 'models', 'ggml-tiny.bin'),
  '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
];

function findBinary(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Convert audio to 16kHz mono WAV using macOS afconvert or ffmpeg.
 */
function convertToWav(inputPath: string): string | null {
  const wavPath = join(tmpdir(), `hiveclaw-stt-${Date.now()}.wav`);
  try {
    // Try afconvert (macOS built-in)
    execSync(`afconvert "${inputPath}" "${wavPath}" -d LEI16@16000 -c 1`, { timeout: 15000, stdio: 'pipe' });
    return wavPath;
  } catch {
    try {
      // Fallback to ffmpeg
      execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f wav "${wavPath}"`, { timeout: 15000, stdio: 'pipe' });
      return wavPath;
    } catch {
      logger.warn('[Transcriber] Cannot convert audio to WAV — no afconvert or ffmpeg');
      return null;
    }
  }
}

/**
 * Transcribe using local whisper-cli (whisper.cpp).
 */
async function transcribeLocal(filePath: string): Promise<string | null> {
  const cli = findBinary(WHISPER_CLI_PATHS);
  const model = findBinary(WHISPER_MODEL_PATHS);

  if (!cli || !model) {
    logger.debug('[Transcriber] Local whisper not available (cli=%s, model=%s)', !!cli, !!model);
    return null;
  }

  // Convert to WAV 16kHz mono (whisper.cpp requirement)
  const wavPath = convertToWav(filePath);
  if (!wavPath) return null;

  try {
    const output = execSync(
      `"${cli}" -m "${model}" -f "${wavPath}" --no-timestamps -l auto --print-special false 2>/dev/null`,
      { timeout: 30000, encoding: 'utf-8' }
    );

    // whisper-cli outputs text to stdout, filter out empty/whitespace lines
    const text = output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('whisper_') && !l.startsWith('ggml_') && !l.startsWith('load_'))
      .join(' ')
      .trim();

    if (text) {
      logger.info('[Transcriber] Local whisper: %d bytes → "%s" (%d chars)', readFileSync(filePath).length, text.slice(0, 80), text.length);
      return text;
    }
    return null;
  } catch (err) {
    logger.warn('[Transcriber] Local whisper failed: %s', (err as Error).message?.slice(0, 200));
    return null;
  }
}

/**
 * Transcribe using OpenAI Whisper API (cloud fallback).
 */
async function transcribeOpenAI(filePath: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const fileBuffer = readFileSync(filePath);
    const filename = basename(filePath);

    const boundary = `----HiveClawBoundary${Date.now()}`;
    const parts: Buffer[] = [];

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: audio/ogg\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${WHISPER_MODEL}\r\n`
    ));

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const resp = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      logger.error('[Transcriber] Whisper API error (%d): %s', resp.status, errText.slice(0, 200));
      return null;
    }

    const result = await resp.json() as { text?: string };
    const text = result.text?.trim();

    if (text) {
      logger.info('[Transcriber] OpenAI Whisper: %d bytes → %d chars', fileBuffer.length, text.length);
      return text;
    }

    return null;
  } catch (err) {
    logger.error('[Transcriber] OpenAI Whisper failed: %s', (err as Error).message);
    return null;
  }
}

/**
 * Transcribe an audio file. Tries local whisper-cli first, then OpenAI API.
 * Returns the transcription text, or null on failure.
 */
export async function transcribeAudio(filePath: string): Promise<string | null> {
  // Strategy 1: Local whisper-cli (free, fast, offline)
  const localResult = await transcribeLocal(filePath);
  if (localResult) return localResult;

  // Strategy 2: OpenAI Whisper API (cloud)
  const apiResult = await transcribeOpenAI(filePath);
  if (apiResult) return apiResult;

  logger.warn('[Transcriber] All transcription methods failed for %s', filePath);
  return null;
}

/**
 * HiveClaw Connect — Token encoding/decoding
 *
 * Token format: HCW-XXXX-XXXX-XXXX-XXXX
 * Contains: instance_id, broker URL, MQTT credentials (all base64url encoded)
 */

import { randomBytes, createHash } from 'crypto';

export interface TokenPayload {
  /** Unique instance identifier */
  instance: string;
  /** MQTT broker URL (wss://) */
  broker: string;
  /** MQTT username */
  mqttUser: string;
  /** MQTT password */
  mqttPass: string;
  /** User ID this token belongs to */
  userId?: string;
  /** User role */
  role?: string;
  /** Allowed agent IDs (empty = all) */
  agents?: string[];
  /** Token version */
  v: number;
}

const TOKEN_PREFIX = 'HCW';
const TOKEN_VERSION = 1;

/** Generate a random instance ID */
export function generateInstanceId(): string {
  return 'hc_' + randomBytes(12).toString('hex');
}

/** Generate MQTT credentials for an instance */
export function generateMqttCredentials(instanceId: string): { user: string; pass: string } {
  return {
    user: `${instanceId}_client`,
    pass: randomBytes(24).toString('base64url'),
  };
}

/** Generate a user-specific remote access token */
export function generateToken(payload: TokenPayload): string {
  const json = JSON.stringify({
    i: payload.instance,
    b: payload.broker,
    u: payload.mqttUser,
    p: payload.mqttPass,
    uid: payload.userId,
    r: payload.role,
    a: payload.agents,
    v: payload.v,
  });

  const encoded = Buffer.from(json).toString('base64url');

  // Split into groups of 4 for readability
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    chunks.push(encoded.slice(i, i + 4));
  }

  // Add checksum (first 4 chars of hash)
  const checksum = createHash('sha256').update(encoded).digest('base64url').slice(0, 4);

  return `${TOKEN_PREFIX}-${chunks.join('-')}-${checksum}`;
}

/** Decode a HiveClaw Connect token */
export function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('-');
    if (parts.length < 3 || parts[0] !== TOKEN_PREFIX) return null;

    // Remove prefix and checksum
    const checksum = parts[parts.length - 1];
    const encoded = parts.slice(1, -1).join('');

    // Verify checksum
    const expectedChecksum = createHash('sha256').update(encoded).digest('base64url').slice(0, 4);
    if (checksum !== expectedChecksum) return null;

    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    const data = JSON.parse(json);

    return {
      instance: data.i,
      broker: data.b,
      mqttUser: data.u,
      mqttPass: data.p,
      userId: data.uid,
      role: data.r,
      agents: data.a,
      v: data.v || TOKEN_VERSION,
    };
  } catch {
    return null;
  }
}

/** Validate token format (quick check, no decode) */
export function isValidTokenFormat(token: string): boolean {
  return /^HCW-[A-Za-z0-9_-]{4,}(-[A-Za-z0-9_-]{1,4})+$/.test(token);
}

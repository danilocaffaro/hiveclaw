/**
 * HiveClaw Connect — MQTT Bridge
 *
 * Connects HiveClaw server to MQTT broker (HiveMQ Cloud or self-hosted)
 * Routes messages between remote PWA clients and local agent-runner
 * All messages are E2E encrypted — broker sees only blobs
 */

import mqtt from 'mqtt';
import { getDb } from '../../db/index.js';
import { encrypt, decrypt, generateKeyPair, type KeyPair } from './crypto.js';
import { validateSession, pairDevice, type Device } from './device-manager.js';
import { generateInstanceId, generateMqttCredentials, generateToken, decodeToken, type TokenPayload } from './token.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'connect:mqtt' });

export interface MqttBridgeConfig {
  broker: string;        // wss://broker.hivemq.com:8884/mqtt
  instanceId: string;
  mqttUser: string;
  mqttPass: string;
  serverKeyPair: KeyPair;
}

export interface ConnectMessage {
  type: 'chat' | 'auth' | 'auth_response' | 'ping' | 'pong' | 'typing' | 'stream_start' | 'stream_delta' | 'stream_end' | 'tool_start' | 'tool_finish';
  payload: Record<string, unknown>;
  ts: number;
}

type MessageHandler = (deviceId: string, device: Device, message: ConnectMessage) => void | Promise<void>;

export class MqttBridge {
  private client: mqtt.MqttClient | null = null;
  private config: MqttBridgeConfig | null = null;
  private handlers: Map<string, MessageHandler> = new Map();
  private deviceKeys: Map<string, string> = new Map(); // deviceId -> publicKey
  private _connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  get connected(): boolean { return this._connected; }
  get instanceId(): string | null { return this.config?.instanceId ?? null; }

  /** Initialize config from DB or create new */
  async loadOrCreateConfig(): Promise<MqttBridgeConfig> {
    const db = getDb();
    const getKey = (key: string): string | null => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    };
    const setKey = (key: string, value: string): void => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    };

    let instanceId = getKey('connect_instance_id');
    let broker = getKey('connect_broker');
    let mqttUser = getKey('connect_mqtt_user');
    let mqttPass = getKey('connect_mqtt_pass');
    let serverPubKey = getKey('connect_server_public_key');
    let serverSecKey = getKey('connect_server_secret_key');

    // Generate new config if missing
    if (!instanceId) {
      instanceId = generateInstanceId();
      setKey('connect_instance_id', instanceId);
    }
    if (!broker) {
      broker = 'wss://broker.hivemq.com:8884/mqtt';
      setKey('connect_broker', broker);
    }
    if (!mqttUser || !mqttPass) {
      const creds = generateMqttCredentials(instanceId);
      mqttUser = creds.user;
      mqttPass = creds.pass;
      setKey('connect_mqtt_user', mqttUser);
      setKey('connect_mqtt_pass', mqttPass);
    }
    if (!serverPubKey || !serverSecKey) {
      const kp = generateKeyPair();
      serverPubKey = kp.publicKey;
      serverSecKey = kp.secretKey;
      setKey('connect_server_public_key', serverPubKey);
      setKey('connect_server_secret_key', serverSecKey);
    }

    this.config = {
      broker,
      instanceId,
      mqttUser,
      mqttPass,
      serverKeyPair: { publicKey: serverPubKey, secretKey: serverSecKey },
    };

    return this.config;
  }

  /** Connect to MQTT broker */
  async connect(): Promise<void> {
    // Guard: don't reconnect if already connected
    if (this._connected && this.client) {
      log.info('MQTT already connected, skipping reconnect');
      return;
    }

    // Cleanup stale client before reconnecting
    if (this.client) {
      try { this.client.end(true); } catch { /* ignore */ }
      this.client = null;
    }

    if (!this.config) await this.loadOrCreateConfig();
    const cfg = this.config!;

    log.info(`Connecting to MQTT broker: ${cfg.broker}`);

    this.client = mqtt.connect(cfg.broker, {
      username: cfg.mqttUser,
      password: cfg.mqttPass,
      clientId: `hc_server_${cfg.instanceId.slice(3, 15)}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      log.info('Connected to MQTT broker');

      // Subscribe to instance topics
      const prefix = cfg.instanceId;
      this.client!.subscribe([
        `${prefix}/auth`,      // Device pairing requests
        `${prefix}/+/user`,    // User messages (per-device)
        `${prefix}/+/ping`,    // Device pings
      ], { qos: 1 });
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload).catch(err => {
        log.error({ err }, 'Error handling MQTT message');
      });
    });

    this.client.on('error', (err) => {
      log.error({ err: err.message }, 'MQTT error');
    });

    this.client.on('close', () => {
      this._connected = false;
      this.reconnectAttempts++;
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        log.warn(`MQTT disconnected, reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      } else {
        log.error('MQTT max reconnect attempts reached');
        this.client?.end(true);
      }
    });
  }

  /** Disconnect from broker */
  async disconnect(): Promise<void> {
    if (this.client) {
      this._connected = false;
      this.client.end(true);
      this.client = null;
      log.info('Disconnected from MQTT broker');
    }
  }

  /** Register a message handler */
  onMessage(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /** Send an encrypted message to a specific device */
  sendToDevice(deviceId: string, message: ConnectMessage): void {
    if (!this.client || !this.config || !this._connected) {
      log.warn('Cannot send — MQTT not connected');
      return;
    }

    const topic = `${this.config.instanceId}/${deviceId}/agent`;

    const devicePubKey = this.deviceKeys.get(deviceId);
    if (devicePubKey) {
      // Encrypted (E2E)
      const plaintext = JSON.stringify(message);
      const encrypted = encrypt(plaintext, devicePubKey, this.config.serverKeyPair.secretKey);
      this.client.publish(topic, JSON.stringify(encrypted), { qos: 1 });
    } else {
      // Plain text fallback (MVP — no E2E key exchanged yet)
      this.client.publish(topic, JSON.stringify(message), { qos: 1 });
    }
  }

  /** Broadcast to all active devices of a user */
  sendToUser(userId: string, message: ConnectMessage, devices: Device[]): void {
    for (const device of devices) {
      if (!device.revoked) {
        this.deviceKeys.set(device.id, device.publicKey);
        this.sendToDevice(device.id, message);
      }
    }
  }

  /** Generate a remote access token for a user */
  generateUserToken(userId: string, role: string, agents?: string[]): string {
    if (!this.config) throw new Error('MQTT bridge not initialized');

    return generateToken({
      instance: this.config.instanceId,
      broker: this.config.broker,
      mqttUser: this.config.mqttUser,
      mqttPass: this.config.mqttPass,
      userId,
      role,
      agents,
      v: 1,
    });
  }

  /** Handle incoming MQTT message */
  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    if (!this.config) return;

    const prefix = this.config.instanceId;
    const parts = topic.replace(`${prefix}/`, '').split('/');

    // Auth request (pairing)
    if (parts[0] === 'auth') {
      await this.handleAuth(payload);
      return;
    }

    // Device message
    const deviceId = parts[0];
    const channel = parts[1]; // 'user' or 'ping'

    if (channel === 'ping') {
      this.handlePing(deviceId);
      return;
    }

    if (channel === 'user') {
      await this.handleUserMessage(deviceId, payload);
    }
  }

  /** Handle device pairing/auth request */
  private async handleAuth(payload: Buffer): Promise<void> {
    try {
      const data = JSON.parse(payload.toString()) as {
        token: string;
        deviceName: string;
        publicKey: string;
        userAgent?: string;
      };

      // Validate the token
      const tokenPayload = decodeToken(data.token) as TokenPayload | null;
      if (!tokenPayload || tokenPayload.instance !== this.config!.instanceId) {
        log.warn('Invalid pairing token');
        return;
      }

      // Pair the device
      const device = pairDevice({
        userId: tokenPayload.userId || 'default',
        name: data.deviceName,
        publicKey: data.publicKey,
        userAgent: data.userAgent,
      });

      // Store the device's public key
      this.deviceKeys.set(device.id, data.publicKey);

      // Send auth response (unencrypted — first message, no shared key yet)
      // After this, all comms will be encrypted
      const response = {
        type: 'auth_response' as const,
        payload: {
          status: 'paired',
          deviceId: device.id,
          sessionToken: device.sessionToken,
          serverPublicKey: this.config!.serverKeyPair.publicKey,
          role: tokenPayload.role || 'member',
          agents: tokenPayload.agents || [],
        },
        ts: Date.now(),
      };

      const topic = `${this.config!.instanceId}/${device.id}/agent`;
      this.client!.publish(topic, JSON.stringify(response), { qos: 1 });

      // Subscribe to this device's topics
      this.client!.subscribe([
        `${this.config!.instanceId}/${device.id}/user`,
        `${this.config!.instanceId}/${device.id}/ping`,
      ], { qos: 1 });

      log.info(`Device paired: ${device.name} (${device.id})`);
    } catch (err) {
      log.error({ err }, 'Auth error');
    }
  }

  /** Handle user message — supports both encrypted (E2E) and plain text (MVP) */
  private async handleUserMessage(deviceId: string, payload: Buffer): Promise<void> {
    try {
      const parsed = JSON.parse(payload.toString());

      let message: ConnectMessage;

      // Check if this is an encrypted message (has nonce field) or plain text
      if (parsed.nonce && parsed.ciphertext) {
        // Encrypted message — decrypt with E2E
        const devicePubKey = this.deviceKeys.get(deviceId);
        if (!devicePubKey) {
          const db = getDb();
          const row = db.prepare('SELECT public_key FROM connect_devices WHERE id = ? AND revoked = 0').get(deviceId) as { public_key: string } | undefined;
          if (!row) { log.warn(`Unknown device: ${deviceId}`); return; }
          this.deviceKeys.set(deviceId, row.public_key);
        }
        const pubKey = this.deviceKeys.get(deviceId)!;
        const plaintext = decrypt(parsed, pubKey, this.config!.serverKeyPair.secretKey);
        if (!plaintext) { log.warn(`Failed to decrypt from device ${deviceId}`); return; }
        message = JSON.parse(plaintext) as ConnectMessage;
      } else {
        // Plain text message (MVP mode — no E2E yet)
        message = parsed as ConnectMessage;
        log.info(`Plain text message from device ${deviceId} (type: ${message.type})`);
      }

      // Resolve device — try session token first, then lookup by deviceId
      let device: Device | null = null;
      const sessionToken = (message.payload as Record<string, string>)?.sessionToken;
      if (sessionToken) {
        device = validateSession(sessionToken);
      }
      if (!device) {
        // Fallback: lookup device by ID in DB
        const db = getDb();
        const row = db.prepare('SELECT * FROM connect_devices WHERE id = ? AND revoked = 0').get(deviceId) as Record<string, unknown> | undefined;
        if (row) {
          device = {
            id: row.id as string,
            userId: row.user_id as string,
            name: row.name as string,
            publicKey: (row.public_key as string) || '',
            sessionToken: row.session_token as string,
            pairedAt: row.paired_at as string,
            lastSeenAt: row.last_seen_at as string,
            revoked: false,
          };
        }
      }

      if (!device) { log.warn(`No valid device for ${deviceId}`); return; }

      // Call registered handler
      const handler = this.handlers.get(message.type);
      if (handler) {
        await handler(deviceId, device, message);
      } else {
        log.warn(`No handler for message type: ${message.type}`);
      }
    } catch (err) {
      log.error({ err }, 'Error handling user message');
    }
  }

  /** Handle device ping */
  private handlePing(deviceId: string): void {
    if (!this.client || !this.config) return;

    // Update last seen
    const db = getDb();
    db.prepare('UPDATE connect_devices SET last_seen_at = datetime(\'now\') WHERE id = ? AND revoked = 0').run(deviceId);

    // Pong
    const topic = `${this.config.instanceId}/${deviceId}/agent`;
    this.client.publish(topic, JSON.stringify({ type: 'pong', ts: Date.now() }));
  }
}

// Singleton
let bridge: MqttBridge | null = null;

export function getMqttBridge(): MqttBridge {
  if (!bridge) bridge = new MqttBridge();
  return bridge;
}

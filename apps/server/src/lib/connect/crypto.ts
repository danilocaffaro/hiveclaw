/**
 * HiveClaw Connect — E2E Encryption
 *
 * Uses X25519 for key exchange + XSalsa20-Poly1305 for encryption (via tweetnacl)
 * Same crypto primitives as Signal, WhatsApp, Telegram Secret Chats
 */

import nacl from 'tweetnacl';
import pkg from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = pkg;

export interface KeyPair {
  publicKey: string;  // base64
  secretKey: string;  // base64
}

export interface EncryptedMessage {
  /** Version */
  v: number;
  /** Encryption scheme identifier */
  enc: 'x25519-xsalsa20-poly1305';
  /** Nonce (base64) */
  nonce: string;
  /** Encrypted payload (base64) */
  payload: string;
}

/** Generate a new X25519 key pair */
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/** Encrypt a message for a recipient */
export function encrypt(
  message: string,
  recipientPublicKey: string,
  senderSecretKey: string,
): EncryptedMessage {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(message);
  const recipientPk = decodeBase64(recipientPublicKey);
  const senderSk = decodeBase64(senderSecretKey);

  const encrypted = nacl.box(messageBytes, nonce, recipientPk, senderSk);
  if (!encrypted) throw new Error('Encryption failed');

  return {
    v: 1,
    enc: 'x25519-xsalsa20-poly1305',
    nonce: encodeBase64(nonce),
    payload: encodeBase64(encrypted),
  };
}

/** Decrypt a message from a sender */
export function decrypt(
  encryptedMsg: EncryptedMessage,
  senderPublicKey: string,
  recipientSecretKey: string,
): string | null {
  try {
    const nonce = decodeBase64(encryptedMsg.nonce);
    const payload = decodeBase64(encryptedMsg.payload);
    const senderPk = decodeBase64(senderPublicKey);
    const recipientSk = decodeBase64(recipientSecretKey);

    const decrypted = nacl.box.open(payload, nonce, senderPk, recipientSk);
    if (!decrypted) return null;

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/** Verify that a public key is valid (32 bytes base64) */
export function isValidPublicKey(key: string): boolean {
  try {
    const decoded = decodeBase64(key);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

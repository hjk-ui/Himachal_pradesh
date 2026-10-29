import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM field encryption for secrets/PHI at rest.
 * Key: PHI_FIELD_ENCRYPTION_KEY — 32 bytes as 64 hex chars or base64.
 * Wire format: v1.<iv>.<tag>.<ciphertext> (base64url parts).
 */

export class FieldEncryptionError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'INVALID_PAYLOAD') {
    super(code);
    this.name = 'FieldEncryptionError';
  }
}

function loadKey(): Buffer {
  const raw = process.env.PHI_FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) throw new FieldEncryptionError('NOT_CONFIGURED');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new FieldEncryptionError('NOT_CONFIGURED');
  return key;
}

export function isFieldEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptField(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new FieldEncryptionError('INVALID_PAYLOAD');
  try {
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof FieldEncryptionError) throw err;
    throw new FieldEncryptionError('INVALID_PAYLOAD');
  }
}

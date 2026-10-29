/**
 * Field-level encryption for the most sensitive identifiers (SSN). AES-256-GCM with a key from
 * PHI_FIELD_ENCRYPTION_KEY (32 bytes, base64 or hex). When the key is not configured nothing is
 * encrypted and callers store only the last four digits (never the plaintext).
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function key(): Buffer | null {
  const raw = process.env.PHI_FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

export function fieldEncryptionConfigured(): boolean {
  return key() !== null;
}

export function encryptField(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptField(stored: string | null | undefined): string | null {
  const k = key();
  if (!k || !stored) return null;
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

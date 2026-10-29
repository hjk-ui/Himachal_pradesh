import { createCipheriv, randomBytes } from 'node:crypto';
import { DrFirstError } from './errors';
import type { DrFirstExchangeAuditEvent } from './types';

function auditKey(value?: string) {
  if (!value) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  return key;
}

export function encryptDrFirstAuditEvent(event: DrFirstExchangeAuditEvent, keyValue: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', auditKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

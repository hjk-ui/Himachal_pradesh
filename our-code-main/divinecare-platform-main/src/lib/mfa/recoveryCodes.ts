import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MFA_RECOVERY_CODE_COUNT } from './messages';

/** Recovery codes look like ABCD-EFGH (no ambiguous characters); only SHA-256 hashes are stored. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

function randomChunk(len: number) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function generateRecoveryCodes(count = MFA_RECOVERY_CODE_COUNT) {
  const codes = Array.from({ length: count }, () => `${randomChunk(4)}-${randomChunk(4)}`);
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Returns the remaining hashes when the code matched, or null when it did not. */
export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  const candidate = Buffer.from(hashRecoveryCode(code));
  let matchIndex = -1;
  hashes.forEach((stored, i) => {
    const buf = Buffer.from(stored);
    if (buf.length === candidate.length && timingSafeEqual(buf, candidate)) matchIndex = i;
  });
  if (matchIndex < 0) return null;
  return hashes.filter((_, i) => i !== matchIndex);
}

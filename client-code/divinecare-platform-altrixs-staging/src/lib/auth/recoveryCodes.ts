/**
 * Two-factor recovery codes: 10 one-time codes shown once at enrollment. Stored as
 * "<salt hex>:<sha256(salt + code) hex>" — never the code itself. Each code works once.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const RECOVERY_CODE_COUNT = 10;
/** No 0/O, 1/I/L — easy to read off paper. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function normalizeRecoveryCode(code: string): string {
  return String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Looks like a recovery code (10 characters from the alphabet, dash optional) and not a 6-digit TOTP code. */
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[a-z0-9]{10}$/.test(normalizeRecoveryCode(code)) && !/^\d+$/.test(normalizeRecoveryCode(code));
}

/** "abcde-fghjk" × count, plain (show once, then discard). */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let s = '';
    for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
    codes.add(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return [...codes];
}

function digest(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${normalizeRecoveryCode(code)}`).digest('hex');
}

export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${digest(salt, code)}`;
}

/** Index of the stored hash that matches, or -1. Remove that entry after use (single use). */
export function findRecoveryCode(input: string, stored: readonly string[]): number {
  const norm = normalizeRecoveryCode(input);
  if (!norm) return -1;
  let found = -1;
  stored.forEach((entry, i) => {
    const [salt, hash] = entry.split(':');
    if (!salt || !hash) return;
    const a = Buffer.from(digest(salt, norm), 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b) && found < 0) found = i;
  });
  return found;
}

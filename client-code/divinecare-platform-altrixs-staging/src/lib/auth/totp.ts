/**
 * TOTP (RFC 6238 / RFC 4226): SHA-1, 6 digits, 30-second steps — what Google Authenticator,
 * Microsoft Authenticator, 1Password, Authy and Duo Mobile expect from an otpauth:// QR code.
 * Pure node:crypto, no dependency; the secret never leaves the server except in the enrollment QR.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous / next 30-second step as well (clock drift). */
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'Altrixs';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random secret: 20 bytes (160 bits, RFC 4226 recommendation), base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP value for one counter (time step). */
export function totpCodeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function totpCode(secret: string, nowMs: number = Date.now()): string {
  return totpCodeForStep(secret, totpStep(nowMs));
}

export type TotpResult = { ok: true; step: number; reason?: undefined } | { ok: false; reason: 'format' | 'invalid' | 'replay' };

/**
 * Verify a 6-digit code within ±TOTP_WINDOW steps. `lastUsedStep` is the step of the last code this
 * account accepted: a code for that step or an earlier one is refused (no reuse within its window).
 */
export function verifyTotp(
  secret: string,
  codeRaw: string,
  opts: { nowMs?: number; lastUsedStep?: number | null; window?: number } = {}
): TotpResult {
  const code = String(codeRaw ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'format' };
  const current = totpStep(opts.nowMs ?? Date.now());
  const window = opts.window ?? TOTP_WINDOW;
  let matched: number | null = null;
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(totpCodeForStep(secret, current + d));
    if (timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = current + d;
  }
  if (matched === null) return { ok: false, reason: 'invalid' };
  if (opts.lastUsedStep != null && matched <= opts.lastUsedStep) return { ok: false, reason: 'replay' };
  return { ok: true, step: matched };
}

/** otpauth:// URI for the authenticator QR code. Label: "Altrixs:<email>". */
export function otpauthUri(secret: string, accountName: string, issuer: string = TOTP_ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Secret in groups of four for manual entry ("Can't scan? Enter this key"). */
export function formatManualKey(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

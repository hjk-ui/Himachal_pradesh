/**
 * Per-member group telehealth join tokens. Server use only (signs with AUTH_SECRET; no 'server-only'
 * import so node:test can load it). One token per participant row: the token names the member's own
 * participant id, so attendance is per person and a forwarded link cannot admit a new person (the
 * row is the member; removing it refuses the link). Expires at the end of the session day.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { fromPracticeWallTime } from '@/lib/time/practiceTime';

const PREFIX = 'g1';

function secret() {
  return process.env.AUTH_SECRET || 'dev';
}

function sign(participantId: string, exp: number) {
  return createHmac('sha256', secret()).update(`group-video:${participantId}:${exp}`).digest('hex');
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

/** End of the session's practice day (23:59:59 practice clock), as epoch ms. */
export function groupTokenExpiry(sessionDateYmd: string, timeZone?: string): number {
  const end = fromPracticeWallTime(sessionDateYmd, '23:59:59', timeZone);
  if (!end) throw new Error('Invalid session date');
  return end.getTime();
}

export function createGroupJoinToken(input: { participantId: string; exp: number }): string {
  if (!input.participantId || input.participantId.includes(':')) throw new Error('Invalid participant');
  return toBase64Url(`${PREFIX}:${input.participantId}:${input.exp}:${sign(input.participantId, input.exp)}`);
}

export function readGroupJoinToken(token: string, now = Date.now()): { participantId: string; exp: number } | null {
  try {
    if (!token || token.length < 16 || token.length > 400) return null;
    const [prefix, participantId, expStr, sig] = fromBase64Url(token).split(':');
    const exp = Number(expStr);
    if (prefix !== PREFIX || !participantId || !exp || !sig) return null;
    if (now > exp) return null;
    const expected = Buffer.from(sign(participantId, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { participantId, exp };
  } catch {
    return null;
  }
}

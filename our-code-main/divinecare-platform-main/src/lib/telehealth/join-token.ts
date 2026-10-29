import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { getAuthSecret } from '@/lib/security/secrets';

type JoinTokenPayload = {
  appointmentId: string;
  clientId: string;
  exp: number;
};

function secret() {
  return getAuthSecret();
}

function sign(payload: JoinTokenPayload) {
  return createHmac('sha256', secret())
    .update(`${payload.appointmentId}:${payload.clientId}:${payload.exp}`)
    .digest('hex');
}

function signaturesMatch(expected: string, given: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Browser Buffer polyfills often lack 'base64url'; use standard base64 + URL alphabet. */
function toBase64Url(value: string) {
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

export function createTelehealthJoinToken(input: {
  appointmentId: string;
  clientId: string;
  expiresInMinutes?: number;
}) {
  const exp = Date.now() + (input.expiresInMinutes ?? 30) * 60 * 1000;
  const payload: JoinTokenPayload = {
    appointmentId: input.appointmentId,
    clientId: input.clientId,
    exp,
  };
  const raw = `${payload.appointmentId}:${payload.clientId}:${payload.exp}:${sign(payload)}`;
  return toBase64Url(raw);
}

export function readTelehealthJoinToken(token: string): JoinTokenPayload | null {
  try {
    const raw = fromBase64Url(token);
    const [appointmentId, clientId, expStr, sig] = raw.split(':');
    const exp = Number(expStr);
    if (!appointmentId || !clientId || !exp || !sig) return null;
    if (Date.now() > exp) return null;
    const payload = { appointmentId, clientId, exp };
    if (!signaturesMatch(sign(payload), sig)) return null;
    return payload;
  } catch {
    return null;
  }
}

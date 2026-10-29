/**
 * Marketing unsubscribe tokens: HMAC of "<kind>:<id>" (no PHI in the URL). kind = lead | contact.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type UnsubKind = 'lead' | 'contact';

function secret(): string {
  const s =
    process.env.MARKETING_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.UNSUBSCRIBE_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error('MARKETING_UNSUBSCRIBE_SECRET (or AUTH_SECRET) is not set');
  return s;
}

const sig = (payload: string, key: string) => createHmac('sha256', key).update(`mkt-unsub:${payload}`).digest('base64url');

export function marketingUnsubscribeToken(kind: UnsubKind, id: string, key: string = secret()): string {
  const payload = `${kind}:${id}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig(payload, key)}`;
}

export function readMarketingUnsubscribeToken(token: string | null | undefined, key: string = secret()): { kind: UnsubKind; id: string } | null {
  if (!token || typeof token !== 'string' || token.length > 300) return null;
  const [p, mac] = token.split('.');
  if (!p || !mac) return null;
  let payload: string;
  try {
    payload = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const m = /^(lead|contact):([A-Za-z0-9_-]{1,64})$/.exec(payload);
  if (!m) return null;
  const want = Buffer.from(sig(payload, key));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { kind: m[1] as UnsubKind, id: m[2] };
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://altrixs.com').replace(/\/+$/, '');
}

export function unsubscribeUrl(kind: UnsubKind, id: string): string {
  return `${appBaseUrl()}/api/marketing/public/unsubscribe?t=${encodeURIComponent(marketingUnsubscribeToken(kind, id))}`;
}

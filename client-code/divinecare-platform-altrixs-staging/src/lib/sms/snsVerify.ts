import { createVerify } from 'node:crypto';

/**
 * Amazon SNS HTTP(S) message signature verification
 * (docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
 *
 *  1. SigningCertURL must be https://sns.<region>.amazonaws.com/... .pem (never fetch any other host)
 *  2. Build the canonical string for the message Type (Notification vs Subscription/Unsubscribe)
 *  3. Verify Signature (base64) with the certificate: SignatureVersion 1 = SHA1withRSA, 2 = SHA256withRSA
 *  4. Caller also checks TopicArn against the configured inbound topic.
 */

export type SnsMessage = {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
};

const CERT_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isTrustedSigningCertUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && CERT_HOST_RE.test(u.hostname) && u.pathname.endsWith('.pem') && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

/** SubscribeURL must point at the SNS API host too (we GET it to confirm the subscription). */
export function isTrustedSubscribeUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && CERT_HOST_RE.test(u.hostname) && u.searchParams.get('Action') === 'ConfirmSubscription';
  } catch {
    return false;
  }
}

export function snsStringToSign(m: SnsMessage): string | null {
  const keys =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', ...(m.Subject != null ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : m.Type === 'SubscriptionConfirmation' || m.Type === 'UnsubscribeConfirmation'
        ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
        : null;
  if (!keys) return null;
  let out = '';
  for (const k of keys) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v !== 'string') return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

export function isSnsMessageShape(v: unknown): v is SnsMessage {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return ['Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'].every(
    (k) => typeof o[k] === 'string'
  );
}

const certCache = new Map<string, { pem: string; at: number }>();
const CERT_TTL_MS = 60 * 60 * 1000;

async function defaultFetchCert(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit && Date.now() - hit.at < CERT_TTL_MS) return hit.pem;
  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) throw new Error(`cert fetch ${res.status}`);
  const pem = await res.text();
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('not a certificate');
  certCache.set(url, { pem, at: Date.now() });
  return pem;
}

export type SnsVerifyResult = { ok: true } | { ok: false; reason: string };

/** Verify an SNS message's signature. `fetchCert` is injectable for tests. */
export async function verifySnsMessage(
  m: SnsMessage,
  opts: { fetchCert?: (url: string) => Promise<string>; now?: Date; maxAgeMs?: number } = {}
): Promise<SnsVerifyResult> {
  if (!isTrustedSigningCertUrl(m.SigningCertURL)) return { ok: false, reason: 'untrusted_cert_url' };
  const algo = m.SignatureVersion === '1' ? 'RSA-SHA1' : m.SignatureVersion === '2' ? 'RSA-SHA256' : null;
  if (!algo) return { ok: false, reason: 'bad_signature_version' };
  const toSign = snsStringToSign(m);
  if (!toSign) return { ok: false, reason: 'bad_message_type' };
  const ts = Date.parse(m.Timestamp);
  const now = (opts.now ?? new Date()).getTime();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.maxAgeMs ?? 60 * 60 * 1000)) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  let pem: string;
  try {
    pem = await (opts.fetchCert ?? defaultFetchCert)(m.SigningCertURL);
  } catch {
    return { ok: false, reason: 'cert_fetch_failed' };
  }
  try {
    const v = createVerify(algo);
    v.update(toSign, 'utf8');
    return v.verify(pem, m.Signature, 'base64') ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** AWS End User Messaging two-way SMS payload (the SNS Message field, JSON). */
export type InboundSmsPayload = {
  originationNumber: string;
  destinationNumber?: string;
  messageKeyword?: string;
  messageBody: string;
  inboundMessageId?: string;
  previousPublishedMessageId?: string;
};

export function parseInboundSmsPayload(message: string): InboundSmsPayload | null {
  try {
    const o = JSON.parse(message) as Record<string, unknown>;
    if (typeof o.originationNumber !== 'string' || typeof o.messageBody !== 'string') return null;
    return {
      originationNumber: o.originationNumber,
      destinationNumber: typeof o.destinationNumber === 'string' ? o.destinationNumber : undefined,
      messageKeyword: typeof o.messageKeyword === 'string' ? o.messageKeyword : undefined,
      messageBody: o.messageBody,
      inboundMessageId: typeof o.inboundMessageId === 'string' ? o.inboundMessageId : undefined,
      previousPublishedMessageId: typeof o.previousPublishedMessageId === 'string' ? o.previousPublishedMessageId : undefined,
    };
  } catch {
    return null;
  }
}

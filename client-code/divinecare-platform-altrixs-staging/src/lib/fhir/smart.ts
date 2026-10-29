import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { DEMO_MODE, SMART_SIGNING_SECRET } from './config';

export const LAUNCH_TTL_SEC = 5 * 60;
export const ACCESS_TTL_SEC = 30 * 60;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

type AuthCodeRecord = {
  payload: LaunchContext;
  expiresAt: number;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

/**
 * In-memory auth-code store (single-instance).
 * Production multi-instance should use a DB/Redis TTL store.
 */
const authCodes = new Map<string, AuthCodeRecord>();

let lastPrune = 0;

function pruneAuthCodes() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [code, rec] of authCodes) {
    if (rec.expiresAt <= now) authCodes.delete(code);
  }
}

export type LaunchContext = {
  launch_patient: string;
  /** Organization the launching user (and patient) belong to; every FHIR read is scoped to it */
  org?: string;
  launch_encounter?: string;
  launch_user: string;
  npi?: string;
  patient_dob?: string;
  patient_first?: string;
  patient_last?: string;
};

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function signJwt(
  payload: Record<string, unknown>,
  expiresInSec: number,
  secret = SMART_SIGNING_SECRET
): string {
  if (!secret) {
    throw new Error('SMART_SIGNING_SECRET is required to sign JWTs');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const data = `${h}.${p}`;
  const sig = createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64url(sig)}`;
}

export function verifyJwt(
  token: string,
  secret = SMART_SIGNING_SECRET
): Record<string, unknown> | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  if (!h || !p || !s) return null;

  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  let actual: Buffer;
  try {
    actual = base64urlDecode(s);
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64urlDecode(p).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const exp = payload.exp;
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function createAuthCode(
  payload: LaunchContext,
  redirectUri: string,
  pkce?: { codeChallenge?: string; codeChallengeMethod?: string }
): string {
  pruneAuthCodes();
  const code = randomBytes(32).toString('hex');
  authCodes.set(code, {
    payload,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    redirectUri,
    codeChallenge: pkce?.codeChallenge,
    codeChallengeMethod: pkce?.codeChallengeMethod,
  });
  return code;
}

export function consumeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string | null
): { ok: true; payload: LaunchContext } | { ok: false; error: string } {
  pruneAuthCodes();
  const rec = authCodes.get(code);
  if (!rec) return { ok: false, error: 'invalid_grant' };
  if (rec.expiresAt <= Date.now()) {
    authCodes.delete(code);
    return { ok: false, error: 'invalid_grant' };
  }
  if (rec.redirectUri !== redirectUri) {
    return { ok: false, error: 'invalid_grant' };
  }
  if (rec.codeChallenge) {
    if (!codeVerifier) return { ok: false, error: 'invalid_grant' };
    const method = (rec.codeChallengeMethod || 'S256').toUpperCase();
    if (method === 'S256') {
      const challenge = base64url(createHash('sha256').update(codeVerifier).digest());
      const a = Buffer.from(challenge);
      const b = Buffer.from(rec.codeChallenge);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, error: 'invalid_grant' };
      }
    } else if (method === 'PLAIN') {
      const a = Buffer.from(codeVerifier);
      const b = Buffer.from(rec.codeChallenge);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, error: 'invalid_grant' };
      }
    } else {
      return { ok: false, error: 'invalid_grant' };
    }
  }
  authCodes.delete(code);
  return { ok: true, payload: rec.payload };
}

export function demoLaunchContext(): LaunchContext {
  return {
    launch_patient: 'demo-patient-001',
    launch_encounter: `enc-demo-${new Date().toISOString().slice(0, 10)}`,
    launch_user: 'demo-practitioner-001',
    npi: '1234567890',
    patient_dob: '1985-03-14',
    patient_first: 'James',
    patient_last: 'Wilson',
  };
}

export function isDemoMode(): boolean {
  return DEMO_MODE;
}

/** token_use claim values: a launch token can never be used as an access token and vice versa. */
export const TOKEN_USE_LAUNCH = 'smart_launch';
export const TOKEN_USE_ACCESS = 'smart_access';

/**
 * Verify a SMART access token for the FHIR read endpoints: valid signature + expiry, minted by our
 * token endpoint (token_use), audience = our FHIR issuer, and carrying patient + organization context.
 */
export function verifyAccessToken(
  token: string | null,
  expectedAud: string,
  secret = SMART_SIGNING_SECRET
): { patient: string; org: string; sub: string; npi?: string } | null {
  if (!token) return null;
  const claims = verifyJwt(token, secret);
  if (!claims) return null;
  if (claims.token_use !== TOKEN_USE_ACCESS) return null;
  if (claims.aud !== expectedAud) return null;
  const patient = typeof claims.patient === 'string' ? claims.patient : '';
  const org = typeof claims.org === 'string' ? claims.org : '';
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!patient || !org || !sub) return null;
  return { patient, org, sub, npi: typeof claims.npi === 'string' ? claims.npi : undefined };
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

export function newInviteToken() {
  return randomBytes(32).toString('hex');
}

export function hashInviteToken(raw: string) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function isInviteTokenShape(raw: string) {
  return /^[a-f0-9]{64}$/i.test(raw);
}

export function inviteExpiry() {
  return new Date(Date.now() + INVITE_TTL_MS);
}

function jwtSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required');
  }
  return 'dev-patient-jwt';
}

type PatientClaims = {
  sub: string;
  clientId: string;
  typ: 'patient' | 'patient-password-reset';
  credential: string;
  iat: number;
  exp: number;
  nonce?: string;
};

function b64url(input: Buffer | string) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

// Bind proofs to the current password hash without exposing that hash. A password
// change invalidates every existing session and reset link, without a new table.
export function patientCredential(passwordHash: string) {
  return createHmac('sha256', jwtSecret()).update(`patient-credential:${passwordHash}`).digest('hex');
}

export function matchesPatientCredential(credential: string, passwordHash: string) {
  const expected = Buffer.from(patientCredential(passwordHash));
  const actual = Buffer.from(credential);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signPatientProof(accountId: string, clientId: string, passwordHash: string, reset: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: PatientClaims = {
    sub: accountId,
    clientId,
    typ: reset ? 'patient-password-reset' : 'patient',
    credential: patientCredential(passwordHash),
    iat: now,
    exp: now + (reset ? 30 * 60 : SESSION_TTL_SEC),
    ...(reset ? { nonce: randomBytes(16).toString('hex') } : {}),
  };
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', jwtSecret()).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export function signPatientSession(accountId: string, clientId: string, passwordHash: string) {
  return signPatientProof(accountId, clientId, passwordHash, false);
}

export function signPatientPasswordReset(accountId: string, clientId: string, passwordHash: string) {
  return signPatientProof(accountId, clientId, passwordHash, true);
}

function verifyPatientProof(token: string, purpose: PatientClaims['typ']) {
  if (token.length > 2048) {
    throw new Error('Invalid token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = createHmac('sha256', jwtSecret()).update(data).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    throw new Error('Invalid token');
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid token');
  }
  let claims: PatientClaims;
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') throw new Error('Invalid token');
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PatientClaims;
  } catch {
    throw new Error('Invalid token');
  }
  if (claims?.typ !== purpose || typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.clientId !== 'string' || !claims.clientId ||
      typeof claims.credential !== 'string' || !/^[a-f0-9]{64}$/.test(claims.credential)) {
    throw new Error('Invalid token');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      !Number.isSafeInteger(claims.iat) || claims.iat > now || claims.exp <= claims.iat) {
    throw new Error('Session expired');
  }
  return { accountId: claims.sub, clientId: claims.clientId, credential: claims.credential };
}

export function verifyPatientSession(token: string) {
  return verifyPatientProof(token, 'patient');
}

export function verifyPatientPasswordReset(token: string) {
  return verifyPatientProof(token, 'patient-password-reset');
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { jwtVerify, SignJWT } from 'jose';
import { getAuthSecret, getAuthSecretBytes } from '@/lib/security/secrets';

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

type PatientClaims = {
  clientId: string;
  typ: 'patient' | 'patient-password-reset';
  credential: string;
  nonce?: string;
};

// Bind proofs to the current password hash without exposing that hash. A password
// change invalidates every existing session and reset link, without a new table.
export function patientCredential(passwordHash: string) {
  return createHmac('sha256', getAuthSecret()).update(`patient-credential:${passwordHash}`).digest('hex');
}

export function matchesPatientCredential(credential: string, passwordHash: string) {
  const expected = Buffer.from(patientCredential(passwordHash));
  const actual = Buffer.from(credential);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function signPatientProof(accountId: string, clientId: string, passwordHash: string, reset: boolean) {
  const payload: PatientClaims = {
    clientId,
    typ: reset ? 'patient-password-reset' : 'patient',
    credential: patientCredential(passwordHash),
    ...(reset ? { nonce: randomBytes(16).toString('hex') } : {}),
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(accountId)
    .setIssuer('altrixs')
    .setAudience('altrixs-patient')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + (reset ? 30 * 60 : SESSION_TTL_SEC))
    .sign(getAuthSecretBytes());
}

export function signPatientSession(accountId: string, clientId: string, passwordHash: string) {
  return signPatientProof(accountId, clientId, passwordHash, false);
}

export function signPatientPasswordReset(accountId: string, clientId: string, passwordHash: string) {
  return signPatientProof(accountId, clientId, passwordHash, true);
}

async function verifyPatientProof(token: string, purpose: PatientClaims['typ']) {
  if (token.length > 2048) {
    throw new Error('Invalid token');
  }
  try {
    const { payload, protectedHeader } = await jwtVerify(token, getAuthSecretBytes(), {
      algorithms: ['HS256'],
      issuer: 'altrixs',
      audience: 'altrixs-patient',
      currentDate: new Date(Date.now()),
    });
    if (protectedHeader.typ !== 'JWT') throw new Error('Invalid token');
    const claims = payload as typeof payload & PatientClaims;
    if (claims.typ !== purpose || typeof claims.sub !== 'string' || !claims.sub ||
        typeof claims.clientId !== 'string' || !claims.clientId ||
        typeof claims.credential !== 'string' || !/^[a-f0-9]{64}$/.test(claims.credential)) {
      throw new Error('Invalid token');
    }
    return { accountId: claims.sub, clientId: claims.clientId, credential: claims.credential };
  } catch {
    throw new Error('Invalid token');
  }
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

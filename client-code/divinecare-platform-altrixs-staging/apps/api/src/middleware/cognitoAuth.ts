'use strict';
/**
 * Amazon Cognito JWT verification middleware
 * Drop-in replacement for Firebase Auth middleware (auth.ts)
 *
 * Migration path:
 *   Phase 1 (now): Deploy cognitoAuth alongside firebaseAuth.
 *                  API reads COGNITO_USER_POOL_ID env var to decide which to use.
 *   Phase 2:       Migrate web + mobile apps to Amplify Auth SDK.
 *   Phase 3:       Remove Firebase Auth middleware entirely.
 *
 * Cognito token carries:
 *   sub              → user UID (replaces Firebase uid)
 *   email            → user email
 *   custom:role      → RBAC role (therapist, psychiatrist, np, client, etc.)
 *   custom:npi       → provider NPI (for DrFirst SSO)
 *   custom:dea       → provider DEA (for EPCS)
 *   cognito:groups   → Cognito user groups (maps to roles)
 */

import { Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoAuthenticatedRequest extends Request {
  user?: {
    uid:          string;
    email?:       string;
    role:         string;
    npi?:         string;
    dea?:         string;
    groups?:      string[];
    authProvider: 'cognito' | 'firebase';
  };
}

// ─── Verifier — initialized once at module load ───────────────────────────────
// aws-jwt-verify caches JWKS automatically (fetched from Cognito's well-known endpoint)
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const COGNITO_CLIENT_ID    = process.env.COGNITO_CLIENT_ID    ?? '';
const COGNITO_ENABLED      = !!(COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID);

// Access token verifier (used for API calls)
const accessTokenVerifier = COGNITO_ENABLED
  ? CognitoJwtVerifier.create({
      userPoolId: COGNITO_USER_POOL_ID,
      tokenUse:   'access',
      clientId:   COGNITO_CLIENT_ID,
    })
  : null;

// ID token verifier (used when you need user attributes like email)
const idTokenVerifier = COGNITO_ENABLED
  ? CognitoJwtVerifier.create({
      userPoolId: COGNITO_USER_POOL_ID,
      tokenUse:   'id',
      clientId:   COGNITO_CLIENT_ID,
    })
  : null;

// ─── Role resolution ──────────────────────────────────────────────────────────
// Cognito groups map 1:1 to Altrixs RBAC roles
const GROUP_TO_ROLE: Record<string, string> = {
  therapists:           'therapist',
  psychiatrists:        'psychiatrist',
  nurse_practitioners:  'np',
  prp_specialists:      'prp_specialist',
  case_managers:        'case_manager',
  peer_support:         'peer_support',
  medical_assistants:   'medical_assistant', // ADDED
  crisis_responders:    'crisis_responder',   // ADDED
  practice_directors:   'practice_director',
  office_managers:      'office_manager',
  billing_specialists:  'billing_specialist',
  hr_managers:          'hr_manager',
  clients:              'client',
  admins:               'admin',
};

function resolveRole(payload: Record<string, unknown>): string {
  // 1. Prefer explicit custom:role attribute (set during user creation)
  if (payload['custom:role']) return payload['custom:role'] as string;

  // 2. Fall back to first matching Cognito group
  const groups = (payload['cognito:groups'] as string[] | undefined) ?? [];
  for (const group of groups) {
    const role = GROUP_TO_ROLE[group];
    if (role) return role;
  }

  // 3. Default to client (most restrictive)
  return 'client';
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export const authenticateCognito = async (
  req: CognitoAuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!COGNITO_ENABLED) {
    return res.status(503).json({
      success: false,
      error: { code: 'COGNITO_NOT_CONFIGURED', message: 'Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID to enable Cognito auth.' },
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
  }

  const token = authHeader.slice(7);

  try {
    // Try access token first, fall back to ID token
    let payload: Record<string, unknown>;
    try {
      payload = await accessTokenVerifier!.verify(token) as Record<string, unknown>;
    } catch {
      payload = await idTokenVerifier!.verify(token) as Record<string, unknown>;
    }

    req.user = {
      uid:          payload.sub as string,
      email:        payload.email as string | undefined,
      role:         resolveRole(payload),
      npi:          payload['custom:npi']  as string | undefined,
      dea:          payload['custom:dea']  as string | undefined,
      groups:       payload['cognito:groups'] as string[] | undefined,
      authProvider: 'cognito',
    };

    next();
  } catch (err) {
    console.error('[Cognito auth] Token verification failed:', err);
    return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
};

// ─── Universal middleware ─────────────────────────────────────────────────────
// Accepts EITHER a Cognito token OR a Firebase token during the migration period.
// Once all clients are migrated to Cognito, remove the Firebase fallback.
export const authenticateUniversal = async (
  req: CognitoAuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
  }

  const token = authHeader.slice(7);

  // Attempt Cognito verification first (if configured)
  if (COGNITO_ENABLED && accessTokenVerifier) {
    try {
      let payload: Record<string, unknown>;
      try {
        payload = await accessTokenVerifier.verify(token) as Record<string, unknown>;
      } catch {
        payload = await idTokenVerifier!.verify(token) as Record<string, unknown>;
      }

      req.user = {
        uid:          payload.sub as string,
        email:        payload.email as string | undefined,
        role:         resolveRole(payload),
        npi:          payload['custom:npi'] as string | undefined,
        dea:          payload['custom:dea'] as string | undefined,
        groups:       payload['cognito:groups'] as string[] | undefined,
        authProvider: 'cognito',
      };
      return next();
    } catch {
      // Not a Cognito token — fall through to Firebase
    }
  }

  // Fallback: Firebase token (migration period only)
  try {
    const admin = await import('firebase-admin');
    const decoded = await admin.auth().verifyIdToken(token);
    const user    = await admin.auth().getUser(decoded.uid);

    (req as any).user = {
      uid:          decoded.uid,
      email:        decoded.email,
      role:         (user.customClaims?.role as string) ?? 'client',
      authProvider: 'firebase',
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
};

export { COGNITO_ENABLED };

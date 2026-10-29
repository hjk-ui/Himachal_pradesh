import { NextResponse } from 'next/server';
import {
  DEMO_MODE,
  getApiBaseUrl,
  getFhirIss,
  SMART_ALLOWED_CLIENTS,
  SMART_SIGNING_SECRET,
} from '@/lib/fhir/config';
import {
  createAuthCode,
  demoLaunchContext,
  type LaunchContext,
  TOKEN_USE_LAUNCH,
  verifyJwt,
} from '@/lib/fhir/smart';

export const runtime = 'nodejs';

/**
 * Registered redirect URIs per SMART client, from SMART_REDIRECT_URIS:
 *   "crisp-eqp=https://a.example/cb|https://b.example/cb,crisp-sandbox=https://c.example/cb"
 * Matching is exact string comparison (OAuth 2.1 / RFC 9700): no prefix or wildcard match.
 */
function registeredRedirectUris(clientId: string): string[] {
  const raw = (process.env.SMART_REDIRECT_URIS ?? '').trim();
  if (!raw || !clientId) return [];
  for (const entry of raw.split(',')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    if (entry.slice(0, eq).trim() !== clientId) continue;
    return entry
      .slice(eq + 1)
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean);
  }
  return [];
}

function parseAbsoluteHttpUrl(value: string): URL | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Live: redirect_uri must be one of the client's registered URIs (fail closed when none are
 * registered). DEMO_MODE: same origin as this app, or the demo client's registered URIs. Never an
 * arbitrary URL, or the authorize endpoint becomes an open redirect that leaks auth codes.
 */
function redirectUriAllowed(req: Request, clientId: string, redirectUri: string): boolean {
  const target = parseAbsoluteHttpUrl(redirectUri);
  if (!target || target.username || target.password || target.hash) return false;
  if (registeredRedirectUris(clientId).includes(redirectUri)) return true;
  if (!DEMO_MODE) return false;
  const origins = new Set<string>([new URL(req.url).origin]);
  const base = parseAbsoluteHttpUrl(getApiBaseUrl());
  if (base) origins.add(base.origin);
  return origins.has(target.origin);
}

/** GET /auth/smart/authorize — public; CRISP OAuth authorize callback. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state') || '';
  const launch = url.searchParams.get('launch') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || undefined;

  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type' },
      { status: 400 }
    );
  }

  if (!DEMO_MODE && !SMART_ALLOWED_CLIENTS.includes(clientId)) {
    return NextResponse.json({ error: 'unauthorized_client' }, { status: 403 });
  }

  if (!redirectUri) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'redirect_uri required' }, { status: 400 });
  }

  // Do not redirect to an unvalidated URI, even with an error (RFC 6749 4.1.2.1).
  if (!redirectUriAllowed(req, clientId, redirectUri)) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' },
      { status: 400 }
    );
  }

  let ctx: LaunchContext;

  if (DEMO_MODE) {
    ctx = demoLaunchContext();
  } else {
    const claims = verifyJwt(launch, SMART_SIGNING_SECRET);
    // Only launch tokens minted by POST /fhir/launch (an access token is not a launch token)
    if (!claims || claims.token_use !== TOKEN_USE_LAUNCH) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'invalid or expired launch token' },
        { status: 400 }
      );
    }
    const patient = String(claims.launch_patient || '');
    const user = String(claims.launch_user || '');
    const org = typeof claims.org === 'string' ? claims.org : '';
    if (!patient || !user || !org) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'launch context incomplete' },
        { status: 400 }
      );
    }
    ctx = {
      launch_patient: patient,
      org,
      launch_encounter: claims.launch_encounter
        ? String(claims.launch_encounter)
        : undefined,
      launch_user: user,
      npi: claims.npi ? String(claims.npi) : undefined,
      patient_dob: claims.patient_dob ? String(claims.patient_dob) : undefined,
      patient_first: claims.patient_first ? String(claims.patient_first) : undefined,
      patient_last: claims.patient_last ? String(claims.patient_last) : undefined,
    };
  }

  // Ensure iss matches our host when present
  void getFhirIss();

  const code = createAuthCode(ctx, redirectUri, {
    codeChallenge,
    codeChallengeMethod,
  });

  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);

  return NextResponse.redirect(target.toString(), 302);
}

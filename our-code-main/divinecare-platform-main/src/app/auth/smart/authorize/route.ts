import { NextResponse } from 'next/server';
import {
  DEMO_MODE,
  getFhirIss,
  SMART_ALLOWED_CLIENTS,
  SMART_SIGNING_SECRET,
} from '@/lib/fhir/config';
import {
  createAuthCode,
  demoLaunchContext,
  type LaunchContext,
  verifyJwt,
} from '@/lib/fhir/smart';

export const runtime = 'nodejs';

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

  let ctx: LaunchContext;

  if (DEMO_MODE) {
    ctx = demoLaunchContext();
  } else {
    const claims = verifyJwt(launch, SMART_SIGNING_SECRET);
    if (!claims) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'invalid or expired launch token' },
        { status: 400 }
      );
    }
    const patient = String(claims.launch_patient || '');
    const user = String(claims.launch_user || '');
    if (!patient || !user) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'launch context incomplete' },
        { status: 400 }
      );
    }
    ctx = {
      launch_patient: patient,
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

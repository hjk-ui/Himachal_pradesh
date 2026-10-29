import { NextResponse } from 'next/server';
import { DEMO_MODE, getFhirIss } from '@/lib/fhir/config';
import {
  ACCESS_TTL_SEC,
  consumeAuthCode,
  demoLaunchContext,
  signJwt,
  type LaunchContext,
} from '@/lib/fhir/smart';

export const runtime = 'nodejs';

async function parseForm(req: Request): Promise<URLSearchParams> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    return new URLSearchParams(text);
  }
  if (contentType.includes('application/json')) {
    const json = (await req.json()) as Record<string, string>;
    return new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v ?? '')]));
  }
  const text = await req.text();
  return new URLSearchParams(text);
}

/** POST /auth/smart/token — public; form-urlencoded authorization_code grant. */
export async function POST(req: Request) {
  let form: URLSearchParams;
  try {
    form = await parseForm(req);
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const grantType = form.get('grant_type');
  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = form.get('code') || '';
  const redirectUri = form.get('redirect_uri') || '';
  const codeVerifier = form.get('code_verifier');

  let ctx: LaunchContext;
  let demo = DEMO_MODE;

  if (DEMO_MODE) {
    ctx = demoLaunchContext();
  } else {
    const result = consumeAuthCode(code, redirectUri, codeVerifier);
    if (result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    ctx = result.payload;
  }

  const iss = getFhirIss();
  const accessToken = DEMO_MODE
    ? `DEMO-ACCESS-${Date.now()}`
    : signJwt(
        {
          iss,
          aud: iss,
          patient: ctx.launch_patient,
          encounter: ctx.launch_encounter,
          npi: ctx.npi,
          fhirUser: `${iss}/Practitioner/${ctx.launch_user}`,
          sub: ctx.launch_user,
        },
        ACCESS_TTL_SEC
      );

  // In DEMO we still mint a signed token when secret appears mid-session is impossible;
  // unsigned DEMO token is accepted by Patient/Practitioner DEMO path.

  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    scope: 'launch patient/Patient.read openid fhirUser',
    patient: ctx.launch_patient,
    encounter: ctx.launch_encounter,
  };
  if (demo) body.demo_mode = true;

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

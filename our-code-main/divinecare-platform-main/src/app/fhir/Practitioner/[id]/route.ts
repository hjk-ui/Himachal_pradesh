import { NextResponse } from 'next/server';
import { DEMO_MODE, SMART_SIGNING_SECRET } from '@/lib/fhir/config';
import {
  demoPractitionerResource,
  operationOutcome,
  practitionerFromToken,
} from '@/lib/fhir/resources';
import { extractBearer, verifyJwt } from '@/lib/fhir/smart';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /fhir/Practitioner/:id — DEMO open; LIVE requires SMART Bearer; NPI from token. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  if (DEMO_MODE) {
    return NextResponse.json(demoPractitionerResource(id), {
      headers: { 'Content-Type': 'application/fhir+json' },
    });
  }

  const token = extractBearer(req);
  const claims = token ? verifyJwt(token, SMART_SIGNING_SECRET) : null;
  if (!claims) {
    return NextResponse.json(
      operationOutcome('error', 'login', 'Valid Bearer access token required'),
      { status: 401, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  }

  const npi = claims.npi ? String(claims.npi) : '0000000000';
  return NextResponse.json(practitionerFromToken(id, npi), {
    headers: { 'Content-Type': 'application/fhir+json' },
  });
}

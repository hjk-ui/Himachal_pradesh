import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { DEMO_MODE, getFhirIss } from '@/lib/fhir/config';
import { mapPractitioner } from '@/lib/fhir/mapping/organization';
import { FHIR_NOT_CONFIGURED, operationOutcome } from '@/lib/fhir/resources';
import { extractBearer, verifyAccessToken } from '@/lib/fhir/smart';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const FHIR_JSON = { 'Content-Type': 'application/fhir+json', 'Cache-Control': 'no-store' };

/**
 * GET /fhir/Practitioner/:id
 * Not configured (no SMART_SIGNING_SECRET): 503 OperationOutcome. LIVE: SMART access token; only the token's own user
 * (fhirUser / sub), read from the token's organization. No invented NPI or name.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  if (DEMO_MODE) {
    return NextResponse.json(FHIR_NOT_CONFIGURED, { status: 503, headers: FHIR_JSON });
  }

  const claims = verifyAccessToken(extractBearer(req), getFhirIss());
  if (!claims) {
    return NextResponse.json(operationOutcome('error', 'login', 'Valid Bearer access token required'), {
      status: 401,
      headers: FHIR_JSON,
    });
  }
  if (claims.sub !== id) {
    return NextResponse.json(operationOutcome('error', 'forbidden', 'Token user does not match requested id'), {
      status: 403,
      headers: FHIR_JSON,
    });
  }

  const user = await prisma.user.findFirst({
    where: { id, organizationId: claims.org },
    select: { id: true, name: true, email: true, role: true, status: true, npi: true, licenseNumber: true },
  });
  if (!user) {
    return NextResponse.json(operationOutcome('error', 'not-found', `Practitioner/${id} not found`), {
      status: 404,
      headers: FHIR_JSON,
    });
  }
  return NextResponse.json(
    mapPractitioner({ ...user, role: String(user.role), status: String(user.status) }, { organizationId: claims.org }),
    { headers: FHIR_JSON }
  );
}

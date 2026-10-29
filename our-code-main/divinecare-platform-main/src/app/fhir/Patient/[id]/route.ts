import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { DEMO_MODE, SMART_SIGNING_SECRET } from '@/lib/fhir/config';
import {
  clientToPatientResource,
  demoPatientResource,
  operationOutcome,
} from '@/lib/fhir/resources';
import { extractBearer, verifyJwt } from '@/lib/fhir/smart';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /fhir/Patient/:id — DEMO open; LIVE requires SMART Bearer with matching patient. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  if (DEMO_MODE) {
    return NextResponse.json(demoPatientResource(id === 'demo-patient-001' ? id : 'demo-patient-001'), {
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

  const patientClaim = String(claims.patient || '');
  if (patientClaim !== id) {
    return NextResponse.json(
      operationOutcome('error', 'security', 'Token patient context does not match requested id'),
      { status: 401, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  }

  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      return NextResponse.json(
        operationOutcome('error', 'not-found', `Patient/${id} not found`),
        { status: 404, headers: { 'Content-Type': 'application/fhir+json' } }
      );
    }
    return NextResponse.json(clientToPatientResource(client), {
      headers: { 'Content-Type': 'application/fhir+json' },
    });
  } catch (err) {
    console.error('[fhir Patient GET]', err);
    return NextResponse.json(
      operationOutcome('error', 'exception', 'Failed to load Patient'),
      { status: 500, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  }
}

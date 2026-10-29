import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { DEMO_MODE, getFhirIss } from '@/lib/fhir/config';
import { mapPatient } from '@/lib/fhir/mapping/patient';
import { FHIR_NOT_CONFIGURED, operationOutcome } from '@/lib/fhir/resources';
import { extractBearer, verifyAccessToken } from '@/lib/fhir/smart';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const FHIR_JSON = { 'Content-Type': 'application/fhir+json', 'Cache-Control': 'no-store' };

/**
 * GET /fhir/Patient/:id
 * Not configured (no SMART_SIGNING_SECRET): 503 OperationOutcome, never a fixture or a database row.
 * LIVE: SMART access token from our token endpoint whose patient matches :id; the client is
 * read scoped to the token's organization, and the read is audited.
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

  const meta = auditRequestMeta(req);
  if (claims.patient !== id) {
    await writeAuditLog({
      action: 'FHIR_PATIENT_READ',
      actorUserId: claims.sub,
      actorRole: 'smart_app',
      organizationId: claims.org,
      resourceType: 'Patient',
      resourceId: id,
      outcome: 'DENIED',
      metadata: { reason: 'patient_context_mismatch' },
      ...meta,
    });
    return NextResponse.json(
      operationOutcome('error', 'forbidden', 'Token patient context does not match requested id'),
      { status: 403, headers: FHIR_JSON }
    );
  }

  try {
    const client = await prisma.client.findFirst({
      where: clientByIdWhere(id, claims.org),
      include: { sensitiveRecord: { select: { noteClassification: true } } },
    });
    if (!client) {
      return NextResponse.json(operationOutcome('error', 'not-found', `Patient/${id} not found`), {
        status: 404,
        headers: FHIR_JSON,
      });
    }
    await writeAuditLog({
      action: 'FHIR_PATIENT_READ',
      actorUserId: claims.sub,
      actorRole: 'smart_app',
      organizationId: claims.org,
      resourceType: 'Patient',
      resourceId: id,
      patientId: id,
      metadata: { channel: 'smart_on_fhir' },
      ...meta,
    });
    const resource = mapPatient(
      { ...client, status: String(client.status), sensitiveRecord: client.sensitiveRecord ?? null },
      { organizationId: claims.org }
    );
    return NextResponse.json(resource, { headers: FHIR_JSON });
  } catch (err) {
    console.error('[fhir Patient GET]', err instanceof Error ? err.message : err);
    return NextResponse.json(operationOutcome('error', 'exception', 'Failed to load Patient'), {
      status: 500,
      headers: FHIR_JSON,
    });
  }
}

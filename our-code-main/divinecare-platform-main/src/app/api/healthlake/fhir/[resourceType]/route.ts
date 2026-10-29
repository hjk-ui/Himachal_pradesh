import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isValidResourceType, searchFhirResources } from '@/lib/aws/healthlake';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ resourceType: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/healthlake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { resourceType } = await ctx.params;
  if (!isValidResourceType(resourceType)) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Invalid resourceType. Allowed: Patient Encounter Condition MedicationRequest Observation CarePlan DocumentReference Practitioner',
      },
      { status: 400 }
    );
  }

  try {
    const result = await searchFhirResources(gate.organizationId, resourceType);
    return NextResponse.json({ success: true, resourceType, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FHIR search failed';
    return NextResponse.json({ success: false, error: message, demoMode: false }, { status: 502 });
  }
}

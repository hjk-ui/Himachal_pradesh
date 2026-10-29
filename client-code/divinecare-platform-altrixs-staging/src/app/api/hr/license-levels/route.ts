import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { listLicenseLevels, setLicenseLevel } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

/**
 * GET / PATCH /api/hr/license-levels
 * Licensed vs pre-licensed for each clinician. Pre-licensed authors (LGPC, LMSW, LGMFT, LGADC,
 * trainees, supervisees on a licensure track) need a supervisor signature on treatment plans and
 * a co-signature on notes. HR can set the level explicitly; otherwise it is derived.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/hr/credentialing')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ success: true, staff: await listLicenseLevels(gate.organizationId) });
  } catch (err) {
    console.error('[hr/license-levels GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load license levels' }, { status: 500 });
  }
}

const patchSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  licenseLevel: z.enum(['LICENSED', 'PRE_LICENSED']).nullable(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/hr/credentialing')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const ok = await setLicenseLevel(gate.organizationId, body.userId, body.licenseLevel);
  await writeAuditLog({
    action: 'UPDATE',
    actorUserId: gate.userId,
    actorRole: gate.role,
    organizationId: gate.organizationId,
    resourceType: 'staffLicenseLevel',
    resourceId: body.userId,
    outcome: ok ? 'SUCCESS' : 'FAILURE',
    ...auditRequestMeta(req),
    metadata: { licenseLevel: body.licenseLevel ?? 'derived' },
  });
  if (!ok) return NextResponse.json({ success: false, error: 'Staff member not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

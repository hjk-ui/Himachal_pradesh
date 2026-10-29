import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { LIBRARY_SOURCES, MAX_LIBRARY_ITEMS } from '@/lib/ehr/therapy/planHierarchy';
import { canEditPracticeLibrary, loadLibraries, saveLibrary } from '@/lib/ehr/therapy/libraryStore';

export const runtime = 'nodejs';

/**
 * GET / PUT /api/ehr/treatment-plans/library
 * Treatment plan content libraries: the Practice Library (leadership maintains it; everyone with
 * plan access uses it) and the caller's Personal Library. Valant's library and the Wiley
 * PracticePlanners® library are listed as not included (licensed content). No patient data.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const libs = await loadLibraries(gate.organizationId, gate.userId);
  return NextResponse.json(
    { success: true, sources: LIBRARY_SOURCES, practice: libs.practice, personal: libs.personal, canEditPractice: canEditPracticeLibrary(gate.role) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

const putSchema = z.object({
  scope: z.enum(['practice', 'personal']),
  items: z.array(z.record(z.string(), z.unknown())).max(MAX_LIBRARY_ITEMS),
});

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid library' }, { status: 400 });
  }
  if (body.scope === 'practice' && !canEditPracticeLibrary(gate.role)) {
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'treatmentPlanLibrary',
      outcome: 'DENIED',
      ...auditRequestMeta(req),
      metadata: { scope: body.scope },
    });
    return NextResponse.json({ success: false, error: 'Only practice leadership can change the Practice Library. Save it to your Personal Library instead.' }, { status: 403 });
  }
  try {
    const items = await saveLibrary(gate.organizationId, body.scope, gate.userId, body.items);
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'treatmentPlanLibrary',
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      metadata: { scope: body.scope, items: items.length },
    });
    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error('[treatment-plans/library PUT]', err);
    return NextResponse.json({ success: false, error: 'Could not save the library' }, { status: 500 });
  }
}

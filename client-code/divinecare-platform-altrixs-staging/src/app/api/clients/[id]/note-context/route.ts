import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { loadStructuredNoteContext } from '@/lib/ehr/structuredNoteContext';
import { asStructuredNoteType } from '@/lib/ehr/structuredNotes';

export const runtime = 'nodejs';

/**
 * GET /api/clients/[id]/note-context?noteType=&excludeNoteId=
 * Read-only chart data for the structured note templates (Psychiatric Med
 * Management, Child Psychiatry Intake / Re-Eval, Adult Psychiatry Intake / Re-Eval):
 * demographics, signed-in
 * provider, medications, allergies, problems, rating scales, lab results, next
 * appointment, prior notes and the saved safety plan.
 * Org + caseload scoped (404 when the client is outside the caller's access).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const noteType = asStructuredNoteType(url.searchParams.get('noteType'));
  if (!id || id.length > 128 || !noteType) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const excludeNoteId = url.searchParams.get('excludeNoteId')?.trim().slice(0, 128) || null;

  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: id,
      path: `/api/clients/${id}/note-context`,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }

  try {
    const context = await loadStructuredNoteContext(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      id,
      { noteType, excludeNoteId }
    );
    if (!context) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'client',
      resourceId: id,
      patientId: id,
      metadata: { purpose: 'structured_note_context', noteType },
    });
    return NextResponse.json({ success: true, context }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[note-context GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load chart data' }, { status: 500 });
  }
}

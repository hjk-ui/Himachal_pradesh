import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { canAccessTreatmentPlans } from '@/lib/ehr/treatmentPlans';
import { loadDocumentGoalSuggestions } from '@/lib/ehr/therapy/planStore';

export const runtime = 'nodejs';

const id = z.string().trim().min(1).max(128);

/**
 * GET /api/ehr/treatment-plans/template/goal-suggestions?clientId=&documentId=
 * Goal / objective / intervention lines read from a treatment plan document filed to the chart
 * (Smart Doc Intake, e.g. a Valant plan PDF). Suggestions with their quoted source lines for the
 * clinician to confirm in the editor; nothing is saved. Only the matched lines are returned,
 * not the document's full text.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessTreatmentPlans(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const parsed = z
    .object({ clientId: id, documentId: id })
    .safeParse({ clientId: url.searchParams.get('clientId') ?? '', documentId: url.searchParams.get('documentId') ?? '' });
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role!,
      clientId: parsed.data.clientId,
      path: '/api/ehr/treatment-plans/template/goal-suggestions',
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }
  try {
    const result = await loadDocumentGoalSuggestions({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }, parsed.data);
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'documentIntake',
      resourceId: parsed.data.documentId,
      patientId: parsed.data.clientId,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      metadata: {
        purpose: 'treatment_plan_goal_suggestions',
        ...(result.ok === false
          ? { status: result.status }
          : { goals: result.suggestions.goals.length, unattached: result.suggestions.unattached.length }),
      },
    });
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json(
      { success: true, document: result.document, suggestions: result.suggestions },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[treatment-plans/template/goal-suggestions GET]', err);
    return NextResponse.json({ success: false, error: 'Could not read the plan document' }, { status: 500 });
  }
}

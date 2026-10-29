import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { getTherapyWorkflowSettings, listPlanPendingClients, saveTherapyWorkflowSettings } from '@/lib/ehr/therapy/planStore';
import { transitionUntilDate, type TherapyWorkflowSettings } from '@/lib/ehr/therapy/rules';
import { clinicDate } from '@/lib/workflows/dates';

export const runtime = 'nodejs';

/**
 * GET / PUT /api/ehr/therapy-workflow
 * Practice switches for the therapist workflow:
 *  - requirePlanForProgressNotes (default on): therapy progress notes cannot be signed without
 *    an active, signed treatment plan
 *  - requirePatientSignature (default off): the plan only becomes active once the patient signs
 *  - goLiveDate (default 2026-11-01) and transitionUntil (null = go-live + 30 days): until then a
 *    Valant client's therapy progress note may be signed with the plan pending (go-live transition)
 * Anyone who writes notes can read them; leadership (Practice Setup access) can change them.
 * GET ?pending=1 also returns the clients with a note signed with the plan pending and still no
 * active plan (Treatment Plans "Before go-live" worklist), within the caller's client access.
 */
// Also: library editing before / after the plan is active, and review reminder days (owner;
// optional supervisor) — the Valant Treatment Plan template configuration.
function withEffective(settings: TherapyWorkflowSettings) {
  const until = transitionUntilDate(settings);
  return { ...settings, transitionUntilEffective: until, transitionActive: Boolean(until && clinicDate() <= until) };
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes') && !canAccessPath(gate.role, '/dashboard/practice-setup')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const settings = withEffective(await getTherapyWorkflowSettings(gate.organizationId));
  if (new URL(req.url).searchParams.get('pending') !== '1') return NextResponse.json({ success: true, settings });
  const pending = await listPlanPendingClients({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }).catch(
    (err: unknown) => {
      console.error('[therapy-workflow pending]', err);
      return null;
    }
  );
  if (pending) {
    await writeAuditLog({
      action: 'LIST',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'treatmentPlanPending',
      outcome: 'SUCCESS',
      ...auditRequestMeta(req),
      metadata: { count: pending.length },
    });
  }
  return NextResponse.json(
    { success: true, settings, pending: pending ?? [], pendingError: pending ? null : 'Could not load the pending-plan list.' },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const putSchema = z.object({
  requirePlanForProgressNotes: z.boolean().optional(),
  requirePatientSignature: z.boolean().optional(),
  goLiveDate: isoDay.optional(),
  /** null = back to the default (go-live + 30 days) */
  transitionUntil: isoDay.nullable().optional(),
  libraryEditBeforeActive: z.boolean().optional(),
  libraryEditAfterActive: z.boolean().optional(),
  reviewReminderDays: z.number().int().min(0).max(90).optional(),
  /** null = no supervisor reminder */
  supervisorReminderDays: z.number().int().min(0).max(90).nullable().optional(),
});

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/practice-setup')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid settings' }, { status: 400 });
  }
  const current = await getTherapyWorkflowSettings(gate.organizationId);
  const goLive = body.goLiveDate ?? current.goLiveDate;
  const until = body.transitionUntil !== undefined ? body.transitionUntil : current.transitionUntil;
  if (until && until < goLive) {
    return NextResponse.json({ success: false, error: 'The transition must end on or after the go-live date.' }, { status: 400 });
  }
  const settings = await saveTherapyWorkflowSettings(gate.organizationId, body);
  await writeAuditLog({
    action: 'UPDATE',
    actorUserId: gate.userId,
    actorRole: gate.role,
    organizationId: gate.organizationId,
    resourceType: 'therapyWorkflowSettings',
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { ...settings, transitionUntilEffective: transitionUntilDate(settings) },
  });
  return NextResponse.json({ success: true, settings: withEffective(settings) });
}

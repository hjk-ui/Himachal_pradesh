import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { isElevatedNoteActor } from '@/lib/clients/notes';
import { loadNotePolicy, saveNotePolicy } from '@/lib/notes/policy';
import { verifiedNoteBaseRole } from '@/lib/notes/routeAccess';
import { formatElementsGate, isEnforceFromDate } from '@/lib/notes/formatElements';
import { practiceToday } from '@/lib/time/practiceTime';

export const runtime = 'nodejs';

const bodySchema = z.object({
  staleDraftDays: z.number().int().min(1).max(365).optional(),
  cloneWarnPercent: z.number().int().min(50).max(100).optional(),
  requireDiagnosisToSign: z.boolean().optional(),
  /** Diagnosis-list review interval (days): 90 = quarterly, 180 = twice a year */
  diagnosisReviewDays: z.number().int().min(30).max(365).optional(),
  /** Required note sections: warn until this practice date (YYYY-MM-DD), then block signing */
  formatElementsEnforceFrom: z.string().refine(isEnforceFromDate, 'Enter a valid date (YYYY-MM-DD)').optional(),
  /** "Block now": enforce from today (practice time zone) */
  formatElementsBlockNow: z.literal(true).optional(),
});

/** Policy plus the format-element gate as of now (practice clock) */
function withGate(policy: Awaited<ReturnType<typeof loadNotePolicy>>) {
  return { ...policy, formatElements: { ...formatElementsGate(policy), today: practiceToday(policy.timeZone) } };
}

/** GET /api/notes/policy — the practice documentation policy (sign deadline, stale drafts, clone warning). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const policy = withGate(await loadNotePolicy(gate.organizationId));
  return NextResponse.json({ success: true, policy, canEdit: isElevatedNoteActor(gate.role, await verifiedNoteBaseRole(gate)) });
}

/** PUT /api/notes/policy — admins / directors. The sign deadline itself is Practice settings › Clinical. */
export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!isElevatedNoteActor(gate.role, await verifiedNoteBaseRole(gate))) {
    return NextResponse.json({ success: false, error: 'Only an administrator or director can change the documentation policy.' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const { formatElementsBlockNow, ...input } = parsed.data;
  if (formatElementsBlockNow) input.formatElementsEnforceFrom = practiceToday((await loadNotePolicy(gate.organizationId)).timeZone);
  await saveNotePolicy(gate.organizationId, gate.userId, input);
  await writeAuditLog({
    action: 'SETTINGS_UPDATE',
    actorUserId: gate.userId,
    actorRole: gate.role,
    organizationId: gate.organizationId,
    resourceType: 'notePolicySettings',
    resourceId: gate.organizationId,
    outcome: 'SUCCESS',
    metadata: { ...input, ...(formatElementsBlockNow ? { formatElementsBlockNow: true } : {}) },
  });
  return NextResponse.json({ success: true, policy: withGate(await loadNotePolicy(gate.organizationId)) });
}

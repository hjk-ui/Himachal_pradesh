import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { updateAppointment } from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess, auditRequestMeta } from '@/lib/audit/requestMeta';
import { DUPLICATE_APPOINTMENT_CODE } from '@/lib/appointments/duplicates';
import { CLINICIAN_OVERLAP_CODE } from '@/lib/appointments/overlap';
import { CONSENT_CHECKIN_OVERRIDE_ACTION, CONSENT_REQUIRED_CODE, OVERRIDE_REASON_MAX } from '@/lib/consents/library/decisions';
import { sendCompletedVisitToRcopia } from '@/app/api/drfirst/_lib/officeVisit';

export const runtime = 'nodejs';

const visitEnum = z.enum([
  'scheduled',
  'checked-in',
  'in-session',
  'completed',
  'cancelled',
  'no-show',
  'late-cancel',
  'SCHEDULED',
  'CHECKED_IN',
  'IN_SESSION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'LATE_CANCEL',
]);

const noteEnum = z.enum([
  'not-started',
  'ai-draft',
  'in-progress',
  'signed',
  'NOT_STARTED',
  'AI_DRAFT',
  'IN_PROGRESS',
  'SIGNED',
]);

const patchSchema = z.object({
  status: visitEnum.optional().nullable(),
  visitStatus: visitEnum.optional().nullable(),
  noteStatus: noteEnum.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Edit Details: reschedule / reassign (client is not editable)
  type: z.string().min(1).max(120).optional().nullable(),
  startsAt: z.string().min(16).max(40).optional().nullable(),
  endsAt: z.string().min(16).max(40).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  isVirtual: z.boolean().optional().nullable(),
  videoProvider: z.enum(['zoom', 'google', 'in_app', 'chime']).optional().nullable(),
  allowDuplicate: z.boolean().optional(),
  allowOverbook: z.boolean().optional(),
  overbookReason: z.string().max(300).optional().nullable(),
  audioOnly: z.boolean().optional().nullable(),
  /** Check-in soft stop override (src/lib/consents/library/decisions.ts); stored in ConsentCheckInOverride */
  consentOverrideReason: z.string().max(OVERRIDE_REASON_MAX).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to update appointments' },
      { status: 403 }
    );
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const result = await updateAppointment(id, body, {
      id: gate.userId,
      role: gate.role,
      organizationId: gate.organizationId,
    });
    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'appointment', resourceId: id, outcome: 'DENIED', metadata: { status: result.status } });
      }
      if ('code' in result && result.code === DUPLICATE_APPOINTMENT_CODE) {
        return NextResponse.json(
          { success: false, error: result.error, code: result.code, existingAppointmentId: result.existingId },
          { status: 409 }
        );
      }
      if ('code' in result && result.code === CONSENT_REQUIRED_CODE && 'missing' in result) {
        // Check-in soft stop: the dialog offers in-office signing or an override reason
        return NextResponse.json(
          { success: false, error: result.error, code: result.code, missing: result.missing, flags: result.flags, isVirtual: result.isVirtual },
          { status: 409 }
        );
      }
      if ('code' in result && result.code === CLINICIAN_OVERLAP_CODE) {
        return NextResponse.json(
          { success: false, error: result.error, code: result.code, conflictIds: result.conflictIds, existingAppointmentId: result.existingId },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    if (result.changedFields.length > 0) {
      // Field names only; values (times, notes) stay out of the audit metadata.
      await auditPhiAccess({
        gate,
        req,
        action: 'UPDATE',
        resourceType: 'appointment',
        resourceId: id,
        patientId: result.appointment.clientId,
        metadata: {
          fields: result.changedFields,
          allowDuplicate: body.allowDuplicate ? true : null,
          // Intentional overbook reason (staff text) kept with the edit
          overbook: result.changedFields.includes('overbookReason') ? true : null,
          reason: result.changedFields.includes('overbookReason') ? body.overbookReason?.trim() ?? null : null,
        },
      });
    }
    if (result.consentOverride) {
      // Ids and counts only; the staff reason is in ConsentCheckInOverride
      await auditPhiAccess({
        gate,
        req,
        action: CONSENT_CHECKIN_OVERRIDE_ACTION,
        resourceType: 'appointment',
        resourceId: id,
        patientId: result.appointment.clientId,
        metadata: { overrideId: result.consentOverride.id, templateKeys: result.consentOverride.templateKeys, missing: result.consentOverride.templateKeys.length, stored: Boolean(result.consentOverride.id) },
      });
    }
    if (result.labelAutoApplied) {
      await auditPhiAccess({
        gate,
        req,
        action: 'UPDATE',
        resourceType: 'appointment_label',
        resourceId: id,
        patientId: result.appointment.clientId,
        metadata: { labelId: result.appointment.labelId, autoApplied: result.labelAutoApplied },
      });
    }
    // Completed visit for a DrFirst-linked client -> send_patient_office_visits (after the response; never blocks completion)
    const visit = String(body.visitStatus ?? body.status ?? '').toUpperCase().replace('-', '_');
    if (visit === 'COMPLETED') {
      const meta = auditRequestMeta(req);
      after(() => sendCompletedVisitToRcopia(id, {
        userId: gate.userId, role: String(gate.role), organizationId: gate.organizationId,
        ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null,
      }));
    }
    // AutoPay runs from updateAppointment (src/lib/appointments/manage.ts) for every status path
    return NextResponse.json({ success: true, appointment: result.appointment });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update appointment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

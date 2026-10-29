import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import {
  createPatientAppointment,
  listPatientAppointments,
} from '@/patient/application/appointments/service';
import {
  patientGet,
  patientOk,
  patientOptions,
  patientPost,
} from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ req, ctx }) => {
    const url = new URL(req.url);
    const includePast = url.searchParams.get('includePast') === 'true' || url.searchParams.get('past') === 'true';
    const appointments = await listPatientAppointments(ctx.clientId, { includePast, viewer: ctx });
    await writeAuditLog({
      action: 'LIST',
      actorUserId: ctx.accountId,
      actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: 'appointment',
      patientId: ctx.clientId,
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-app', includePast, count: appointments.length },
    });
    return patientOk({ appointments });
  },
  ['patient-appointments-list', 60]
);

const createSchema = z.object({
  clinicianId: z.string().min(1).max(128),
  type: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  isVirtual: z.boolean().optional(),
});

export const POST = patientPost(
  async ({ req, ctx }) => {
    const body = createSchema.parse(await readPatientJson(req));
    const appointment = await createPatientAppointment(ctx, body);
    await writeAuditLog({
      action: 'CREATE',
      actorUserId: ctx.accountId,
      actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: 'appointment',
      resourceId: appointment.id,
      patientId: ctx.clientId,
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-app', fields: Object.keys(body), isVirtual: Boolean(body.isVirtual) },
    });
    return patientOk({ appointment }, 201, 'Appointment requested');
  },
  ['patient-appointment-create', 20]
);

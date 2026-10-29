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

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ req, ctx }) => {
    const url = new URL(req.url);
    const includePast = url.searchParams.get('includePast') === 'true' || url.searchParams.get('past') === 'true';
    const includeCancelled = url.searchParams.get('includeCancelled') === 'true' || url.searchParams.get('cancelled') === 'true';
    return patientOk({ appointments: await listPatientAppointments(ctx.clientId, { includePast, includeCancelled }) });
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
    return patientOk({ appointment }, 201, 'Appointment requested');
  },
  ['patient-appointment-create', 20]
);

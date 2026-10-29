import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { reschedulePatientAppointment } from '@/patient/application/appointments/service';
import { patientOk, patientOptions, patientPatch } from '@/patient/infrastructure/http/handler';

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export function OPTIONS() {
  return patientOptions();
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientPatch(
    async ({ ctx: patient }) => {
      const body = bodySchema.parse(await readPatientJson(req));
      const appointment = await reschedulePatientAppointment(patient, id, body);
      return patientOk({ appointment }, 200, 'Reschedule requested');
    },
    ['patient-appointment-reschedule', 20]
  );
  return handler(req);
}

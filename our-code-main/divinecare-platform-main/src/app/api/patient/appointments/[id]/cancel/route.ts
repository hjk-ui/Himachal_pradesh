import { z } from 'zod';
import { readPatientJson } from '@/patient/infrastructure/http/response';
import { cancelPatientAppointment } from '@/patient/application/appointments/service';
import { patientOk, patientOptions, patientPatch } from '@/patient/infrastructure/http/handler';

const bodySchema = z.object({}).optional();

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
      bodySchema.parse(await readPatientJson(req, true));
      const appointment = await cancelPatientAppointment(patient, id);
      return patientOk({ appointment }, 200, 'Appointment cancelled');
    },
    ['patient-appointment-cancel', 20]
  );
  return handler(req);
}

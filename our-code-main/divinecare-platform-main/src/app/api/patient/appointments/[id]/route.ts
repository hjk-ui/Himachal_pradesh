import { getPatientAppointment } from '@/patient/application/appointments/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientGet(
    async ({ ctx: patient }) => {
      const appointment = await getPatientAppointment(patient.clientId, id);
      return patientOk({ appointment });
    },
    ['patient-appointment-detail', 60]
  );
  return handler(req);
}

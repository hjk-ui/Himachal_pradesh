import { getDoctorAvailability } from '@/patient/application/doctors/service';
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
    async ({ req: request, ctx: patient }) => {
      const url = new URL(request.url);
      const fromDate = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
      const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 14));
      const data = await getDoctorAvailability(patient.organizationId, id, fromDate, days);
      return patientOk(data);
    },
    ['patient-doctor-availability', 60]
  );
  return handler(req);
}

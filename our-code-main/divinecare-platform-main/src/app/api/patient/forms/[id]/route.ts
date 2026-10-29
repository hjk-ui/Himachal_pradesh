import { getPatientForm } from '@/patient/application/forms/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() { return patientOptions(); }

export async function GET(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return patientGet(async ({ ctx }) => patientOk({ form: await getPatientForm(ctx, id) }), ['patient-form', 60])(req);
}

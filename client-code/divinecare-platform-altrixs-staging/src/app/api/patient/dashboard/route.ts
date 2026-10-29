import { buildPatientDashboard } from '@/patient/application/dashboard/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ ctx }) => {
    const data = await buildPatientDashboard(ctx);
    return patientOk(data);
  },
  ['patient-dashboard', 120]
);

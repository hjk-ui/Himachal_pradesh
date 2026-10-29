import { getPatientProgress } from '@/patient/application/check-ins/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ ctx }) => patientOk(await getPatientProgress(ctx)),
  ['patient-progress', 60]
);

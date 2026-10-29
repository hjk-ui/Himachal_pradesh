import { listPatientDoctors } from '@/patient/application/doctors/service';
import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ ctx }) => patientOk({ doctors: await listPatientDoctors(ctx.organizationId) }),
  ['patient-doctors', 60]
);

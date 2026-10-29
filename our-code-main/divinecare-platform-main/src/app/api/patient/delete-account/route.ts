import { deletePatientAccount } from '@/patient/application/profile/service';
import { patientAccountHandler, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const POST = patientAccountHandler(
  async ({ me }) => patientOk(await deletePatientAccount(me)),
  ['patient-account-delete', 5]
);

export const DELETE = POST;

import { deletePatientAccount, getPatientProfile, updatePatientProfile } from '@/patient/application/profile/service';
import { patientAccountHandler, patientOk, patientOptions, readPatientJson } from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientAccountHandler(async ({ me }) =>
  patientOk({ client: await getPatientProfile(me) })
);

export const PATCH = patientAccountHandler(async ({ req, me }) =>
  patientOk({ client: await updatePatientProfile(me, await readPatientJson(req)) }),
  ['patient-profile-update', 30]
);

export const DELETE = patientAccountHandler(async ({ me }) =>
  patientOk(await deletePatientAccount(me)),
  ['patient-account-delete', 5]
);

import { z } from 'zod';
import { changePatientPassword } from '@/patient/application/auth/change-password';
import {
  patientAccountHandler,
  patientOk,
  patientOptions,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(72),
  newPassword: z.string().min(1, 'New password is required').max(72),
}).strict();

export function OPTIONS() {
  return patientOptions();
}

export const POST = patientAccountHandler(
  async ({ req, me }) => {
    const body = schema.parse(await readPatientJson(req));
    const result = await changePatientPassword(me, body.currentPassword, body.newPassword);
    return patientOk(result, 200, result.message);
  },
  ['patient-change-password', 10]
);

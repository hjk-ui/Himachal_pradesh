import { z } from 'zod';
import { resetPatientPassword } from '@/patient/application/auth/password-reset';
import { patientOk, patientOptions, patientRateLimited, patientRouteError, readPatientJson } from '@/patient/infrastructure/http/handler';

const schema = z.object({ token: z.string().min(1).max(2048), password: z.string().min(1).max(72) }).strict();

export function OPTIONS() { return patientOptions(); }

export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-reset-password', 10);
    if (blocked) return blocked;
    const body = schema.parse(await readPatientJson(req));
    await resetPatientPassword(body.token, body.password);
    return patientOk({}, 200, 'Password saved. Sign in with your new password.');
  } catch (err) { return patientRouteError(err); }
}

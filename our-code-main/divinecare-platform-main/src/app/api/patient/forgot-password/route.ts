import { z } from 'zod';
import { PASSWORD_RESET_MESSAGE, requestPatientPasswordReset } from '@/patient/application/auth/password-reset';
import { patientOk, patientOptions, patientRateLimited, patientRouteError, readPatientJson } from '@/patient/infrastructure/http/handler';

const schema = z.object({ email: z.string().trim().email().max(254) }).strict();

export function OPTIONS() { return patientOptions(); }

export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-forgot-password', 10);
    if (blocked) return blocked;
    const body = schema.parse(await readPatientJson(req));
    await requestPatientPasswordReset(body.email);
    return patientOk({}, 200, PASSWORD_RESET_MESSAGE);
  } catch (err) { return patientRouteError(err); }
}

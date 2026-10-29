import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { acceptPatientInvite } from '@/patient/application/auth/accept-invite';
import {
  patientOk,
  patientOptions,
  patientRateLimited,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { isInviteTokenShape } from '@/patient/infrastructure/security/tokens';

const schema = z.object({
  token: z.string().refine(isInviteTokenShape),
  password: z.string().min(8).max(72),
});

export function OPTIONS() {
  return patientOptions();
}

export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-invite-accept', 10);
    if (blocked) return blocked;

    const body = schema.parse(await readPatientJson(req));
    const result = await acceptPatientInvite(body.token, body.password);

    return patientOk(
      { email: result.email, name: result.name },
      200,
      'Password saved. Sign in with your email.'
    );
  } catch (err) {
    return patientRouteError(err);
  }
}

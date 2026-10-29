import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { loginPatient } from '@/patient/application/auth/login';
import {
  patientFail,
  patientOk,
  patientOptions,
  patientRateLimited,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(72),
});

export function OPTIONS() {
  return patientOptions();
}

export async function POST(req: Request) {
  try {
    const blocked = patientRateLimited(req, 'patient-login', 20, 60_000);
    if (blocked) return blocked;

    const body = schema.parse(await readPatientJson(req));
    const result = await loginPatient(body.email, body.password);

    await logPatientAudit({
      clientId: result.client.id,
      action: 'login.success',
    });

    return patientOk({
      token: result.token,
      client: result.client,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return patientFail('VALIDATION_ERROR', 'Email and password are required', 400);
    }
    return patientRouteError(err);
  }
}

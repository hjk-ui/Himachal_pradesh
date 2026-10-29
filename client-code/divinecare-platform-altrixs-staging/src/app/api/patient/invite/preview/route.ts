import { z } from 'zod';
import { previewPatientInvite } from '@/patient/application/auth/accept-invite';
import {
  patientFail,
  patientOk,
  patientOptions,
  patientRateLimited,
  patientRouteError,
} from '@/patient/infrastructure/http/handler';
import { isInviteTokenShape } from '@/patient/infrastructure/security/tokens';

const getSchema = z.object({ token: z.string().refine(isInviteTokenShape) });

export function OPTIONS() {
  return patientOptions();
}

export async function GET(req: Request) {
  const blocked = patientRateLimited(req, 'patient-invite-preview', 30);
  if (blocked) return blocked;

  const token = new URL(req.url).searchParams.get('token') || '';
  const parsed = getSchema.safeParse({ token });
  if (!parsed.success) {
    return patientFail('VALIDATION_ERROR', 'Invalid invite link', 400);
  }

  try {
    const invite = await previewPatientInvite(parsed.data.token);
    return patientOk({ invite });
  } catch (err) {
    return patientRouteError(err);
  }
}

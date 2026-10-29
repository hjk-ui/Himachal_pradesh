import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import type { PatientContext, PatientProfile } from '@/patient/domain';
import { requirePatient } from '@/patient/application/auth/session';
import { loadPatientContext } from '@/patient/infrastructure/persistence/patient-context';
import {
  patientFail,
  patientRouteError,
} from '@/patient/infrastructure/http/response';

export {
  patientOptions,
  patientOk,
  patientFail,
  patientRouteError,
  parsePagination,
  PATIENT_CORS,
  readPatientJson,
} from '@/patient/infrastructure/http/response';

export function patientRateLimited(req: Request, bucket: string, limit: number, windowMs = 15 * 60 * 1000) {
  const limited = rateLimit(clientKey(req, bucket), limit, windowMs);
  if (!limited.ok) {
    return patientFail('RATE_LIMITED', 'Too many attempts. Try again later.', 429);
  }
  return null;
}

type Handler = (input: { req: Request; ctx: PatientContext }) => Promise<Response>;

export function patientGet(handler: Handler, rate?: [string, number]) {
  return async (req: Request) => {
    try {
      if (rate) {
        const blocked = patientRateLimited(req, rate[0], rate[1]);
        if (blocked) return blocked;
      }
      const me = await requirePatient(req);
      const ctx = await loadPatientContext(me);
      return await handler({ req, ctx });
    } catch (err) {
      return patientRouteError(err);
    }
  };
}

export function patientPost(handler: Handler, rate?: [string, number]) {
  return patientGet(handler, rate);
}

export function patientPatch(handler: Handler, rate?: [string, number]) {
  return patientGet(handler, rate);
}

// Account/profile access does not require a clinic assignment.
export function patientAccountHandler(
  handler: (input: { req: Request; me: PatientProfile }) => Promise<Response>,
  rate?: [string, number]
) {
  return async (req: Request) => {
    try {
      if (rate) {
        const blocked = patientRateLimited(req, rate[0], rate[1]);
        if (blocked) return blocked;
      }
      const me = await requirePatient(req);
      return await handler({ req, me });
    } catch (err) {
      return patientRouteError(err);
    }
  };
}

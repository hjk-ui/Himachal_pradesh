import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { PatientAppError, proxyMayUse, type PatientContext, type PatientProfile, type PortalFeature } from '@/patient/domain';
import { requirePatient } from '@/patient/application/auth/session';
import { logPatientAudit, proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
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

export function patientRateLimited(req: Request, bucket: string, limit: number) {
  const limited = rateLimit(clientKey(req, bucket), limit, 15 * 60 * 1000);
  if (!limited.ok) {
    return patientFail('RATE_LIMITED', 'Too many attempts. Try again later.', 429);
  }
  return null;
}

type Handler = (input: { req: Request; ctx: PatientContext }) => Promise<Response>;

/**
 * Proxy (guardian / representative) requests: one audit row per request (route + method, no PHI),
 * and features a proxy may not use are refused (src/patient/domain/proxy-policy.ts proxyMayUse).
 */
async function proxyGate(req: Request, me: PatientProfile, feature?: PortalFeature) {
  if (!me.access?.isProxy) return;
  let path = '';
  try { path = new URL(req.url).pathname.slice(0, 120); } catch { path = ''; }
  const allowed = !feature || proxyMayUse(me.access, feature);
  await logPatientAudit({
    clientId: me.clientId,
    accountId: me.accountId,
    action: allowed ? 'proxy.access' : 'proxy.access_blocked',
    entityType: req.method,
    entityId: path,
    ...proxyAuditFields(me),
  });
  if (!allowed) {
    throw new PatientAppError('This part of the account is only available to the patient.', 403, 'proxy_not_allowed');
  }
}

/** Throws 403 when the signed-in proxy may not use this feature (for routes that branch inside). */
export function assertPortalFeature(me: PatientProfile, feature: PortalFeature) {
  if (me.access?.isProxy && !proxyMayUse(me.access, feature)) {
    throw new PatientAppError('This part of the account is only available to the patient.', 403, 'proxy_not_allowed');
  }
}

/** Route prefix -> feature, so every existing route is gated without touching each file. */
const FEATURE_BY_PATH: [RegExp, PortalFeature][] = [
  [/^\/api\/patient\/check-ins/, 'check-ins'],
  [/^\/api\/patient\/progress/, 'progress'],
  [/^\/api\/patient\/delete-account/, 'account.delete'],
  [/^\/api\/patient\/avatar/, 'avatar'],
  [/^\/api\/patient\/medications/, 'medications'],
  [/^\/api\/patient\/(messages|conversations)/, 'messages'],
  [/^\/api\/patient\/(appointments|doctors)/, 'appointments'],
  [/^\/api\/patient\/(documents|forms)/, 'documents'],
  [/^\/api\/patient\/consents/, 'consents'],
  [/^\/api\/patient\/resources/, 'resources'],
  [/^\/api\/patient\/(billing|statements|autopay|payments)/, 'billing'],
  [/^\/api\/patient\/device-token/, 'device-token'],
];

export function featureForRequest(req: Request): PortalFeature | undefined {
  let path = '';
  try { path = new URL(req.url).pathname; } catch { return undefined; }
  if (/^\/api\/patient\/me\/?$/.test(path)) {
    return req.method === 'GET' || req.method === 'OPTIONS' ? 'profile.view' : req.method === 'DELETE' ? 'account.delete' : 'profile.edit';
  }
  return FEATURE_BY_PATH.find(([re]) => re.test(path))?.[1];
}

export function patientGet(handler: Handler, rate?: [string, number]) {
  return async (req: Request) => {
    try {
      if (rate) {
        const blocked = patientRateLimited(req, rate[0], rate[1]);
        if (blocked) return blocked;
      }
      const me = await requirePatient(req);
      await proxyGate(req, me, featureForRequest(req));
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
      await proxyGate(req, me, featureForRequest(req));
      return await handler({ req, me });
    } catch (err) {
      return patientRouteError(err);
    }
  };
}

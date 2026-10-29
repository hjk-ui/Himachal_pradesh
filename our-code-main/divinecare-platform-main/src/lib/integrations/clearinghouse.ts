import { randomUUID } from 'node:crypto';

export type Vendor = 'Carelon' | 'Availity';
type Json = Record<string, unknown>;
export class ClearinghouseError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export function clearinghouseMode(vendor: Vendor, operation: 'claims' | 'prior-auth' = 'prior-auth') {
  if (process.env.CLINICAL_CLEARINGHOUSE_MODE === 'demo') return 'demo';
  const prefix = vendor.toUpperCase();
  const endpoint = operation === 'claims' ? process.env.AVAILITY_CLAIMS_URL : process.env[`${prefix}_PRIOR_AUTH_URL`];
  return process.env[`${prefix}_CLIENT_ID`] && process.env[`${prefix}_CLIENT_SECRET`] && process.env[`${prefix}_TOKEN_URL`] && endpoint ? 'configured' : 'unconfigured';
}
const tokens = new Map<string, { token: string; expires: number }>();
function httpsUrl(raw: string | undefined) {
  if (!raw) throw new ClearinghouseError('Clearinghouse endpoint is not configured', 503);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new ClearinghouseError('Clearinghouse endpoints must use HTTPS', 503);
  return url.toString();
}
async function token(vendor: Vendor) {
  const prefix = vendor.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const secret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !secret) throw new ClearinghouseError(`${vendor} credentials are not configured`, 503);
  const url = httpsUrl(process.env[`${prefix}_TOKEN_URL`]);
  const key = `${vendor}:${url}:${clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 15000) return cached.token;
  const response = await fetch(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret,
      ...(process.env[`${prefix}_SCOPE`] ? { scope: process.env[`${prefix}_SCOPE`]! } : {}) }),
  });
  if (!response.ok) throw new ClearinghouseError(`${vendor} authentication failed`);
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !result.access_token) throw new ClearinghouseError('Invalid clearinghouse token response');
  tokens.set(key, { token: result.access_token, expires: Date.now() + Number(result.expires_in || 300) * 1000 });
  return result.access_token as string;
}
export async function clearinghouseRequest(vendor: Vendor, endpoint: string | undefined, body?: Json, requestId?: string): Promise<Json> {
  const url = httpsUrl(endpoint);
  const bearer = await token(vendor);
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json',
      ...(requestId ? { 'Idempotency-Key': requestId } : {}),
      ...(vendor === 'Carelon' && process.env.CARELON_ORG_ID ? { 'X-Carelon-Organization-Id': process.env.CARELON_ORG_ID } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new ClearinghouseError(`${vendor} request failed (${response.status}); review the clearinghouse portal before retrying`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ClearinghouseError('Invalid clearinghouse response');
  return result as Json;
}
export function statusEndpoint(template: string | undefined, id: string) {
  if (!template?.includes('{id}')) throw new ClearinghouseError('Status endpoint must be configured with {id}', 503);
  return template.replace('{id}', encodeURIComponent(id));
}
export const newControlNumber = () => randomUUID();

export interface PriorAuthSubmissionPayload {
  patientId: string; patientName: string; dob: string; memberId: string; payerId: string; payerName: string;
  vendor: Vendor; cptCodes: string[]; diagnosisCodes: string[]; startDate: string; endDate: string;
  requestedUnits: number; clinicalRationale: string; providerNpi?: string; requestId?: string;
}
export type AuthorizationStatus = 'APPROVED' | 'PENDING_REVIEW' | 'DENIED' | 'ADDITIONAL_INFO_NEEDED';
export function normalizeAuthorizationStatus(value: unknown): AuthorizationStatus {
  const status = String(value ?? '').toUpperCase().replace(/[ -]/g, '_');
  if (status === 'APPROVED' || status === 'DENIED') return status;
  if (['PENDING_INFO_NEEDED', 'ADDITIONAL_INFO_NEEDED'].includes(status)) return 'ADDITIONAL_INFO_NEEDED';
  return 'PENDING_REVIEW';
}
export async function submitPriorAuth(payload: PriorAuthSubmissionPayload) {
  const controlNumber = payload.requestId || newControlNumber();
  const demoMode = clearinghouseMode(payload.vendor) === 'demo';
  const [firstName, ...last] = payload.patientName.trim().split(/\s+/);
  const provider = { npi: payload.providerNpi || process.env.AVAILITY_NPI, organizationName: process.env.AVAILITY_ORG_NAME };
  const request: Json = payload.vendor === 'Carelon' ? {
    requestId: controlNumber,
    memberInfo: { memberId: payload.memberId, firstName, lastName: last.join(' '), dateOfBirth: payload.dob },
    providerInfo: provider,
    authorizationRequest: { requestType: 'Standard', serviceType: 'BehavioralHealth', diagnosisCodes: payload.diagnosisCodes,
      procedureCodes: payload.cptCodes, startDate: payload.startDate, endDate: payload.endDate, requestedUnits: payload.requestedUnits, clinicalNotes: payload.clinicalRationale },
  } : {
    controlNumber, tradingPartnerServiceId: payload.payerId,
    subscriber: { memberId: payload.memberId, firstName, lastName: last.join(' '), birthDate: payload.dob },
    requester: { providerType: 'BillingProvider', ...provider }, receiver: { organizationName: payload.payerName },
    serviceReview: { reviewDecisionReasonCode: 'UR', serviceTypeCodes: ['MH'], cptCodes: payload.cptCodes,
      diagnosisCodes: payload.diagnosisCodes, serviceStartDate: payload.startDate, serviceEndDate: payload.endDate,
      requestedUnits: payload.requestedUnits, urgencyCode: 'R', clinicalNotes: payload.clinicalRationale },
  };
  if (!demoMode && (!provider.npi || !provider.organizationName)) throw new ClearinghouseError('Provider NPI and organization name are required', 503);
  const result = demoMode ? { id: `DEMO-${controlNumber}`, status: 'PENDING_REVIEW' } :
    await clearinghouseRequest(payload.vendor, process.env[`${payload.vendor.toUpperCase()}_PRIOR_AUTH_URL`], request, controlNumber);
  const referenceNumber = result.authorizationNumber ?? result.paNumber ?? result.referenceNumber ?? result.id;
  if (typeof referenceNumber !== 'string' || !referenceNumber) throw new ClearinghouseError('Clearinghouse did not return a reference number; review the portal before retrying');
  return { referenceNumber, status: normalizeAuthorizationStatus(result.status),
    approvedUnits: typeof result.approvedUnits === 'number' ? result.approvedUnits : undefined,
    message: demoMode ? 'DEMO: simulated submission; nothing was sent to a payer.' : 'Submitted to clearinghouse. Review the payer response.',
    clearinghousePayload: result, demoMode, timestamp: new Date().toISOString() };
}
export async function checkPriorAuthStatus(referenceNumber: string, vendor: Vendor, demoMode = false) {
  if (demoMode) return { status: 'PENDING_REVIEW' as AuthorizationStatus, approvedUnits: undefined };
  const result = await clearinghouseRequest(vendor, statusEndpoint(process.env[`${vendor.toUpperCase()}_PRIOR_AUTH_STATUS_URL`], referenceNumber));
  return { status: normalizeAuthorizationStatus(result.status), approvedUnits: typeof result.approvedUnits === 'number' ? result.approvedUnits : undefined };
}

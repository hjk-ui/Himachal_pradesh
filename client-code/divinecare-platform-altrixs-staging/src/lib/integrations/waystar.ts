import 'server-only';

import { ClearinghouseError } from '@/lib/integrations/clearinghouse';

export const WAYSTAR_ENABLED = () => Boolean(process.env.WAYSTAR_CLIENT_ID);
export const AVAILITY_ENABLED = () => Boolean(process.env.AVAILITY_CLIENT_ID);

export function claimClearinghouseMode() {
  const waystarEnabled = WAYSTAR_ENABLED();
  const availityEnabled = AVAILITY_ENABLED();
  const forcedDemo = process.env.CLINICAL_CLEARINGHOUSE_MODE === 'demo';
  const demoMode = forcedDemo || (!waystarEnabled && !availityEnabled);
  const claimCh: 'waystar' | 'availity' | 'demo' = waystarEnabled
    ? 'waystar'
    : availityEnabled
      ? 'availity'
      : 'demo';
  return {
    waystarEnabled,
    availityEnabled,
    demoMode: demoMode || claimCh === 'demo',
    claimCh: demoMode ? ('demo' as const) : claimCh,
  };
}

export type WaystarClaimSubmitResponse = {
  id?: string;
  claimId?: string;
  controlNumber?: string;
  status?: string;
  message?: string;
  trackingId?: string;
  [key: string]: unknown;
};

type CachedToken = { accessToken: string; expiresAt: number };

let cachedToken: CachedToken | null = null;

const TOKEN_SKEW_MS = 60_000;

function httpsUrl(raw: string | undefined, label: string) {
  if (!raw) throw new ClearinghouseError(`${label} is not configured`, 503);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ClearinghouseError('Waystar endpoints must use HTTPS', 503);
  }
  return url.toString();
}

/** OAuth2 client_credentials. Refreshes 60s before expiry. */
export async function getWaystarToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_SKEW_MS) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.WAYSTAR_CLIENT_ID;
  const clientSecret = process.env.WAYSTAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ClearinghouseError('Waystar credentials are not configured', 503);
  }

  const tokenUrl = httpsUrl(process.env.WAYSTAR_TOKEN_URL, 'WAYSTAR_TOKEN_URL');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    ...(process.env.WAYSTAR_SCOPE ? { scope: process.env.WAYSTAR_SCOPE } : {}),
  });

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ClearinghouseError('Waystar authentication failed', 502);
  }

  if (!response.ok) {
    console.error('[waystar-auth] token request failed', { status: response.status });
    throw new ClearinghouseError('Waystar authentication failed', 502);
  }

  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;

  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new ClearinghouseError('Invalid Waystar token response', 502);
  }

  const expiresIn = Number(payload.expires_in || 300);
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

export function clearWaystarTokenCache() {
  cachedToken = null;
}

export function waystarControlNumber(now = Date.now()) {
  return String(now).slice(-9);
}

/** Heuristic claim filing indicator from payer name / id. */
export function claimFilingIndicatorFromPayer(payer: string | null | undefined): 'MC' | 'MB' | 'BL' | 'CI' {
  const value = (payer ?? '').toLowerCase();
  if (/medicaid|mdcd|\bmc\b/.test(value)) return 'MC';
  if (/medicare|cms|\bmb\b/.test(value)) return 'MB';
  if (/blue\s*cross|blue\s*shield|bcbs|\bbc\/bs\b|\bbl\b/.test(value)) return 'BL';
  return 'CI';
}

export type Waystar837PInput = {
  senderId?: string;
  controlNumber?: string;
  tradingPartnerServiceId: string;
  submitterInfo: { organizationName: string; npi: string; taxId?: string };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  payerName?: string | null;
  /** 005010 SBR09 claim filing indicator code (e.g. MC Medicaid, MB Medicare B, BL BCBS, CI commercial, HM HMO) */
  claimFilingIndicator?: string;
  serviceDate: string;
  totalChargeAmount: number;
  placeOfServiceCode: string;
  diagnosisCodes: string[];
  procedureCode: string;
  modifiers?: string[];
  units: number;
  renderingNpi?: string;
};

export function buildWaystar837P(input: Waystar837PInput) {
  const controlNumber = input.controlNumber || waystarControlNumber();
  const claimFilingIndicator =
    input.claimFilingIndicator ?? claimFilingIndicatorFromPayer(input.payerName ?? input.tradingPartnerServiceId);

  const telehealthPos = input.placeOfServiceCode === '02' || input.placeOfServiceCode === '10';
  const modifiers = [...(input.modifiers ?? [])];
  if (telehealthPos) {
    for (const mod of ['GT', '95']) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
    }
  }

  return {
    senderId: input.senderId || process.env.WAYSTAR_SENDER_ID || input.submitterInfo.npi,
    controlNumber,
    tradingPartnerServiceId: input.tradingPartnerServiceId,
    submitterInfo: {
      organizationName: input.submitterInfo.organizationName,
      npi: input.submitterInfo.npi,
      ...(input.submitterInfo.taxId ? { taxId: input.submitterInfo.taxId } : {}),
    },
    subscriber: input.subscriber,
    claim: {
      claimFilingIndicator,
      serviceDate: input.serviceDate,
      totalChargeAmount: input.totalChargeAmount,
      placeOfServiceCode: input.placeOfServiceCode,
      diagnoses: input.diagnosisCodes.map((value, i) => ({
        qualifierCode: i === 0 ? 'ABK' : 'ABF',
        value,
      })),
      serviceLines: [
        {
          procedureCode: input.procedureCode,
          ...(modifiers.length ? { modifiers } : {}),
          serviceDate: input.serviceDate,
          chargeAmount: input.totalChargeAmount,
          units: input.units,
          diagnosisPointers: ['1'],
          ...(input.renderingNpi ? { renderingProvider: { npi: input.renderingNpi } } : {}),
        },
      ],
    },
  };
}

export async function waystarRequest(
  endpoint: string | undefined,
  body?: Record<string, unknown>,
  requestId?: string
): Promise<WaystarClaimSubmitResponse> {
  const url = httpsUrl(endpoint, 'Waystar endpoint');
  const bearer = await getWaystarToken();
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(requestId ? { 'Idempotency-Key': requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new ClearinghouseError(
      `Waystar request failed (${response.status}); review the clearinghouse portal before retrying`,
      502
    );
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ClearinghouseError('Invalid Waystar response', 502);
  }
  return result as WaystarClaimSubmitResponse;
}

export function waystarStatusEndpoint(claimId: string) {
  const template = process.env.WAYSTAR_CLAIM_STATUS_URL;
  if (!template?.includes('{id}')) {
    throw new ClearinghouseError('WAYSTAR_CLAIM_STATUS_URL must include {id}', 503);
  }
  return template.replace('{id}', encodeURIComponent(claimId));
}

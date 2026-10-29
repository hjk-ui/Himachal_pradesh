import crypto from 'crypto';

/**
 * DrFirst Rcopia v2.54 External API integration service for Altrixs.
 *
 * Implements the Rcopia 2.54 External Request / Response specification
 * (staging region 201). Supports:
 * - MAC-signed traditional SSO launch URL generation
 * - Discrete patient demographic sync (send_patient)
 * - Medication list download & reconciliation (update_medication)
 * - Notification badge counts (get_notification_count)
 * - XML envelope construction with HTTP Basic authentication
 *
 * @deprecated The legacy transport is retained only for reference while the
 * verified provider adapter is implemented. It is disabled by default and
 * must not be used by application routes.
 */

const VENDOR_USER = process.env.DRFIRST_VENDOR_USERNAME || '';
const VENDOR_PASS = process.env.DRFIRST_VENDOR_PASSWORD || '';
const PRACTICE_USER = process.env.DRFIRST_PRACTICE_USERNAME || process.env.DRFIRST_PRACTICE_USER_NAME || '';
const SYSTEM_NAME = process.env.DRFIRST_PORTAL_SYSTEM_NAME || VENDOR_USER;
const SSO_URL = process.env.DRFIRST_SSO_URL || '';
const ENGINE_URL = process.env.DRFIRST_ENGINE_URL || '';
const UPDATE_URL = process.env.DRFIRST_UPDATE_URL || '';
const PASSWORD_MODE = process.env.DRFIRST_PASSWORD_MODE || 'plain';
const PRACTICE_ELEMENT = process.env.DRFIRST_PRACTICE_ELEMENT || 'PracticeUserName';
const LEGACY_TRANSPORT_ENABLED = process.env.DRFIRST_LEGACY_TRANSPORT_ENABLED === 'true';

export const DEMO_MODE = !LEGACY_TRANSPORT_ENABLED || !VENDOR_USER || !VENDOR_PASS || !PRACTICE_USER;

export interface RcopiaCallResult {
  ok: boolean;
  status: string;
  raw: string;
  demo: boolean;
  error?: { code: string; text: string };
}

function xmlEscape(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ssoTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCFullYear() - 2000) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

/**
 * Builds standard DrFirst v2.54 XML envelope with authenticated Caller header.
 */
export function buildEnvelope(innerXml: string, rcopiaUserName?: string): string {
  const reqId = `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${now.getUTCFullYear()} ${pad(
    now.getUTCHours(),
  )}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

  let pwdBlock = `<Password>${xmlEscape(VENDOR_PASS)}</Password>`;
  if (PASSWORD_MODE === 'md5') {
    const hash = crypto.createHash('md5').update(VENDOR_PASS + timeStr).digest('hex').toUpperCase();
    pwdBlock = `<Password type="md5">${hash}</Password>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<RCExtRequest version="2.54">
  <Caller>
    <Username>${xmlEscape(VENDOR_USER)}</Username>
    ${pwdBlock}
    <${PRACTICE_ELEMENT}>${xmlEscape(PRACTICE_USER)}</${PRACTICE_ELEMENT}>
    ${rcopiaUserName ? `<RcopiaUserName>${xmlEscape(rcopiaUserName)}</RcopiaUserName>` : ''}
  </Caller>
  <Time>${timeStr}</Time>
  <RequestID>${reqId}</RequestID>
  <Request>
${innerXml}
  </Request>
</RCExtRequest>`;
}

async function postServlet(url: string, bodyXml: string): Promise<RcopiaCallResult> {
  if (DEMO_MODE) {
    return {
      ok: false,
      status: 'legacy_route_disabled',
      raw: '',
      demo: true,
      error: { code: 'legacy_route_disabled', text: 'Legacy DrFirst transport is disabled' },
    };
  }

  if (!url) {
    return {
      ok: false,
      status: 'not_configured',
      raw: '',
      demo: false,
      error: { code: 'not_configured', text: 'DrFirst endpoint is not configured' },
    };
  }

  const authHeader = 'Basic ' + Buffer.from(`${VENDOR_USER}:${VENDOR_PASS}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
      body: new URLSearchParams({ request: bodyXml }),
    });

    const raw = await res.text();
    const statusMatch = raw.match(/<Status>([^<]+)<\/Status>/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() : res.ok ? 'success' : 'error';
    const errCode = (raw.match(/<Error[^>]*Code="([^"]+)"/i) || raw.match(/<ErrorCode>([^<]+)<\/ErrorCode>/i) || [])[1];
    const errText = (raw.match(/<Error[^>]*>([^<]+)<\/Error>/i) || raw.match(/<ErrorText>([^<]+)<\/ErrorText>/i) || [])[1];

    return {
      ok: status === 'success' || (res.ok && !errCode),
      status,
      raw,
      demo: false,
      error: errCode || errText ? { code: errCode || 'api_error', text: errText || 'Unknown error from DrFirst' } : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 'network_error',
      raw: '',
      demo: false,
      error: { code: 'network_error', text: err.message || 'Failed to connect to DrFirst' },
    };
  }
}

export async function callEngine(innerXml: string, rcopiaUserName?: string): Promise<RcopiaCallResult> {
  const envelope = buildEnvelope(innerXml, rcopiaUserName);
  return postServlet(ENGINE_URL, envelope);
}

export async function callUpdate(innerXml: string, rcopiaUserName?: string): Promise<RcopiaCallResult> {
  const envelope = buildEnvelope(innerXml, rcopiaUserName);
  return postServlet(UPDATE_URL, envelope);
}

// ─── Traditional MAC-Signed SSO URL Builder ─────────────────────────────────

export interface SsoLaunchOptions {
  rcopiaUsername?: string;
  userExternalId?: string;
  startupScreen?: 'patient' | 'message' | 'report' | 'manage_medications' | 'manage_allergies' | 'manage_problems';
  patientRcopiaId?: string;
  patientExternalId?: string;
  limpMode?: boolean;
  logoutUrl?: string;
}

export function buildRcopiaSsoUrl(opts: SsoLaunchOptions): string | null {
  if (!SSO_URL || !SYSTEM_NAME || !VENDOR_PASS || !PRACTICE_USER) return null;
  if (!opts.rcopiaUsername && !opts.userExternalId) return null;

  const params: [string, string][] = [];
  const add = (k: string, v?: string) => {
    if (v) params.push([k, v]);
  };

  add('rcopia_portal_system_name', SYSTEM_NAME);
  add('rcopia_practice_user_name', PRACTICE_USER);
  add('rcopia_user_id', opts.rcopiaUsername);
  if (!opts.rcopiaUsername) add('rcopia_user_external_id', opts.userExternalId);
  add('service', 'rcopia');
  add('action', 'login');
  add('startup_screen', opts.startupScreen || 'patient');
  add('rcopia_patient_id', opts.patientRcopiaId);
  if (!opts.patientRcopiaId && opts.patientExternalId) {
    add('rcopia_patient_system_name', SYSTEM_NAME);
    add('rcopia_patient_external_id', opts.patientExternalId);
  }
  add('close_window', 'n');
  if (opts.limpMode) add('limp_mode', 'y');
  add('logout_url', opts.logoutUrl);
  add('time', ssoTime());

  const paramString = params.map(([k, v]) => `${k}=${v}`).join('&');
  const mac = crypto.createHash('md5').update(paramString + VENDOR_PASS).digest('hex').toUpperCase();
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + `&MAC=${mac}`;
  return `${SSO_URL}?${query}`;
}

// ─── send_patient Demographic Sync ──────────────────────────────────────────

export interface DemographicPatient {
  externalId: string;
  firstName: string;
  middleInitial?: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  gender: 'M' | 'F' | 'U';
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode: string;
  phone?: string;
}

export async function sendPatient(patient: DemographicPatient, rcopiaUserName?: string): Promise<RcopiaCallResult> {
  const [y, m, d] = patient.dob.split('-');
  const formattedDob = `${m}/${d}/${y}`;

  const body = `    <Command>send_patient</Command>
    <PatientList>
      <Patient>
        <ExternalID>${xmlEscape(patient.externalId)}</ExternalID>
        <FirstName>${xmlEscape(patient.firstName)}</FirstName>
        ${patient.middleInitial ? `<MiddleName>${xmlEscape(patient.middleInitial)}</MiddleName>` : ''}
        <LastName>${xmlEscape(patient.lastName)}</LastName>
        <DOB>${formattedDob}</DOB>
        <Sex>${patient.gender}</Sex>
        <Address1>${xmlEscape(patient.addressLine1 || '')}</Address1>
        <City>${xmlEscape(patient.city || '')}</City>
        <State>${xmlEscape(patient.state || '')}</State>
        <Zip>${xmlEscape(patient.zipCode)}</Zip>
        ${patient.phone ? `<HomePhone>${xmlEscape(patient.phone.replace(/\D/g, ''))}</HomePhone>` : ''}
      </Patient>
    </PatientList>`;

  return callEngine(body, rcopiaUserName);
}

// ─── Notification Counts (Pending Prescriptions & Refills) ───────────────────

export interface NotificationCounts {
  counts: Record<string, number>;
  demo: boolean;
  error?: string;
}

export async function getNotificationCounts(rcopiaUserName?: string): Promise<NotificationCounts> {
  if (DEMO_MODE) {
    return {
      counts: { pending_prescription: 0, refill: 0, rx_change: 0 },
      demo: true,
    };
  }

  const body = `    <Command>get_notification_count</Command>
    <ReturnPrescriptionIDs>y</ReturnPrescriptionIDs>
    <ReturnRefillIDs>y</ReturnRefillIDs>`;

  const res = await callUpdate(body, rcopiaUserName);
  if (!res.ok) {
    return { counts: {}, demo: false, error: res.error?.text || res.status };
  }

  const counts: Record<string, number> = {};
  const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
  for (const block of res.raw.match(/<NotificationCount>[\s\S]*?<\/NotificationCount>/g) || []) {
    const type = inTag(block, 'Type') || 'pending_prescription';
    counts[type] = (counts[type] || 0) + parseInt(inTag(block, 'Number') || '0', 10);
  }

  return { counts, demo: false };
}

export async function probeConnection(): Promise<{ demo: boolean; engineUrl: string; practice: string; result?: RcopiaCallResult }> {
  if (DEMO_MODE) {
    return { demo: true, engineUrl: ENGINE_URL, practice: PRACTICE_USER || 'not configured' };
  }
  const result = await callEngine('    <Command>get_patient_list</Command>');
  return { demo: false, engineUrl: ENGINE_URL, practice: PRACTICE_USER, result };
}

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
 * - XML envelope with vendor credentials in <Caller> (DrFirst's sample request format)
 * - Graceful demo mode fallback when credentials are not configured
 */

const VENDOR_USER = process.env.DRFIRST_VENDOR_USERNAME || '';
const VENDOR_PASS = process.env.DRFIRST_VENDOR_PASSWORD || '';
const PRACTICE_USER = process.env.DRFIRST_PRACTICE_USERNAME || 'mb3385';
const SYSTEM_NAME = process.env.DRFIRST_PORTAL_SYSTEM_NAME || VENDOR_USER;
const SSO_URL = process.env.DRFIRST_SSO_URL || 'https://orca.staging.drfirst.com/sso/portalServices';
const ENGINE_URL = process.env.DRFIRST_ENGINE_URL || 'https://engine201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet';
const UPDATE_URL = process.env.DRFIRST_UPDATE_URL || 'https://update201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet';

export const DEMO_MODE = !VENDOR_USER || !VENDOR_PASS;

/** Fallback when the database setting (drfirst_settings.api_version, GM4) is not available. */
export const DEFAULT_RCOPIA_API_VERSION = process.env.DRFIRST_API_VERSION?.trim() || '2.54';

export interface RcopiaCallResult {
  ok: boolean;
  status: string;
  raw: string;
  demo: boolean;
  error?: { code: string; text: string };
}

// ─── Database hooks (GM4 API version, GM6 / GM12 call log) ─────────────────────
// Resolved lazily from src/lib/drfirst/persistence only when DATABASE_URL is set, so unit tests and
// the standalone capture scripts run without a database. Tests may install their own (setRcopiaHooks).

export interface RcopiaCallLogEntry {
  kind: 'api' | 'sso';
  command: string;
  servlet?: string;
  practiceUsername?: string;
  rcopiaUsername?: string;
  ok: boolean;
  httpStatus?: number;
  status?: string;
  errorCode?: string;
  errorText?: string;
  durationMs?: number;
  payloadKind?: 'response' | 'request' | 'sso_url';
  payload?: string;
}
export interface RcopiaHooks {
  apiVersion?: () => Promise<string>;
  logCall?: (e: RcopiaCallLogEntry) => Promise<void>;
}
let hooks: RcopiaHooks | null | undefined;

export function setRcopiaHooks(h: RcopiaHooks | null) {
  hooks = h;
}

async function resolveHooks(): Promise<RcopiaHooks | null> {
  if (hooks !== undefined) return hooks;
  if (!process.env.DATABASE_URL) return (hooks = null);
  try {
    const m = await import('../drfirst/persistence');
    hooks = { apiVersion: () => m.loadApiVersion(), logCall: m.recordRcopiaCall };
  } catch (err) {
    console.error('[drfirst] persistence unavailable:', err instanceof Error ? err.name : 'unknown');
    hooks = null;
  }
  return hooks;
}

/** Drop characters XML 1.0 forbids: C0 controls except tab / LF / CR, U+FFFE / U+FFFF, lone surrogates. */
function dropInvalidXmlChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += s[i];
  }
  return out;
}

/**
 * XML text escaping for every value Altrixs puts in an Rcopia request (GM9): & < > " ' are escaped
 * and characters XML 1.0 forbids are dropped. Non-ASCII text (accents, CJK, emoji) is sent as UTF-8,
 * which the envelope declares.
 */
export function xmlEscape(s: string): string {
  return dropInvalidXmlChars(String(s ?? ''))
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
 * Builds the RCExtRequest envelope in DrFirst's sample-request format
 * (verified against staging 201, Oct 2026):
 *  - vendor credentials go IN the XML: <Caller><VendorName/><VendorPassword/>.
 *    HTTP Basic alone authenticates the vendor but never identifies the practice
 *    (bad_practice_id / user_not_found).
 *  - the practice is a top-level <RcopiaPracticeUsername>, sibling of <Caller>.
 *  - the prescriber is a top-level <RcopiaUserName>; DrFirst ignores it inside
 *    <Caller> or <Request>.
 */
export function buildEnvelope(innerXml: string, rcopiaUserName?: string, apiVersion: string = DEFAULT_RCOPIA_API_VERSION): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<RCExtRequest version="${xmlEscape(apiVersion)}">`,
    '  <Caller>',
    `    <VendorName>${xmlEscape(VENDOR_USER)}</VendorName>`,
    `    <VendorPassword>${xmlEscape(VENDOR_PASS)}</VendorPassword>`,
    '  </Caller>',
    rcopiaUserName ? `  <RcopiaUserName>${xmlEscape(rcopiaUserName)}</RcopiaUserName>` : '',
    `  <SystemName>${xmlEscape(SYSTEM_NAME)}</SystemName>`,
    `  <RcopiaPracticeUsername>${xmlEscape(PRACTICE_USER)}</RcopiaPracticeUsername>`,
    '  <Request>',
    innerXml,
    '  </Request>',
    '</RCExtRequest>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The <Response>'s own <Status> (DrFirst reports success as "ok"), lower-cased; '' if none.
 * Items inside *List sections carry their own Status: send_* responses put the
 * envelope "ok" FIRST and each item's "created"/"updated" after it, while
 * update_* responses put the envelope status last (verified live, Oct 2026), so
 * list sections are removed before reading it.
 */
export function envelopeStatus(responseXml: string): string {
  const top = responseXml.replace(/<(\w+List)>[\s\S]*<\/\1>/g, '');
  const statuses = [...top.matchAll(/<Status>([^<]+)<\/Status>/g)];
  return statuses.length ? statuses[statuses.length - 1][1].trim().toLowerCase() : '';
}

async function postServlet(url: string, bodyXml: string, servlet: 'engine' | 'update', rcopiaUserName?: string): Promise<RcopiaCallResult> {
  if (DEMO_MODE) {
    return {
      ok: true,
      status: 'success',
      raw: '<RCExtResponse version="2.54"><Response><Status>success</Status></Response></RCExtResponse>',
      demo: true,
    };
  }

  const command = (bodyXml.match(/<Command>([^<]*)<\/Command>/) || [])[1] || 'unknown';
  const started = Date.now();
  let result: RcopiaCallResult;
  let httpStatus: number | undefined;
  let full = '';
  try {
    // Credentials travel inside the envelope (see buildEnvelope); the servlet takes raw XML.
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: bodyXml,
    });
    httpStatus = res.status;
    full = await res.text();
    // Rcopia echoes our <Request> (LastUpdateDate cursor, Patient/RcopiaID, ...) ahead of
    // <Response>. Parse only the response, or downloads read our own cursor and IDs as data.
    const start = full.lastIndexOf('<Response>');
    const raw = start >= 0 ? full.slice(start) : full;
    // Errors arrive as <Error><Code/><Text/></Error> (per-item errors use <Description>); an item's error fails the call
    const status = envelopeStatus(raw) || (res.ok ? 'unknown' : 'error');
    const errBlock = (raw.match(/<Error>[\s\S]*?<\/Error>/) || [''])[0];
    const errCode = (errBlock.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    const errText = (errBlock.match(/<Text>([^<]+)<\/Text>/) || errBlock.match(/<Description>([^<]+)<\/Description>/) || [])[1];
    const ok = res.ok && (status === 'ok' || status === 'success') && !errCode;
    result = {
      ok,
      status,
      raw,
      demo: false,
      error: errCode || errText
        ? { code: errCode || 'api_error', text: errText || 'Unknown error from DrFirst' }
        // A gateway / maintenance page or a body without an Rcopia status is never a success, and says why
        : ok ? undefined
        : { code: res.ok ? 'bad_response' : `http_${res.status}`, text: res.ok ? 'DrFirst returned no response status' : `DrFirst returned HTTP ${res.status}` },
    };
  } catch (err: any) {
    // Rcopia not reachable (DNS, TLS, refused, or no answer within 30 s): callers report it and keep their cursors
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    result = {
      ok: false,
      status: 'network_error',
      raw: '',
      demo: false,
      error: { code: 'network_error', text: timedOut ? 'DrFirst did not answer within 30 seconds' : err?.message || 'Failed to connect to DrFirst' },
    };
  }

  // GM6 / GM12: every call is logged with its error; the response is kept for answered calls and the
  // request for connection failures (encrypted, credentials removed: src/lib/drfirst/persistence).
  const h = await resolveHooks();
  if (h?.logCall) {
    const connectionFailure = result.status === 'network_error';
    await h.logCall({
      kind: 'api',
      command,
      servlet,
      practiceUsername: PRACTICE_USER,
      rcopiaUsername: rcopiaUserName,
      ok: result.ok,
      httpStatus,
      status: result.status,
      errorCode: result.error?.code,
      errorText: result.error?.text,
      durationMs: Date.now() - started,
      payloadKind: connectionFailure ? 'request' : 'response',
      payload: connectionFailure ? bodyXml : full,
    }).catch(() => {});
  }
  return result;
}

async function envelopeFor(innerXml: string, rcopiaUserName?: string): Promise<string> {
  const h = DEMO_MODE ? null : await resolveHooks();
  const version = h?.apiVersion ? await h.apiVersion().catch(() => DEFAULT_RCOPIA_API_VERSION) : DEFAULT_RCOPIA_API_VERSION;
  return buildEnvelope(innerXml, rcopiaUserName, version);
}

export async function callEngine(innerXml: string, rcopiaUserName?: string): Promise<RcopiaCallResult> {
  return postServlet(ENGINE_URL, await envelopeFor(innerXml, rcopiaUserName), 'engine', rcopiaUserName);
}

export async function callUpdate(innerXml: string, rcopiaUserName?: string): Promise<RcopiaCallResult> {
  return postServlet(UPDATE_URL, await envelopeFor(innerXml, rcopiaUserName), 'update', rcopiaUserName);
}

// ─── Traditional MAC-Signed SSO URL Builder ─────────────────────────────────

export interface SsoLaunchOptions {
  rcopiaUsername?: string;
  userExternalId?: string;
  startupScreen?: 'patient' | 'message' | 'report' | 'manage_medications' | 'manage_allergies' | 'manage_problems';
  patientRcopiaId?: string;
  patientExternalId?: string;
  /** Limited Multi Patient Mode (limp_mode=y): required for the message / report screens under Single Patient Mode (NCDM3) */
  limpMode?: boolean;
  /** GM11: 'n' when Rcopia is shown in an iframe / embedded browser. Altrixs opens a normal browser tab, so it is unset. */
  allowPopupScreen?: 'y' | 'n';
  logoutUrl?: string;
}

export function buildRcopiaSsoUrl(opts: SsoLaunchOptions): string | null {
  if (DEMO_MODE) return null;
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
  add('allow_popup_screen', opts.allowPopupScreen);
  add('logout_url', opts.logoutUrl);
  add('time', ssoTime());

  const paramString = params.map(([k, v]) => `${k}=${v}`).join('&');
  const mac = crypto.createHash('md5').update(paramString + VENDOR_PASS).digest('hex').toUpperCase();
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + `&MAC=${mac}`;
  return `${SSO_URL}?${query}`;
}

// ─── send_patient Demographic Sync ──────────────────────────────────────────

export interface DemographicPatient {
  /** Our client id (PDUR1). Empty for a chart linked to a pre-existing Rcopia patient, which is updated by rcopiaId. */
  externalId: string;
  /** Rcopia id of a chart linked to an existing Rcopia patient (GM1: identify by RcopiaID) */
  rcopiaId?: string;
  /** Legal name pieces (never a split of the display name); built by src/lib/drfirst/patientDemographics.ts */
  firstName: string;
  /** Full legal middle name when on file, else the middle initial */
  middleName?: string;
  /** @deprecated use middleName */
  middleInitial?: string;
  lastName: string;
  suffix?: string;
  dob: string; // YYYY-MM-DD
  gender: 'M' | 'F' | 'U';
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  /** 5 or 9 digits */
  zipCode: string;
  /** 10 digits each; Rcopia <HomePhone> / <MobilePhone> / <WorkPhone> (seen in update_patient responses) */
  homePhone?: string;
  mobilePhone?: string;
  workPhone?: string;
  /** @deprecated sent as HomePhone when no typed phone is given */
  phone?: string;
}

/** The send_patient command body (no envelope). Pure; exported for tests. */
export function sendPatientBody(patient: DemographicPatient): string {
  const [y, m, d] = patient.dob.split('-');
  const formattedDob = `${m}/${d}/${y}`;
  const digits = (v: string) => v.replace(/\D/g, '');
  // Always sent, empty when the chart has none: an omitted tag leaves Rcopia's old middle name in place
  // (DrFirst certification: removing a middle initial must carry over to Rcopia)
  const middle = patient.middleName || patient.middleInitial || '';
  const homePhone = patient.homePhone ? digits(patient.homePhone) : patient.phone && !patient.mobilePhone ? digits(patient.phone) : '';

  const body = `    <Command>send_patient</Command>
    <PatientList>
      <Patient>
        ${patient.rcopiaId ? `<RcopiaID>${xmlEscape(patient.rcopiaId)}</RcopiaID>` : ''}
        ${patient.externalId ? `<ExternalID>${xmlEscape(patient.externalId)}</ExternalID>` : ''}
        <FirstName>${xmlEscape(patient.firstName)}</FirstName>
        <MiddleName>${xmlEscape(middle)}</MiddleName>
        <LastName>${xmlEscape(patient.lastName)}</LastName>
        ${patient.suffix ? `<Suffix>${xmlEscape(patient.suffix)}</Suffix>` : ''}
        <DOB>${formattedDob}</DOB>
        <Sex>${patient.gender}</Sex>
        ${homePhone ? `<HomePhone>${xmlEscape(homePhone)}</HomePhone>` : ''}
        ${patient.mobilePhone ? `<MobilePhone>${xmlEscape(digits(patient.mobilePhone))}</MobilePhone>` : ''}
        ${patient.workPhone ? `<WorkPhone>${xmlEscape(digits(patient.workPhone))}</WorkPhone>` : ''}
        ${patient.addressLine1 ? `<Address1>${xmlEscape(patient.addressLine1)}</Address1>` : ''}
        ${patient.addressLine2 ? `<Address2>${xmlEscape(patient.addressLine2)}</Address2>` : ''}
        ${patient.city ? `<City>${xmlEscape(patient.city)}</City>` : ''}
        ${patient.state ? `<State>${xmlEscape(patient.state)}</State>` : ''}
        <Zip>${xmlEscape(patient.zipCode)}</Zip>
      </Patient>
    </PatientList>`;
  // Drop the blank lines left by optional elements
  return body.replace(/\n\s*\n/g, '\n');
}

/**
 * The per-patient item of a send_patient response (verified live Oct 20 2026: PatientList/Patient
 * with RcopiaID, ExternalID and Status created | updated). Exported for fixture tests.
 */
export function parseSendPatientItem(raw: string): { rcopiaId?: string; externalId?: string; status?: string } | null {
  const list = (raw.match(/<PatientList>[\s\S]*<\/PatientList>/) || [''])[0];
  const item = (list.match(/<Patient>[\s\S]*?<\/Patient>/) || [''])[0];
  if (!item) return null;
  const own = item.replace(/<Error>[\s\S]*?<\/Error>/, '');
  const tag = (t: string) => (own.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim() || undefined;
  return { rcopiaId: tag('RcopiaID'), externalId: tag('ExternalID'), status: tag('Status')?.toLowerCase() };
}

/**
 * send_patient — create or update the patient (keyed by our ExternalID, or RcopiaID for a chart linked
 * to an existing Rcopia patient). Succeeds only when Rcopia confirms the item as created / updated;
 * `patientRcopiaId` is Rcopia's id for it.
 */
export async function sendPatient(
  patient: DemographicPatient,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { patientRcopiaId?: string; itemStatus?: string }> {
  const res = await callEngine(sendPatientBody(patient), rcopiaUserName);
  if (res.demo || !res.ok) return res;
  const item = parseSendPatientItem(res.raw);
  if (!item || !['created', 'updated'].includes(item.status || '')) {
    return { ...res, ok: false, itemStatus: item?.status, error: { code: 'no_item_status', text: 'DrFirst did not confirm the patient' } };
  }
  return { ...res, patientRcopiaId: item.rcopiaId, itemStatus: item.status };
}

// ─── Notification Counts (get_notification_count, v2.54) ──────────────────────

export interface NotificationItem {
  kind: 'prescription' | 'refill' | 'rx_change' | 'therapy_request';
  type: string;                 // the <Type> of the NotificationCount block it came from
  rcopiaId?: string;
  prescriberOrderNumber?: string;
  rxReferenceNumber?: string;
  providerUsername?: string;
  providerExternalId?: string;
}

export interface NotificationCounts {
  /** Practice/caller totals keyed by the response's <Type> values. */
  counts: Record<string, number>;
  /** Counts per owning Rcopia provider username (only when item ids were returned). */
  byProvider: Record<string, Record<string, number>>;
  items: NotificationItem[];
  demo: boolean;
  error?: string;
}

/**
 * get_notification_count — per-type pending counts. With returnIds, Rcopia
 * also lists every pending item with the provider who owns it, so each
 * prescriber's badge shows only their own renewals / changes.
 */
export async function getNotificationCounts(
  rcopiaUserName?: string,
  opts: { type?: string; returnIds?: boolean } = {},
): Promise<NotificationCounts> {
  if (DEMO_MODE) {
    return { counts: {}, byProvider: {}, items: [], demo: true };
  }

  const body = [
    '    <Command>get_notification_count</Command>',
    opts.type ? `    <Type>${xmlEscape(opts.type)}</Type>` : '',
    opts.returnIds ? '    <ReturnPrescriptionIDs>y</ReturnPrescriptionIDs>' : '',
    opts.returnIds ? '    <ReturnRefillIDs>y</ReturnRefillIDs>' : '',
    opts.returnIds ? '    <ReturnRxChangeIDs>y</ReturnRxChangeIDs>' : '',
    opts.returnIds ? '    <ReturnTherapyRequestIDs>y</ReturnTherapyRequestIDs>' : '',
  ].filter(Boolean).join('\n');

  const res = await callUpdate(body, rcopiaUserName);
  if (!res.ok) {
    return { counts: {}, byProvider: {}, items: [], demo: false, error: res.error?.text || res.status };
  }
  return { ...parseNotificationCounts(res.raw), demo: false };
}

/** Parse a get_notification_count <Response> (exported for fixture tests). */
export function parseNotificationCounts(raw: string): Pick<NotificationCounts, 'counts' | 'byProvider' | 'items'> {
  const counts: Record<string, number> = {};
  const byProvider: Record<string, Record<string, number>> = {};
  const items: NotificationItem[] = [];
  const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() || '';
  for (const block of raw.match(/<NotificationCount>[\s\S]*?<\/NotificationCount>/g) || []) {
    // <Type>/<Number> of the block itself, not of a listed item
    const head = block.replace(/<(Prescription|Refill|RxChange|TherapyRequest)>[\s\S]*?<\/\1>/g, '');
    const type = inTag(head, 'Type') || 'unknown';
    counts[type] = (counts[type] || 0) + (parseInt(inTag(head, 'Number') || '0', 10) || 0);
    const collect = (tag: string, kind: NotificationItem['kind']) => {
      for (const item of block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) || []) {
        const provider = (item.match(/<Provider>[\s\S]*?<\/Provider>/) || [''])[0];
        const rec: NotificationItem = {
          kind,
          type,
          rcopiaId: inTag(item.replace(provider, ''), 'RcopiaID') || undefined,
          prescriberOrderNumber: inTag(item, 'PrescriberOrderNumber') || undefined,
          rxReferenceNumber: inTag(item, 'RxReferenceNumber') || undefined,
          providerUsername: inTag(provider, 'Username') || undefined,
          providerExternalId: inTag(provider, 'ExternalID') || undefined,
        };
        if (!(rec.rcopiaId || rec.prescriberOrderNumber || rec.rxReferenceNumber)) continue;
        items.push(rec);
        const owner = (rec.providerUsername || '').toLowerCase() || '(unassigned)';
        byProvider[owner] = byProvider[owner] || {};
        byProvider[owner][type] = (byProvider[owner][type] || 0) + 1;
      }
    };
    collect('Prescription', 'prescription');
    collect('Refill', 'refill');
    collect('RxChange', 'rx_change');
    collect('TherapyRequest', 'therapy_request');
  }
  return { counts, byProvider, items };
}

/**
 * Rcopia get_notification_count <Type> values (verified live on staging 201, Oct 20 2026) and the
 * stable keys the Altrixs badge uses (NCDM2). The synced-table fallback (_lib/badgeCounts) uses the
 * same keys. Unknown types pass through under their own name.
 */
export const BADGE_KEY_BY_TYPE: Record<string, string> = {
  rx_pending: 'pending_prescription',     // prescriptions started but not completed
  rx_need_signing: 'need_signing',        // prescriptions waiting for the prescriber's signature
  rx_needs_signing: 'need_signing',
  rx_orders_pending: 'orders_pending',
  refill: 'refill',                       // pharmacy renewal requests
  rxchange: 'rx_change',                  // pharmacy change requests
  rx_change: 'rx_change',
  therapy_request: 'therapy_request',
};

/**
 * Badge counts for a set of Rcopia usernames (one prescriber, or an organization's prescribers).
 * Per type: when Rcopia listed the type's items (Return*IDs), count only the items owned by those
 * usernames; when it listed none, use the type's own <Number> (Rcopia's count for the signing user).
 */
export function badgeCountsFor(
  parsed: Pick<NotificationCounts, 'counts' | 'items'>,
  usernames: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const owned = new Set([...usernames].map(u => u.toLowerCase()));
  for (const [type, number] of Object.entries(parsed.counts)) {
    const key = BADGE_KEY_BY_TYPE[type] || type;
    const listed = parsed.items.filter(i => i.type === type);
    const n = listed.length ? listed.filter(i => owned.has((i.providerUsername || '').toLowerCase())).length : number;
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

export async function probeConnection(): Promise<{ demo: boolean; engineUrl: string; practice: string; result?: RcopiaCallResult }> {
  if (DEMO_MODE) {
    return { demo: true, engineUrl: ENGINE_URL, practice: PRACTICE_USER || 'not configured' };
  }
  const result = await callEngine('    <Command>get_patient_list</Command>');
  return { demo: false, engineUrl: ENGINE_URL, practice: PRACTICE_USER, result };
}

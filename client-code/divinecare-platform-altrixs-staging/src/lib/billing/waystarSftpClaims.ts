/**
 * Waystar SFTP claims: pure helpers (no DB, no AWS).
 *
 *  - claimToBatchClaim(): maps a DB Claim (+ lines, client, appointment) and the
 *    billing configuration (MapperContext) to the ClaimForBatch shape
 *    generate837P() expects, and lists every missing or invalid field instead
 *    of guessing a value (pre-send checks). Covers subscriber != patient,
 *    secondary / tertiary COB, prior auth, telehealth, corrected / void claims,
 *    per-claim billing provider and Waystar payer ID mapping.
 *  - parse999() / parse277CA(): minimal segment-level readers for Waystar's
 *    acknowledgments, keyed the way our 837 is built:
 *      999   AK1 -> GS06 (batch control number), AK2 -> ST02 (one ST per claim)
 *      277CA TRN*2 at the patient level -> CLM01 (= Claim.claimControlNumber;
 *            look it up with claimByControlNumber() in ./claims)
 */
import {
  billingProviderProblems,
  envBillingProvider,
  isValidNpi,
  type BillingProviderForBatch,
  type CasAdjustment,
  type ClaimForBatch,
  type ClaimLine,
  type OtherPayerForBatch,
} from '@/lib/services/waystarSftpService';
import { submissionLinesFor } from './claimLines';
import { authUnitsForLines } from './priorAuthMath';
import { validateIcd10Codes } from '@/lib/icd10/validate';
import {
  baseCode,
  codingEditFindings,
  isTaxonomyCode,
  noteClaimFindings,
  notePracticeDate,
  prpClaimBlock,
  timelyFiling,
  type NoteForClaim,
} from './claimRules';
import { administrativeSexCode, normalizeStateCode, zipDigits } from '@/lib/clients/demographics';

/** Staff member as billed in NM1 (2310B rendering / 2310D supervising): legal name, NPI, taxonomy. */
export type StaffForClaim = {
  userId?: string | null;
  npi: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  taxonomyCode?: string | null;
  /** Pre-licensed (supervised) per HR license level / supervision track / credentials */
  preLicensed?: boolean;
  /** Supervisor from SupervisionTrack.supervisorId (pre-licensed clinicians) */
  supervisor?: StaffForClaim | null;
};

/** The signed note the claim bills (its own, or the primary claim's for a secondary claim). */
export type NoteForMapping = NoteForClaim & {
  durationMinutes?: number | null;
  psychotherapyMinutes?: number | null;
  telehealth?: boolean | null;
  audioOnly?: boolean | null;
};

/** Where the service was performed (client's location): 2310C when it differs from 2010AA. */
export type ServiceLocationConfig = {
  name: string;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  npi?: string | null;
  npiVerified?: boolean | null;
};

/** Seeded placeholder site NPIs cleared by 20261018_clear_placeholder_location_npis.sql: never sent. */
export const PLACEHOLDER_LOCATION_NPIS = new Set(['1457893211', '1457893212', '1457893213', '1457893214']);

export type SuperviseeClaimsPolicy = 'render_as_supervisor' | 'supervisee_with_2310D' | 'not_allowed';
export type AudioOnlyPolicy = '93' | 'FQ' | 'none' | 'not_allowed';

const MEDICARE_FILING = new Set(['MB', 'MA']);

/** Per-payer defaults when a mapping does not set them (Medicare: supervisees blocked, audio-only 93). */
export function payerPolicyDefaults(claimFilingCode: string | null | undefined) {
  const f = String(claimFilingCode ?? '').toUpperCase();
  return {
    superviseeClaims: (MEDICARE_FILING.has(f) ? 'not_allowed' : 'supervisee_with_2310D') as SuperviseeClaimsPolicy,
    requireTaxonomy: f === 'MC',
    audioOnlyModifier: (MEDICARE_FILING.has(f) ? '93' : 'not_allowed') as AudioOnlyPolicy,
  };
}

// ─── Mapper input ─────────────────────────────────────────────────────────────

export type ClaimForMapping = {
  id: string;
  status: string;
  cptCode: string;
  units: number;
  amountCents: number | null;
  payer: string | null;
  icd10Codes: string[];
  placeOfService: string | null;
  renderingNpi: string | null;
  billingNpi: string | null;
  submissionData: unknown;
  /** CLM01 (<= 20 chars) */
  claimControlNumber?: string | null;
  /** CLM05-3: 1 / 7 / 8 */
  frequencyCode?: string | null;
  /** REF*F8 for 7 / 8 */
  payerClaimControlNumber?: string | null;
  /** P / S / T: which of the client's coverages this claim bills */
  payerResponsibility?: string | null;
  /** Staff-entered prior authorization number (claim editor) */
  priorAuthNumber?: string | null;
  /** ProgressNote.telehealth */
  noteTelehealth?: boolean | null;
  /** The signed note billed (DOS, rendering clinician, minutes, audio-only come from it) */
  note?: NoteForMapping | null;
  /** The note's clinician as billed (legal name / NPI / taxonomy / supervision) */
  renderingClinician?: StaffForClaim | null;
  client: {
    name: string;
    legalFirstName?: string | null;
    legalLastName?: string | null;
    middleInitial?: string | null;
    /** NM107 */
    nameSuffix?: string | null;
    /** Legal name not confirmed (import / backfill could not split it): blocks the claim */
    needsNameReview?: boolean | null;
    dateOfBirth: Date | null;
    /** X12 DMG03 F / M / U; legacy `gender` maps only when it literally says male / female */
    administrativeSex?: string | null;
    gender: string | null;
    addressLine1: string | null;
    addressLine2?: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    insurancePayer: string | null;
    insuranceMemberId: string | null;
    insuranceGroupNumber?: string | null;
  };
  /** The note's linked appointment: cross-check only (clinician + practice date) */
  appointment: {
    id?: string;
    startsAt: Date;
    clinicianId?: string | null;
    isVirtual?: boolean | null;
    audioOnly?: boolean | null;
    clinician?: { name: string | null; npi: string | null } | null;
  } | null;
  /** ProgressNote workflow status; a SIGNED or LOCKED note is required (same rule as the REST path). */
  noteStatus: string | null;
  serviceLines: Array<{ id: string; cptCode: string; modifier: string | null; units: number; totalCharge: number }>;
};

/** billing_providers row (2010AA) plus its selection rules. */
export type BillingProviderConfig = BillingProviderForBatch & {
  id?: string;
  label?: string | null;
  departments: string[];
  clinicianRoles: string[];
  locationKeys: string[];
  isDefault: boolean;
  active: boolean;
  /** 2000A PRV*BI taxonomy (null = practice settings' primary taxonomy) */
  taxonomyCode?: string | null;
};

/** waystar_payer_mappings row. */
export type PayerMappingConfig = {
  id?: string;
  payerName: string;
  aliases: string[];
  waystarPayerId: string;
  claimFilingCode: string;
  /** 95 | GT | both | none */
  telehealthModifier: string;
  requiresPriorAuth: boolean;
  verified: boolean;
  active: boolean;
  /** Pre-licensed rendering clinicians (default by filing code: Medicare not_allowed, else supervisee_with_2310D) */
  superviseeClaims?: SuperviseeClaimsPolicy | string | null;
  /** PRV taxonomy required (default: Medicaid / PBHS) */
  requireTaxonomy?: boolean | null;
  /** Audio-only telehealth modifier (default: Medicare 93, else not_allowed) */
  audioOnlyModifier?: AudioOnlyPolicy | string | null;
  /** Timely filing limit, days from DOS (null = not configured) */
  filingLimitDays?: number | null;
};

/** client_insurance_coverages row. Rank P may omit payer / member (they stay on Client). */
export type CoverageRecord = {
  rank: 'P' | 'S' | 'T';
  payerName?: string | null;
  memberId?: string | null;
  groupNumber?: string | null;
  claimFilingCode?: string | null;
  subscriberRelationship: string;
  subscriberFirstName?: string | null;
  subscriberLastName?: string | null;
  subscriberMiddleInitial?: string | null;
  active?: boolean;
};

export type PriorAuthRecord = {
  authNumber: string | null;
  status: string;
  payer: string;
  payerId?: string | null;
  cptCodes: string[];
  startDate: Date | null;
  endDate: Date | null;
  unitsApproved: number;
  unitsUsed: number;
};

/** How an earlier payer adjudicated this service (from its 835, or entered by staff). */
export type CobAdjudication = {
  source: 'era' | 'staff';
  /** Waystar payer ID of that payer (from its claim); else resolved through the payer mapping */
  payerId?: string | null;
  claimFilingCode?: string | null;
  paidAmount: number;
  /** YYYY-MM-DD */
  paidDate: string;
  adjustments: CasAdjustment[];
  lines?: Array<{ lineNumber: number; paidAmount: number; adjustments: CasAdjustment[]; paidDate?: string }>;
};

export type MapperContext = {
  /** Env billing NPI (PRACTICE_GROUP_NPI); only used when `billingProviders` is not supplied. */
  groupNpi?: string;
  /** Staff (legal name, taxonomy, supervision) by NPI, for a rendering NPI picked in the claim editor. */
  providersByNpi?: Record<string, StaffForClaim | undefined>;
  /** Practice settings' primary taxonomy (2000A when the billing provider has none). */
  billingTaxonomy?: string | null;
  /** Client's service location (2310C). undefined = not loaded (check skipped); null = none assigned. */
  serviceLocation?: ServiceLocationConfig | null;
  /** Codes already billed for this client by the same rendering provider on the same DOS (NCCI / per-day caps). */
  sameDayCodes?: string[];
  /** Practice's confirmed PRP billing model (PracticeSettings.prpBillingModel); null = PRP held. */
  prpBillingModel?: string | null;
  /** "Today" for timely filing (tests). */
  today?: Date;
  /** Clinic time zone for turning an appointment start into a date of service. */
  timeZone?: string;
  /** ISA15 of the file being built; unverified payer IDs are blocked when 'P'. */
  usageIndicator?: 'T' | 'P';
  /** Configured billing providers. When absent the PRACTICE_* env provider is used (one NPI). */
  billingProviders?: BillingProviderConfig[];
  /** Department of the service (submissionData.department wins). */
  department?: string | null;
  /** Role of the rendering clinician (e.g. PSYCHIATRIST). */
  clinicianRole?: string | null;
  /** Client location id / code / name. */
  locationKeys?: string[];
  /** Waystar payer mapping. When absent, the payer ID must be on submissionData. */
  payerMappings?: PayerMappingConfig[];
  /** The client's insurance coverages. */
  coverages?: CoverageRecord[];
  /** The client's prior authorizations. */
  priorAuths?: PriorAuthRecord[];
  /** Earlier payers' adjudication from their 835 (keyed by that payer's rank). */
  priorAdjudications?: Partial<Record<'P' | 'S', CobAdjudication | null>>;
};

export type MapResult = { ok: true; claim: ClaimForBatch; warnings: string[] } | { ok: false; errors: string[]; warnings?: string[] };

const ICD10_RE = /^[A-Z][0-9A-Z]{2}(\.?[0-9A-Z]{1,4})?$/;

/** submissionData.diagnosisPointers (1-based, max 4, within the claim's diagnoses), else [1]. */
export function claimLevelPointers(raw: unknown, diagnosisCount: number): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (const p of list) {
    if (typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= Math.max(1, diagnosisCount) && !out.includes(p)) out.push(p);
    if (out.length === 4) break;
  }
  return out.length ? out : [1];
}

const CPT_RE = /^[A-Z0-9]{5}$/;
const MOD_RE = /^[A-Z0-9]{2}$/;
const PAYER_ID_RE = /^[A-Z0-9-]{2,15}$/i;
export const FILING_CODES = new Set(['MC', 'MB', 'MA', 'BL', 'CI', 'HM', '12', '13', '14', '15', '16', '17', 'AM', 'CH', 'DS', 'FI', 'LM', 'OF', 'TV', 'VA', 'WC', 'ZZ']);
/** 2000C PAT01 / 2320 SBR02 individual relationship codes (18 = self is SBR02-only). */
export const RELATIONSHIP_CODES: Record<string, string> = {
  '18': 'Self',
  '01': 'Spouse',
  '19': 'Child',
  '20': 'Employee',
  '21': 'Unknown',
  '39': 'Organ donor',
  '40': 'Cadaver donor',
  '53': 'Life partner',
  G8: 'Other relationship',
};
const CAS_GROUPS = new Set(['CO', 'CR', 'OA', 'PI', 'PR']);
const TELEHEALTH_POS = new Set(['02', '10']);
const TELEHEALTH_MODS = new Set(['95', 'GT']);
export const CONTROL_NUMBER_RE = /^[A-Z0-9]{1,20}$/;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cents(n: number) {
  return Math.round(n * 100);
}

/** Local calendar date (YYYY-MM-DD) of an instant in the clinic's time zone. */
export function localDate(at: Date, timeZone = 'America/New_York') {
  return at.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}


/** "Dr. Jane Q. Doe, LCSW-C" -> { first: 'Jane', last: 'Doe' }; null when it can't be split safely. */
export function providerNameParts(raw: string | null | undefined): { first: string; last: string } | null {
  const name = (raw || '').split(',')[0].replace(/^(dr|mr|mrs|ms)\.?\s+/i, '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

/** NM1 patient name: the structured legal name only (a display name is never split). */
function patientName(client: ClaimForMapping['client']): { first: string; last: string; mi?: string; suffix?: string } | null {
  const first = str(client.legalFirstName);
  const last = str(client.legalLastName);
  const mi = str(client.middleInitial).replace(/\./g, '').slice(0, 1).toUpperCase() || undefined;
  const suffix = str(client.nameSuffix) || undefined;
  if (first && last) return { first, last, mi, suffix };
  return null;
}

// ─── Configuration lookups ────────────────────────────────────────────────────

/** "CareFirst BCBS (BlueChoice)" -> "carefirstbcbsbluechoice" for exact-name matching. */
export function normalizePayerName(name: string | null | undefined) {
  return (name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

/** Exact (normalized) match on payer name or an alias. No fuzzy matching: an unmapped payer is reported, not guessed. */
export function findPayerMapping(mappings: PayerMappingConfig[], payerName: string | null | undefined): PayerMappingConfig | null {
  const key = normalizePayerName(payerName);
  if (!key) return null;
  return (
    mappings.find((m) => m.active && (normalizePayerName(m.payerName) === key || m.aliases.some((a) => normalizePayerName(a) === key))) ?? null
  );
}

function npiIn(text: string | null | undefined) {
  const m = /\b(\d{10})\b/.exec(text || '');
  return m ? m[1] : '';
}

/**
 * Picks the 2010AA billing provider for a claim:
 *   1. an NPI set on the claim (claim editor "Billing provider") must be a configured provider;
 *   2. else providers whose departments include the claim's department, else whose
 *      clinician roles include the rendering clinician's role;
 *   3. narrowed by client location when that matches;
 *   4. the default provider among the remaining candidates.
 */
export function resolveBillingProvider(
  providers: BillingProviderConfig[],
  input: { explicit?: string | null; department?: string | null; clinicianRole?: string | null; locationKeys?: string[] }
): { ok: true; provider: BillingProviderConfig; reason: string } | { ok: false; error: string } {
  const active = providers.filter((p) => p.active);
  if (!active.length) return { ok: false, error: 'No billing providers are configured (Billing > Payer settings > Billing providers)' };
  const explicitText = str(input.explicit);
  if (explicitText) {
    const npi = npiIn(explicitText);
    if (!npi) return { ok: false, error: `Billing provider "${explicitText}" on the claim has no NPI` };
    const hit = active.find((p) => p.npi === npi);
    return hit
      ? { ok: true, provider: hit, reason: 'set on the claim' }
      : { ok: false, error: `Claim billing NPI ${npi} is not a configured billing provider` };
  }
  const lc = (s: string) => s.trim().toLowerCase();
  let candidates = active;
  let reason = 'default';
  const dept = lc(input.department || '');
  const role = (input.clinicianRole || '').trim().toUpperCase();
  const byDept = dept ? active.filter((p) => p.departments.some((d) => lc(d) === dept)) : [];
  const byRole = role ? active.filter((p) => p.clinicianRoles.some((r) => r.trim().toUpperCase() === role)) : [];
  if (byDept.length) { candidates = byDept; reason = `department ${input.department}`; }
  else if (byRole.length) { candidates = byRole; reason = `clinician role ${role}`; }
  const keys = (input.locationKeys || []).map(lc).filter(Boolean);
  if (keys.length) {
    const byLoc = candidates.filter((p) => p.locationKeys.some((k) => keys.includes(lc(k))));
    if (byLoc.length) { candidates = byLoc; reason = reason === 'default' ? 'location' : `${reason} + location`; }
  }
  if (candidates.length === 1) return { ok: true, provider: candidates[0], reason };
  const defaults = candidates.filter((p) => p.isDefault);
  if (defaults.length === 1) return { ok: true, provider: defaults[0], reason: reason === 'default' ? 'default' : `${reason} (default)` };
  return {
    ok: false,
    error: `Billing provider is ambiguous (${candidates.map((p) => p.npi).join(', ')}); set the billing provider on the claim or mark one default`,
  };
}

/** Telehealth modifiers per payer policy: removes 95/GT, then adds what the payer wants. */
export function telehealthModifiers(mods: string[] | undefined, policy: string | null): string[] {
  const base = (mods || []).filter((m) => !TELEHEALTH_MODS.has(m));
  if (!policy) return base;
  if (policy === 'GT') return [...base, 'GT'];
  if (policy === 'both') return [...base, 'GT', '95'];
  if (policy === 'none') return base;
  return [...base, '95'];
}

function inWindow(dos: string, start: Date | null, end: Date | null) {
  const s = start ? start.toISOString().slice(0, 10) : '';
  const e = end ? end.toISOString().slice(0, 10) : '';
  return (!s || s <= dos) && (!e || dos <= e);
}

/** Active (APPROVED) auth for this payer, date of service and procedure. CPT-specific first, then latest start. */
export function selectPriorAuth(
  auths: PriorAuthRecord[],
  input: { payerName: string; payerId: string; mapping: PayerMappingConfig | null; serviceDate: string; cpts: string[] }
): { auth: PriorAuthRecord | null; notes: string[] } {
  const names = new Set([input.payerName, ...(input.mapping ? [input.mapping.payerName, ...input.mapping.aliases] : [])].map(normalizePayerName).filter(Boolean));
  const forPayer = auths.filter(
    (a) => a.status === 'APPROVED' && str(a.authNumber) && (names.has(normalizePayerName(a.payer)) || (a.payerId && a.payerId.toUpperCase() === input.payerId.toUpperCase()))
  );
  // An auth with no CPT codes (e.g. imported from Valant, which exports none) covers any service for
  // the payer in its date range; an auth listing this claim's CPT is preferred when both apply.
  const forCpt = forPayer.filter((a) => !a.cptCodes.length || a.cptCodes.some((c) => input.cpts.includes(c.split('-')[0].toUpperCase())));
  const specific = (a: PriorAuthRecord) => (a.cptCodes.length ? 1 : 0);
  const valid = forCpt
    .filter((a) => inWindow(input.serviceDate, a.startDate, a.endDate))
    .sort((a, b) => specific(b) - specific(a) || (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));
  const notes: string[] = [];
  if (!valid.length && forCpt.length) notes.push(`Prior auth ${forCpt.map((a) => a.authNumber).join(', ')} does not cover the date of service ${input.serviceDate}`);
  return { auth: valid[0] ?? null, notes };
}

/** Staff-entered adjudication of an earlier payer (submissionData.cob[rank]). */
export function readStaffCob(submissionData: unknown, rank: 'P' | 'S'): CobAdjudication | null {
  const raw = obj(obj(obj(submissionData).cob)[rank]);
  if (!Object.keys(raw).length) return null;
  const adj = (v: unknown): CasAdjustment[] =>
    (Array.isArray(v) ? v : []).map((a) => {
      const o = obj(a);
      return { group: str(o.group).toUpperCase() as CasAdjustment['group'], reason: str(o.reason).toUpperCase(), amount: Number(o.amount) };
    });
  return {
    source: 'staff',
    payerId: str(raw.payerId) || null,
    claimFilingCode: str(raw.claimFilingCode) || null,
    paidAmount: Number(raw.paidAmount),
    paidDate: str(raw.paidDate),
    adjustments: adj(raw.adjustments),
    lines: Array.isArray(raw.lines)
      ? raw.lines.map((l) => {
          const o = obj(l);
          return { lineNumber: Number(o.lineNumber), paidAmount: Number(o.paidAmount), adjustments: adj(o.adjustments), ...(str(o.paidDate) ? { paidDate: str(o.paidDate) } : {}) };
        })
      : undefined,
  };
}

/** One posted 835 claim payment (era_claim_payments, written by Waystar inbound). */
export type EraPaymentForCob = {
  paidAmount: number;
  /** Remittance payment date (BPR16) or posting date, YYYY-MM-DD */
  paidDate: string | null;
  /** [{ group, carc, amount }] claim-level CAS */
  claimAdjustments: unknown;
  /** [{ seq, procedureCode, paid, adjustments: [{ group, carc, amount }] }] SVC loops */
  serviceLines: unknown;
};

function eraCas(list: unknown): CasAdjustment[] {
  return (Array.isArray(list) ? list : []).map((a) => {
    const o = obj(a);
    return { group: str(o.group).toUpperCase() as CasAdjustment['group'], reason: str(o.carc ?? o.reason).toUpperCase(), amount: Number(o.amount) };
  });
}

/**
 * COB adjudication from the previous payer's posted 835 payment(s).
 * Line-level detail (2430) is used only when there is one payment whose SVC lines
 * line up 1:1, in order and by procedure code, with the claim lines; otherwise all
 * adjustments are sent at claim level (2320 CAS), which still balances.
 * Returns null when no payment is posted (staff then enter the COB data).
 */
export function eraAdjudicationFromPayments(
  payments: EraPaymentForCob[],
  lineCpts: string[],
  payer: { payerId?: string | null; claimFilingCode?: string | null } = {}
): CobAdjudication | null {
  if (!payments.length) return null;
  const paidCents = payments.reduce((t, p) => t + cents(Number(p.paidAmount)), 0);
  const paidDate = payments.map((p) => p.paidDate || '').filter(Boolean).sort().pop() || '';
  const svc = payments.length === 1 && Array.isArray(payments[0].serviceLines) ? (payments[0].serviceLines as unknown[]).map(obj) : [];
  const aligned =
    svc.length > 0 &&
    svc.length === lineCpts.length &&
    svc.every((l, i) => str(l.procedureCode).toUpperCase().split(':')[0] === lineCpts[i].toUpperCase());
  const claimLevel = payments.flatMap((p) => eraCas(p.claimAdjustments));
  const base = {
    source: 'era' as const,
    payerId: payer.payerId || null,
    claimFilingCode: payer.claimFilingCode || null,
    paidAmount: paidCents / 100,
    paidDate,
  };
  if (aligned) {
    return {
      ...base,
      adjustments: claimLevel,
      lines: svc.map((l, i) => ({ lineNumber: i + 1, paidAmount: Number(l.paid), adjustments: eraCas(l.adjustments) })),
    };
  }
  const lineLevel = payments.flatMap((p) => (Array.isArray(p.serviceLines) ? (p.serviceLines as unknown[]) : []).flatMap((l) => eraCas(obj(l).adjustments)));
  return { ...base, adjustments: [...claimLevel, ...lineLevel] };
}

function casProblems(list: CasAdjustment[], where: string): string[] {
  const p: string[] = [];
  list.forEach((a) => {
    if (!CAS_GROUPS.has(a.group)) p.push(`${where}: adjustment group "${a.group}" must be CO, CR, OA, PI or PR`);
    if (!/^[A-Z0-9]{1,5}$/.test(a.reason)) p.push(`${where}: adjustment reason code "${a.reason}" is not a CARC`);
    if (!Number.isFinite(a.amount) || cents(a.amount) === 0) p.push(`${where}: adjustment ${a.group}-${a.reason} amount must be a non-zero number`);
  });
  return p;
}

/** COB balancing (2320 / 2430): charge = paid + all adjustments, at claim and line level. */
export function cobProblems(adj: CobAdjudication, lineCharges: number[], label: string): string[] {
  const p: string[] = [];
  const total = lineCharges.reduce((t, c) => t + cents(c), 0);
  if (!Number.isFinite(adj.paidAmount) || adj.paidAmount < 0) p.push(`${label}: paid amount must be 0 or more`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(adj.paidDate)) p.push(`${label}: adjudication (paid) date is missing`);
  p.push(...casProblems(adj.adjustments, label));
  const claimAdj = adj.adjustments.reduce((t, a) => t + cents(a.amount), 0);
  let lineAdj = 0;
  if (adj.lines?.length) {
    const seen = new Set<number>();
    let linePaid = 0;
    adj.lines.forEach((l) => {
      const where = `${label} line ${l.lineNumber}`;
      if (!Number.isInteger(l.lineNumber) || l.lineNumber < 1 || l.lineNumber > lineCharges.length) { p.push(`${where}: no such service line`); return; }
      if (seen.has(l.lineNumber)) p.push(`${where}: listed twice`);
      seen.add(l.lineNumber);
      if (!Number.isFinite(l.paidAmount) || l.paidAmount < 0) p.push(`${where}: paid amount must be 0 or more`);
      p.push(...casProblems(l.adjustments, where));
      const la = l.adjustments.reduce((t, a) => t + cents(a.amount), 0);
      lineAdj += la;
      linePaid += cents(l.paidAmount);
      if (cents(lineCharges[l.lineNumber - 1]) !== cents(l.paidAmount) + la) {
        p.push(`${where}: charge $${lineCharges[l.lineNumber - 1].toFixed(2)} must equal paid + adjustments ($${((cents(l.paidAmount) + la) / 100).toFixed(2)})`);
      }
    });
    if (linePaid !== cents(adj.paidAmount)) p.push(`${label}: line paid amounts ($${(linePaid / 100).toFixed(2)}) must add up to the claim paid amount ($${adj.paidAmount.toFixed(2)})`);
  }
  if (Number.isFinite(adj.paidAmount) && cents(adj.paidAmount) + claimAdj + lineAdj !== total) {
    p.push(`${label}: claim charge $${(total / 100).toFixed(2)} must equal paid ($${adj.paidAmount.toFixed(2)}) + adjustments ($${((claimAdj + lineAdj) / 100).toFixed(2)})`);
  }
  return p;
}

type ResolvedCoverage = {
  rank: 'P' | 'S' | 'T';
  payerName: string;
  memberId: string;
  groupNumber: string;
  claimFilingCode: string;
  relationship: string;
  subscriber: { first: string; last: string; mi?: string } | null;
  onFile: boolean;
};

function resolveCoverage(rank: 'P' | 'S' | 'T', claim: ClaimForMapping, ctx: MapperContext, billed: boolean): ResolvedCoverage {
  const sd = obj(claim.submissionData);
  const row = (ctx.coverages || []).find((c) => c.rank === rank && c.active !== false) ?? null;
  const client = claim.client;
  const isP = rank === 'P';
  const payerName = (billed ? str(claim.payer) : '') || str(row?.payerName) || (isP ? str(client.insurancePayer) : '');
  const memberId = (billed && isP ? str(sd.memberId) : '') || str(row?.memberId) || (isP ? str(client.insuranceMemberId) : '');
  const groupNumber = str(row?.groupNumber) || (isP ? str(client.insuranceGroupNumber) || (billed ? str(sd.groupNumber) : '') : '');
  const relationship = str(row?.subscriberRelationship) || '18';
  const subscriber = relationship === '18'
    ? null
    : { first: str(row?.subscriberFirstName), last: str(row?.subscriberLastName), mi: str(row?.subscriberMiddleInitial).slice(0, 1) || undefined };
  return {
    rank, payerName, memberId, groupNumber, relationship, subscriber,
    claimFilingCode: str(row?.claimFilingCode).toUpperCase(),
    onFile: isP ? Boolean(row || client.insurancePayer) : Boolean(row),
  };
}

const RANK_LABEL = { P: 'Primary', S: 'Secondary', T: 'Tertiary' } as const;

/**
 * DB claim -> ClaimForBatch. Every problem is listed; nothing is defaulted
 * except where the 837 rules make the value certain.
 */
export function claimToBatchClaim(claim: ClaimForMapping, ctx: MapperContext): MapResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sd = obj(claim.submissionData);
  const client = claim.client;

  if (claim.status !== 'READY') errors.push(`Claim status is ${claim.status}; only READY claims are sent`);
  if (!['SIGNED', 'LOCKED'].includes(claim.noteStatus || '')) errors.push('A signed progress note is required');
  // The note is the source of the DOS, rendering clinician and minutes; the appointment only cross-checks (B1, B2)
  const note = claim.note ?? null;
  if (!note) errors.push('The claim is not linked to its progress note (date of service and rendering provider come from the note)');
  else {
    const appt = claim.appointment && claim.appointment.clinicianId !== undefined
      ? { id: claim.appointment.id ?? '', clinicianId: claim.appointment.clinicianId ?? null, startsAt: claim.appointment.startsAt }
      : null;
    // The claim's lines carry the CPT (a coder may have corrected it); the note CPT itself is checked by the scrubber
    for (const f of noteClaimFindings(note, appt, { timeZone: ctx.timeZone, requireCpt: false })) {
      (f.severity === 'error' ? errors : warnings).push(f.message);
    }
  }

  // CLM01 claim control number (<= 20 chars so payers don't truncate it)
  const controlNumber = str(claim.claimControlNumber).toUpperCase();
  if (!controlNumber) errors.push('Claim control number (CLM01) is not assigned (apply the 20261016 Waystar migration)');
  else if (!CONTROL_NUMBER_RE.test(controlNumber)) errors.push(`Claim control number "${controlNumber}" must be 1-20 letters/digits`);

  // CLM05-3 frequency + REF*F8
  const frequency = str(claim.frequencyCode) || '1';
  if (!['1', '7', '8'].includes(frequency)) errors.push(`Claim frequency code "${frequency}" must be 1 (original), 7 (replacement) or 8 (void)`);
  const payerClaimControlNumber = str(claim.payerClaimControlNumber) || str(sd.payerClaimControlNumber);
  if ((frequency === '7' || frequency === '8') && !payerClaimControlNumber) {
    errors.push(`${frequency === '7' ? 'Corrected' : 'Void'} claim needs the payer claim control number of the original claim (REF*F8)`);
  } else if (payerClaimControlNumber && !/^[A-Za-z0-9-]{1,50}$/.test(payerClaimControlNumber)) {
    errors.push(`Payer claim control number "${payerClaimControlNumber}" has characters a payer will reject`);
  }

  // Which coverage this claim bills (SBR01)
  const responsibility = (str(claim.payerResponsibility) || 'P').toUpperCase() as 'P' | 'S' | 'T';
  if (!['P', 'S', 'T'].includes(responsibility)) errors.push(`Payer responsibility "${claim.payerResponsibility}" must be P, S or T`);
  const coverage = resolveCoverage(responsibility, claim, ctx, true);
  if (responsibility !== 'P' && !coverage.onFile) errors.push(`${RANK_LABEL[responsibility]} insurance is not on file for the client`);

  // Payer + Waystar payer ID (staff-entered submissionData.payerId wins over the mapping)
  const payerName = coverage.payerName;
  if (!payerName) errors.push('Payer name is missing on the claim and the client insurance');
  const mapping = ctx.payerMappings ? findPayerMapping(ctx.payerMappings, payerName) : null;
  const enteredPayerId = str(sd.payerId);
  const payerId = (enteredPayerId || mapping?.waystarPayerId || '').toUpperCase();
  if (!payerId) {
    errors.push(
      ctx.payerMappings
        ? `Waystar payer ID is missing: no payer mapping for "${payerName || '(no payer)'}" (add it in Billing > Payer settings > Waystar payer IDs)`
        : 'Waystar payer ID is missing (enter it under Submission details)'
    );
  } else if (!PAYER_ID_RE.test(payerId)) errors.push(`Waystar payer ID "${payerId}" is not a valid payer ID`);
  if (mapping && payerId === mapping.waystarPayerId.toUpperCase() && !mapping.verified) {
    if (ctx.usageIndicator === 'P') errors.push(`Waystar payer ID ${payerId} for ${mapping.payerName} is not verified; confirm it on Waystar's payer list before production sends`);
    else warnings.push(`Waystar payer ID ${payerId} for ${mapping.payerName} is unverified (allowed for test files only)`);
  }
  if (enteredPayerId && mapping && enteredPayerId.toUpperCase() !== mapping.waystarPayerId.toUpperCase()) {
    warnings.push(`Payer ID ${enteredPayerId.toUpperCase()} entered on the claim differs from the mapping for ${mapping.payerName} (${mapping.waystarPayerId})`);
  }
  const enteredFiling = str(sd.claimFilingCode).toUpperCase();
  const filing = ((enteredPayerId ? enteredFiling : '') || mapping?.claimFilingCode || enteredFiling || coverage.claimFilingCode).toUpperCase();
  if (!filing) errors.push('Insurance type (claim filing code) is missing (save Submission details or the payer mapping)');
  else if (!FILING_CODES.has(filing)) errors.push(`Claim filing code "${filing}" is not valid`);

  // Subscriber (2010BA) and patient (2010BA when self, else 2000C / 2010CA)
  const memberId = coverage.memberId;
  if (!memberId) errors.push('Insurance member ID is missing');
  else if (!/^[A-Za-z0-9-]{2,80}$/.test(memberId)) errors.push('Insurance member ID has characters a payer will reject');
  let subscriber: ClaimForBatch['subscriber'];
  if (coverage.relationship !== '18') {
    if (!RELATIONSHIP_CODES[coverage.relationship]) errors.push(`Subscriber relationship "${coverage.relationship}" is not an X12 relationship code`);
    if (!coverage.subscriber?.first || !coverage.subscriber?.last) errors.push('Policyholder (subscriber) first and last name are missing on the client coverage');
    subscriber = { relationship: coverage.relationship, firstName: coverage.subscriber?.first || '', lastName: coverage.subscriber?.last || '', ...(coverage.subscriber?.mi ? { middleInitial: coverage.subscriber.mi } : {}) };
  }
  // Patient demographics (2010BA / 2010CA): same rules as src/lib/clients/demographics.ts claimReadiness
  const name = patientName(client);
  if (!name) errors.push('Patient legal first and last name are missing (set legal name on the client)');
  if (client.needsNameReview) errors.push('Patient legal name needs staff review (confirm legal first / last name on the client profile)');
  if (!client.dateOfBirth || Number.isNaN(client.dateOfBirth.getTime())) errors.push('Patient date of birth is missing');
  const gender = administrativeSexCode(client);
  if (!gender) {
    errors.push(client.gender || client.administrativeSex
      ? `Patient sex "${client.administrativeSex || client.gender}" is not an X12 sex code; set Sex (F / M / U) on the client profile`
      : 'Patient sex is missing (set Sex on the client profile)');
  }
  const line1 = str(client.addressLine1);
  const line2 = str(client.addressLine2);
  const city = str(client.city);
  const state = normalizeStateCode(client.state) ?? '';
  const zip = zipDigits(client.postalCode) ?? '';
  if (!line1) errors.push('Patient street address is missing');
  if (!city) errors.push('Patient city is missing');
  if (!state) errors.push(str(client.state) ? `Patient state "${client.state}" must be a 2-letter code` : 'Patient state is missing');
  if (!zip) errors.push(str(client.postalCode) ? 'Patient ZIP must be 5 or 9 digits' : 'Patient ZIP is missing');

  // Diagnoses
  const rawDx = claim.icd10Codes?.length ? claim.icd10Codes : Array.isArray(sd.diagnosisCodes) ? (sd.diagnosisCodes as unknown[]) : [];
  const diagnoses = rawDx.map((d) => str(d).toUpperCase()).filter(Boolean);
  if (!diagnoses.length) errors.push('No ICD-10 diagnosis on the claim');
  if (diagnoses.length > 12) errors.push('A claim can carry at most 12 diagnoses');
  const badDx = diagnoses.filter((d) => !ICD10_RE.test(d));
  if (badDx.length) errors.push(`Invalid ICD-10 code(s): ${badDx.join(', ')}`);
  else if (diagnoses.length) {
    // FY2027 code set: each code must exist and be billable (no category headers)
    const inSet = validateIcd10Codes(diagnoses, { requireBillable: true });
    errors.push(...inSet.errors);
  }

  // Billing provider (2010AA): configured providers, else the single PRACTICE_* env provider
  let billingProvider: BillingProviderForBatch | null = null;
  let providerTaxonomy = '';
  if (ctx.billingProviders) {
    const r = resolveBillingProvider(ctx.billingProviders, {
      explicit: claim.billingNpi,
      department: str(sd.department) || ctx.department,
      clinicianRole: ctx.clinicianRole,
      locationKeys: ctx.locationKeys,
    });
    if ('error' in r) errors.push(r.error);
    else {
      const { npi, name: bpName, taxId, address1, address2, city: bpCity, state: bpState, zip: bpZip, phone } = r.provider;
      providerTaxonomy = str(r.provider.taxonomyCode);
      billingProvider = { npi, name: bpName, taxId, address1, ...(address2 ? { address2 } : {}), city: bpCity, state: bpState, zip: bpZip, ...(phone ? { phone } : {}) };
      errors.push(...billingProviderProblems(billingProvider));
    }
  } else {
    const groupNpi = ctx.groupNpi ?? '';
    if (!isValidNpi(groupNpi)) errors.push('Billing NPI (PRACTICE_GROUP_NPI) is not a valid NPI');
    if (claim.billingNpi) {
      const npi = npiIn(claim.billingNpi);
      if (!npi) errors.push(`Billing provider "${claim.billingNpi}" on the claim has no NPI`);
      else if (npi !== groupNpi) {
        errors.push(`Claim billing NPI ${npi} differs from the Waystar billing NPI ${groupNpi}; without configured billing providers there is one billing NPI per file`);
      }
    }
    billingProvider = { ...envBillingProvider(), npi: groupNpi };
  }

  // Rendering provider (2310B) from the note's clinician (or the NPI picked in the claim editor), billed
  // under the legal name on the staff profile (H7: display names are never parsed). The billing
  // provider is an organization, so it can't render.
  const editorNpi = /^\d{10}$/.test(str(claim.renderingNpi)) ? str(claim.renderingNpi) : '';
  if (claim.renderingNpi && !editorNpi) errors.push(`Rendering provider "${claim.renderingNpi}" is not a 10-digit NPI`);
  let rendering: StaffForClaim | null = null;
  if (editorNpi) {
    rendering = ctx.providersByNpi?.[editorNpi] ?? (str(claim.renderingClinician?.npi) === editorNpi ? claim.renderingClinician! : null);
    if (!rendering) errors.push(`Rendering NPI ${editorNpi} picked on the claim is not a staff member of this practice`);
  } else if (!claim.renderingNpi) {
    rendering = claim.renderingClinician ?? null;
    if (!rendering) errors.push("Rendering provider is missing: the note's clinician could not be loaded");
  }
  const staffProblems = (who: StaffForClaim, label: string): string[] => {
    const p: string[] = [];
    const npi = str(who.npi);
    if (!npi) p.push(`${label} has no NPI on the staff profile`);
    else if (!isValidNpi(npi)) p.push(`${label} NPI ${npi} fails the NPI check digit`);
    if (!str(who.legalFirstName) || !str(who.legalLastName)) p.push(`${label}${npi ? ` (NPI ${npi})` : ''}: legal first and last name are missing on the staff profile`);
    if (who.taxonomyCode && !isTaxonomyCode(who.taxonomyCode)) p.push(`${label}: taxonomy "${who.taxonomyCode}" is not a NUCC taxonomy code`);
    return p;
  };
  // Supervised (pre-licensed) clinician: per-payer rule (B3)
  let supervising: StaffForClaim | null = null;
  const policies = payerPolicyDefaults(mapping?.claimFilingCode || filing);
  if (rendering?.preLicensed) {
    const policy = (str(mapping?.superviseeClaims) || policies.superviseeClaims) as SuperviseeClaimsPolicy;
    const sup = rendering.supervisor ?? null;
    if (policy === 'not_allowed') {
      errors.push(`${mapping?.payerName || payerName || 'This payer'} does not accept claims rendered by a pre-licensed clinician (payer setting "supervisee claims: not allowed")`);
    } else if (!sup) {
      errors.push('The rendering clinician is pre-licensed but has no supervisor on a supervision track (HR > Supervision)');
    } else {
      const supProblems = staffProblems(sup, 'Supervising provider');
      errors.push(...supProblems);
      if (policy === 'render_as_supervisor') rendering = sup;
      else if (policy === 'supervisee_with_2310D') supervising = sup;
      else errors.push(`Unknown supervisee claims setting "${policy}" on the payer mapping`);
    }
  }
  if (rendering) errors.push(...staffProblems(rendering, 'Rendering provider'));
  const renderingNpi = str(rendering?.npi);

  // Taxonomy (B4): 2000A from the billing provider (else practice settings), 2310B from the rendering staff profile
  const requireTaxonomy = mapping?.requireTaxonomy ?? policies.requireTaxonomy;
  const billingTaxonomy = providerTaxonomy || str(ctx.billingTaxonomy);
  const renderingTaxonomy = str(rendering?.taxonomyCode);
  if (billingTaxonomy && !isTaxonomyCode(billingTaxonomy)) errors.push(`Billing provider taxonomy "${billingTaxonomy}" is not a NUCC taxonomy code`);
  for (const [missing, what] of [
    [!billingTaxonomy, 'Billing provider taxonomy (PRV*BI) is missing: set it on the billing provider or the practice settings taxonomy codes'],
    [Boolean(rendering) && !renderingTaxonomy, `Rendering provider taxonomy (PRV*PE) is missing on the staff profile${renderingNpi ? ` for NPI ${renderingNpi}` : ''}`],
  ] as const) {
    if (missing) (requireTaxonomy ? errors : warnings).push(`${what}${requireTaxonomy ? ` (required by ${mapping?.payerName || 'this payer'})` : ''}`);
  }

  // Service lines
  const pos = str(claim.placeOfService) || str(sd.placeOfService);
  if (!/^\d{2}$/.test(pos)) errors.push('Place of service is missing');
  // Date of service = the note's practice date (never the appointment start or the note's creation time)
  const serviceDate = notePracticeDate(note?.dateOfService) ?? '';
  if (!serviceDate && note) errors.push("Date of service is missing on the progress note");

  let lines: ClaimLine[] = [];
  if (claim.serviceLines.length) {
    lines = submissionLinesFor(claim.serviceLines, claim.submissionData, {
      serviceDate: serviceDate || '0000-00-00',
      diagnosisCount: Math.max(1, diagnoses.length),
    }).map((l) => ({
      cpt: l.procedureCode.toUpperCase(),
      modifiers: l.modifiers,
      units: l.units,
      chargeAmount: l.chargeAmount,
      serviceDate: l.serviceDate,
      posCode: pos,
      diagnosisPointers: l.diagnosisPointers,
    }));
  } else {
    const [cpt, ...mods] = claim.cptCode.split('-');
    const stored = Array.isArray(sd.modifiers) ? (sd.modifiers as unknown[]).map((m) => str(m).toUpperCase()) : [];
    lines = [{
      cpt: cpt.toUpperCase(),
      modifiers: Array.from(new Set([...mods.map((m) => m.toUpperCase()), ...stored].filter(Boolean))),
      units: claim.units,
      chargeAmount: (claim.amountCents ?? 0) / 100,
      serviceDate,
      posCode: pos,
      // Claim-level pointers (claim drafted from a note's linked diagnoses), else the primary
      diagnosisPointers: claimLevelPointers(sd.diagnosisPointers, diagnoses.length),
    }];
  }

  // Telehealth (same trigger as the REST path: POS 02/10), plus the visit/note flags and 95/GT already on a line.
  // Modifier per payer mapping (default 95); POS must be 02 or 10.
  const telehealth =
    Boolean(claim.appointment?.isVirtual) ||
    Boolean(claim.noteTelehealth) ||
    sd.telehealth === true ||
    TELEHEALTH_POS.has(pos) ||
    lines.some((l) => (l.modifiers || []).some((m) => TELEHEALTH_MODS.has(m)));
  // Audio-only (H1): the payer's audio-only modifier replaces 95/GT; blocked when the payer does not allow it
  const audioOnly = Boolean(note?.audioOnly || claim.appointment?.audioOnly);
  if (telehealth || audioOnly) {
    if (!TELEHEALTH_POS.has(pos)) {
      errors.push(`Telehealth visit billed with place of service ${pos || '(none)'}: use 02 (telehealth outside the patient's home) or 10 (telehealth in the patient's home)`);
    }
    if (audioOnly) {
      const audio = (str(mapping?.audioOnlyModifier) || policies.audioOnlyModifier) as AudioOnlyPolicy;
      if (audio === 'not_allowed') {
        errors.push(`${mapping?.payerName || payerName || 'This payer'} is not set up to accept audio-only telehealth (payer setting "audio-only: not allowed"); confirm the payer's audio-only policy before billing`);
      } else {
        lines = lines.map((l) => ({ ...l, modifiers: [...telehealthModifiers(l.modifiers, 'none').filter((m) => m !== '93' && m !== 'FQ'), ...(audio === 'none' ? [] : [audio])] }));
      }
    } else {
      const policy = mapping?.telehealthModifier || '95';
      lines = lines.map((l) => ({ ...l, modifiers: telehealthModifiers(l.modifiers, policy) }));
    }
  }

  // Charge capture + coding edits (B6, B7): PRP blocked; minutes vs CPT, add-ons, NCCI pairs, per-day caps
  const prp = prpClaimBlock(lines.map((l) => l.cpt), ctx.prpBillingModel);
  if (prp) errors.push(prp);
  for (const f of codingEditFindings(lines.map((l) => ({ cpt: l.cpt, units: l.units })), {
    minutes: note?.durationMinutes ?? null,
    psychotherapyMinutes: note?.psychotherapyMinutes ?? null,
    sameDayCodes: ctx.sameDayCodes,
  })) {
    (f.severity === 'error' ? errors : warnings).push(f.message);
  }

  // 2310C service facility (B5): in-person visits at a location whose address differs from 2010AA
  let serviceFacility: ClaimForBatch['serviceFacility'];
  if (!(telehealth || audioOnly) && ctx.serviceLocation !== undefined) {
    const loc = ctx.serviceLocation;
    if (!loc) errors.push('Service location is missing: assign the client a location (Practice settings > Locations) with a street address');
    else {
      const l1 = str(loc.addressLine1);
      const lcity = str(loc.city);
      const lstate = str(loc.state).toUpperCase();
      const lzip = str(loc.postalCode).replace(/\D/g, '');
      if (!l1 || !lcity || !/^[A-Z]{2}$/.test(lstate) || !/^(\d{5}|\d{9})$/.test(lzip)) {
        errors.push(`Service location "${loc.name}" address is incomplete (street, city, 2-letter state and ZIP are required for 2310C)`);
      } else if (billingProvider) {
        const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const same = norm(l1) === norm(billingProvider.address1) && lzip.slice(0, 5) === billingProvider.zip.replace(/\D/g, '').slice(0, 5);
        if (!same) {
          const npi = str(loc.npi);
          const sendNpi = npi && loc.npiVerified && isValidNpi(npi) && !PLACEHOLDER_LOCATION_NPIS.has(npi) && npi !== billingProvider.npi;
          serviceFacility = {
            name: loc.name,
            ...(sendNpi ? { npi } : {}),
            address1: l1,
            ...(str(loc.addressLine2) ? { address2: str(loc.addressLine2) } : {}),
            city: lcity,
            state: lstate,
            zip: lzip,
          };
        }
      }
    }
  }

  // Timely filing (per payer mapping; limits are starting values to verify against each contract)
  const tf = claim.frequencyCode !== '8' ? timelyFiling(serviceDate || null, mapping?.filingLimitDays, ctx.today) : null;
  if (tf?.status === 'past') errors.push(`Timely filing: date of service ${serviceDate} is ${tf.age} days old, past ${mapping!.payerName}'s ${tf.limitDays}-day filing limit`);
  else if (tf?.status === 'near') warnings.push(`Timely filing: ${tf.daysLeft} day(s) left of ${mapping!.payerName}'s ${tf.limitDays}-day filing limit`);

  if (!lines.length) errors.push('Claim has no service lines');
  if (lines.length > 50) errors.push('A claim can carry at most 50 service lines');
  lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    if (!CPT_RE.test(l.cpt)) errors.push(`${n}: CPT/HCPCS "${l.cpt}" is not a 5-character code`);
    const badMods = (l.modifiers || []).filter((m) => !MOD_RE.test(m));
    if (badMods.length) errors.push(`${n}: invalid modifier(s) ${badMods.join(', ')}`);
    if ((l.modifiers || []).length > 4) errors.push(`${n}: more than 4 modifiers`);
    if (!Number.isInteger(l.units) || l.units < 1) errors.push(`${n}: units must be a whole number of at least 1`);
    if (!(l.chargeAmount > 0)) errors.push(`${n}: charge must be greater than $0`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.serviceDate) || l.serviceDate === '0000-00-00') errors.push(`${n}: date of service is missing`);
    if (!l.diagnosisPointers.length || l.diagnosisPointers.some((p) => p < 1 || p > diagnoses.length)) {
      errors.push(`${n}: diagnosis pointer does not match a claim diagnosis`);
    }
  });
  const lineCents = lines.reduce((t, l) => t + cents(l.chargeAmount), 0);
  if (claim.amountCents != null && claim.serviceLines.length && lineCents !== claim.amountCents) {
    errors.push('Service line charges do not add up to the claim total (re-save the claim lines)');
  }
  if (!claim.amountCents) errors.push('Claim charge is missing');

  // Prior authorization (2300 REF*G1): staff-entered number, else an approved auth covering payer + DOS + CPT
  let priorAuthNumber = str(claim.priorAuthNumber);
  if (!priorAuthNumber && ctx.priorAuths && serviceDate) {
    const pick = selectPriorAuth(ctx.priorAuths, { payerName, payerId, mapping, serviceDate, cpts: lines.map((l) => l.cpt) });
    if (pick.auth) {
      priorAuthNumber = str(pick.auth.authNumber);
      const units = authUnitsForLines(pick.auth.cptCodes, lines);
      // Units this claim already counted (a corrected claim resent under the same auth) are not counted twice
      const counted = obj(sd.priorAuthUsage);
      const already = !counted.releasedAt && str(counted.authNumber) === priorAuthNumber ? Number(counted.units) || 0 : 0;
      const used = Math.max(0, pick.auth.unitsUsed - already);
      if (pick.auth.unitsApproved > 0 && used + units > pick.auth.unitsApproved) {
        const msg = `Prior auth ${priorAuthNumber}: ${used} of ${pick.auth.unitsApproved} units already used; this claim needs ${units} more`;
        (mapping?.requiresPriorAuth ? errors : warnings).push(mapping?.requiresPriorAuth ? `${msg} (auth exhausted: request more units before billing)` : msg);
      }
    } else warnings.push(...pick.notes);
  }
  if (!priorAuthNumber && mapping?.requiresPriorAuth) {
    errors.push(`${mapping.payerName} requires prior authorization and no approved auth covers ${lines.map((l) => l.cpt).join(', ')} on ${serviceDate || 'the date of service'}`);
  }
  if (priorAuthNumber && !/^[A-Za-z0-9-]{1,50}$/.test(priorAuthNumber)) errors.push(`Prior authorization number "${priorAuthNumber}" has characters a payer will reject`);

  // COB (2320 / 2330A / 2330B / 2430): every earlier payer's adjudication
  const otherPayers: OtherPayerForBatch[] = [];
  const earlier: Array<'P' | 'S'> = responsibility === 'S' ? ['P'] : responsibility === 'T' ? ['P', 'S'] : [];
  for (const rank of earlier) {
    const label = `${RANK_LABEL[rank]} payer adjudication`;
    const cov = resolveCoverage(rank, claim, ctx, false);
    if (!cov.onFile || !cov.payerName) { errors.push(`${RANK_LABEL[rank]} insurance is not on file for the client (needed for COB)`); continue; }
    const era = ctx.priorAdjudications?.[rank] ?? null;
    const adj = era ?? readStaffCob(claim.submissionData, rank);
    if (!adj) {
      errors.push(`${label} is missing: no 835 on file for the ${RANK_LABEL[rank].toLowerCase()} claim, so enter what ${cov.payerName} paid and its adjustments (COB)`);
      continue;
    }
    errors.push(...cobProblems(adj, lines.map((l) => l.chargeAmount), label));
    const otherMapping = ctx.payerMappings ? findPayerMapping(ctx.payerMappings, cov.payerName) : null;
    const otherId = (str(adj.payerId) || otherMapping?.waystarPayerId || '').toUpperCase();
    if (!otherId) errors.push(`${label}: no Waystar payer ID for ${cov.payerName} (payer mapping)`);
    const otherFiling = (str(adj.claimFilingCode) || cov.claimFilingCode || otherMapping?.claimFilingCode || '').toUpperCase();
    if (!FILING_CODES.has(otherFiling)) errors.push(`${label}: claim filing code for ${cov.payerName} is missing or invalid`);
    if (!cov.memberId) errors.push(`${label}: member ID for ${cov.payerName} is missing`);
    if (!RELATIONSHIP_CODES[cov.relationship]) errors.push(`${label}: subscriber relationship "${cov.relationship}" is not an X12 relationship code`);
    const subName = cov.relationship === '18' ? (name ? { first: name.first, last: name.last, mi: name.mi } : null) : cov.subscriber;
    if (!subName?.first || !subName?.last) errors.push(`${label}: subscriber name for ${cov.payerName} is missing`);
    otherPayers.push({
      responsibility: rank,
      relationship: cov.relationship,
      ...(cov.groupNumber ? { groupNumber: cov.groupNumber } : {}),
      claimFilingCode: otherFiling,
      subscriberLastName: subName?.last || '',
      subscriberFirstName: subName?.first || '',
      ...(subName?.mi ? { subscriberMiddleInitial: subName.mi } : {}),
      memberId: cov.memberId,
      payerName: cov.payerName,
      payerId: otherId,
      paidAmount: adj.paidAmount,
      paidDate: adj.paidDate,
      adjustments: adj.adjustments,
      ...(adj.lines?.length ? { lines: adj.lines } : {}),
    });
  }

  if (errors.length) return { ok: false, errors, warnings };
  const dob = client.dateOfBirth!.toISOString().slice(0, 10);
  return {
    ok: true,
    warnings,
    claim: {
      claimId: claim.id,
      controlNumber,
      frequencyCode: frequency as '1' | '7' | '8',
      ...(frequency !== '1' ? { payerClaimControlNumber } : {}),
      payerResponsibility: responsibility,
      patientLastName: name!.last,
      patientFirstName: name!.first,
      ...(name!.mi ? { patientMiddleInitial: name!.mi } : {}),
      ...(name!.suffix ? { patientNameSuffix: name!.suffix } : {}),
      patientDob: dob,
      patientGender: gender!,
      patientAddress: { line1, ...(line2 ? { line2 } : {}), city, state, zip },
      memberId,
      ...(coverage.groupNumber ? { groupNumber: coverage.groupNumber } : {}),
      ...(subscriber ? { subscriber } : {}),
      payerName,
      payerId,
      claimFilingCode: filing,
      ...(priorAuthNumber ? { priorAuthNumber } : {}),
      billingProvider: billingProvider!,
      ...(billingTaxonomy ? { billingTaxonomy: billingTaxonomy.toUpperCase() } : {}),
      renderingNpi,
      renderingLastName: str(rendering!.legalLastName),
      renderingFirstName: str(rendering!.legalFirstName),
      ...(renderingTaxonomy ? { renderingTaxonomy: renderingTaxonomy.toUpperCase() } : {}),
      ...(serviceFacility ? { serviceFacility } : {}),
      ...(supervising ? { supervisingProvider: { npi: str(supervising.npi), lastName: str(supervising.legalLastName), firstName: str(supervising.legalFirstName) } } : {}),
      diagnoses: diagnoses.map((d) => d.replace('.', '')),
      lines,
      ...(otherPayers.length ? { otherPayers } : {}),
    },
  };
}

// ─── X12 reading ──────────────────────────────────────────────────────────────

export function splitX12(content: string): { segments: string[][]; component: string } {
  const text = content.replace(/^﻿/, '').trimStart();
  let element = '*';
  let terminator = '~';
  let component = ':';
  if (text.startsWith('ISA') && text.length >= 106) {
    element = text[3];
    component = text[104];
    terminator = text[105];
  }
  const segments = text
    .split(terminator)
    .map((s) => s.replace(/[\r\n]+/g, '').trim())
    .filter(Boolean)
    .map((s) => s.split(element));
  return { segments, component };
}

export function x12TransactionType(content: string): '999' | '277CA' | '835' | 'unknown' {
  const st = splitX12(content).segments.find((s) => s[0] === 'ST');
  if (!st) return 'unknown';
  if (st[1] === '999') return '999';
  if (st[1] === '277') return '277CA';
  if (st[1] === '835') return '835';
  return 'unknown';
}

export type Ack999Set = {
  groupControlNumber: string;
  stControlNumber: string;
  /** IK501: A accepted, E accepted with errors, R/M/W/X rejected */
  code: string;
  accepted: boolean;
  errors: string[];
};

export type Ack999Group = {
  groupControlNumber: string;
  /** AK901: A accepted, E accepted with errors, P partially accepted, R rejected */
  code: string;
  received: number | null;
  acceptedCount: number | null;
  sets: Ack999Set[];
};

const IK5_ACCEPTED = new Set(['A', 'E']);

export function parse999(content: string): { groups: Ack999Group[] } {
  const { segments } = splitX12(content);
  const groups: Ack999Group[] = [];
  let group: Ack999Group | null = null;
  let set: Ack999Set | null = null;
  for (const s of segments) {
    switch (s[0]) {
      case 'AK1':
        group = { groupControlNumber: s[2] || '', code: '', received: null, acceptedCount: null, sets: [] };
        groups.push(group);
        set = null;
        break;
      case 'AK2':
        if (!group) break;
        set = { groupControlNumber: group.groupControlNumber, stControlNumber: s[2] || '', code: '', accepted: false, errors: [] };
        group.sets.push(set);
        break;
      case 'IK3':
        set?.errors.push(`Segment ${s[1] || '?'} at position ${s[2] || '?'}${s[4] ? ` (error code ${s[4]})` : ''}`);
        break;
      case 'IK4':
        set?.errors.push(`Element ${s[1] || '?'}${s[3] ? ` (error code ${s[3]})` : ''}${s[4] ? ` value "${s[4]}"` : ''}`);
        break;
      case 'IK5':
        if (set) {
          set.code = s[1] || '';
          set.accepted = IK5_ACCEPTED.has(set.code);
          const codes = s.slice(2).filter(Boolean);
          if (codes.length) set.errors.push(`Transaction set error code(s) ${codes.join(', ')}`);
        }
        break;
      case 'AK9':
        if (group) {
          group.code = s[1] || '';
          group.received = s[3] ? Number(s[3]) : null;
          group.acceptedCount = s[4] ? Number(s[4]) : null;
        }
        break;
      default:
        break;
    }
  }
  return { groups };
}

export const STC_CATEGORY: Record<string, string> = {
  A0: 'Forwarded to another entity',
  A1: 'Received / acknowledged',
  A2: 'Accepted for adjudication',
  A3: 'Returned as unprocessable',
  A4: 'Not found',
  A5: 'Split claim',
  A6: 'Rejected for missing information',
  A7: 'Rejected for invalid information',
  A8: 'Rejected for relational field in error',
};

const STC_REJECTED = new Set(['A3', 'A4', 'A6', 'A7', 'A8']);

export type ClaimStatus277 = {
  /** TRN02 at the patient level = CLM01 of our 837 */
  claimRef: string;
  category: string;
  statusCode: string;
  entityCode: string;
  /** true accepted for adjudication, false rejected, null informational (A0/A1/A5) */
  accepted: boolean | null;
  reason: string;
  payerClaimNumber?: string;
  clearinghouseTrace?: string;
};

function stcText(s: string[], component: string): { category: string; statusCode: string; entityCode: string; reason: string } {
  const [category = '', statusCode = '', entityCode = ''] = (s[1] || '').split(component);
  const extra = [s[10], s[11]]
    .filter(Boolean)
    .map((c) => c.split(component).filter(Boolean).join('/'))
    .filter(Boolean);
  const label = STC_CATEGORY[category] || `Category ${category || '?'}`;
  const parts = [`${category} ${label}`, `status code ${statusCode || '?'}${entityCode ? ` (entity ${entityCode})` : ''}`];
  if (extra.length) parts.push(`also ${extra.join(', ')}`);
  if (s[12]) parts.push(s[12]);
  return { category, statusCode, entityCode, reason: parts.join('; ') };
}

/** Claim-level statuses from a 277CA. Line-level (after SVC) and provider-level STCs are not used for matching. */
export function parse277CA(content: string): { claims: ClaimStatus277[]; notes: string[] } {
  const { segments, component } = splitX12(content);
  const claims: ClaimStatus277[] = [];
  const notes: string[] = [];
  let level = '';
  let current: ClaimStatus277 | null = null;
  let inLine = false;
  for (const s of segments) {
    if (s[0] === 'HL') {
      level = s[3] || '';
      current = null;
      inLine = false;
      continue;
    }
    if (level === 'PT') {
      if (s[0] === 'TRN' && s[1] === '2') {
        current = { claimRef: s[2] || '', category: '', statusCode: '', entityCode: '', accepted: null, reason: '' };
        claims.push(current);
        inLine = false;
      } else if (s[0] === 'SVC') {
        inLine = true;
      } else if (s[0] === 'STC' && current && !inLine) {
        const t = stcText(s, component);
        if (!current.category) {
          Object.assign(current, t);
          current.accepted = t.category === 'A2' ? true : STC_REJECTED.has(t.category) ? false : null;
        } else {
          current.reason += ` | ${t.reason}`;
          if (STC_REJECTED.has(t.category)) current.accepted = false;
        }
      } else if (s[0] === 'REF' && current && !inLine) {
        if (s[1] === '1K') current.payerClaimNumber = s[2];
        if (s[1] === 'D9') current.clearinghouseTrace = s[2];
      }
    } else if (s[0] === 'STC' && (level === '19' || level === '20' || level === '21')) {
      const t = stcText(s, component);
      if (STC_REJECTED.has(t.category)) notes.push(`${level === '19' ? 'Billing provider' : 'Submitter/receiver'} level: ${t.reason}`);
    }
  }
  return { claims, notes };
}

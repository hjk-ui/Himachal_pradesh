/**
 * Client chart: sticky patient banner + shared chart access rules.
 * Pure module (no prisma import): the route passes a data source, tests pass a fake one.
 *
 * Access mirrors GET /api/clients/[id] so the banner never shows more than the chart:
 *  1. client must be in the viewer's org (the source only finds org-scoped clients);
 *  2. role must be able to open the client roster;
 *  3. protected record (SensitiveRecord / 42 CFR Part 2) needs PD/Admin, whitelist or a live
 *     break-glass grant, else the banner is "locked" (lock + alias only);
 *  4. caseload roles: on the client's care team, the same rule as the client list
 *     (orgScope.clientAccessWhere / careTeamClientWhereForRole): primary assigned clinician,
 *     treatment-team member, or recent / upcoming appointment clinician (primary care roles also
 *     a MedicalVisit; Peer Support assigned or treatment team); or a message thread
 *     forwarded/assigned to them, or a protected record they were explicitly cleared for.
 *  5. a verified Medical Director (src/lib/auth/medicalDirector.ts) skips the caseload rule
 *     (org-wide, like leadership) but NOT rule 3: protected records still need whitelist / break-glass.
 */
import type { ClientCareTeam } from '@/lib/clients/careTeam';
import { canChangePcp, type PcpReviewDisplay } from '@/lib/medical/pcpAssignment';
import { canAccessClientRoster, canSeeClientInsurance, canSeeClientRiskDetail } from '@/lib/clients/orgScope';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import type { AlertBucket } from '@/lib/clinical/sessionFrequency';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { PRONOUNS, claimReadiness, codeLabel, drfirstReadiness, type DemographicsInput } from '@/lib/clients/demographics';
import { canSeeCarelonFlag, REQUIREMENT_LABEL, type RequirementState } from '@/lib/consents/carelon/workflow';

const DAY_MS = 86_400_000;

// ─── Access ──────────────────────────────────────────────────────────────────

export type ChartViewer = { organizationId: string; userId: string; role: string };

/** none = not a protected record; allowed = protected, viewer cleared; locked = protected, not cleared */
export type SensitiveState = 'none' | 'allowed' | 'locked';

export type ChartAccessDecision =
  | { ok: true; sensitive: SensitiveState }
  | { ok: false; status: 403 | 404; reason: 'client_not_found' | 'role_not_permitted' | 'not_on_caseload' | 'sensitive_record' };

export function decideChartAccess(input: {
  role: string;
  userId: string;
  /** Viewer's organization (the Medical Director org-wide scope never crosses organizations) */
  organizationId?: string;
  client: { assignedToId: string | null } | null;
  sensitive: SensitiveState;
  /** only consulted for caseload roles viewing a client assigned to someone else */
  hasForwardedThread: () => Promise<boolean> | boolean;
  /** every caseload-scoped role: on the client's care team (role-correct clientAccessWhere branch) */
  hasCareTeamLink?: () => Promise<boolean> | boolean;
}): Promise<ChartAccessDecision> | ChartAccessDecision {
  if (!input.client) return { ok: false, status: 404, reason: 'client_not_found' };
  if (!canAccessClientRoster(input.role)) return { ok: false, status: 403, reason: 'role_not_permitted' };
  if (input.sensitive === 'locked') return { ok: false, status: 403, reason: 'sensitive_record' };
  // Caseload rule; a verified Medical Director is org-wide (isCaseloadScoped), like leadership.
  // The primary assignee passes without a query; everyone else on a caseload needs the care-team link
  const isPrimary = input.client.assignedToId != null && input.client.assignedToId === input.userId;
  if (
    isCaseloadScoped({ role: input.role, userId: input.userId, organizationId: input.organizationId }) &&
    !isPrimary &&
    input.sensitive !== 'allowed'
  ) {
    const ok: ChartAccessDecision = { ok: true, sensitive: input.sensitive };
    const denied: ChartAccessDecision = { ok: false, status: 403, reason: 'not_on_caseload' };
    const checks = [
      // Care team (treatment team member / appointment clinician / medical visit), same rule as the list
      ...(input.hasCareTeamLink ? [input.hasCareTeamLink] : []),
      input.hasForwardedThread,
    ];
    // First passing check wins; later checks only run when the earlier ones fail
    const run = (i: number): Promise<ChartAccessDecision> | ChartAccessDecision => {
      if (i >= checks.length) return denied;
      const r = checks[i]();
      return typeof r === 'boolean' ? (r ? ok : run(i + 1)) : r.then((yes) => (yes ? ok : run(i + 1)));
    };
    return run(0);
  }
  return { ok: true, sensitive: input.sensitive };
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** "•••• 1234" — never more than the last 4 */
export function maskMemberId(memberId: string | null | undefined): string | null {
  const v = (memberId ?? '').replace(/\s+/g, '');
  if (!v) return null;
  return v.length <= 4 ? `•••• ${v}` : `•••• ${v.slice(-4)}`;
}

/** Whole years on `now` (UTC dates), or null */
export function ageOn(dob: Date | null | undefined, now: Date): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** "Jane D." — first name + last initial, for document.title / breadcrumbs */
export function shortDisplayName(parts: { name: string; legalFirstName?: string | null; legalLastName?: string | null }): string {
  const first = (parts.legalFirstName || '').trim();
  const last = (parts.legalLastName || '').trim();
  if (first && last) return `${first} ${last.charAt(0).toUpperCase()}.`;
  const words = (parts.name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]} ${words[words.length - 1].charAt(0).toUpperCase()}.`;
  return words[0] || 'Client';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// Authorizations ──────────────────────────────────────────────────────────────

export type AuthRow = {
  id: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
};

export const AUTH_LOW_VISITS = 3;
export const AUTH_ENDING_DAYS = 14;

export type AuthSummary = {
  id: string;
  payer: string;
  authNumber: string | null;
  cptCodes: string[];
  unitsApproved: number;
  unitsUsed: number;
  unitsRemaining: number;
  startDate: string | null;
  endDate: string | null;
  /** whole days from today to the end date (0 = ends today); null when open-ended */
  daysToEnd: number | null;
  lowVisits: boolean;
  endingSoon: boolean;
  warn: boolean;
};

/** An APPROVED auth whose date window contains today (open ends count as open). */
export function isActiveAuth(a: Pick<AuthRow, 'status' | 'startDate' | 'endDate'>, now: Date): boolean {
  if (a.status !== 'APPROVED') return false;
  const today = iso(now) as string;
  if (a.startDate && (iso(a.startDate) as string) > today) return false;
  if (a.endDate && (iso(a.endDate) as string) < today) return false;
  return true;
}

export function summarizeAuth(a: AuthRow, now: Date): AuthSummary {
  const remaining = Math.max(0, (a.unitsApproved ?? 0) - (a.unitsUsed ?? 0));
  const end = iso(a.endDate);
  const daysToEnd = end ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${iso(now)}T00:00:00Z`)) / DAY_MS) : null;
  const lowVisits = remaining < AUTH_LOW_VISITS;
  const endingSoon = daysToEnd != null && daysToEnd <= AUTH_ENDING_DAYS;
  return {
    id: a.id,
    payer: a.payer,
    authNumber: a.authNumber,
    cptCodes: a.cptCodes,
    unitsApproved: a.unitsApproved,
    unitsUsed: a.unitsUsed,
    unitsRemaining: remaining,
    startDate: iso(a.startDate),
    endDate: end,
    daysToEnd,
    lowVisits,
    endingSoon,
    warn: lowVisits || endingSoon,
  };
}

/** Active auths, soonest-ending first (open-ended last). The banner shows the first. */
export function activeAuthSummaries(rows: AuthRow[], now: Date): AuthSummary[] {
  return rows
    .filter((a) => isActiveAuth(a, now))
    .map((a) => summarizeAuth(a, now))
    .sort((x, y) => (x.endDate ?? '9999-12-31').localeCompare(y.endDate ?? '9999-12-31'));
}

// Allergies ───────────────────────────────────────────────────────────────────

const NKA_RE = /^(nka|nkda|nkma|no known (drug |medication )?allerg(y|ies)( documented)?)\.?$/i;
const INACTIVE_ALLERGY = new Set(['inactive', 'resolved', 'entered in error', 'deleted']);

export type AllergyRow = { allergen: string; reaction: string | null; severity: string | null; status: string | null; source: string | null };

export type AllergySummary =
  | { status: 'list'; items: { allergen: string; reaction: string | null; severity: string | null; source: 'drfirst' | 'altrixs' }[] }
  | { status: 'nka' }
  | { status: 'none' };

/** list = active allergies; nka = only an explicit "No known allergies" entry; none = nothing charted */
export function summarizeAllergies(rows: AllergyRow[]): AllergySummary {
  const active = rows.filter((r) => r.allergen?.trim() && !INACTIVE_ALLERGY.has((r.status || '').toLowerCase()));
  const real = active.filter((r) => !NKA_RE.test(r.allergen.trim()));
  if (real.length) {
    return {
      status: 'list',
      items: real.map((r) => ({
        allergen: r.allergen.trim(),
        reaction: r.reaction?.trim() || null,
        severity: r.severity?.trim() || null,
        source: r.source === 'drfirst' ? 'drfirst' : 'altrixs',
      })),
    };
  }
  return active.length ? { status: 'nka' } : { status: 'none' };
}

// Risk ────────────────────────────────────────────────────────────────────────

export type RiskLevelLower = 'high' | 'medium' | 'low';
const RANK: Record<RiskLevelLower, number> = { low: 0, medium: 1, high: 2 };
const lower = (v: string | null | undefined): RiskLevelLower | null => {
  const s = (v || '').toLowerCase();
  if (s === 'high' || s === 'imminent') return 'high';
  if (s === 'medium' || s === 'moderate') return 'medium';
  if (s === 'low') return 'low';
  return null;
};

export type RiskAlertRow = { id: string; type: string; severity: string; reviewed: boolean; createdAt: Date };
export type CssrsRow = { id: string; instrumentName: string; totalScore: number | null; severity: string | null; safetyFlagged: boolean; createdAt: Date };

export type RiskSummary = {
  /** highest of: chart risk level, any unreviewed risk alert, a safety-flagged latest C-SSRS */
  level: RiskLevelLower;
  chartLevel: RiskLevelLower;
  openAlerts: number;
  latestAlert: { id: string; type: string; severity: RiskLevelLower; reviewed: boolean; createdAt: string } | null;
  latestCssrs: { id: string; instrumentName: string; totalScore: number | null; severity: string | null; safetyFlagged: boolean; createdAt: string } | null;
};

export function summarizeRisk(input: { riskLevel: string; alerts: RiskAlertRow[]; latestCssrs: CssrsRow | null }): RiskSummary {
  const chartLevel = lower(input.riskLevel) ?? 'low';
  let level = chartLevel;
  const bump = (l: RiskLevelLower | null) => {
    if (l && RANK[l] > RANK[level]) level = l;
  };
  const sorted = [...input.alerts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const open = sorted.filter((a) => !a.reviewed);
  for (const a of open) bump(lower(a.severity));
  const c = input.latestCssrs;
  if (c?.safetyFlagged) bump('high');
  const latest = sorted[0];
  return {
    level,
    chartLevel,
    openAlerts: open.length,
    latestAlert: latest
      ? { id: latest.id, type: latest.type, severity: lower(latest.severity) ?? 'low', reviewed: latest.reviewed, createdAt: latest.createdAt.toISOString() }
      : null,
    latestCssrs: c
      ? { id: c.id, instrumentName: c.instrumentName, totalScore: c.totalScore, severity: c.severity, safetyFlagged: c.safetyFlagged, createdAt: c.createdAt.toISOString() }
      : null,
  };
}

/** SUD diagnosis on the chart (same rule as the chart's Part 2 notice) */
export function hasSudDiagnosis(c: { primaryDiagnosisCode?: string | null; primaryDiagnosis?: string | null; secondaryDiagnoses?: string | null }): boolean {
  const combined = `${c.primaryDiagnosisCode || ''} ${c.primaryDiagnosis || ''} ${c.secondaryDiagnoses || ''}`;
  return /f1[0-689]|substance|alcohol|opioid|cannabis|sedative|cocaine|\bsud\b/i.test(combined);
}

// ─── Banner ──────────────────────────────────────────────────────────────────

export type BannerClientRow = {
  id: string;
  name: string;
  legalFirstName: string | null;
  middleInitial: string | null;
  legalLastName: string | null;
  mrn: string | null;
  dateOfBirth: Date | null;
  status: string;
  riskLevel: string;
  assignedToId: string | null;
  assignedToName: string | null;
  locationName: string | null;
  insurancePayer: string | null;
  insuranceMemberId: string | null;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  secondaryDiagnoses: string | null;
  preferredName?: string | null;
  /** LOINC pronoun answer code */
  pronouns?: string | null;
} & Partial<Pick<DemographicsInput,
  'needsNameReview' | 'administrativeSex' | 'gender' | 'addressLine1' | 'addressStatus' | 'city' | 'state' | 'postalCode' | 'phone' | 'insuranceType' | 'medicaidId'
>>;

export type BannerSessionFrequency = {
  bucket: AlertBucket;
  recommendation: string;
  /** Therapy cadence status text (the banner tracks therapy; med management is separate) */
  statusDetail: string;
  /** CadenceStatus of the therapy cadence (optional: older callers) */
  status?: string;
  /** Last attended therapy session / medication management visit (YYYY-MM-DD, any evidence: visits, claims, signed notes, Valant charges) */
  therapyLastAttended?: string | null;
  medLastAttended?: string | null;
  therapyNextScheduled?: string | null;
  medNextScheduled?: string | null;
} | null;

export type ChartBannerSource = {
  /** org-scoped lookup; null when the client is not in this org */
  findClient(organizationId: string, clientId: string): Promise<BannerClientRow | null>;
  /** protected-record state for this viewer (implementations log the access) */
  sensitiveState(viewer: ChartViewer, clientId: string): Promise<SensitiveState>;
  /** alias shown on a locked banner */
  sensitiveAlias(organizationId: string, clientId: string): Promise<string | null>;
  hasForwardedThread(viewer: ChartViewer, clientId: string): Promise<boolean>;
  /** caseload roles: role-correct care-team link, same rule as the client list (see decideChartAccess) */
  hasCareTeamLink?(viewer: ChartViewer, clientId: string): Promise<boolean>;
  allergies(clientId: string): Promise<AllergyRow[]>;
  priorAuths(organizationId: string, clientId: string): Promise<AuthRow[]>;
  riskAlerts(organizationId: string, clientId: string): Promise<RiskAlertRow[]>;
  latestCssrs(organizationId: string, clientId: string): Promise<CssrsRow | null>;
  nextAppointment(clientId: string, now: Date): Promise<{ id: string; startsAt: Date; type: string; clinicianName: string | null; isVirtual: boolean } | null>;
  /** Practice time zone (PracticeSettings.timeZone); defaults to America/New_York when absent. */
  practiceTimeZone?(organizationId: string): Promise<string>;
  /** patient balance in cents (positive = owes, negative = credit) */
  balanceCents(organizationId: string, clientId: string): Promise<number | null>;
  sessionFrequency(viewer: ChartViewer, clientId: string): Promise<BannerSessionFrequency>;
  /**
   * Primary-care patient: visit / vitals / charge on file, created by primary-care intake, or
   * imported Valant "Family Practice" rows (medicalProgram.primaryCarePatientWhere). Drives the
   * chart's Medical tab group. Location alone never counts.
   */
  isPrimaryCarePatient?(clientId: string): Promise<boolean>;
  /**
   * Primary care provider (src/lib/medical/pcpAssignment.ts: the "Primary Care Provider" care team
   * member, else the intake text). Asked only for primary-care patients. Separate from the
   * behavioral health clinician (assignedToId).
   */
  primaryCareProvider?(organizationId: string, clientId: string): Promise<{ id: string | null; name: string } | null>;
  /**
   * No staff PCP of record: "PCP: to confirm" with every contender (AMBIGUOUS) or "PCP: not
   * assigned" (NO_EVIDENCE); null otherwise (pcpAssignment.pcpReviewDisplay). Primary care only.
   */
  pcpReview?(organizationId: string, clientId: string): Promise<PcpReviewDisplay | null>;
  /** Primary + other care team members (src/lib/clients/careTeam.ts); asked only after access is granted */
  careTeam?(organizationId: string, clientId: string): Promise<ClientCareTeam | null>;
  /**
   * Carelon non-overlap attestation requirement (Maryland Medicaid clients only; see
   * src/lib/consents/carelon/medicaid.ts). null / not_required = no flag.
   */
  carelonAttestation?(organizationId: string, clientId: string): Promise<RequirementState | null>;
  /**
   * Required consents that need action (missing / expired / revoked / needs re-sign / declined),
   * from the consent library (src/lib/consents/library/status.ts). Empty / null = no flag.
   */
  consentGaps?(organizationId: string, clientId: string): Promise<{ title: string; state: string }[] | null>;
};

export type LockedBanner = {
  locked: true;
  id: string;
  displayName: string;
  canRequestBreakGlass: true;
};

export type ChartBanner = {
  locked: false;
  id: string;
  name: string;
  legalName: string | null;
  shortName: string;
  preferredName: string | null;
  /** Pronoun label (e.g. "she/her/hers"); null when not recorded or declined */
  pronouns: string | null;
  /**
   * Required items missing for e-prescribing (DrFirst) / claims (837P), as labels
   * (src/lib/clients/demographics.ts). null for Peer Support (minimum necessary).
   */
  demographics: { erxMissing: string[]; claimsMissing: string[] } | null;
  dateOfBirth: string | null;
  age: number | null;
  mrn: string | null;
  status: string;
  assignedClinician: { id: string; name: string } | null;
  /** Primary first, then the other care team members; a non-clinical assignee shows as Unassigned */
  careTeam?: ClientCareTeam | null;
  location: string | null;
  payer: { name: string; memberIdMasked: string | null } | null;
  allergies: AllergySummary;
  risk: RiskSummary;
  protection: { protectedRecord: boolean; sudDiagnosis: boolean };
  /** null when the viewer's role cannot see billing */
  balance: { cents: number } | null;
  billingVisible: boolean;
  authorization: (AuthSummary & { activeCount: number }) | null;
  /** startsAt is ISO UTC; render it on the practice clock in `timeZone` (never the browser zone). */
  nextAppointment: { id: string; startsAt: string; timeZone: string; type: string; clinicianName: string | null; isVirtual: boolean } | null;
  sessionFrequency: BannerSessionFrequency;
  /** primary-care patient (records, intake marker or Valant Family Practice rows); see src/lib/medical/medicalProgram.ts */
  primaryCarePatient: boolean;
  /** PCP for primary-care patients (null = not set or not a primary-care patient); id null = intake text only */
  primaryCareProvider: { id: string | null; name: string } | null;
  /** No staff PCP: to confirm (with contenders) / not assigned; null when set or not primary care */
  pcpReview: PcpReviewDisplay | null;
  /** Viewer may set the PCP (pcpAssignment.canChangePcp; the PUT /pcp route enforces it again) */
  canSetPcp: boolean;
  /**
   * "Carelon non-overlap attestation needed": Maryland Medicaid client without a current completed
   * attestation (or a new one requested). null when not needed or the role does not manage it.
   */
  carelonAttestation: { state: RequirementState; label: string } | null;
  /** "Required consents missing": count + titles; null when none or the role does not manage consents */
  consentGaps: { count: number; titles: string[] } | null;
};

export type BannerResult =
  | { ok: true; banner: ChartBanner | LockedBanner }
  | { ok: false; status: 403 | 404; reason: string };

function legalNameOf(c: BannerClientRow): string | null {
  const first = (c.legalFirstName || '').trim();
  const last = (c.legalLastName || '').trim();
  if (!first || !last) return null;
  const mi = (c.middleInitial || '').replace(/\./g, '').trim().charAt(0).toUpperCase();
  return `${last}, ${first}${mi ? ` ${mi}.` : ''}`;
}

/** Labels of the required demographic items missing for e-prescribing / claims */
export function demographicsGaps(client: BannerClientRow, now = new Date()): { erxMissing: string[]; claimsMissing: string[] } {
  const required = (r: { missing: Array<{ label: string; severity: string }> }) => r.missing.filter((g) => g.severity === 'required').map((g) => g.label);
  return {
    erxMissing: required(drfirstReadiness(client, now)),
    claimsMissing: required(claimReadiness(client, now)),
  };
}

/** Banner payload for one client, after org / role / caseload / Part 2 checks. */
export async function loadChartBanner(
  source: ChartBannerSource,
  viewer: ChartViewer & { billingVisible: boolean },
  clientId: string,
  now = new Date()
): Promise<BannerResult> {
  const client = await source.findClient(viewer.organizationId, clientId);
  if (!client) return { ok: false, status: 404, reason: 'client_not_found' };
  if (!canAccessClientRoster(viewer.role)) return { ok: false, status: 403, reason: 'role_not_permitted' };

  const sensitive = await source.sensitiveState(viewer, client.id);
  if (sensitive === 'locked') {
    const alias = await source.sensitiveAlias(viewer.organizationId, client.id);
    return { ok: true, banner: { locked: true, id: client.id, displayName: alias || 'Protected Client', canRequestBreakGlass: true } };
  }

  const decision = await decideChartAccess({
    role: viewer.role,
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    client,
    sensitive,
    hasForwardedThread: () => source.hasForwardedThread(viewer, client.id),
    hasCareTeamLink: source.hasCareTeamLink ? () => source.hasCareTeamLink!(viewer, client.id) : undefined,
  });
  if (decision.ok === false) return { ok: false, status: decision.status, reason: decision.reason };

  const showCarelon = canSeeCarelonFlag(viewer.role) && canSeeClientInsurance(viewer.role) && Boolean(source.carelonAttestation);
  const showConsents = showCarelon && Boolean(source.consentGaps);
  const [allergies, auths, alerts, cssrs, next, balance, freq, medical, timeZone, carelon, gaps, careTeam] = await Promise.all([
    source.allergies(client.id),
    source.priorAuths(viewer.organizationId, client.id),
    source.riskAlerts(viewer.organizationId, client.id),
    source.latestCssrs(viewer.organizationId, client.id),
    source.nextAppointment(client.id, now),
    viewer.billingVisible ? source.balanceCents(viewer.organizationId, client.id) : Promise.resolve(null),
    source.sessionFrequency(viewer, client.id).catch(() => null),
    source.isPrimaryCarePatient ? source.isPrimaryCarePatient(client.id) : Promise.resolve(false),
    source.practiceTimeZone
      ? source.practiceTimeZone(viewer.organizationId).catch(() => DEFAULT_PRACTICE_TIME_ZONE)
      : Promise.resolve(DEFAULT_PRACTICE_TIME_ZONE),
    showCarelon ? source.carelonAttestation!(viewer.organizationId, client.id).catch(() => null) : Promise.resolve(null),
    showConsents ? source.consentGaps!(viewer.organizationId, client.id).catch(() => null) : Promise.resolve(null),
    source.careTeam ? source.careTeam(viewer.organizationId, client.id).catch(() => null) : Promise.resolve(null),
  ]);

  const [pcp, pcpReview] = medical
    ? await Promise.all([
        source.primaryCareProvider ? source.primaryCareProvider(viewer.organizationId, client.id).catch(() => null) : Promise.resolve(null),
        source.pcpReview ? source.pcpReview(viewer.organizationId, client.id).catch(() => null) : Promise.resolve(null),
      ])
    : [null, null];
  const active = activeAuthSummaries(auths, now);
  // Peer Support (minimum necessary): no payer / authorization, no C-SSRS score or alert detail,
  // no SUD flag. They keep the overall risk level so a high-risk client still shows the safety flag.
  const peer = !canSeeClientInsurance(viewer.role);
  // Risk detail (C-SSRS score, alert text, open-alert count) and the SUD (Part 2) flag: the treating
  // BH roles only (Risk Alerts page roles). Front Desk, Office Manager, Billing and primary care keep
  // the generic risk level, which is the safety flag.
  const riskHidden = !canSeeClientRiskDetail(viewer.role);
  const risk = summarizeRisk({ riskLevel: client.riskLevel, alerts, latestCssrs: cssrs });
  return {
    ok: true,
    banner: {
      locked: false,
      id: client.id,
      name: client.name,
      legalName: legalNameOf(client),
      shortName: shortDisplayName(client),
      preferredName: client.preferredName?.trim() || null,
      pronouns: client.pronouns && !['ASKU', 'OTH', 'UNK'].includes(client.pronouns) ? codeLabel(PRONOUNS, client.pronouns) : null,
      demographics: peer ? null : demographicsGaps(client, now),
      dateOfBirth: iso(client.dateOfBirth),
      age: ageOn(client.dateOfBirth, now),
      mrn: client.mrn,
      status: client.status,
      assignedClinician: client.assignedToId ? { id: client.assignedToId, name: client.assignedToName || 'Assigned clinician' } : null,
      careTeam,
      location: client.locationName,
      payer: !peer && client.insurancePayer ? { name: client.insurancePayer, memberIdMasked: maskMemberId(client.insuranceMemberId) } : null,
      allergies: summarizeAllergies(allergies),
      risk: peer || riskHidden ? { ...risk, openAlerts: 0, latestAlert: null, latestCssrs: null } : risk,
      protection: { protectedRecord: sensitive === 'allowed', sudDiagnosis: !peer && !riskHidden && hasSudDiagnosis(client) },
      balance: viewer.billingVisible && balance != null ? { cents: balance } : null,
      billingVisible: viewer.billingVisible,
      authorization: !peer && active.length ? { ...active[0], activeCount: active.length } : null,
      nextAppointment: next
        ? { id: next.id, startsAt: next.startsAt.toISOString(), timeZone, type: next.type, clinicianName: next.clinicianName, isVirtual: next.isVirtual }
        : null,
      sessionFrequency: freq,
      primaryCarePatient: medical,
      primaryCareProvider: pcp,
      pcpReview: pcp?.id ? null : pcpReview,
      canSetPcp: medical && canChangePcp(viewer.role),
      carelonAttestation: carelon && carelon !== 'not_required' && carelon !== 'complete' ? { state: carelon, label: REQUIREMENT_LABEL[carelon] } : null,
      consentGaps: gaps && gaps.length ? { count: gaps.length, titles: gaps.slice(0, 4).map((g) => g.title) } : null,
    },
  };
}

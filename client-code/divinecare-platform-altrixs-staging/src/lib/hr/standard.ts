/**
 * HR standard: pure rules shared by the HR APIs, the HR hub and tests (no Prisma, no I/O).
 *
 *  - Expiration engine: every dated item is current / due in 60 days / due in 30 days / expired.
 *  - CAQH re-attestation (default 120 days) and exclusion screening (default monthly) due dates.
 *  - Onboarding / offboarding checklist templates and task generation by role and worker type.
 *  - Time off: Maryland Healthy Working Families Act style sick accrual (1 h per N worked, N from
 *    HR settings, "practice policy, confirm") and PTO per-period accrual with caps.
 *  - Field visibility by relationship (self / manager / HR / leadership / office manager / peer).
 *  - AI outputs are drafts: never saved by the AI call itself.
 *
 * Regulatory numbers that are not well established in code are settings (HrSettings) and start
 * null; the UI labels them "practice policy, confirm".
 */
import { addBusinessDays } from '@/lib/workflows/dates';

// ─── Dates (YYYY-MM-DD, zone independent) ────────────────────────────────────

export function ymd(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function utc(ymdStr: string): number {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

export function addDaysYmd(value: string, days: number): string {
  return new Date(utc(value) + days * 86_400_000).toISOString().slice(0, 10);
}

export function addMonthsYmd(value: string, months: number): string {
  const [y, m, d] = value.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Date-only column value for Prisma (noon UTC avoids off-by-one in any zone). */
export function dateOnlyValue(value: string | null | undefined): Date | null {
  const v = ymd(value ?? null);
  return v ? new Date(`${v}T12:00:00.000Z`) : null;
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export const HR_LEADERSHIP_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
/** HR administrators: full HR record incl. compensation and discipline */
export const HR_ADMIN_ROLES = [...HR_LEADERSHIP_ROLES, 'HR'] as const;
/** Credentialing / training operations (no compensation, discipline or personal data) */
export const HR_CREDENTIALING_ROLES = [...HR_ADMIN_ROLES, 'OFFICE_MANAGER'] as const;

export const CLINICAL_ROLES = [
  'THERAPIST',
  'CLINICIAN',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CRISIS_RESPONDER',
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
] as const;
export const LICENSED_ROLES = ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'] as const;
export const PRESCRIBER_ROLES = ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'] as const;

function norm(role: string | null | undefined): string {
  return String(role || '').toUpperCase();
}
export const isHrAdminRole = (r: string | null | undefined) => (HR_ADMIN_ROLES as readonly string[]).includes(norm(r));
export const isHrLeadershipRole = (r: string | null | undefined) => (HR_LEADERSHIP_ROLES as readonly string[]).includes(norm(r));
export const isCredentialingRole = (r: string | null | undefined) => (HR_CREDENTIALING_ROLES as readonly string[]).includes(norm(r));
export const isClinicalRole = (r: string | null | undefined) => (CLINICAL_ROLES as readonly string[]).includes(norm(r));
export const isLicensedRole = (r: string | null | undefined) => (LICENSED_ROLES as readonly string[]).includes(norm(r));
export const isPrescriberRole = (r: string | null | undefined) => (PRESCRIBER_ROLES as readonly string[]).includes(norm(r));

// ─── Visibility ──────────────────────────────────────────────────────────────

export type HrRelationship = 'leadership' | 'hr' | 'office_manager' | 'self' | 'manager' | 'peer';

export type HrFieldAccess = {
  /** Directory: name, title, department, location, work contact, manager */
  directory: boolean;
  /** DOB, home address, personal contact, emergency contacts */
  personal: boolean;
  employment: boolean;
  /** Pay type / rate / payroll reference: HR + leadership only */
  compensation: boolean;
  /** Separation type / rehire eligibility */
  separation: boolean;
  credentials: boolean;
  documents: boolean;
  training: boolean;
  timeOff: boolean;
  performance: boolean;
  /** Corrective action: HR + leadership (the employee sees records shared with them) */
  discipline: boolean;
  editRecord: boolean;
  editCredentials: boolean;
};

/**
 * Relationship of the viewer to an employee record. HR / leadership roles win over self so an HR
 * manager viewing their own record still sees it as HR.
 */
export function hrRelationship(
  viewer: { userId: string; role: string | null | undefined },
  subject: { userId: string; managerUserId?: string | null; clinicalSupervisorUserId?: string | null },
): HrRelationship {
  const r = norm(viewer.role);
  if ((HR_LEADERSHIP_ROLES as readonly string[]).includes(r)) return 'leadership';
  if (r === 'HR') return 'hr';
  if (viewer.userId === subject.userId) return 'self';
  if (subject.managerUserId === viewer.userId || subject.clinicalSupervisorUserId === viewer.userId) return 'manager';
  if (r === 'OFFICE_MANAGER') return 'office_manager';
  return 'peer';
}

export function hrFieldAccess(rel: HrRelationship): HrFieldAccess {
  const none: HrFieldAccess = {
    directory: true,
    personal: false,
    employment: false,
    compensation: false,
    separation: false,
    credentials: false,
    documents: false,
    training: false,
    timeOff: false,
    performance: false,
    discipline: false,
    editRecord: false,
    editCredentials: false,
  };
  switch (rel) {
    case 'leadership':
    case 'hr':
      return {
        directory: true,
        personal: true,
        employment: true,
        compensation: true,
        separation: true,
        credentials: true,
        documents: true,
        training: true,
        timeOff: true,
        performance: true,
        discipline: true,
        editRecord: true,
        editCredentials: true,
      };
    case 'office_manager':
      // Credentialing + training operations only: no pay, payroll, discipline or personal data.
      return { ...none, employment: true, credentials: true, training: true, editCredentials: true };
    case 'self':
      return { ...none, personal: true, employment: true, credentials: true, documents: true, training: true, timeOff: true, performance: true };
    case 'manager':
      // A supervisor sees their reports' non-sensitive work data.
      return { ...none, employment: true, credentials: true, training: true, timeOff: true, performance: true };
    default:
      return none;
  }
}

/** Remove fields the viewer may not see from a serialized employee record (server-side). */
export function redactEmployeeRecord<T extends Record<string, unknown>>(record: T, access: HrFieldAccess): T {
  const out: Record<string, unknown> = { ...record };
  const drop = (keys: string[]) => keys.forEach((k) => delete out[k]);
  if (!access.personal) {
    drop([
      'dateOfBirth',
      'personalEmail',
      'personalPhone',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'postalCode',
      'emergencyContacts',
      'legalMiddleName',
    ]);
  }
  if (!access.compensation) drop(['payType', 'payRateCents', 'compEffectiveOn', 'payrollSystem', 'payrollExternalId']);
  if (!access.separation) drop(['separationType', 'rehireEligible']);
  if (!access.employment) drop(['fte', 'workerType', 'employeeNumber', 'hireDate', 'terminationDate', 'caqhId', 'medicaidProviderId']);
  return out as T;
}

// ─── Expiration engine ───────────────────────────────────────────────────────

export type ExpiryStatus = 'current' | 'due_60' | 'due_30' | 'expired' | 'missing' | 'no_expiry';

export type ExpiryWindows = { dueSoonDays: number; urgentDays: number };
export const DEFAULT_WINDOWS: ExpiryWindows = { dueSoonDays: 60, urgentDays: 30 };

export function expiryStatus(
  expiresOn: string | null | undefined,
  today: string,
  windows: ExpiryWindows = DEFAULT_WINDOWS,
): { status: ExpiryStatus; daysLeft: number | null } {
  const exp = ymd(expiresOn ?? null);
  if (!exp) return { status: 'no_expiry', daysLeft: null };
  const daysLeft = daysBetween(today, exp);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= windows.urgentDays) return { status: 'due_30', daysLeft };
  if (daysLeft <= windows.dueSoonDays) return { status: 'due_60', daysLeft };
  return { status: 'current', daysLeft };
}

export function expiryLabel(status: ExpiryStatus, windows: ExpiryWindows = DEFAULT_WINDOWS): string {
  switch (status) {
    case 'current':
      return 'Current';
    case 'due_60':
      return `Due within ${windows.dueSoonDays} days`;
    case 'due_30':
      return `Due within ${windows.urgentDays} days`;
    case 'expired':
      return 'Expired';
    case 'missing':
      return 'Missing';
    default:
      return 'No expiry';
  }
}

export function expiryTone(status: ExpiryStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'current') return 'success';
  if (status === 'due_60' || status === 'due_30') return 'warning';
  if (status === 'expired' || status === 'missing') return 'danger';
  return 'neutral';
}

/** CAQH ProView re-attestation: due `days` (default 120) after the last attestation. */
export function caqhNextDue(lastAttestedOn: string | null | undefined, days = 120): string | null {
  const last = ymd(lastAttestedOn ?? null);
  return last ? addDaysYmd(last, days) : null;
}

export function caqhStatus(
  input: { caqhId?: string | null; lastAttestedOn?: string | null },
  today: string,
  settings: { caqhAttestationDays?: number } & Partial<ExpiryWindows> = {},
): { status: ExpiryStatus | 'not_applicable'; dueOn: string | null; daysLeft: number | null } {
  if (!input.caqhId) return { status: 'not_applicable', dueOn: null, daysLeft: null };
  const dueOn = caqhNextDue(input.lastAttestedOn, settings.caqhAttestationDays ?? 120);
  if (!dueOn) return { status: 'missing', dueOn: today, daysLeft: 0 };
  // CAQH reminders run on a short cycle: 30 / 14 days before.
  const st = expiryStatus(dueOn, today, { dueSoonDays: 30, urgentDays: 14 });
  return { status: st.status, dueOn, daysLeft: st.daysLeft };
}

export const EXCLUSION_SOURCES = [
  {
    key: 'OIG_LEIE',
    label: 'OIG LEIE',
    description: 'HHS-OIG List of Excluded Individuals / Entities',
    url: 'https://exclusions.oig.hhs.gov/',
  },
  {
    key: 'SAM_GOV',
    label: 'SAM.gov',
    description: 'System for Award Management exclusions',
    url: 'https://sam.gov/',
  },
  {
    key: 'MD_MEDICAID',
    label: 'Maryland Medicaid sanctions',
    description: 'Maryland Medicaid excluded / sanctioned providers (Maryland Department of Health OIG). Confirm the current list URL.',
    url: 'https://health.maryland.gov/oig/',
  },
] as const;
export type ExclusionSource = (typeof EXCLUSION_SOURCES)[number]['key'];
export const EXCLUSION_SOURCE_KEYS = EXCLUSION_SOURCES.map((s) => s.key) as ExclusionSource[];

/**
 * Exclusion screening due date per source: last check + interval (default 30 days, monthly).
 * Never checked = due today. Status uses a 7-day "due soon" window.
 */
export function exclusionDue(
  lastCheckedOn: string | null | undefined,
  today: string,
  intervalDays = 30,
): { dueOn: string; status: 'current' | 'due_soon' | 'overdue' | 'never'; daysLeft: number } {
  const last = ymd(lastCheckedOn ?? null);
  if (!last) return { dueOn: today, status: 'never', daysLeft: 0 };
  const dueOn = addDaysYmd(last, intervalDays);
  const daysLeft = daysBetween(today, dueOn);
  if (daysLeft < 0) return { dueOn, status: 'overdue', daysLeft };
  if (daysLeft <= 7) return { dueOn, status: 'due_soon', daysLeft };
  return { dueOn, status: 'current', daysLeft };
}

// ─── Credential catalog ──────────────────────────────────────────────────────

export const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  LICENSE: 'Professional license',
  CEU: 'CEU cycle',
  MALPRACTICE: 'Malpractice insurance',
  DEA: 'DEA registration',
  CDS: 'Maryland CDS registration',
  CERTIFICATION: 'Certification',
  BOARD_CERTIFICATION: 'Board certification',
  CPR_BLS: 'CPR / BLS',
  BACKGROUND_CHECK: 'Background check',
  SUPERVISION: 'Supervision agreement',
};

export const VERIFICATION_METHODS = [
  { key: 'board_website', label: 'State board online lookup' },
  { key: 'primary_source_letter', label: 'Primary source letter' },
  { key: 'nppes', label: 'NPPES NPI registry' },
  { key: 'dea_lookup', label: 'DEA registration validation' },
  { key: 'caqh', label: 'CAQH ProView' },
  { key: 'other', label: 'Other (describe)' },
] as const;

/** Maryland license types: level for supervision / billing and the board that issues it. */
export const MD_LICENSE_TYPES = [
  { code: 'LCSW-C', label: 'Licensed Certified Social Worker-Clinical', level: 'LICENSED', board: 'bswe' },
  { code: 'LCSW', label: 'Licensed Certified Social Worker', level: 'PRE_LICENSED', board: 'bswe' },
  { code: 'LMSW', label: 'Licensed Master Social Worker', level: 'PRE_LICENSED', board: 'bswe' },
  { code: 'LCPC', label: 'Licensed Clinical Professional Counselor', level: 'LICENSED', board: 'bopc' },
  { code: 'LGPC', label: 'Licensed Graduate Professional Counselor', level: 'PRE_LICENSED', board: 'bopc' },
  { code: 'LCMFT', label: 'Licensed Clinical Marriage and Family Therapist', level: 'LICENSED', board: 'bopc' },
  { code: 'LGMFT', label: 'Licensed Graduate Marriage and Family Therapist', level: 'PRE_LICENSED', board: 'bopc' },
  { code: 'LCADC', label: 'Licensed Clinical Alcohol and Drug Counselor', level: 'LICENSED', board: 'bopc' },
  { code: 'LGADC', label: 'Licensed Graduate Alcohol and Drug Counselor', level: 'PRE_LICENSED', board: 'bopc' },
  { code: 'PSYCHOLOGIST', label: 'Licensed Psychologist', level: 'LICENSED', board: 'psych' },
  { code: 'MD', label: 'Physician (MD / DO)', level: 'LICENSED', board: 'mbp' },
  { code: 'CRNP-PMH', label: 'Psychiatric-Mental Health Nurse Practitioner', level: 'LICENSED', board: 'mbon' },
  { code: 'CRNP', label: 'Certified Registered Nurse Practitioner', level: 'LICENSED', board: 'mbon' },
  { code: 'RN', label: 'Registered Nurse', level: 'LICENSED', board: 'mbon' },
  { code: 'CPRP', label: 'Certified Psychiatric Rehabilitation Practitioner', level: 'CERTIFIED', board: 'other' },
  { code: 'CPRS', label: 'Certified Peer Recovery Specialist', level: 'CERTIFIED', board: 'other' },
] as const;

/** Lookup links for primary source verification (confirm links; boards change their sites). */
export const VERIFICATION_LINKS: Record<string, { label: string; url: string }> = {
  bswe: { label: 'MD Board of Social Work Examiners', url: 'https://health.maryland.gov/bswe/' },
  bopc: { label: 'MD Board of Professional Counselors and Therapists', url: 'https://health.maryland.gov/bopc/' },
  psych: { label: 'MD Board of Examiners of Psychologists', url: 'https://health.maryland.gov/psych/' },
  mbp: { label: 'MD Board of Physicians', url: 'https://www.mbp.state.md.us/' },
  mbon: { label: 'MD Board of Nursing', url: 'https://mbon.maryland.gov/' },
  cds: { label: 'MD Office of Controlled Substances Administration (CDS)', url: 'https://health.maryland.gov/ocsa/' },
  nppes: { label: 'NPPES NPI Registry', url: 'https://npiregistry.cms.hhs.gov/' },
  dea: { label: 'DEA Diversion registration validation', url: 'https://apps.deadiversion.usdoj.gov/' },
  caqh: { label: 'CAQH ProView', url: 'https://proview.caqh.org/' },
  eprep: { label: 'Maryland Medicaid ePREP', url: 'https://eprep.health.maryland.gov/' },
};

export function verificationLinkFor(credentialType: string, licenseType?: string | null) {
  if (credentialType === 'DEA') return VERIFICATION_LINKS.dea;
  if (credentialType === 'CDS') return VERIFICATION_LINKS.cds;
  const lt = MD_LICENSE_TYPES.find((t) => t.code === (licenseType || '').toUpperCase());
  return lt && VERIFICATION_LINKS[lt.board] ? VERIFICATION_LINKS[lt.board] : null;
}

export const COMPLIANCE_KINDS = [
  { key: 'TB_TEST', label: 'TB screening', policy: 'Interval per practice policy (HR settings)' },
  { key: 'FLU_VACCINE', label: 'Flu vaccine / declination', policy: 'Seasonal; roles per practice policy' },
  { key: 'HEP_B', label: 'Hepatitis B series / declination', policy: 'Clinical roles per practice policy' },
  { key: 'BACKGROUND_CHECK', label: 'Background check', policy: 'At hire; re-check per practice policy' },
  { key: 'CJIS_FINGERPRINT', label: 'CJIS fingerprinting', policy: 'Per program requirement' },
  { key: 'I9', label: 'Form I-9', policy: 'Completion recorded; document images not stored unless policy allows' },
  { key: 'CAQH_ATTESTATION', label: 'CAQH re-attestation', policy: 'Every 120 days (HR settings)' },
  { key: 'MEDICAID_ENROLLMENT', label: 'Maryland Medicaid (ePREP) enrollment', policy: 'Revalidation date from ePREP' },
  { key: 'OTHER', label: 'Other', policy: '' },
] as const;
export const COMPLIANCE_KIND_KEYS = COMPLIANCE_KINDS.map((k) => k.key);

// ─── CEUs ────────────────────────────────────────────────────────────────────

export type CeuRequirementMap = Record<string, { hours?: number | null; cycleMonths?: number | null }>;

/**
 * CEU hours earned toward one license renewal cycle. Required hours come from the license row
 * (ceuRequired > 0) or the HR setting for its license type; null = not set (practice policy, confirm).
 */
export function ceuProgress(
  license: { id: string; licenseType?: string | null; issuedAt?: string | null; expiresAt: string; ceuRequired?: number | null },
  completions: Array<{ hours?: number | null; completedOn: string; ceuEligible?: boolean; credentialId?: string | null }>,
  requirements: CeuRequirementMap = {},
): { required: number | null; earned: number; pct: number | null; cycleStart: string; cycleEnd: string; source: 'license' | 'setting' | 'unset' } {
  const setting = license.licenseType ? requirements[license.licenseType.toUpperCase()] ?? requirements[license.licenseType] : undefined;
  const required = license.ceuRequired && license.ceuRequired > 0 ? license.ceuRequired : setting?.hours ?? null;
  const source = license.ceuRequired && license.ceuRequired > 0 ? 'license' : setting?.hours ? 'setting' : 'unset';
  const cycleMonths = setting?.cycleMonths ?? null;
  const cycleEnd = license.expiresAt;
  const cycleStart = cycleMonths ? addMonthsYmd(cycleEnd, -cycleMonths) : license.issuedAt || addMonthsYmd(cycleEnd, -24);
  const earned = completions
    .filter((c) => c.ceuEligible !== false && (c.credentialId ? c.credentialId === license.id : true))
    .filter((c) => c.completedOn >= cycleStart && c.completedOn <= cycleEnd)
    .reduce((s, c) => s + (Number(c.hours) || 0), 0);
  const rounded = Math.round(earned * 10) / 10;
  return {
    required,
    earned: rounded,
    pct: required ? Math.min(100, Math.round((rounded / required) * 100)) : null,
    cycleStart,
    cycleEnd,
    source,
  };
}

// ─── Training ────────────────────────────────────────────────────────────────

export type TrainingRequirementLike = {
  id: string;
  key: string;
  name: string;
  frequencyMonths: number | null;
  roles: string[];
  dueWithinDaysOfHire: number | null;
  active?: boolean;
};

/** Suggested requirements for a new practice (HR edits them; frequencies are practice policy). */
export const DEFAULT_TRAINING_REQUIREMENTS: Array<Omit<TrainingRequirementLike, 'id'> & { category: string; policyNote: string }> = [
  { key: 'hipaa', name: 'HIPAA privacy & security', category: 'compliance', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 30, policyNote: 'Annual (practice policy, confirm)' },
  { key: 'part2', name: '42 CFR Part 2 confidentiality', category: 'compliance', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 30, policyNote: 'Annual (practice policy, confirm)' },
  { key: 'fwa', name: 'Compliance / fraud, waste & abuse', category: 'compliance', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 30, policyNote: 'Annual (practice policy, confirm)' },
  { key: 'mandated_reporter', name: 'Mandated reporter (child / vulnerable adult abuse)', category: 'compliance', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 30, policyNote: 'Frequency per practice policy, confirm' },
  { key: 'deescalation', name: 'Crisis de-escalation', category: 'safety', frequencyMonths: 12, roles: [...CLINICAL_ROLES, 'FRONT_DESK'], dueWithinDaysOfHire: 60, policyNote: 'Frequency per practice policy, confirm' },
  { key: 'cpr', name: 'CPR / First Aid', category: 'safety', frequencyMonths: 24, roles: ['PRP_SPECIALIST', 'CRISIS_RESPONDER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'], dueWithinDaysOfHire: 60, policyNote: 'Card interval per issuing body; roles per practice policy, confirm' },
  { key: 'suicide_prevention', name: 'Suicide prevention / risk assessment', category: 'clinical', frequencyMonths: 12, roles: [...LICENSED_ROLES, 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'CRISIS_RESPONDER'], dueWithinDaysOfHire: 60, policyNote: 'Frequency per practice policy, confirm' },
  { key: 'cultural_competency', name: 'Cultural competency', category: 'clinical', frequencyMonths: 12, roles: [], dueWithinDaysOfHire: 90, policyNote: 'Frequency per practice policy, confirm' },
];

export function trainingApplies(req: Pick<TrainingRequirementLike, 'roles' | 'active'>, role: string | null | undefined): boolean {
  if (req.active === false) return false;
  if (!req.roles || req.roles.length === 0) return true;
  return req.roles.map(norm).includes(norm(role));
}

export function trainingStatus(
  req: TrainingRequirementLike,
  input: { role: string | null | undefined; hireDate?: string | null; lastCompletedOn?: string | null; lastExpiresOn?: string | null },
  today: string,
  windows: ExpiryWindows = DEFAULT_WINDOWS,
): { status: ExpiryStatus | 'not_required'; dueOn: string | null; daysLeft: number | null } {
  if (!trainingApplies(req, input.role)) return { status: 'not_required', dueOn: null, daysLeft: null };
  const last = ymd(input.lastCompletedOn ?? null);
  if (last) {
    const dueOn = ymd(input.lastExpiresOn ?? null) ?? (req.frequencyMonths ? addMonthsYmd(last, req.frequencyMonths) : null);
    if (!dueOn) return { status: 'current', dueOn: null, daysLeft: null };
    const st = expiryStatus(dueOn, today, windows);
    return { status: st.status, dueOn, daysLeft: st.daysLeft };
  }
  // Never completed: due within N days of hire (or now).
  const hire = ymd(input.hireDate ?? null);
  const dueOn = hire && req.dueWithinDaysOfHire != null ? addDaysYmd(hire, req.dueWithinDaysOfHire) : today;
  const daysLeft = daysBetween(today, dueOn);
  return { status: daysLeft < 0 ? 'expired' : 'missing', dueOn, daysLeft };
}

/** Compliance % = applicable requirements that are current (or due soon but not expired). */
export function trainingCompliancePct(statuses: Array<ExpiryStatus | 'not_required'>): number | null {
  const applicable = statuses.filter((s) => s !== 'not_required');
  if (!applicable.length) return null;
  const ok = applicable.filter((s) => s === 'current' || s === 'due_60' || s === 'due_30').length;
  return Math.round((ok / applicable.length) * 100);
}

// ─── Checklists ──────────────────────────────────────────────────────────────

export type ChecklistOwner = 'hr' | 'manager' | 'employee' | 'admin' | 'clinical_director' | 'it';

export type ChecklistItem = {
  key: string;
  label: string;
  category: string;
  ownerType: ChecklistOwner;
  /** Days relative to the start date (onboarding) or last day (offboarding); negative = before */
  dueOffsetDays?: number;
  /** Business days after the start date (e.g. I-9 section 2) */
  dueBusinessDays?: number;
  requiresAck?: boolean;
  requiresUpload?: boolean;
  systemAction?: string;
  /** policy kind acknowledged by this item (handbook, code_of_conduct, hipaa, confidentiality) */
  policyKind?: string;
  clinicalOnly?: boolean;
  licensedOnly?: boolean;
  prescriberOnly?: boolean;
  workerTypes?: string[];
  roles?: string[];
  help?: string;
};

export const DEFAULT_ONBOARDING_ITEMS: ChecklistItem[] = [
  { key: 'offer_letter', label: 'Signed offer letter on file', category: 'Paperwork', ownerType: 'hr', dueOffsetDays: -7, requiresUpload: true },
  { key: 'i9_section1', label: 'Form I-9 Section 1 completed by the employee', category: 'Paperwork', ownerType: 'employee', dueOffsetDays: 0, workerTypes: ['W2', 'PER_DIEM'], help: 'Record completion only; no copies of identity documents unless practice policy allows.' },
  { key: 'i9_section2', label: 'Form I-9 Section 2 verified by HR', category: 'Paperwork', ownerType: 'hr', dueBusinessDays: 3, workerTypes: ['W2', 'PER_DIEM'] },
  { key: 'w4', label: 'Federal W-4 sent to payroll', category: 'Paperwork', ownerType: 'employee', dueOffsetDays: 0, workerTypes: ['W2', 'PER_DIEM'], help: 'Submitted in the payroll system; Altrixs records completion only.' },
  { key: 'mw507', label: 'Maryland MW507 withholding sent to payroll', category: 'Paperwork', ownerType: 'employee', dueOffsetDays: 0, workerTypes: ['W2', 'PER_DIEM'] },
  { key: 'w9', label: 'W-9 on file (contractor)', category: 'Paperwork', ownerType: 'employee', dueOffsetDays: 0, workerTypes: ['1099'] },
  { key: 'direct_deposit', label: 'Direct deposit set up in the payroll system', category: 'Paperwork', ownerType: 'employee', dueOffsetDays: 7, help: 'Bank details are entered in payroll only, never in Altrixs.' },
  { key: 'background_check', label: 'Background check cleared', category: 'Screening', ownerType: 'hr', dueOffsetDays: -3 },
  { key: 'exclusion_initial', label: 'OIG, SAM.gov and Maryland Medicaid exclusion checks clear', category: 'Screening', ownerType: 'hr', dueOffsetDays: -3 },
  { key: 'cjis_fingerprint', label: 'CJIS fingerprinting (if the program requires it)', category: 'Screening', ownerType: 'hr', dueOffsetDays: 30, clinicalOnly: true },
  { key: 'credentials_collected', label: 'License / certification copies collected', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: -7, clinicalOnly: true, requiresUpload: true },
  { key: 'psv', label: 'Licenses verified at the Maryland board (primary source)', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 0, licensedOnly: true },
  { key: 'npi_verified', label: 'NPI verified on NPPES', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 0, licensedOnly: true },
  { key: 'dea_cds', label: 'DEA and Maryland CDS registrations verified for this practice', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 0, prescriberOnly: true },
  { key: 'malpractice', label: 'Malpractice coverage confirmed (certificate on file)', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 0, licensedOnly: true },
  { key: 'caqh', label: 'CAQH profile attested; practice granted access', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 14, licensedOnly: true },
  { key: 'payer_enrollment', label: 'Payer enrollment started (Maryland Medicaid ePREP, commercial)', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 14, licensedOnly: true },
  { key: 'supervisor_assigned', label: 'Clinical supervisor assigned (pre-licensed staff)', category: 'Credentialing', ownerType: 'clinical_director', dueOffsetDays: 0, clinicalOnly: true },
  { key: 'tb_test', label: 'TB screening on file (per practice policy)', category: 'Health', ownerType: 'employee', dueOffsetDays: 14, clinicalOnly: true, requiresUpload: true },
  { key: 'immunizations', label: 'Immunizations or declinations (flu, hepatitis B per policy)', category: 'Health', ownerType: 'employee', dueOffsetDays: 30, clinicalOnly: true, requiresUpload: true },
  { key: 'cpr', label: 'CPR / BLS card on file (if required for the role)', category: 'Health', ownerType: 'employee', dueOffsetDays: 30, roles: ['PRP_SPECIALIST', 'CRISIS_RESPONDER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'], requiresUpload: true },
  { key: 'training_hipaa', label: 'HIPAA privacy & security training', category: 'Training', ownerType: 'employee', dueOffsetDays: 30 },
  { key: 'training_part2', label: '42 CFR Part 2 confidentiality training', category: 'Training', ownerType: 'employee', dueOffsetDays: 30 },
  { key: 'training_compliance', label: 'Compliance / fraud, waste & abuse training', category: 'Training', ownerType: 'employee', dueOffsetDays: 30 },
  { key: 'ack_handbook', label: 'Acknowledge the employee handbook', category: 'Policies', ownerType: 'employee', dueOffsetDays: 3, requiresAck: true, policyKind: 'handbook', systemAction: 'policy_ack' },
  { key: 'ack_conduct', label: 'Acknowledge the code of conduct', category: 'Policies', ownerType: 'employee', dueOffsetDays: 3, requiresAck: true, policyKind: 'code_of_conduct', systemAction: 'policy_ack' },
  { key: 'ack_hipaa', label: 'Acknowledge the HIPAA policy', category: 'Policies', ownerType: 'employee', dueOffsetDays: 3, requiresAck: true, policyKind: 'hipaa', systemAction: 'policy_ack' },
  { key: 'ack_confidentiality', label: 'Sign the confidentiality agreement', category: 'Policies', ownerType: 'employee', dueOffsetDays: 3, requiresAck: true, policyKind: 'confidentiality', systemAction: 'policy_ack' },
  { key: 'access_altrixs', label: 'Altrixs account invited with the right role', category: 'System access', ownerType: 'admin', dueOffsetDays: -1 },
  { key: 'access_drfirst', label: 'DrFirst (Rcopia) account and EPCS set up', category: 'System access', ownerType: 'admin', dueOffsetDays: 7, prescriberOnly: true },
  { key: 'access_email', label: 'Practice email and phone set up', category: 'System access', ownerType: 'it', dueOffsetDays: -1 },
  { key: 'equipment', label: 'Equipment issued (laptop, badge, keys)', category: 'First week', ownerType: 'manager', dueOffsetDays: 0 },
  { key: 'orientation', label: 'New-hire orientation completed', category: 'First week', ownerType: 'manager', dueOffsetDays: 5 },
  { key: 'checkin_30', label: '30-day check-in', category: 'Check-ins', ownerType: 'manager', dueOffsetDays: 30 },
  { key: 'checkin_60', label: '60-day check-in', category: 'Check-ins', ownerType: 'manager', dueOffsetDays: 60 },
  { key: 'checkin_90', label: '90-day review', category: 'Check-ins', ownerType: 'manager', dueOffsetDays: 90 },
];

export const DEFAULT_OFFBOARDING_ITEMS: ChecklistItem[] = [
  { key: 'separation_recorded', label: 'Last day and separation type recorded', category: 'Separation', ownerType: 'hr', dueOffsetDays: -14 },
  { key: 'resignation_letter', label: 'Resignation / separation letter on file', category: 'Separation', ownerType: 'hr', dueOffsetDays: -14, requiresUpload: true },
  { key: 'caseload_reassign', label: 'Reassign caseload to other clinicians', category: 'Clinical handoff', ownerType: 'clinical_director', dueOffsetDays: -7, clinicalOnly: true, systemAction: 'caseload_reassign' },
  { key: 'notes_signed', label: 'All notes signed and supervision logs closed', category: 'Clinical handoff', ownerType: 'manager', dueOffsetDays: -1, clinicalOnly: true },
  { key: 'exit_interview', label: 'Exit interview', category: 'Separation', ownerType: 'hr', dueOffsetDays: -2, systemAction: 'exit_interview' },
  { key: 'equipment_return', label: 'Equipment returned (laptop, badge, keys)', category: 'Access & equipment', ownerType: 'manager', dueOffsetDays: 0 },
  { key: 'deactivate_user', label: 'Deactivate the Altrixs account', category: 'Access & equipment', ownerType: 'admin', dueOffsetDays: 0, systemAction: 'deactivate_user' },
  { key: 'drfirst_deactivate', label: 'Deactivate DrFirst (Rcopia) / EPCS access', category: 'Access & equipment', ownerType: 'admin', dueOffsetDays: 0, prescriberOnly: true, systemAction: 'drfirst_deactivate' },
  { key: 'email_access', label: 'Disable email, phone and other system access', category: 'Access & equipment', ownerType: 'it', dueOffsetDays: 0 },
  { key: 'payer_notify', label: 'Notify payers and end enrollments (Maryland Medicaid ePREP, commercial)', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 7, licensedOnly: true, systemAction: 'payer_notify' },
  { key: 'dea_cds_address', label: 'Prescriber updates DEA / CDS registration away from the practice address', category: 'Credentialing', ownerType: 'hr', dueOffsetDays: 30, prescriberOnly: true },
  { key: 'final_pay', label: 'Final pay processed (timing per Maryland wage law; confirm with payroll)', category: 'Pay & benefits', ownerType: 'hr', dueOffsetDays: 0, systemAction: 'final_pay' },
  { key: 'pto_payout', label: 'Unused PTO handled per the written policy', category: 'Pay & benefits', ownerType: 'hr', dueOffsetDays: 0 },
  { key: 'cobra_notice', label: 'COBRA / Maryland continuation notice (if enrolled in the health plan)', category: 'Pay & benefits', ownerType: 'hr', dueOffsetDays: 14, systemAction: 'cobra_notice' },
  { key: 'file_closed', label: 'Personnel file closed (retain per practice policy)', category: 'Separation', ownerType: 'hr', dueOffsetDays: 30 },
];

export type ChecklistSubject = {
  userId: string;
  role: string | null | undefined;
  workerType?: string | null;
  managerUserId?: string | null;
};

export function checklistItemApplies(item: ChecklistItem, subject: ChecklistSubject): boolean {
  const role = norm(subject.role);
  if (item.prescriberOnly && !isPrescriberRole(role)) return false;
  if (item.licensedOnly && !isLicensedRole(role)) return false;
  if (item.clinicalOnly && !isClinicalRole(role)) return false;
  if (item.roles && item.roles.length && !item.roles.map(norm).includes(role)) return false;
  if (item.workerTypes && item.workerTypes.length) {
    const wt = norm(subject.workerType || 'W2');
    if (!item.workerTypes.map(norm).includes(wt)) return false;
  }
  return true;
}

export type GeneratedChecklistTask = {
  key: string;
  label: string;
  category: string;
  ownerType: ChecklistOwner;
  assigneeUserId: string | null;
  dueOn: string | null;
  sortOrder: number;
  requiresAck: boolean;
  requiresUpload: boolean;
  systemAction: string | null;
  note: string | null;
};

/**
 * Tasks for one employee from a template: items that apply to the role / worker type, due dates
 * from the anchor date (start date or last day), employee tasks assigned to the employee and
 * manager tasks to their manager; HR / admin / IT / clinical director tasks stay in those queues.
 */
export function buildChecklistTasks(items: ChecklistItem[], subject: ChecklistSubject, anchorOn: string): GeneratedChecklistTask[] {
  return items
    .filter((i) => checklistItemApplies(i, subject))
    .map((i, idx) => {
      const dueOn =
        i.dueBusinessDays != null
          ? addBusinessDays(anchorOn, i.dueBusinessDays)
          : i.dueOffsetDays != null
            ? addDaysYmd(anchorOn, i.dueOffsetDays)
            : null;
      const assigneeUserId =
        i.ownerType === 'employee' ? subject.userId : i.ownerType === 'manager' ? subject.managerUserId ?? null : null;
      return {
        key: i.key,
        label: i.label,
        category: i.category,
        ownerType: i.ownerType,
        assigneeUserId,
        dueOn,
        sortOrder: idx,
        requiresAck: Boolean(i.requiresAck),
        requiresUpload: Boolean(i.requiresUpload),
        systemAction: i.systemAction ?? null,
        note: i.help ?? null,
      };
    });
}

/** Offboarding: caseload task label carries the assigned-client COUNT only (never names). */
export function caseloadTaskLabel(assignedClientCount: number): string {
  return assignedClientCount > 0
    ? `Reassign caseload: ${assignedClientCount} assigned client${assignedClientCount === 1 ? '' : 's'}`
    : 'Reassign caseload: no clients assigned';
}

export function checklistProgress(tasks: Array<{ status: string }>): { done: number; total: number; pct: number } {
  const total = tasks.filter((t) => t.status !== 'skipped').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function isChecklistTaskOverdue(task: { status: string; dueOn: string | null }, today: string): boolean {
  return task.status === 'open' && !!task.dueOn && task.dueOn < today;
}

// ─── Time off ────────────────────────────────────────────────────────────────

export type SickPolicy = {
  /** 1 hour per N hours worked (HWFA default 30; practice policy, confirm). null = not set */
  sickAccrualHoursWorked: number | null;
  sickAnnualAccrualCap?: number | null;
  sickBalanceCap?: number | null;
};

/**
 * Sick leave accrued for `hoursWorked`: hoursWorked / N, rounded down to 0.01 h, limited by the
 * annual accrual cap and the balance cap when the practice sets them. Policy not set = 0 with a reason.
 */
export function sickAccrual(
  input: { hoursWorked: number; accruedThisYear?: number; balance?: number },
  policy: SickPolicy,
): { hours: number; capped: boolean; reason: string | null } {
  const per = policy.sickAccrualHoursWorked;
  if (!per || per <= 0) return { hours: 0, capped: false, reason: 'Sick accrual rate is not set in HR settings' };
  const worked = Math.max(0, Number(input.hoursWorked) || 0);
  let hours = Math.floor((worked / per) * 100) / 100;
  let capped = false;
  if (policy.sickAnnualAccrualCap != null) {
    const room = Math.max(0, policy.sickAnnualAccrualCap - (input.accruedThisYear ?? 0));
    if (hours > room) {
      hours = room;
      capped = true;
    }
  }
  if (policy.sickBalanceCap != null) {
    const room = Math.max(0, policy.sickBalanceCap - (input.balance ?? 0));
    if (hours > room) {
      hours = room;
      capped = true;
    }
  }
  return { hours: Math.round(hours * 100) / 100, capped, reason: capped ? 'Limited by the practice cap' : null };
}

export type PtoPolicy = { hoursPerPeriod?: number | null; periodsPerYear?: number | null; balanceCap?: number | null };

/** PTO for one pay period: hoursPerPeriod x FTE (default 1), limited by the balance cap. */
export function ptoAccrualForPeriod(policy: PtoPolicy | null | undefined, input: { fte?: number | null; balance?: number }) {
  if (!policy?.hoursPerPeriod || policy.hoursPerPeriod <= 0) return { hours: 0, capped: false, reason: 'PTO accrual is not set in HR settings' };
  const fte = input.fte && input.fte > 0 ? Math.min(1, input.fte) : 1;
  let hours = Math.floor(policy.hoursPerPeriod * fte * 100) / 100;
  let capped = false;
  if (policy.balanceCap != null) {
    const room = Math.max(0, policy.balanceCap - (input.balance ?? 0));
    if (hours > room) {
      hours = room;
      capped = true;
    }
  }
  return { hours, capped, reason: capped ? 'Limited by the PTO balance cap' : null };
}

export function ledgerBalance(entries: Array<{ bucket: string; hours: number }>, bucket: string): number {
  return Math.round(entries.filter((e) => e.bucket === bucket).reduce((s, e) => s + e.hours, 0) * 100) / 100;
}

export const TIME_OFF_TYPES = [
  { key: 'pto', label: 'PTO / vacation', bucket: 'pto' },
  { key: 'sick', label: 'Sick & safe leave', bucket: 'sick' },
  { key: 'unpaid', label: 'Unpaid leave', bucket: null },
  { key: 'bereavement', label: 'Bereavement', bucket: null },
  { key: 'jury_duty', label: 'Jury duty', bucket: null },
  { key: 'fmla', label: 'FMLA / medical leave (HR coordinates)', bucket: null },
  { key: 'other', label: 'Other', bucket: null },
] as const;

export function bucketForType(type: string): 'pto' | 'sick' | null {
  const t = TIME_OFF_TYPES.find((x) => x.key === type);
  return (t?.bucket as 'pto' | 'sick' | null) ?? null;
}

/** Weekday hours in a date range at 8 h/day (the requester can edit the total). */
export function defaultTimeOffHours(startDate: string, endDate: string, hoursPerDay = 8): number {
  if (endDate < startDate) return 0;
  let n = 0;
  for (let d = startDate; d <= endDate; d = addDaysYmd(d, 1)) {
    const wd = new Date(utc(d)).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
    if (n > 400) break;
  }
  return n * hoursPerDay;
}

/** Who may approve a time-off request: HR / leadership, or the requester's manager (never self). */
export function canApproveTimeOff(
  viewer: { userId: string; role: string | null | undefined },
  request: { userId: string; managerUserId?: string | null },
): boolean {
  if (viewer.userId === request.userId) return false;
  if (isHrAdminRole(viewer.role)) return true;
  return !!request.managerUserId && request.managerUserId === viewer.userId;
}

// ─── Performance ─────────────────────────────────────────────────────────────

/** Notes signed on time (counts only; no note content). */
export function notesOnTime(
  notes: Array<{ serviceAt: string | Date | null; signedAt: string | Date | null }>,
  deadlineHours = 72,
): { total: number; signed: number; signedOnTime: number; onTimePct: number | null } {
  let signed = 0;
  let onTime = 0;
  for (const n of notes) {
    if (!n.signedAt) continue;
    signed += 1;
    const s = new Date(n.signedAt).getTime();
    const svc = n.serviceAt ? new Date(n.serviceAt).getTime() : NaN;
    if (Number.isFinite(svc) && s - svc <= deadlineHours * 3_600_000) onTime += 1;
  }
  return { total: notes.length, signed, signedOnTime: onTime, onTimePct: notes.length ? Math.round((onTime / notes.length) * 100) : null };
}

export const REVIEW_TYPES = [
  { key: 'ninety_day', label: '90-day review' },
  { key: 'annual', label: 'Annual review' },
  { key: 'probation', label: 'Probation review' },
  { key: 'other', label: 'Other' },
] as const;

export const DISCIPLINE_TYPES = [
  { key: 'coaching', label: 'Coaching' },
  { key: 'verbal_warning', label: 'Verbal warning (documented)' },
  { key: 'written_warning', label: 'Written warning' },
  { key: 'final_warning', label: 'Final written warning' },
  { key: 'pip', label: 'Performance improvement plan' },
  { key: 'suspension', label: 'Suspension' },
  { key: 'termination', label: 'Termination' },
] as const;

// ─── Headcount / turnover ────────────────────────────────────────────────────

/** Annualized turnover % = separations / average headcount x (365 / days in period). */
export function turnoverPct(separations: number, avgHeadcount: number, periodDays = 365): number | null {
  if (!avgHeadcount || avgHeadcount <= 0 || periodDays <= 0) return null;
  return Math.round((separations / avgHeadcount) * (365 / periodDays) * 1000) / 10;
}

export function headcountOn(
  staff: Array<{ hireDate: string | null; terminationDate: string | null }>,
  on: string,
): number {
  return staff.filter((s) => (!s.hireDate || s.hireDate <= on) && (!s.terminationDate || s.terminationDate >= on)).length;
}

// ─── AI drafts ───────────────────────────────────────────────────────────────

export type AiDraft<T> = {
  /** Always 'draft': a person reviews, edits and saves */
  status: 'draft';
  requiresConfirmation: true;
  /** The AI call itself never writes to the HR record */
  saved: false;
  feature: string;
  generatedAt: string;
  engine: 'bedrock' | 'rules';
  data: T;
  disclaimer: string;
};

export function aiDraft<T>(feature: string, data: T, engine: 'bedrock' | 'rules', disclaimer = 'AI draft. Review and edit before saving.'): AiDraft<T> {
  return { status: 'draft', requiresConfirmation: true, saved: false, feature, generatedAt: new Date().toISOString(), engine, data, disclaimer };
}

export const HR_AI_FEATURES = [
  { key: 'aiDocumentExtract', label: 'Document intelligence', description: 'Read a license, certificate or insurance document and prefill the credential form for HR to confirm.' },
  { key: 'aiWritingDrafts', label: 'Job description and offer letter drafts', description: 'Draft from role, location and pay type; HR edits before use.' },
  { key: 'aiReviewAssistant', label: 'Performance review assistant', description: "Summarize the employee's goals and the manager's notes into a draft review." },
  { key: 'aiPolicyQa', label: 'Handbook Q&A', description: "Answers from the practice's uploaded handbook only, with section citations. Not legal advice." },
  { key: 'aiDigest', label: 'Weekly HR digest', description: 'Summary of expiring items and overdue tasks (counts and names of staff only).' },
] as const;
export type HrAiFeature = (typeof HR_AI_FEATURES)[number]['key'];

// ─── Document extraction (rules fallback) ────────────────────────────────────

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** All dates found in text, as YYYY-MM-DD, in order of appearance. */
export function findDates(text: string): string[] {
  const out: Array<{ at: number; v: string }> = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  const push = (at: number, y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2100) out.push({ at, v: `${y}-${pad(m)}-${pad(d)}` });
  };
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g)) push(m.index ?? 0, Number(m[3]), Number(m[1]), Number(m[2]));
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index ?? 0, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi)) {
    push(m.index ?? 0, Number(m[3]), MONTHS[m[1].toLowerCase()] ?? 0, Number(m[2]));
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.v);
}

export type ExtractedCredential = {
  credentialType: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  holderName: string | null;
  issuer: string | null;
  state: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  confidence: 'low' | 'medium';
  notes: string[];
};

/** Deterministic best-effort extraction from document text (used when Bedrock is off). */
export function extractCredentialFields(text: string): ExtractedCredential {
  const t = text.replace(/\s+/g, ' ');
  const notes: string[] = [];
  let credentialType: string | null = null;
  if (/drug enforcement|\bDEA\b/i.test(t)) credentialType = 'DEA';
  else if (/controlled dangerous substance|\bCDS\b/i.test(t)) credentialType = 'CDS';
  else if (/malpractice|professional liability|certificate of insurance/i.test(t)) credentialType = 'MALPRACTICE';
  else if (/\bBLS\b|basic life support|\bCPR\b/i.test(t)) credentialType = 'CPR_BLS';
  else if (/board certif|diplomate/i.test(t)) credentialType = 'BOARD_CERTIFICATION';
  else if (/licen[cs]e/i.test(t)) credentialType = 'LICENSE';
  else if (/certif/i.test(t)) credentialType = 'CERTIFICATION';

  const lt = MD_LICENSE_TYPES.find((x) => new RegExp(`\\b${x.code.replace('-', '[- ]?')}\\b`, 'i').test(t));
  const numMatch =
    t.match(/(?:license|registration|certificate|policy)\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9-]{4,20})/i) ||
    t.match(/\b([A-Z]{2}\d{7})\b/); // DEA format
  const dates = findDates(t);
  const expiryMatch = t.match(/(?:expir\w*|valid (?:through|until)|exp\.?)\s*(?:date)?\s*:?\s*([A-Za-z0-9 ,/-]{6,20})/i);
  const issueMatch = t.match(/(?:issue[d]?|effective)\s*(?:date|on)?\s*:?\s*([A-Za-z0-9 ,/-]{6,20})/i);
  const expiresAt = (expiryMatch && findDates(expiryMatch[1])[0]) || (dates.length ? [...dates].sort().at(-1)! : null);
  const issuedAt = (issueMatch && findDates(issueMatch[1])[0]) || (dates.length > 1 ? [...dates].sort()[0] : null);
  const nameMatch = t.match(/(?:name|licensee|registrant|insured)\s*:?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/);
  const state = /maryland/i.test(t) ? 'MD' : null;
  const issuerMatch = t.match(/(Maryland Board of [A-Za-z ]+?|Board of [A-Za-z ]+?|Drug Enforcement Administration|American Heart Association|American Red Cross)(?=[,.;]|\s{2}|$)/i);
  if (!numMatch) notes.push('License number not found');
  if (!expiresAt) notes.push('Expiration date not found');
  return {
    credentialType,
    licenseType: lt?.code ?? null,
    licenseNumber: numMatch ? numMatch[1] : null,
    holderName: nameMatch ? nameMatch[1].trim() : null,
    issuer: issuerMatch ? issuerMatch[1].trim() : null,
    state,
    issuedAt,
    expiresAt,
    confidence: numMatch && expiresAt ? 'medium' : 'low',
    notes,
  };
}

// ─── Policy Q&A retrieval (handbook sections only) ───────────────────────────

export type PolicySection = { policyId: string; policyTitle: string; sectionId: string; heading: string; text: string };

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'is', 'are', 'do', 'does', 'i', 'my', 'me', 'can', 'what', 'how', 'when', 'who', 'with', 'at', 'be', 'it', 'if', 'we', 'our', 'you']);

function terms(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Keyword retrieval: top sections by term overlap (heading matches count double). */
export function retrievePolicySections(question: string, sections: PolicySection[], limit = 4): Array<PolicySection & { score: number }> {
  const q = [...new Set(terms(question))];
  if (!q.length) return [];
  return sections
    .map((s) => {
      const body = terms(s.text);
      const head = terms(s.heading);
      let score = 0;
      for (const w of q) {
        score += body.filter((b) => b === w || b.startsWith(w)).length > 0 ? 1 : 0;
        score += head.some((h) => h === w || h.startsWith(w)) ? 2 : 0;
      }
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Split pasted handbook text into sections on headings (lines in Title Case / numbered / ALL CAPS). */
export function splitPolicyText(text: string): Array<{ id: string; heading: string; text: string }> {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: Array<{ id: string; heading: string; text: string }> = [];
  let current: { heading: string; body: string[] } = { heading: 'Introduction', body: [] };
  const isHeading = (l: string) => {
    const s = l.trim();
    if (!s || s.length > 90) return false;
    if (/^(\d+(\.\d+)*\.?|section\s+\d+[.:]?|article\s+[ivx\d]+[.:]?)\s+\S/i.test(s)) return true;
    if (/^#{1,4}\s+\S/.test(s)) return true;
    return /^[A-Z0-9 &/,'()-]{4,}$/.test(s) && /[A-Z]{3,}/.test(s);
  };
  const flush = () => {
    const body = current.body.join('\n').trim();
    if (body) sections.push({ id: `s${sections.length + 1}`, heading: current.heading.replace(/^#+\s*/, '').trim(), text: body });
  };
  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      current = { heading: line.trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  flush();
  return sections.slice(0, 400);
}

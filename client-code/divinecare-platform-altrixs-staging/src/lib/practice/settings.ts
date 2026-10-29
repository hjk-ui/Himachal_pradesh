/**
 * Practice settings: field definitions, defaults and zod validation per section.
 * Pure (no Prisma) — shared by the settings hub, the setup wizard, the API and tests.
 *
 * Identifiers default to empty and are never pre-filled: an empty field shows as missing on
 * the readiness checklist rather than being filled with a placeholder.
 */
import { z } from 'zod';
import {
  isValidClia,
  isValidEin,
  isValidNpi,
  isValidPhone,
  isValidPos,
  isValidPtan,
  isValidTaxonomy,
  isValidZip,
  normalizeEin,
  normalizePhone,
  normalizeZip,
} from './validators';
import { isPlaceholderNpi } from './placeholders';

const PLACEHOLDER_NPI_MESSAGE = 'That NPI is an imported placeholder, not a real NPI — enter the NPPES value';

// ─── Option lists ────────────────────────────────────────────────────────────

export const PRACTICE_TYPES = [
  { value: 'omhc', label: 'Outpatient mental health clinic (OMHC)' },
  { value: 'group', label: 'Group practice' },
  { value: 'solo', label: 'Solo practice' },
  { value: 'cmhc', label: 'Community mental health center' },
  { value: 'fqhc', label: 'FQHC / look-alike' },
  { value: 'other', label: 'Other' },
] as const;

export const SPECIALTY_OPTIONS = [
  'Outpatient mental health',
  'Psychiatric rehabilitation (PRP)',
  'Psychiatry / medication management',
  'Primary care',
  'Substance use disorder treatment',
  'Child & adolescent',
  'Telehealth',
  'Crisis services',
] as const;

/** Common NUCC taxonomy codes for behavioral health organizations (reference list, not defaults). */
export const COMMON_TAXONOMIES = [
  { code: '261QM0801X', label: 'Clinic/Center — Mental Health (incl. CMHC)' },
  { code: '261QR0405X', label: 'Clinic/Center — Rehabilitation, Substance Use Disorder' },
  { code: '251S00000X', label: 'Agency — Community/Behavioral Health' },
  { code: '261QP2300X', label: 'Clinic/Center — Primary Care' },
  { code: '2084P0800X', label: 'Psychiatry & Neurology — Psychiatry' },
  { code: '193200000X', label: 'Multi-Specialty Group' },
] as const;

export const ACCREDITATION_BODIES = [
  { value: 'none', label: 'Not accredited' },
  { value: 'CARF', label: 'CARF' },
  { value: 'TJC', label: 'The Joint Commission' },
  { value: 'COA', label: 'Council on Accreditation (COA)' },
] as const;

export const COPAY_POLICIES = [
  { value: 'at_check_in', label: 'Collect at check-in' },
  { value: 'at_check_out', label: 'Collect at check-out' },
  { value: 'bill_after_visit', label: 'Bill after the visit (statement)' },
] as const;

export const RENDERING_DEFAULTS = [
  { value: 'appointment_clinician', label: 'Appointment clinician renders (2310B = clinician NPI)' },
  { value: 'billing_provider', label: 'Billing provider renders (omit 2310B)' },
] as const;

export const TELEHEALTH_MODIFIERS = [
  { value: '95', label: '95 (synchronous audio/video)' },
  { value: 'GT', label: 'GT (legacy; some payers)' },
  { value: 'none', label: 'No modifier' },
] as const;

export const TELEHEALTH_PLATFORMS = ['CHIME', 'ZOOM', 'DOXY', 'GOOGLE', 'TEAMS', 'PHONE'] as const;

export const US_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

/** Roles whose notes can require a co-signature (supervised roles). */
export const COSIGNABLE_ROLES = [
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CLINICIAN',
  'THERAPIST',
  'NP',
  'MEDICAL_ASSISTANT',
] as const;

export const ESCALATION_ROLES = ['PRACTICE_DIRECTOR', 'DIRECTOR', 'ADMIN', 'OFFICE_MANAGER'] as const;

export const BAA_STATUSES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'requested', label: 'Requested' },
  { value: 'signed', label: 'Signed' },
  { value: 'not_required', label: 'Not required' },
] as const;

/** Vendors that handle PHI for an Altrixs practice. Rows appear as "not recorded" until saved. */
export const DEFAULT_BAA_VENDORS = [
  { key: 'aws', name: 'Amazon Web Services', service: 'Hosting, database, SMS/email, Chime, HealthLake', requiredForGoLive: true },
  { key: 'waystar', name: 'Waystar', service: 'Clearinghouse (837P / 835 / 270-271)', requiredForGoLive: true },
  { key: 'drfirst', name: 'DrFirst', service: 'E-prescribing (Rcopia)', requiredForGoLive: true },
  { key: 'stripe', name: 'Stripe', service: 'Patient card payments', requiredForGoLive: false },
] as const;

/**
 * Maryland medical-record retention default (Md. Code, Health-General §4-403): at least 5 years
 * after the record is made; for a minor, until 3 years after the age of majority (age 21) or
 * 5 years, whichever is later. Payer contracts (e.g. Medicaid, Medicare) can require longer.
 */
export const MD_RETENTION_NOTE =
  'Default per Md. Code, Health-General §4-403: adults 5 years after the record is made; minors until age 21 or 5 years, whichever is later. Payer contracts may require longer (Medicare/Medicaid commonly 6–10 years). Verify with counsel.';

export const TREATMENT_PLAN_NOTE =
  'Adults: this interval, at most 180 days (default 180). Under 18: at most 90 days. Confirmed by the practice owner 2026-10-21 (COMAR 10.63 outpatient programs); every treatment plan path applies the same rule.';

// ─── Sections ────────────────────────────────────────────────────────────────

export const SETTINGS_SECTIONS = [
  { key: 'profile', label: 'Practice profile' },
  { key: 'billing', label: 'Billing & claims' },
  { key: 'locations', label: 'Service locations' },
  { key: 'payers', label: 'Payers' },
  { key: 'clinical', label: 'Clinical policy' },
  { key: 'programs', label: 'Programs & capacity' },
  { key: 'scheduling', label: 'Scheduling' },
  { key: 'compliance', label: 'Compliance & privacy' },
  { key: 'users', label: 'Users & security' },
  { key: 'integrations', label: 'Integrations' },
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]['key'];
/** Sections stored on the PracticeSettings row (others read other tables). */
export type EditableSectionKey = 'profile' | 'billing' | 'clinical' | 'scheduling' | 'compliance';

// ─── Field helpers ───────────────────────────────────────────────────────────

/** Optional text: trimmed, '' / null / undefined -> null. */
function text(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? '').trim())
    .pipe(z.string().max(max, `Must be ${max} characters or fewer`))
    .transform((v) => (v ? v : null));
}

function checked(max: number, ok: (v: string) => boolean, message: string, normalize: (v: string) => string = (v) => v) {
  return text(max)
    .transform((v) => (v ? normalize(v) : null))
    .refine((v) => v === null || ok(v), message);
}

const phone = checked(24, isValidPhone, 'Phone must be 10 digits', normalizePhone);
const email = text(200).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email');
const state = text(2).transform((v) => (v ? v.toUpperCase() : null)).refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'State is a 2-letter code');
const zip = checked(10, (v) => isValidZip(v), 'ZIP is 5 or 9 digits', normalizeZip);
const zip9 = checked(10, (v) => isValidZip(v, true), 'ZIP+4 (9 digits) is required here', normalizeZip);
const isoDate = text(10).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD');
const pos = z.string().trim().refine(isValidPos, 'Place of service is a 2-digit CMS code');
const cents = z.union([z.number().int().min(0).max(100_000), z.null()]).optional().transform((v) => v ?? null);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

// ─── Section schemas ─────────────────────────────────────────────────────────

export const profileSchema = z.object({
  legalName: text(200),
  dbaName: text(200),
  practiceType: z.union([z.enum(PRACTICE_TYPES.map((t) => t.value) as [string, ...string[]]), z.null()]).optional().transform((v) => v ?? null),
  specialties: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  organizationNpi: checked(10, isValidNpi, 'Organization NPI must be 10 digits and pass the NPI check digit').refine((v) => !isPlaceholderNpi(v), PLACEHOLDER_NPI_MESSAGE),
  /** undefined = keep the stored tax ID (the client never receives it unmasked) */
  taxId: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : normalizeEin(v ?? '') || null))
    .refine((v) => v === undefined || v === null || isValidEin(v), 'EIN must be 9 digits (NN-NNNNNNN) with a valid IRS prefix'),
  taxonomyCodes: z
    .array(z.string().trim().toUpperCase())
    .max(10)
    .default([])
    .refine((list) => list.every(isValidTaxonomy), 'Taxonomy codes are 10 characters ending in X (e.g. 261QM0801X)'),
  medicaidProviderNumber: text(20).refine((v) => v === null || /^[A-Za-z0-9-]{4,20}$/.test(v), 'Medicaid provider number: letters and digits only'),
  medicarePtan: text(10).transform((v) => (v ? v.toUpperCase() : null)).refine((v) => v === null || isValidPtan(v), 'PTAN is 4-10 letters or digits'),
  cliaNumber: text(10).transform((v) => (v ? v.toUpperCase() : null)).refine((v) => v === null || isValidClia(v), 'CLIA is 2 digits, D, 7 digits (e.g. 21D1234567)'),
  omhcLicenseNumber: text(60),
  omhcLicenseExpiresOn: isoDate,
  prpLicenseNumber: text(60),
  prpLicenseExpiresOn: isoDate,
  accreditationBody: z.union([z.enum(ACCREDITATION_BODIES.map((a) => a.value) as [string, ...string[]]), z.null()]).optional().transform((v) => v ?? null),
  accreditationExpiresOn: isoDate,
  logoUrl: text(500).refine((v) => v === null || /^(https:\/\/|\/)/.test(v), 'Logo must be an https:// URL or a site path'),
  brandColor: text(7).refine((v) => v === null || /^#[0-9A-Fa-f]{6}$/.test(v), 'Brand color is a hex value like #5C2D91'),
  mainPhone: phone,
  mainFax: phone,
  mainEmail: email,
  website: text(300).refine((v) => v === null || /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), 'Website must start with http:// or https://'),
  timeZone: z.enum(US_TIME_ZONES).default('America/New_York'),
  fiscalYearStartMonth: int(1, 12).default(1),
});

export const billingSchema = z
  .object({
    billingContactName: text(120),
    billingContactPhone: phone,
    billingContactEmail: email,
    payToSameAsBilling: z.boolean().default(true),
    payToAddressLine1: text(55),
    payToAddressLine2: text(55),
    payToCity: text(30),
    payToState: state,
    payToZip: zip9,
    renderingProviderDefault: z.enum(['appointment_clinician', 'billing_provider']).default('appointment_clinician'),
    posOffice: pos.default('11'),
    posTelehealthHome: pos.default('10'),
    posTelehealthOther: pos.default('02'),
    telehealthModifierDefault: z.enum(['95', 'GT', 'none']).default('95'),
    statementRemitName: text(120),
    statementRemitAddressLine1: text(55),
    statementRemitAddressLine2: text(55),
    statementRemitCity: text(30),
    statementRemitState: state,
    statementRemitZip: zip,
    statementMessage: text(500),
    paymentTermsDays: int(0, 120).default(30),
    lateFeesEnabled: z.boolean().default(false),
    lateFeeCents: cents,
    copayCollectionPolicy: z.enum(['at_check_in', 'at_check_out', 'bill_after_visit']).default('at_check_in'),
    noShowFeeEnabled: z.boolean().default(false),
    noShowFeeCents: cents,
    lateCancelFeeEnabled: z.boolean().default(false),
    lateCancelFeeCents: cents,
    cancellationWindowHours: int(0, 168).default(24),
  })
  .superRefine((v, ctx) => {
    if (!v.payToSameAsBilling) {
      if (!v.payToAddressLine1 || !v.payToCity || !v.payToState || !v.payToZip) {
        ctx.addIssue({ code: 'custom', path: ['payToAddressLine1'], message: 'Pay-to address (street, city, state, ZIP+4) is required when it differs from the billing provider' });
      }
    }
    if (v.lateFeesEnabled && !v.lateFeeCents) ctx.addIssue({ code: 'custom', path: ['lateFeeCents'], message: 'Enter a late fee amount or turn late fees off' });
    if (v.noShowFeeEnabled && !v.noShowFeeCents) ctx.addIssue({ code: 'custom', path: ['noShowFeeCents'], message: 'Enter a no-show fee amount or turn the fee off' });
    if (v.lateCancelFeeEnabled && !v.lateCancelFeeCents) ctx.addIssue({ code: 'custom', path: ['lateCancelFeeCents'], message: 'Enter a late-cancel fee amount or turn the fee off' });
    if (!['02', '10'].includes(v.posTelehealthHome) || !['02', '10'].includes(v.posTelehealthOther)) {
      ctx.addIssue({ code: 'custom', path: ['posTelehealthHome'], message: 'Telehealth place of service must be 02 or 10' });
    }
  });

/** Measurement-based care rule rows: who (program / provider) gets which measures, how often */
const mbcMeasures = { instrumentIds: z.array(z.string().trim().min(1).max(60)).min(1, 'Pick at least one measure').max(10), everyDays: int(1, 365).default(30) };
const mbcProgramRuleSchema = z.object({ programId: z.string().trim().min(1).max(60), ...mbcMeasures });
const mbcProviderRuleSchema = z.object({ userId: z.string().trim().min(1).max(60), ...mbcMeasures });

export const clinicalSchema = z
  .object({
    noteSignDeadlineHours: int(1, 336).default(72),
    lateNoteEscalationHours: int(1, 720).default(72),
    lateNoteEscalationRole: z.enum(ESCALATION_ROLES).default('PRACTICE_DIRECTOR'),
    cosignRequiredRoles: z.array(z.enum(COSIGNABLE_ROLES)).max(COSIGNABLE_ROLES.length).default(['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT']),
    cosignDeadlineHours: int(1, 720).default(72),
    // Owner decision 2026-10-21: adults at most 180 days (children at most 90, applied per plan: src/lib/ehr/therapy/rules.ts)
    treatmentPlanReviewDays: int(30, 180).default(180),
    // PRP IRP: same rule as treatment plans (adult at most 180; under 18 at most 90, applied per participant: src/lib/prp/standard.ts)
    prpIrpReviewDays: int(30, 180).default(180),
    phq9IntervalDays: int(7, 365).default(30),
    gad7IntervalDays: int(7, 365).default(30),
    assessAtIntake: z.boolean().default(true),
    aiNoteConsentRequired: z.boolean().default(true),
    safetyPlanRequiredHighRisk: z.boolean().default(true),
    sudRadarAutoAssignMeasures: z.boolean().default(false),
    // Measurement-based care (src/lib/measures/job.ts): everything OFF until leadership turns it on
    mbcAutoSend: z.boolean().default(false),
    mbcVisitRule: z.boolean().default(false),
    mbcProgramRule: z.boolean().default(false),
    mbcProviderRule: z.boolean().default(false),
    mbcProgramMeasures: z.array(mbcProgramRuleSchema).max(100).default([]),
    mbcProviderMeasures: z.array(mbcProviderRuleSchema).max(100).default([]),
  })
  .refine((v) => v.lateNoteEscalationHours >= v.noteSignDeadlineHours, {
    path: ['lateNoteEscalationHours'],
    message: 'Escalation must come at or after the signing deadline',
  });

export const schedulingSchema = z.object({
  cancellationWindowHours: int(0, 168).default(24),
  telehealthDefaultPlatform: z.enum(TELEHEALTH_PLATFORMS).default('CHIME'),
});

export const complianceSchema = z.object({
  privacyOfficerName: text(120),
  privacyOfficerEmail: email,
  privacyOfficerPhone: phone,
  securityOfficerName: text(120),
  securityOfficerEmail: email,
  securityOfficerPhone: phone,
  breachContactName: text(120),
  breachContactEmail: email,
  breachContactPhone: phone,
  part2Program: z.union([z.boolean(), z.null()]).optional().transform((v) => (v === undefined ? null : v)),
  recordRetentionYearsAdult: int(5, 30).default(5),
  recordRetentionMinorAge: int(18, 30).default(21),
  /** "Require two-factor sign-in for staff" — default ON; off only for an emergency rollout pause */
  mfaRequired: z.boolean().default(true),
});

export const SECTION_SCHEMAS = {
  profile: profileSchema,
  billing: billingSchema,
  clinical: clinicalSchema,
  scheduling: schedulingSchema,
  compliance: complianceSchema,
} as const;

export const locationInputSchema = z.object({
  id: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(2, 'Location name is required').max(120),
  code: text(12),
  addressLine1: text(55),
  addressLine2: text(55),
  city: text(30),
  state,
  postalCode: zip,
  phone,
  fax: phone,
  npi: checked(10, isValidNpi, 'Location NPI must be 10 digits and pass the NPI check digit').refine((v) => !isPlaceholderNpi(v), PLACEHOLDER_NPI_MESSAGE),
  posCode: text(2).refine((v) => v === null || isValidPos(v), 'Place of service is a 2-digit CMS code'),
  timezone: z.enum(US_TIME_ZONES).default('America/New_York'),
  active: z.boolean().default(true),
  businessHours: z
    .record(
      z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
      z.object({ enabled: z.boolean(), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
    )
    .optional()
    .nullable()
    .refine((h) => !h || Object.values(h).every((d) => !d || !d.enabled || d.end > d.start), 'Closing time must be after opening time'),
});

export const baaInputSchema = z.object({
  vendorKey: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, 'Vendor key: letters, digits, dashes'),
  vendorName: z.string().trim().min(2).max(120),
  status: z.enum(['not_started', 'requested', 'signed', 'not_required']),
  signedOn: isoDate,
  expiresOn: isoDate,
  notes: text(500),
}).refine((v) => v.status !== 'signed' || v.signedOn, { path: ['signedOn'], message: 'Enter the date the BAA was signed' });

export const onboardingInputSchema = z.object({
  step: z.string().trim().max(40),
  complete: z.boolean().default(false),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type BillingInput = z.infer<typeof billingSchema>;
export type ClinicalInput = z.infer<typeof clinicalSchema>;
export type SchedulingInput = z.infer<typeof schedulingSchema>;
export type ComplianceInput = z.infer<typeof complianceSchema>;
export type LocationInput = z.infer<typeof locationInputSchema>;
export type BaaInput = z.infer<typeof baaInputSchema>;

/** Fields whose values never appear in a response or an audit entry. */
export const SENSITIVE_FIELDS = new Set(['taxId']);

/** Field names whose value differs (values themselves are not returned). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const norm = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v)) return JSON.stringify(v);
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return Object.keys(after)
    .filter((k) => after[k] !== undefined && norm(before[k]) !== norm(after[k]))
    .sort();
}

/** First zod issue as "field: message" for a form banner. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid settings';
  return issue.message;
}

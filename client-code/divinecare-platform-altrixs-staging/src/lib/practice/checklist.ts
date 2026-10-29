/**
 * Readiness checklist for practice settings. Pure: takes what the API loaded and returns
 * per-section completeness plus "Ready to bill" / "Ready to go live".
 *
 *  - bill:        a claim can't be sent (or would be rejected) without it
 *  - golive:      needed before seeing patients on Altrixs (operations / compliance)
 *  - recommended: industry standard, does not block
 */
import { DEFAULT_BAA_VENDORS, type SettingsSectionKey } from './settings';
import { isValidNpi, isValidPos, isValidTaxonomy } from './validators';

export type IntegrationState = 'configured' | 'partial' | 'demo' | 'error';

export type IntegrationStatus = {
  key: 'waystar' | 'drfirst' | 'stripe' | 'sms' | 'email' | 'chime' | 'healthlake';
  label: string;
  state: IntegrationState;
  detail: string;
};

export type PracticeSettingsView = {
  id: string | null;
  legalName: string | null;
  dbaName: string | null;
  practiceType: string | null;
  specialties: string[];
  organizationNpi: string | null;
  /** Never the full value */
  taxIdMasked: string;
  hasTaxId: boolean;
  taxonomyCodes: string[];
  medicaidProviderNumber: string | null;
  medicarePtan: string | null;
  cliaNumber: string | null;
  /** True when the CLIA comes from env LAB_FACILITY_CLIA (no CLIA saved in settings) */
  cliaFromEnv: boolean;
  omhcLicenseNumber: string | null;
  omhcLicenseExpiresOn: string | null;
  prpLicenseNumber: string | null;
  prpLicenseExpiresOn: string | null;
  accreditationBody: string | null;
  accreditationExpiresOn: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  mainPhone: string | null;
  mainFax: string | null;
  mainEmail: string | null;
  website: string | null;
  timeZone: string;
  fiscalYearStartMonth: number;
  billingContactName: string | null;
  billingContactPhone: string | null;
  billingContactEmail: string | null;
  payToSameAsBilling: boolean;
  payToAddressLine1: string | null;
  payToAddressLine2: string | null;
  payToCity: string | null;
  payToState: string | null;
  payToZip: string | null;
  renderingProviderDefault: string;
  posOffice: string;
  posTelehealthHome: string;
  posTelehealthOther: string;
  telehealthModifierDefault: string;
  statementRemitName: string | null;
  statementRemitAddressLine1: string | null;
  statementRemitAddressLine2: string | null;
  statementRemitCity: string | null;
  statementRemitState: string | null;
  statementRemitZip: string | null;
  statementMessage: string | null;
  paymentTermsDays: number;
  lateFeesEnabled: boolean;
  lateFeeCents: number | null;
  copayCollectionPolicy: string;
  noShowFeeEnabled: boolean;
  noShowFeeCents: number | null;
  lateCancelFeeEnabled: boolean;
  lateCancelFeeCents: number | null;
  cancellationWindowHours: number;
  noteSignDeadlineHours: number;
  lateNoteEscalationHours: number;
  lateNoteEscalationRole: string;
  cosignRequiredRoles: string[];
  cosignDeadlineHours: number;
  treatmentPlanReviewDays: number;
  prpIrpReviewDays: number;
  phq9IntervalDays: number;
  gad7IntervalDays: number;
  assessAtIntake: boolean;
  aiNoteConsentRequired: boolean;
  safetyPlanRequiredHighRisk: boolean;
  sudRadarAutoAssignMeasures: boolean;
  mbcAutoSend: boolean;
  mbcVisitRule: boolean;
  mbcProgramRule: boolean;
  mbcProviderRule: boolean;
  mbcProgramMeasures: { programId: string; instrumentIds: string[]; everyDays: number }[];
  mbcProviderMeasures: { userId: string; instrumentIds: string[]; everyDays: number }[];
  privacyOfficerName: string | null;
  privacyOfficerEmail: string | null;
  privacyOfficerPhone: string | null;
  securityOfficerName: string | null;
  securityOfficerEmail: string | null;
  securityOfficerPhone: string | null;
  breachContactName: string | null;
  breachContactEmail: string | null;
  breachContactPhone: string | null;
  part2Program: boolean | null;
  recordRetentionYearsAdult: number;
  recordRetentionMinorAge: number;
  /** Staff two-factor sign-in required (default true; env MFA_ENFORCE=false overrides) */
  mfaRequired: boolean;
  reviewedSections: string[];
  onboardingStep: string | null;
  onboardingCompletedAt: string | null;
  updatedAt: string | null;
};

export type LocationView = {
  id: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  fax: string | null;
  npi: string | null;
  posCode: string | null;
  timezone: string;
  active: boolean;
  isPrimary: boolean;
  businessHours: Record<string, { enabled: boolean; start: string; end: string }> | null;
  /** Fields still holding a known seeded placeholder (src/lib/practice/placeholders.ts) */
  unverifiedFields: string[];
};

export type BaaView = {
  vendorKey: string;
  vendorName: string;
  service: string | null;
  status: 'not_started' | 'requested' | 'signed' | 'not_required' | 'not_recorded';
  signedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  requiredForGoLive: boolean;
};

export type ChecklistContext = {
  settings: PracticeSettingsView;
  locations: LocationView[];
  billingProviders: { active: number; defaultNpi: string | null; problems: string[]; defaultTaxIdMatches?: boolean | null };
  payers: { active: number; verified: number };
  scheduling: { enabledServices: number; reminderChannels: string[]; telehealthPlatform: string | null };
  baas: BaaView[];
  staff: { active: number; leadership: number; clinicians: number; cliniciansMissingNpi: number };
  integrations: IntegrationStatus[];
};

export type ChecklistGate = 'bill' | 'golive' | 'recommended';

export type ChecklistItem = {
  id: string;
  section: SettingsSectionKey;
  label: string;
  done: boolean;
  gate: ChecklistGate;
  detail?: string;
};

export type SectionCompleteness = {
  key: SettingsSectionKey;
  done: number;
  total: number;
  percent: number;
  /** Required (bill / golive) items still open */
  blocking: number;
};

export type PracticeChecklist = {
  items: ChecklistItem[];
  sections: SectionCompleteness[];
  readyToBill: boolean;
  readyToGoLive: boolean;
  billBlockers: ChecklistItem[];
  goLiveBlockers: ChecklistItem[];
  percent: number;
};

const filled = (v: string | null | undefined) => Boolean(v && v.trim());

function addressComplete(a: { line1: string | null; city: string | null; state: string | null; zip: string | null }) {
  return filled(a.line1) && filled(a.city) && /^[A-Z]{2}$/.test(a.state || '') && /^(\d{5}|\d{9})$/.test(a.zip || '');
}

const SECTION_ORDER: SettingsSectionKey[] = ['profile', 'billing', 'locations', 'payers', 'clinical', 'scheduling', 'compliance', 'users', 'integrations'];

export function computePracticeChecklist(ctx: ChecklistContext): PracticeChecklist {
  const s = ctx.settings;
  const items: ChecklistItem[] = [];
  const add = (section: SettingsSectionKey, id: string, label: string, done: boolean, gate: ChecklistGate, detail?: string) =>
    items.push({ id, section, label, done, gate, ...(detail ? { detail } : {}) });
  const reviewed = (k: string) => s.reviewedSections.includes(k);
  const isOmhc = s.practiceType === 'omhc' || s.specialties.some((x) => /outpatient mental/i.test(x));
  const isPrp = s.specialties.some((x) => /PRP|psychiatric rehab/i.test(x)) || filled(s.prpLicenseNumber);

  // Practice profile
  add('profile', 'legal-name', 'Legal business name', filled(s.legalName), 'bill');
  add('profile', 'practice-type', 'Practice type', filled(s.practiceType), 'golive');
  add('profile', 'org-npi', 'Organization (Type 2) NPI', isValidNpi(s.organizationNpi), 'bill', s.organizationNpi && !isValidNpi(s.organizationNpi) ? 'Fails the NPI check digit' : undefined);
  add('profile', 'tax-id', 'Tax ID (EIN)', s.hasTaxId, 'bill');
  add('profile', 'taxonomy', 'Primary taxonomy code', s.taxonomyCodes.length > 0 && s.taxonomyCodes.every(isValidTaxonomy), 'bill');
  add('profile', 'medicaid', 'Medicaid provider number', filled(s.medicaidProviderNumber), 'recommended', 'Required to bill Maryland Medicaid / PBHS');
  add('profile', 'contact', 'Main phone and email', filled(s.mainPhone) && filled(s.mainEmail), 'golive');
  add('profile', 'omhc-license', 'OMHC facility license number and expiry', filled(s.omhcLicenseNumber) && filled(s.omhcLicenseExpiresOn), isOmhc ? 'golive' : 'recommended');
  if (isPrp) add('profile', 'prp-license', 'PRP program license number and expiry', filled(s.prpLicenseNumber) && filled(s.prpLicenseExpiresOn), 'golive');
  add('profile', 'accreditation', 'Accreditation status recorded', filled(s.accreditationBody), 'recommended');
  add('profile', 'time-zone', 'Time zone', filled(s.timeZone), 'golive');

  // Billing & claims
  const bp = ctx.billingProviders;
  add('billing', 'billing-provider', 'Default billing provider (837P 2010AA) with valid NPI, tax ID and ZIP+4', bp.active > 0 && Boolean(bp.defaultNpi) && bp.problems.length === 0, 'bill', bp.problems[0]);
  add('billing', 'billing-npi-match', 'Default billing provider uses the organization NPI', !bp.defaultNpi || !s.organizationNpi || bp.defaultNpi === s.organizationNpi || ctx.billingProviders.active > 1, 'recommended');
  add('billing', 'billing-tin-match', 'Default billing provider tax ID matches the practice EIN', bp.defaultTaxIdMatches !== false, 'recommended', bp.defaultTaxIdMatches === false ? 'Tax IDs differ — confirm which entity bills' : undefined);
  add(
    'billing',
    'pay-to',
    'Pay-to address (2010AB)',
    s.payToSameAsBilling || addressComplete({ line1: s.payToAddressLine1, city: s.payToCity, state: s.payToState, zip: s.payToZip }),
    'bill'
  );
  add('billing', 'pos', 'Place-of-service defaults (office, telehealth)', isValidPos(s.posOffice) && ['02', '10'].includes(s.posTelehealthHome) && ['02', '10'].includes(s.posTelehealthOther), 'bill');
  add('billing', 'billing-contact', 'Billing contact', filled(s.billingContactName) && (filled(s.billingContactEmail) || filled(s.billingContactPhone)), 'golive');
  add(
    'billing',
    'remit-to',
    'Statement remit-to address',
    addressComplete({ line1: s.statementRemitAddressLine1, city: s.statementRemitCity, state: s.statementRemitState, zip: s.statementRemitZip }),
    'golive'
  );
  add('billing', 'billing-reviewed', 'Copay, no-show and late-cancel policy reviewed', reviewed('billing'), 'golive');

  // Locations
  const active = ctx.locations.filter((l) => l.active);
  const complete = active.filter(
    (l) => filled(l.addressLine1) && filled(l.city) && filled(l.state) && filled(l.postalCode) && filled(l.phone) && !l.unverifiedFields.includes('addressLine1')
  );
  add('locations', 'location-any', 'At least one active service location', active.length > 0, 'golive');
  add('locations', 'location-address', 'Every active location has address and phone', active.length > 0 && complete.length === active.length, 'bill', active.length > complete.length ? `${active.length - complete.length} location(s) incomplete` : undefined);
  add('locations', 'location-pos', 'Every active location has a place-of-service code', active.length > 0 && active.every((l) => isValidPos(l.posCode)), 'recommended');
  const placeholderNpi = active.filter((l) => l.unverifiedFields.includes('npi')).length;
  add(
    'locations',
    'location-npi',
    'Location NPIs are real and pass the check digit (where set)',
    active.every((l) => !l.npi || (isValidNpi(l.npi) && !l.unverifiedFields.includes('npi'))),
    'bill',
    placeholderNpi ? `${placeholderNpi} location(s) hold an imported placeholder NPI` : undefined
  );
  add('locations', 'location-hours', 'Business hours set for every active location', active.length > 0 && active.every((l) => l.businessHours && Object.values(l.businessHours).some((d) => d.enabled)), 'recommended');

  // Payers
  add('payers', 'payer-any', 'At least one payer mapped to a Waystar payer ID', ctx.payers.active > 0, 'bill');
  add('payers', 'payer-verified', 'All mapped payers verified', ctx.payers.active > 0 && ctx.payers.verified === ctx.payers.active, 'recommended', ctx.payers.active > ctx.payers.verified ? `${ctx.payers.active - ctx.payers.verified} unverified` : undefined);

  // Clinical
  add('clinical', 'clinical-reviewed', 'Note signing, co-sign and review cadences confirmed', reviewed('clinical'), 'golive');
  add('clinical', 'ai-consent', 'AI note drafting requires documented client consent', s.aiNoteConsentRequired, 'recommended');
  add('clinical', 'safety-plan', 'Safety plan required for high-risk clients', s.safetyPlanRequiredHighRisk, 'recommended');

  // Scheduling
  add('scheduling', 'appointment-types', 'Appointment types enabled', ctx.scheduling.enabledServices > 0, 'golive');
  add('scheduling', 'reminders', 'Appointment reminders on (SMS or email)', ctx.scheduling.reminderChannels.length > 0, 'recommended');
  add('scheduling', 'telehealth-platform', 'Default telehealth platform', filled(ctx.scheduling.telehealthPlatform), 'golive');
  add('scheduling', 'scheduling-reviewed', 'Cancellation window confirmed', reviewed('scheduling'), 'recommended');

  // Compliance
  add('compliance', 'privacy-officer', 'HIPAA privacy officer', filled(s.privacyOfficerName) && (filled(s.privacyOfficerEmail) || filled(s.privacyOfficerPhone)), 'golive');
  add('compliance', 'security-officer', 'HIPAA security officer', filled(s.securityOfficerName) && (filled(s.securityOfficerEmail) || filled(s.securityOfficerPhone)), 'golive');
  add('compliance', 'breach-contact', 'Breach notification contact', filled(s.breachContactName) && (filled(s.breachContactEmail) || filled(s.breachContactPhone)), 'golive');
  add('compliance', 'part2', '42 CFR Part 2 program status answered', s.part2Program !== null, 'golive');
  add('compliance', 'retention', 'Record retention period confirmed', reviewed('compliance'), 'golive');
  for (const vendor of DEFAULT_BAA_VENDORS) {
    const row = ctx.baas.find((b) => b.vendorKey === vendor.key);
    const ok = row ? row.status === 'signed' || row.status === 'not_required' : false;
    add('compliance', `baa-${vendor.key}`, `BAA: ${vendor.name}`, ok, vendor.requiredForGoLive ? 'golive' : 'recommended');
  }

  // Users & security
  add('users', 'leadership', 'A practice leader (admin / director) account', ctx.staff.leadership > 0, 'golive');
  add('users', 'clinicians', 'At least one clinician account', ctx.staff.clinicians > 0, 'golive');
  add('users', 'clinician-npi', 'Every clinician has a valid individual NPI (rendering provider)', ctx.staff.clinicians > 0 && ctx.staff.cliniciansMissingNpi === 0, 'bill', ctx.staff.cliniciansMissingNpi ? `${ctx.staff.cliniciansMissingNpi} missing or invalid` : undefined);

  // Integrations
  const integ = (k: IntegrationStatus['key']) => ctx.integrations.find((i) => i.key === k);
  add('integrations', 'int-waystar', 'Waystar clearinghouse connected', integ('waystar')?.state === 'configured', 'bill', integ('waystar')?.detail);
  add('integrations', 'int-email', 'Email delivery (SES) configured', integ('email')?.state === 'configured', 'golive', integ('email')?.detail);
  add('integrations', 'int-chime', 'Telehealth (Chime) live', integ('chime')?.state === 'configured', 'golive', integ('chime')?.detail);
  add('integrations', 'int-drfirst', 'DrFirst e-prescribing configured', integ('drfirst')?.state === 'configured', 'recommended', integ('drfirst')?.detail);
  add('integrations', 'int-sms', 'SMS reminders (registered number)', integ('sms')?.state === 'configured', 'recommended', integ('sms')?.detail);

  const sections: SectionCompleteness[] = SECTION_ORDER.map((key) => {
    const list = items.filter((i) => i.section === key);
    const done = list.filter((i) => i.done).length;
    return {
      key,
      done,
      total: list.length,
      percent: list.length ? Math.round((done / list.length) * 100) : 100,
      blocking: list.filter((i) => !i.done && i.gate !== 'recommended').length,
    };
  });
  const billBlockers = items.filter((i) => !i.done && i.gate === 'bill');
  const goLiveBlockers = items.filter((i) => !i.done && (i.gate === 'golive' || i.gate === 'bill'));
  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    sections,
    readyToBill: billBlockers.length === 0,
    readyToGoLive: goLiveBlockers.length === 0,
    billBlockers,
    goLiveBlockers,
    percent: items.length ? Math.round((doneCount / items.length) * 100) : 0,
  };
}

/** Settings row defaults (matches the Prisma column defaults) as a view, for orgs with no row yet. */
export function emptySettingsView(): PracticeSettingsView {
  return {
    id: null,
    legalName: null,
    dbaName: null,
    practiceType: null,
    specialties: [],
    organizationNpi: null,
    taxIdMasked: '',
    hasTaxId: false,
    taxonomyCodes: [],
    medicaidProviderNumber: null,
    medicarePtan: null,
    cliaNumber: null,
    cliaFromEnv: false,
    omhcLicenseNumber: null,
    omhcLicenseExpiresOn: null,
    prpLicenseNumber: null,
    prpLicenseExpiresOn: null,
    accreditationBody: null,
    accreditationExpiresOn: null,
    logoUrl: null,
    brandColor: null,
    mainPhone: null,
    mainFax: null,
    mainEmail: null,
    website: null,
    timeZone: 'America/New_York',
    fiscalYearStartMonth: 1,
    billingContactName: null,
    billingContactPhone: null,
    billingContactEmail: null,
    payToSameAsBilling: true,
    payToAddressLine1: null,
    payToAddressLine2: null,
    payToCity: null,
    payToState: null,
    payToZip: null,
    renderingProviderDefault: 'appointment_clinician',
    posOffice: '11',
    posTelehealthHome: '10',
    posTelehealthOther: '02',
    telehealthModifierDefault: '95',
    statementRemitName: null,
    statementRemitAddressLine1: null,
    statementRemitAddressLine2: null,
    statementRemitCity: null,
    statementRemitState: null,
    statementRemitZip: null,
    statementMessage: null,
    paymentTermsDays: 30,
    lateFeesEnabled: false,
    lateFeeCents: null,
    copayCollectionPolicy: 'at_check_in',
    noShowFeeEnabled: false,
    noShowFeeCents: null,
    lateCancelFeeEnabled: false,
    lateCancelFeeCents: null,
    cancellationWindowHours: 24,
    noteSignDeadlineHours: 72,
    lateNoteEscalationHours: 72,
    lateNoteEscalationRole: 'PRACTICE_DIRECTOR',
    cosignRequiredRoles: ['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT'],
    cosignDeadlineHours: 72,
    treatmentPlanReviewDays: 180,
    prpIrpReviewDays: 180,
    phq9IntervalDays: 30,
    gad7IntervalDays: 30,
    assessAtIntake: true,
    aiNoteConsentRequired: true,
    safetyPlanRequiredHighRisk: true,
    sudRadarAutoAssignMeasures: false,
    mbcAutoSend: false,
    mbcVisitRule: false,
    mbcProgramRule: false,
    mbcProviderRule: false,
    mbcProgramMeasures: [],
    mbcProviderMeasures: [],
    privacyOfficerName: null,
    privacyOfficerEmail: null,
    privacyOfficerPhone: null,
    securityOfficerName: null,
    securityOfficerEmail: null,
    securityOfficerPhone: null,
    breachContactName: null,
    breachContactEmail: null,
    breachContactPhone: null,
    part2Program: null,
    recordRetentionYearsAdult: 5,
    recordRetentionMinorAge: 21,
    mfaRequired: true,
    reviewedSections: [],
    onboardingStep: null,
    onboardingCompletedAt: null,
    updatedAt: null,
  };
}


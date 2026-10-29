/**
 * Single source of truth for CPT / HCPCS fee schedule, modifiers, and POS.
 * Used by Billing UI, claim create, AI coding, note-builder, prior-auth.
 */

export type CptCategory =
  | 'Therapy'
  | 'Evaluation'
  | 'MedMgmt'
  | 'AddOn'
  | 'Crisis'
  | 'MobileCrisis'
  | 'Residential'
  | 'PRP'
  | 'PeerSupport'
  | 'CaseMgmt'
  | 'SUD'
  | 'CollabCare';

export type CptCode = {
  code: string;
  desc: string;
  /** Dollar rate (fee schedule) */
  rate: number;
  /** Demo / seed units for revenue display */
  units: number;
  category: CptCategory;
};

export type ModifierCode = {
  modifier: string;
  desc: string;
  posNote: string;
  category: string;
};

export type PosCode = {
  pos: string;
  desc: string;
};

export const CPT_CODES: CptCode[] = [
  // Therapy
  { code: '90837', desc: 'Individual Therapy — 60 min', rate: 180, units: 62, category: 'Therapy' },
  { code: '90834', desc: 'Individual Therapy — 45 min', rate: 135, units: 48, category: 'Therapy' },
  { code: '90832', desc: 'Individual Therapy — 30 min', rate: 89, units: 14, category: 'Therapy' },
  { code: '90853', desc: 'Group Therapy', rate: 60, units: 44, category: 'Therapy' },
  { code: '90847', desc: 'Family Therapy (with client)', rate: 160, units: 18, category: 'Therapy' },
  { code: '90846', desc: 'Family Therapy (without client)', rate: 145, units: 6, category: 'Therapy' },
  // Evaluation
  { code: '90791', desc: 'Psychiatric Evaluation', rate: 250, units: 9, category: 'Evaluation' },
  { code: '90792', desc: 'Psychiatric Eval w/ Med Mgmt', rate: 295, units: 5, category: 'Evaluation' },
  // MedMgmt
  { code: '99213', desc: 'Med Management — 15 min (E&M Level 3)', rate: 89, units: 31, category: 'MedMgmt' },
  { code: '99214', desc: 'Med Management — 25 min (E&M Level 4)', rate: 145, units: 16, category: 'MedMgmt' },
  { code: '99215', desc: 'Med Management — 40 min (E&M Level 5)', rate: 195, units: 4, category: 'MedMgmt' },
  // AddOn
  { code: '90785', desc: 'Interactive Complexity Add-On (+ to psych)', rate: 35, units: 22, category: 'AddOn' },
  {
    code: '90833',
    desc: 'Psychotherapy Add-On 30 min (with E&M) — Mod 25 required',
    rate: 68,
    units: 18,
    category: 'AddOn',
  },
  {
    code: '90836',
    desc: 'Psychotherapy Add-On 45 min (with E&M) — Mod 25 required',
    rate: 98,
    units: 8,
    category: 'AddOn',
  },
  {
    code: '90838',
    desc: 'Psychotherapy Add-On 60 min (with E&M) — Mod 25 required',
    rate: 130,
    units: 4,
    category: 'AddOn',
  },
  // Crisis
  { code: '90839', desc: 'Crisis Psychotherapy — first 60 min', rate: 220, units: 5, category: 'Crisis' },
  {
    code: '90840',
    desc: 'Crisis Psychotherapy — each addl 30 min (add-on to 90839)',
    rate: 110,
    units: 3,
    category: 'Crisis',
  },
  // Mobile Crisis
  { code: 'H2011', desc: 'Crisis Intervention Service (per 15-min unit)', rate: 34, units: 85, category: 'MobileCrisis' },
  { code: 'S9484', desc: 'Crisis Intervention (per hour)', rate: 125, units: 14, category: 'MobileCrisis' },
  { code: 'S9485', desc: 'Crisis Intervention Mental Health (per diem)', rate: 350, units: 6, category: 'MobileCrisis' },
  // Residential (ASAM 3.1 & 3.5)
  { code: 'H0018', desc: 'ASAM 3.5 High-Intensity Residential (per diem, POS 55)', rate: 385, units: 48, category: 'Residential' },
  { code: 'H0019', desc: 'ASAM 3.1 Clinically Managed Low-Intensity Residential (per diem, POS 55)', rate: 245, units: 36, category: 'Residential' },
  // PRP
  { code: 'H2017', desc: 'PRP Services (per 15 min unit)', rate: 24, units: 152, category: 'PRP' },
  { code: 'H2017HK', desc: 'PRP Services — Program Director (Mod HK)', rate: 36, units: 28, category: 'PRP' },
  { code: 'H0036', desc: 'Community Support (per 15 min)', rate: 18, units: 44, category: 'PRP' },
  // PeerSupport
  { code: 'H0038', desc: 'Self-Help / Peer Services (per 15 min) — Mod U3', rate: 16, units: 88, category: 'PeerSupport' },
  // CaseMgmt
  { code: 'T1016', desc: 'Case Management (per 15 min)', rate: 22, units: 64, category: 'CaseMgmt' },
  { code: 'T1017', desc: 'Targeted Case Management (per 15 min)', rate: 28, units: 32, category: 'CaseMgmt' },
  // SUD
  { code: '99408', desc: 'SBIRT — Alcohol/Drug Screening (15-30 min)', rate: 30, units: 11, category: 'SUD' },
  { code: '99409', desc: 'SBIRT — Alcohol/Drug Intervention (>30 min)', rate: 58, units: 4, category: 'SUD' },
  { code: 'H0004', desc: 'BH Counseling & Therapy (per 15 min) — Mod HF', rate: 24, units: 38, category: 'SUD' },
  // CollabCare
  { code: '99492', desc: 'Collaborative Care Mgmt — Initial (70+ min)', rate: 285, units: 2, category: 'CollabCare' },
  { code: '99493', desc: 'Collaborative Care Mgmt — Subsequent (60+ min)', rate: 185, units: 6, category: 'CollabCare' },
  { code: '99494', desc: 'Collaborative Care Add-On (each addl 30 min)', rate: 85, units: 4, category: 'CollabCare' },
];

export const CPT_CATEGORIES: CptCategory[] = [
  'Therapy',
  'Evaluation',
  'MedMgmt',
  'AddOn',
  'Crisis',
  'MobileCrisis',
  'Residential',
  'PRP',
  'PeerSupport',
  'CaseMgmt',
  'SUD',
  'CollabCare',
];

export const CAT_COLORS: Record<CptCategory, { bg: string; text: string; border: string }> = {
  Therapy: { bg: '#F3E8FF', text: '#6B21A8', border: '#D8B4FE' },
  Evaluation: { bg: '#FDF4FF', text: '#A21CAF', border: '#F0ABFC' },
  MedMgmt: { bg: '#ECFCCB', text: '#3F6212', border: '#BEF264' },
  AddOn: { bg: '#E0F2FE', text: '#0369A1', border: '#7DD3FC' },
  Crisis: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  MobileCrisis: { bg: '#FEE2E2', text: '#991B1B', border: '#F87171' },
  Residential: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  PRP: { bg: '#CCFBF1', text: '#0F766E', border: '#5EEAD4' },
  PeerSupport: { bg: '#FCE7F3', text: '#BE185D', border: '#F9A8D4' },
  CaseMgmt: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  SUD: { bg: '#FFEDD5', text: '#C2410C', border: '#FDBA74' },
  CollabCare: { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
};

export const MODIFIER_CODES: ModifierCode[] = [
  {
    modifier: '95',
    desc: 'Synchronous telemedicine via A/V',
    posNote: 'Use with POS 02 or 10',
    category: 'Telehealth',
  },
  {
    modifier: 'GT',
    desc: 'Interactive audio/video telehealth (Medicare)',
    posNote: 'Use with POS 02 or 10',
    category: 'Telehealth',
  },
  {
    modifier: 'AH',
    desc: 'Clinical psychologist (PhD / PsyD)',
    posNote: 'Credential',
    category: 'Credential',
  },
  {
    modifier: 'AJ',
    desc: 'Clinical social worker (LCSW)',
    posNote: 'Credential',
    category: 'Credential',
  },
  {
    modifier: 'HN',
    desc: "Bachelor's level clinician",
    posNote: 'Credential',
    category: 'Credential',
  },
  {
    modifier: 'HO',
    desc: "Master's level (LPC / LCSW / LGPC)",
    posNote: 'Credential',
    category: 'Credential',
  },
  {
    modifier: 'HM',
    desc: 'Less than bachelor’s level',
    posNote: 'Credential',
    category: 'Credential',
  },
  {
    modifier: 'HQ',
    desc: 'Group setting',
    posNote: 'Use with 90853',
    category: 'Service',
  },
  {
    modifier: 'HF',
    desc: 'Substance use disorder program',
    posNote: 'Use with H0004',
    category: 'Service',
  },
  {
    modifier: 'TJ',
    desc: 'Children / adolescents',
    posNote: 'Pediatric / adolescent services',
    category: 'Service',
  },
  {
    modifier: '25',
    desc: 'Significant, separately identifiable E&M same day',
    posNote: 'Required when E&M + psychotherapy same day',
    category: 'Billing rules',
  },
  {
    modifier: '59',
    desc: 'Distinct procedural service / unbundle',
    posNote: 'Distinct / unbundle add-on',
    category: 'Billing rules',
  },
  {
    modifier: 'EP',
    desc: 'EPSDT service (under 21)',
    posNote: 'Maryland Medicaid',
    category: 'Maryland Medicaid',
  },
  {
    modifier: 'U1',
    desc: 'High level of care',
    posNote: 'Maryland Medicaid LOC',
    category: 'Maryland Medicaid',
  },
  {
    modifier: 'U3',
    desc: 'Peer / self-help services',
    posNote: 'Required with H0038',
    category: 'Maryland Medicaid',
  },
];

export const POS_CODES: PosCode[] = [
  { pos: '02', desc: 'Telehealth off-site (patient not at home)' },
  { pos: '03', desc: 'School' },
  { pos: '10', desc: 'Telehealth patient in home' },
  { pos: '11', desc: 'Office / outpatient clinic' },
  { pos: '12', desc: 'Home (non-telehealth)' },
  { pos: '13', desc: 'Assisted Living' },
  { pos: '14', desc: 'Group Home' },
  { pos: '15', desc: 'Mobile Unit (Mobile Crisis / Street Outreach)' },
  { pos: '23', desc: 'Emergency Room (crisis)' },
  { pos: '53', desc: 'CMHC' },
  { pos: '55', desc: 'Residential SUD Treatment Facility (ASAM 3.1 / 3.5)' },
  { pos: '56', desc: 'Psychiatric Residential Treatment Facility' },
  { pos: '99', desc: 'Other / unlisted' },
];

/** Strip trailing -MOD segments (e.g. 90837-GT → 90837). */
export function baseCptCode(raw: string): string {
  const cleaned = (raw || '').trim().toUpperCase();
  if (!cleaned) return '';
  const primary = cleaned.split('-')[0] || cleaned;
  // H2017HK is a single catalog code, not H2017 + HK
  if (cleaned.startsWith('H2017HK')) return 'H2017HK';
  return primary;
}

export function cptByCode(code: string): CptCode | undefined {
  const base = baseCptCode(code);
  return CPT_CODES.find((c) => c.code === base || c.code === code.trim().toUpperCase());
}

/** Fee-schedule price. CPT 99212 has no fee. Unknown codes are not given a made-up price. */
export function feeForCode(code: string): number | null {
  if (baseCptCode(code) === '99212') return null;
  const row = cptByCode(code);
  return row ? row.rate : null;
}

/** Charge in dollars for rate × units. */
export function chargeAmount(code: string, units = 1): number {
  const fee = feeForCode(code);
  if (fee == null) return 0;
  const u = Math.max(1, Math.min(99, Number(units) || 1));
  return fee * u;
}

/** Charge in cents for backend claim amountCents. */
export function chargeAmountCents(code: string, units = 1): number {
  return Math.round(chargeAmount(code, units) * 100);
}

export function cptDescription(code: string): string {
  return cptByCode(code)?.desc || `CPT ${baseCptCode(code) || code}`;
}

export function cptRateCents(code: string): number {
  const row = cptByCode(code);
  return row ? Math.round(row.rate * 100) : 14000;
}

export function defaultPosForCpt(code: string): string {
  const row = cptByCode(code);
  if (!row) return '11';
  if (row.category === 'Crisis') return '23';
  if (row.category === 'MobileCrisis') return '15';
  if (row.category === 'Residential') return '55';
  if (row.category === 'PRP' || row.category === 'PeerSupport' || row.category === 'CaseMgmt') return '99';
  return '11';
}

export function cptCodesByCategory(): Record<CptCategory, CptCode[]> {
  const map = {} as Record<CptCategory, CptCode[]>;
  for (const cat of CPT_CATEGORIES) map[cat] = [];
  for (const row of CPT_CODES) map[row.category].push(row);
  return map;
}

/** Total demo revenue across catalog (rate × demo units). */
export function catalogTotalRevenue(): number {
  return CPT_CODES.reduce((sum, c) => sum + c.rate * c.units, 0);
}

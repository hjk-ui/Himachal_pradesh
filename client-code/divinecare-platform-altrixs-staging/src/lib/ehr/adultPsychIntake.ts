/**
 * Adult Psychiatry Intake note (Valant template 18771 "MD Health - Adult
 * Psychiatry Intake Note" equivalent).
 *
 * Reuses the child-intake helpers (history chips, rows, checklists, grids,
 * ROS, overall risk + safety-plan rule). This module holds only what differs
 * for adults. Same rules: only what the clinician clicks, or what comes from
 * the chart (labeled), is written; nothing defaults to a normal finding.
 */
import { NOTE_SECTIONS } from '@/lib/ehr/noteTemplates';
import { CPI, CPI_CODE_OPTIONS, cpiRiskBlockers, type Tri } from '@/lib/ehr/childPsychIntake';

export const ADULT_PSYCH_INTAKE = 'Adult Psych Intake' as const;
export const API_SECTIONS = NOTE_SECTIONS[ADULT_PSYCH_INTAKE];

/**
 * Section headings (same strings as the child note where shared). No
 * "History of Present Illness/Interval History" and no "Trauma/Stressors":
 * trauma exposure is documented inside Stressors.
 */
export const API = {
  header: CPI.header,
  chiefComplaint: CPI.chiefComplaint,
  hpi: CPI.hpi,
  inpatient: CPI.inpatient,
  outpatient: CPI.outpatient,
  suicideHx: CPI.suicideHx,
  psychMedHx: CPI.psychMedHx,
  abuse: CPI.abuse,
  pastMedical: CPI.pastMedical,
  menstruation: CPI.menstruation,
  allergies: CPI.allergies,
  substanceHx: CPI.substanceHx,
  /** unconfirmed in Valant 18771 screenshot — remove here and in NOTE_SECTIONS if Valant lacks it */
  substanceConsequences: CPI.substanceConsequences,
  substanceTx: CPI.substanceTx,
  familyHx: CPI.familyHx,
  familyRelationships: CPI.familyRelationships,
  developmental: CPI.developmental,
  social: CPI.social,
  legal: CPI.legal,
  violence: CPI.violence,
  stressors: CPI.stressors,
  ros: CPI.ros,
  exam: CPI.exam,
  sourcesOfRisk: CPI.sourcesOfRisk,
  riskFactors: CPI.riskFactors,
  protectiveFactors: CPI.protectiveFactors,
  diagnoses: CPI.diagnoses,
  meds: CPI.meds,
  plan: CPI.plan,
  medChanges: CPI.medChanges,
  nextAppt: CPI.nextAppt,
  review: CPI.review,
} as const;

/** History sections offered for "Bring forward" from a prior adult intake. */
export const API_CARRY_FORWARD = [
  API.inpatient,
  API.outpatient,
  API.suicideHx,
  API.psychMedHx,
  API.abuse,
  API.pastMedical,
  API.menstruation,
  API.allergies,
  API.substanceHx,
  API.substanceConsequences,
  API.substanceTx,
  API.familyHx,
  API.familyRelationships,
  API.developmental,
  API.social,
  API.legal,
  API.violence,
  API.stressors,
] as const;

/** Same codes as the child intake: 90792 and E/M 99204/99205/99214/99215 (only those in the CPT catalog). */
export const API_CODE_OPTIONS = CPI_CODE_OPTIONS;

/** High overall suicide risk needs a safety plan — same rule and heading as the child note. */
export const apiRiskBlockers = cpiRiskBlockers;

const clean = (v: string | null | undefined) => (v || '').trim();

// ─── Header ─────────────────────────────────────────────────────────────────

export const ADULT_INFORMANTS = ['Patient', 'Spouse / partner', 'Family member', 'Friend', 'Other provider', 'Prior records', 'Other'] as const;
/** The adult patient is the default history source; the clinician can add collateral sources. */
export const ADULT_DEFAULT_INFORMANTS = ['Patient'];

export function adultHeaderLines(input: {
  informants: string[];
  informantOther: string;
  collateralName: string;
  collateralRelationship: string;
}): string[] {
  const informants = input.informants.map((i) => (i === 'Other' && clean(input.informantOther) ? `Other (${clean(input.informantOther)})` : i));
  const collateral = [clean(input.collateralName), clean(input.collateralRelationship) ? `(${clean(input.collateralRelationship)})` : '']
    .filter(Boolean)
    .join(' ');
  return [
    `History obtained from: ${informants.length ? informants.join(', ') : 'Not documented'}`,
    collateral ? `Collateral contact: ${collateral}` : '',
  ].filter(Boolean);
}

// ─── Option lists (adult wording) ───────────────────────────────────────────

export const ADULT_ABUSE_TYPES = [
  'Childhood physical',
  'Childhood sexual',
  'Childhood emotional',
  'Childhood neglect',
  'Adult physical',
  'Adult sexual',
  'Intimate partner violence',
  'Witnessed domestic violence',
];
export const ADULT_LEGAL_TYPES = ['Arrest(s)', 'Charges pending', 'Probation / parole', 'Court-ordered treatment', 'Custody issues', 'Incarceration'];
export const ADULT_STRESSOR_TYPES = [
  'Work / unemployment',
  'Relationship conflict',
  'Separation / divorce',
  'Family conflict',
  'Parenting',
  'Caregiving',
  'Financial',
  'Housing',
  'Health',
  'Loss / bereavement',
  'Legal',
  'Discrimination',
];
/** Adults have no separate trauma section: trauma exposure is documented in Stressors. */
export const ADULT_TRAUMA_TYPES = [
  'Physical assault',
  'Sexual assault',
  'Intimate partner violence',
  'Combat / military trauma',
  'Childhood abuse',
  'Accident / injury',
  'Medical trauma',
  'Community violence',
  'Traumatic loss',
  'Natural disaster',
  'Displacement / immigration',
];
export const ADULT_SUBSTANCE_CONSEQUENCES = [
  'Work / school problems',
  'Legal problems / DUI',
  'Relationship / family conflict',
  'Financial problems',
  'Health problems',
  'Blackouts',
  'Withdrawal',
  'Tolerance',
  'Risky behavior while using',
  'Unable to cut down',
];
export const ADULT_SOURCES_OF_RISK = [
  'Risk to self',
  'Risk to others',
  'Victimization / risk from others',
  'Intimate partner violence',
  'Access to firearms',
  'Access to medications',
  'Substance use',
  'Impulsivity / aggression',
  'Housing instability / homelessness',
];
export const ADULT_SUICIDE_RISK_FACTORS = [
  'Prior suicide attempt',
  'Current suicidal ideation',
  'Self-harm',
  'Depression / hopelessness',
  'Family history of suicide',
  'Recent loss',
  'Abuse / trauma history',
  'Relationship breakup / divorce',
  'Job loss / financial crisis',
  'Legal problems',
  'Social isolation / living alone',
  'Access to firearms',
  'Substance use',
  'Impulsivity',
  'Military / combat history',
  'Minority stress / discrimination',
  'Recent psychiatric discharge',
  'Chronic illness / pain',
];
export const ADULT_SUICIDE_PROTECTIVE_FACTORS = [
  'Family support / connectedness',
  'Social support / friends',
  'Employment / meaningful activity',
  'Engaged in treatment',
  'Coping / problem-solving skills',
  'Future orientation',
  'Religious / cultural beliefs',
  'Restricted access to lethal means',
  'Responsibility to children / family / pets',
];
export const ADULT_RELATIVES = ['Mother', 'Father', 'Sibling', 'Child', 'Maternal relative', 'Paternal relative', 'Other'] as const;

// ─── Family relationships / social (adult wording) ──────────────────────────

export const ADULT_FAMILY_REL_FIELDS = [
  { key: 'raisedBy', label: 'Raised by / family of origin' },
  { key: 'parents', label: 'Relationship with parents' },
  { key: 'siblings', label: 'Relationship with siblings' },
  { key: 'partnerChildren', label: 'Relationship with partner / children' },
  { key: 'conflict', label: 'Family conflict / estrangement' },
];

export const MARITAL_STATUS = ['Single', 'Married', 'Partnered', 'Separated', 'Divorced', 'Widowed'] as const;
export const ADULT_SOCIAL_FIELDS = [
  { key: 'living', label: 'Living situation' },
  { key: 'marital', label: 'Marital / relationship status' },
  { key: 'children', label: 'Children / dependents' },
  { key: 'supports', label: 'Supports' },
  { key: 'religion', label: 'Religion / spirituality' },
  { key: 'finances', label: 'Finances / housing stability' },
  { key: 'transportation', label: 'Transportation' },
];

// ─── Developmental & educational (adult) ────────────────────────────────────

export const CHILDHOOD_DEV = ['No known delays / complications', 'Delays / complications reported', 'Unknown / not reported'] as const;
export const EDUCATION_LEVELS = [
  'Less than high school',
  'High school / GED',
  'Trade / vocational',
  'Some college',
  'Associate degree',
  "Bachelor's degree",
  'Graduate degree',
] as const;
export const EMPLOYMENT_STATUS = [
  'Employed full-time',
  'Employed part-time',
  'Self-employed',
  'Unemployed',
  'Student',
  'Retired',
  'Disabled / SSI-SSDI',
  'Homemaker',
] as const;
export const MILITARY_BRANCHES = ['Army', 'Navy', 'Air Force', 'Marine Corps', 'Coast Guard', 'Space Force', 'National Guard / Reserve'] as const;

export type AdultDevState = {
  childhood: '' | (typeof CHILDHOOD_DEV)[number];
  childhoodDetails: string;
  education: string;
  learning: Tri;
  learningDetails: string;
  military: '' | 'Yes' | 'No';
  branch: string;
  discharge: string;
  combat: '' | 'Yes' | 'No' | 'Unknown';
  employment: string;
  occupation: string;
};
export const EMPTY_ADULT_DEV: AdultDevState = {
  childhood: '',
  childhoodDetails: '',
  education: '',
  learning: '',
  learningDetails: '',
  military: '',
  branch: '',
  discharge: '',
  combat: '',
  employment: '',
  occupation: '',
};

export function renderAdultDevelopmental(d: AdultDevState): string {
  const lines: string[] = [];
  if (d.childhood) {
    const details = d.childhood === 'Delays / complications reported' && clean(d.childhoodDetails) ? ` — ${clean(d.childhoodDetails)}` : '';
    lines.push(`Childhood development: ${d.childhood}${details}`);
  }
  if (d.education) lines.push(`Highest education: ${d.education}`);
  if (d.learning) {
    const v = d.learning === 'Endorses' ? 'Yes' : d.learning === 'Denies' ? 'None reported' : 'Not assessed';
    lines.push(`Learning disability / special education: ${v}${d.learning === 'Endorses' && clean(d.learningDetails) ? ` — ${clean(d.learningDetails)}` : ''}`);
  }
  if (d.military === 'No') lines.push('Military service: No');
  if (d.military === 'Yes') {
    const parts = [
      clean(d.branch) ? `branch ${clean(d.branch)}` : '',
      clean(d.discharge) ? `discharge ${clean(d.discharge)}` : '',
      d.combat ? `combat exposure ${d.combat.toLowerCase()}` : '',
    ].filter(Boolean);
    lines.push(`Military service: Yes${parts.length ? ` (${parts.join('; ')})` : ''}`);
  }
  const work = [d.employment, clean(d.occupation) ? `occupation: ${clean(d.occupation)}` : ''].filter(Boolean).join('; ');
  if (work) lines.push(`Employment: ${work}`);
  return lines.join('\n');
}

// ─── Menstruation & pregnancy (adult; relevant for prescribing) ─────────────

export const PREGNANCY_STATUS = ['Not pregnant', 'Pregnant', 'Possibly pregnant', 'Unknown'] as const;
export const MENOPAUSE_STATUS = ['Premenopausal', 'Perimenopausal', 'Postmenopausal', 'Not assessed'] as const;

export type AdultMensesState = {
  lmp: string;
  pregnancy: '' | (typeof PREGNANCY_STATUS)[number];
  breastfeeding: '' | 'Yes' | 'No' | 'Not assessed';
  contraception: string;
  menopause: '' | (typeof MENOPAUSE_STATUS)[number];
  notApplicable: boolean;
};
export const EMPTY_ADULT_MENSES: AdultMensesState = { lmp: '', pregnancy: '', breastfeeding: '', contraception: '', menopause: '', notApplicable: false };

export function renderAdultMenses(m: AdultMensesState): string {
  if (m.notApplicable) return 'Not applicable.';
  return [
    clean(m.lmp) ? `LMP: ${clean(m.lmp)}` : '',
    m.pregnancy ? `Pregnancy status: ${m.pregnancy}` : '',
    m.breastfeeding ? `Breastfeeding: ${m.breastfeeding}` : '',
    clean(m.contraception) ? `Contraception: ${clean(m.contraception)}` : '',
    m.menopause ? `Menopausal status: ${m.menopause}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pregnant / possibly pregnant / breastfeeding: shown as a prescribing caution in the editor. */
export function pregnancyCaution(m: AdultMensesState): boolean {
  return m.pregnancy === 'Pregnant' || m.pregnancy === 'Possibly pregnant' || m.breastfeeding === 'Yes';
}

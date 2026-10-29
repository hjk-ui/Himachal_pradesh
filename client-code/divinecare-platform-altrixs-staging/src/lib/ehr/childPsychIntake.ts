/**
 * Child psychiatry notes: Child Psychiatry Intake (Valant template 18772, initial
 * evaluation) and Child Psychiatry Re-Eval (Valant template 46444; same sections plus
 * History of Present Illness/Interval History). Re-eval specifics live in childPsychReEval.ts.
 *
 * Pure helpers: option lists and renderers for the child-specific sections.
 * Same rules as the med-management note: only what the clinician clicks or
 * what comes from the chart (labeled) is written; nothing defaults to normal.
 */
import { CPT_CODES } from '@/lib/constants/cpt';
import { NOTE_SECTIONS } from '@/lib/ehr/noteTemplates';
import { safetyPlanDocumented } from '@/lib/ehr/psychMedMgmt';

/**
 * Child Psychiatry Re-Eval (Valant 46444). The stored key stays 'Child Psych Intake' (from
 * when this was the only child template) so saved notes keep opening with this template.
 */
export const CHILD_PSYCH_INTAKE = 'Child Psych Intake' as const;
/** Child Psychiatry Intake (Valant 18772): initial evaluation, no interval-history section. */
export const CHILD_PSYCH_INITIAL_INTAKE = 'Child Psych Initial Intake' as const;
export const CPI_SECTIONS = NOTE_SECTIONS[CHILD_PSYCH_INTAKE];
export const CPI_INITIAL_SECTIONS = NOTE_SECTIONS[CHILD_PSYCH_INITIAL_INTAKE];

export const CPI = {
  header: 'Header',
  chiefComplaint: 'Chief Complaint',
  hpi: 'HPI',
  interval: 'History of Present Illness/Interval History',
  inpatient: 'Inpatient Hx',
  outpatient: 'Outpatient Hx',
  suicideHx: 'Suicide/Self-Harm Hx',
  psychMedHx: 'Psychiatric Med Hx',
  abuse: 'Abuse',
  pastMedical: 'Past Medical Hx',
  menstruation: 'Menstruation and Pregnancy Hx',
  allergies: 'Patient Allergies',
  substanceHx: 'Substance Use Hx',
  substanceConsequences: 'Substance Use Consequences',
  substanceTx: 'Substance Treatment Hx',
  familyHx: 'Family Hx',
  familyRelationships: 'Family Relationships',
  developmental: 'Developmental and Educational Hx',
  social: 'General Social Hx',
  legal: 'Legal History',
  violence: 'Violence Hx',
  trauma: 'Trauma/Stressors',
  stressors: 'Stressors',
  ros: 'Review of Systems',
  exam: 'Exam',
  sourcesOfRisk: 'Assessment - Sources of Risk',
  riskFactors: 'Suicide Risk Factors',
  protectiveFactors: 'Suicide Protective Factors',
  diagnoses: 'Assessment - Diagnoses',
  meds: 'Meds & Allergies',
  plan: 'Plan',
  medChanges: 'Plan - Med Changes',
  nextAppt: 'Plan - Next Appointment',
  review: 'Review',
} as const;

/** History sections offered one at a time for "Bring forward" (prior note of the same type, or the prior evaluation for the re-eval). */
export const CPI_CARRY_FORWARD = [
  CPI.inpatient,
  CPI.outpatient,
  CPI.suicideHx,
  CPI.psychMedHx,
  CPI.abuse,
  CPI.pastMedical,
  CPI.menstruation,
  CPI.allergies,
  CPI.substanceHx,
  CPI.substanceConsequences,
  CPI.substanceTx,
  CPI.familyHx,
  CPI.familyRelationships,
  CPI.developmental,
  CPI.social,
  CPI.legal,
  CPI.violence,
  CPI.trauma,
  CPI.stressors,
] as const;

// ─── Service codes ──────────────────────────────────────────────────────────

const CPI_CODES = ['90792', '99204', '99205', '99214', '99215'];
/** Codes present in the CPT catalog (99204/99205 appear once added to src/lib/constants/cpt.ts). */
export const CPI_CODE_OPTIONS = CPI_CODES.flatMap((code) => {
  const c = CPT_CODES.find((x) => x.code === code);
  return c ? [{ code: c.code, label: `${c.code} — ${c.desc}` }] : [];
});
/** Psychotherapy add-ons are billed with E/M codes only (not with 90792). */
export function addOnAllowed(code: string): boolean {
  return /^992/.test(code);
}

const clean = (v: string | null | undefined) => (v || '').trim();

// ─── Header extras ──────────────────────────────────────────────────────────

export const INFORMANTS = ['Patient', 'Parent/guardian', 'Other caregiver', 'School', 'Prior records', 'Other'] as const;
export type EvalKind = '' | 'Initial evaluation' | 'Re-evaluation';

export function childHeaderLines(input: {
  evalKind: EvalKind;
  informants: string[];
  informantOther: string;
  guardianName: string;
  guardianRelationship: string;
}): string[] {
  const informants = input.informants.map((i) => (i === 'Other' && clean(input.informantOther) ? `Other (${clean(input.informantOther)})` : i));
  const guardian = [clean(input.guardianName), clean(input.guardianRelationship) ? `(${clean(input.guardianRelationship)})` : '']
    .filter(Boolean)
    .join(' ');
  return [
    `Evaluation type: ${input.evalKind || 'Not selected'}`,
    `History obtained from: ${informants.length ? informants.join(', ') : 'Not documented'}`,
    guardian ? `Guardian / informant present: ${guardian}` : '',
  ].filter(Boolean);
}

/**
 * Header extras from a saved draft's Header text, so reopening a draft keeps the
 * evaluation type, informants and guardian / collateral contact (child and adult intake).
 */
export function parseIntakeHeader(text: string): {
  evalKind: EvalKind;
  informants: string[];
  informantOther: string;
  contactName: string;
  contactRelationship: string;
} | null {
  const line = (prefix: string) => {
    const l = text.split('\n').find((x) => x.trim().startsWith(prefix));
    return l ? l.trim().slice(prefix.length).trim() : null;
  };
  const from = line('History obtained from:');
  if (from === null) return null;
  const kind = line('Evaluation type:');
  let informantOther = '';
  const informants =
    from === 'Not documented'
      ? []
      : from.split(', ').map((i) => {
          const m = i.match(/^Other \((.*)\)$/);
          if (m) {
            informantOther = m[1];
            return 'Other';
          }
          return i;
        });
  const contact = line('Guardian / informant present:') ?? line('Collateral contact:') ?? '';
  const cm = contact.match(/^(.*?)\s*(?:\(([^()]*)\))?$/);
  return {
    evalKind: kind === 'Initial evaluation' || kind === 'Re-evaluation' ? kind : '',
    informants,
    informantOther,
    contactName: cm ? cm[1].trim() : contact,
    contactRelationship: cm?.[2]?.trim() || '',
  };
}

// ─── Answer chips ───────────────────────────────────────────────────────────

export type Tri = '' | 'Denies' | 'Endorses' | 'Not assessed';

export type HistoryItem = { answer: Tri; types: string[]; details: string };
export const EMPTY_HISTORY: HistoryItem = { answer: '', types: [], details: '' };

export const SUICIDE_HX_TYPES = ['Suicidal ideation', 'Suicide attempt(s)', 'Non-suicidal self-injury', 'Hospitalized after attempt'];
export const ABUSE_TYPES = ['Physical', 'Sexual', 'Emotional', 'Neglect', 'Witnessed domestic violence'];
export const VIOLENCE_TYPES = ['Physical aggression', 'Property destruction', 'Threats', 'Weapon involvement', 'Fire setting', 'Cruelty to animals'];
export const LEGAL_TYPES = ['Arrest(s)', 'Juvenile court', 'Probation', 'Pending charges', 'DSS / CPS involvement', 'Custody proceedings'];
export const TRAUMA_TYPES = ['Loss / bereavement', 'Accident / injury', 'Medical trauma', 'Community violence', 'Bullying', 'Displacement / immigration', 'Natural disaster'];
export const STRESSOR_TYPES = ['School', 'Family conflict', 'Peers / bullying', 'Parental separation / divorce', 'Move / housing', 'Financial', 'Health', 'Loss'];

export function renderHistoryItem(label: string, item: HistoryItem, extra: string[] = []): string {
  if (!item.answer) return '';
  if (item.answer !== 'Endorses') return `${label}: ${item.answer}.`;
  const lines = [`${label}: Endorses${item.types.length ? ` — ${item.types.join(', ')}` : ''}.`];
  for (const e of extra) if (clean(e)) lines.push(clean(e));
  if (clean(item.details)) lines.push(`Details: ${clean(item.details)}`);
  return lines.join('\n');
}

// Abuse-specific fields
export type AbuseExtra = { perpetrator: string; reported: '' | 'Yes' | 'No' | 'Unknown' };
export function abuseExtraLines(x: AbuseExtra): string[] {
  return [
    clean(x.perpetrator) ? `Perpetrator relationship: ${clean(x.perpetrator)}` : '',
    x.reported ? `Reported to CPS / authorities: ${x.reported}` : '',
  ];
}

// ─── Repeatable rows ────────────────────────────────────────────────────────

export type RowField = { key: string; label: string; placeholder?: string };
export type RowsState = { none: boolean; rows: Record<string, string>[] };
export const EMPTY_ROWS: RowsState = { none: false, rows: [] };

export const INPATIENT_FIELDS: RowField[] = [
  { key: 'facility', label: 'Facility' },
  { key: 'dates', label: 'Dates' },
  { key: 'reason', label: 'Reason' },
];
export const OUTPATIENT_FIELDS: RowField[] = [
  { key: 'provider', label: 'Provider / program' },
  { key: 'dates', label: 'Dates' },
  { key: 'reason', label: 'Reason / type of care' },
];
export const MED_HX_FIELDS: RowField[] = [
  { key: 'med', label: 'Medication' },
  { key: 'dose', label: 'Dose' },
  { key: 'dates', label: 'Dates' },
  { key: 'response', label: 'Response' },
  { key: 'stopped', label: 'Reason stopped' },
];
export const SUBSTANCE_TX_FIELDS: RowField[] = [
  { key: 'program', label: 'Program' },
  { key: 'level', label: 'Level of care' },
  { key: 'dates', label: 'Dates' },
  { key: 'outcome', label: 'Outcome' },
];

/** "None reported." when chosen; otherwise one line per non-empty row. Rows tagged `_source` show it. */
export function renderRows(fields: RowField[], state: RowsState): string {
  const rows = state.rows
    .map((r) => {
      const parts = fields.map((f) => (clean(r[f.key]) ? `${f.label}: ${clean(r[f.key])}` : '')).filter(Boolean);
      if (!parts.length) return '';
      return `- ${parts.join('; ')}${clean(r._source) ? ` [${clean(r._source)}]` : ''}`;
    })
    .filter(Boolean);
  if (rows.length) return rows.join('\n');
  return state.none ? 'None reported.' : '';
}

// ─── Checklists ─────────────────────────────────────────────────────────────

export type Checklist = { items: string[]; none: boolean; other: string };
export const EMPTY_CHECKLIST: Checklist = { items: [], none: false, other: '' };

export function renderChecklist(label: string, c: Checklist, noneText = 'None identified'): string {
  const items = [...c.items, ...(clean(c.other) ? [clean(c.other)] : [])];
  if (items.length) return `${label}: ${items.join(', ')}`;
  return c.none ? `${label}: ${noneText}.` : '';
}

export const SUBSTANCE_CONSEQUENCES = [
  'School problems',
  'Legal problems',
  'Family conflict',
  'Health problems',
  'Blackouts',
  'Withdrawal',
  'Tolerance',
  'Risky behavior while using',
  'Unable to cut down',
];

export const SOURCES_OF_RISK = [
  'Risk to self',
  'Risk to others',
  'Victimization / risk from others',
  'Access to firearms',
  'Access to medications',
  'Substance use',
  'Impulsivity / aggression',
  'Runaway risk',
  'Online / sexual exploitation risk',
];

export const SUICIDE_RISK_FACTORS = [
  'Prior suicide attempt',
  'Current suicidal ideation',
  'Self-harm',
  'Depression / hopelessness',
  'Family history of suicide',
  'Recent loss',
  'Abuse / trauma history',
  'Bullying',
  'Social isolation',
  'Access to firearms',
  'Substance use',
  'Impulsivity',
  'Minority stress / discrimination',
  'Recent psychiatric discharge',
  'Chronic illness / pain',
];

export const SUICIDE_PROTECTIVE_FACTORS = [
  'Family support / connectedness',
  'School connectedness',
  'Peer support',
  'Engaged in treatment',
  'Coping / problem-solving skills',
  'Future orientation',
  'Religious / cultural beliefs',
  'Restricted access to lethal means',
  'Responsibility to others / pets',
];

// ─── Substance use grid ─────────────────────────────────────────────────────

export const SUBSTANCES = [
  'Alcohol',
  'Cannabis / THC vape',
  'Nicotine / vape',
  'Stimulants',
  'Opioids',
  'Benzodiazepines',
  'Hallucinogens',
  'Inhalants',
  'Other',
] as const;
export const SUBSTANCE_USE = ['Never', 'Past', 'Current', 'Not assessed'] as const;
export type SubstanceRow = { use: '' | (typeof SUBSTANCE_USE)[number]; firstUse: string; lastUse: string; frequency: string };
export type SubstanceGrid = { rows: Record<string, SubstanceRow>; otherName: string };

export function renderSubstanceGrid(g: SubstanceGrid): string {
  const lines: string[] = [];
  for (const s of SUBSTANCES) {
    const r = g.rows[s];
    if (!r?.use) continue;
    const name = s === 'Other' && clean(g.otherName) ? `Other (${clean(g.otherName)})` : s;
    const parts = [
      clean(r.firstUse) ? `first use ${clean(r.firstUse)}` : '',
      clean(r.lastUse) ? `last use ${clean(r.lastUse)}` : '',
      clean(r.frequency) ? `frequency ${clean(r.frequency)}` : '',
    ].filter(Boolean);
    lines.push(`- ${name}: ${r.use}${parts.length ? ` (${parts.join('; ')})` : ''}`);
  }
  return lines.length ? ['Substance use:', ...lines].join('\n') : '';
}

// ─── Family history grid ────────────────────────────────────────────────────

export const RELATIVES = ['Mother', 'Father', 'Sibling', 'Maternal relative', 'Paternal relative', 'Other'] as const;
export const FAMILY_CONDITIONS = [
  'Depression',
  'Bipolar disorder',
  'Anxiety',
  'ADHD',
  'Autism',
  'Schizophrenia / psychosis',
  'Substance use',
  'Suicide / attempt',
  'Other',
] as const;
export type FamilyGrid = { cells: Record<string, string[]>; none: boolean; unknown: boolean; otherCondition: string };

export function renderFamilyGrid(g: FamilyGrid): string {
  const lines: string[] = [];
  for (const c of FAMILY_CONDITIONS) {
    const rel = g.cells[c] || [];
    if (!rel.length) continue;
    const name = c === 'Other' && clean(g.otherCondition) ? `Other (${clean(g.otherCondition)})` : c;
    lines.push(`- ${name}: ${rel.join(', ')}`);
  }
  if (lines.length) return ['Family psychiatric history:', ...lines].join('\n');
  if (g.unknown) return 'Family psychiatric history: Unknown (e.g. adopted / not available).';
  return g.none ? 'Family psychiatric history: None reported.' : '';
}

// ─── Family relationships / social ──────────────────────────────────────────

export const CUSTODY = ['Both parents', 'Mother', 'Father', 'Shared custody', 'Grandparent / kin', 'Foster care / DSS', 'Other'] as const;

export type LabeledFields = Record<string, string>;
export function renderLabeled(fields: { key: string; label: string }[], v: LabeledFields): string {
  return fields
    .filter((f) => clean(v[f.key]))
    .map((f) => `${f.label}: ${clean(v[f.key])}`)
    .join('\n');
}

export const FAMILY_REL_FIELDS = [
  { key: 'household', label: 'Lives with' },
  { key: 'custody', label: 'Custody' },
  { key: 'siblings', label: 'Siblings' },
  { key: 'relationships', label: 'Family relationships' },
];
export const SOCIAL_FIELDS = [
  { key: 'peers', label: 'Peer relationships' },
  { key: 'activities', label: 'Activities / interests' },
  { key: 'screens', label: 'Screen time / social media' },
  { key: 'supports', label: 'Supports' },
];

// ─── Developmental & educational ────────────────────────────────────────────

export const MILESTONE_DOMAINS = ['Motor', 'Speech / language', 'Social', 'Toileting'] as const;
export const MILESTONE_STATUS = ['On time', 'Delayed', 'Unknown'] as const;
export const SCHOOL_SUPPORTS = ['None', 'IEP', '504 plan', 'Evaluation pending', 'Unknown'] as const;
export const ATTENDANCE = ['Regular', 'Some absences', 'Chronic absenteeism', 'Not enrolled'] as const;

export type DevState = {
  birth: Tri;
  birthDetails: string;
  milestones: Record<string, string>;
  school: string;
  grade: string;
  supports: string;
  grades: string;
  attendance: string;
  behavior: string;
};
export const EMPTY_DEV: DevState = {
  birth: '',
  birthDetails: '',
  milestones: {},
  school: '',
  grade: '',
  supports: '',
  grades: '',
  attendance: '',
  behavior: '',
};

export function renderDevelopmental(d: DevState): string {
  const lines: string[] = [];
  if (d.birth) {
    lines.push(
      `Prenatal / birth complications: ${d.birth === 'Endorses' ? 'Yes' : d.birth === 'Denies' ? 'None reported' : 'Not assessed'}${
        d.birth === 'Endorses' && clean(d.birthDetails) ? ` — ${clean(d.birthDetails)}` : ''
      }`
    );
  }
  const ms = MILESTONE_DOMAINS.filter((m) => d.milestones[m]).map((m) => `${m} ${d.milestones[m].toLowerCase()}`);
  if (ms.length) lines.push(`Developmental milestones: ${ms.join('; ')}`);
  const school = [clean(d.school), clean(d.grade) ? `grade ${clean(d.grade)}` : ''].filter(Boolean).join(', ');
  if (school) lines.push(`School: ${school}`);
  if (d.supports) lines.push(`Educational supports: ${d.supports}`);
  if (clean(d.grades)) lines.push(`Grades / academic performance: ${clean(d.grades)}`);
  if (d.attendance) lines.push(`Attendance: ${d.attendance}`);
  if (clean(d.behavior)) lines.push(`Behavior at school: ${clean(d.behavior)}`);
  return lines.join('\n');
}

// ─── Menstruation & pregnancy ───────────────────────────────────────────────

export type MensesState = { menarche: string; lmp: string; regular: '' | 'Regular' | 'Irregular' | 'Not assessed'; pregnancy: Tri; contraception: string; notApplicable: boolean };
export const EMPTY_MENSES: MensesState = { menarche: '', lmp: '', regular: '', pregnancy: '', contraception: '', notApplicable: false };

/** Shown by default only when chart sex/gender is female or not recorded. */
export function mensesApplies(gender: string | null | undefined): boolean {
  const g = clean(gender).toLowerCase();
  if (!g) return true;
  return /^(f|female|woman|girl)\b/.test(g) || g.includes('female');
}

export function renderMenses(m: MensesState): string {
  if (m.notApplicable) return 'Not applicable.';
  const lines = [
    clean(m.menarche) ? `Menarche: ${clean(m.menarche)}` : '',
    clean(m.lmp) ? `LMP: ${clean(m.lmp)}` : '',
    m.regular ? `Cycles: ${m.regular}` : '',
    m.pregnancy ? `Pregnancy history: ${m.pregnancy === 'Endorses' ? 'Yes' : m.pregnancy === 'Denies' ? 'None reported' : 'Not assessed'}` : '',
    clean(m.contraception) ? `Contraception: ${clean(m.contraception)}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

// ─── Review of systems ──────────────────────────────────────────────────────

export const ROS_SYSTEMS = [
  'Constitutional',
  'Eyes',
  'ENT',
  'Cardiovascular',
  'Respiratory',
  'Gastrointestinal',
  'Genitourinary',
  'Musculoskeletal',
  'Skin',
  'Neurological',
  'Endocrine',
  'Hematologic / lymphatic',
  'Allergic / immunologic',
] as const;
export type RosState = Record<string, { value: '' | 'Positive' | 'Negative'; comment: string }>;

export function renderRos(r: RosState): string {
  const pos = ROS_SYSTEMS.filter((s) => r[s]?.value === 'Positive').map((s) => (clean(r[s].comment) ? `${s} (${clean(r[s].comment)})` : s));
  const neg = ROS_SYSTEMS.filter((s) => r[s]?.value === 'Negative');
  const lines = [pos.length ? `Positive: ${pos.join('; ')}` : '', neg.length ? `Negative: ${neg.join(', ')}` : ''].filter(Boolean);
  return lines.length ? ['Review of systems:', ...lines].join('\n') : '';
}

// ─── Overall suicide risk + safety plan (in Suicide Protective Factors) ─────

export const RISK_LEVELS = ['Low', 'Moderate', 'High'] as const;
export type RiskLevel = '' | (typeof RISK_LEVELS)[number];
export const OVERALL_RISK_PREFIX = 'Overall suicide risk:';
export const SAFETY_PLAN_REFERENCE_PREFIX = 'Safety plan reference:';

export function renderOverallRisk(input: {
  level: RiskLevel;
  rationale: string;
  safetyPlanBlock: string;
  safetyPlanReference: string;
}): string {
  if (!input.level) return '';
  const lines = [`${OVERALL_RISK_PREFIX} ${input.level.toUpperCase()} (clinician judgment)`];
  if (clean(input.rationale)) lines.push(`Rationale: ${clean(input.rationale)}`);
  if (clean(input.safetyPlanReference)) lines.push(`${SAFETY_PLAN_REFERENCE_PREFIX} ${clean(input.safetyPlanReference)}`);
  if (clean(input.safetyPlanBlock)) lines.push(clean(input.safetyPlanBlock));
  return lines.join('\n');
}

/** High overall risk needs a safety plan (Stanley-Brown block or a reference to the saved plan). */
export function cpiRiskBlockers(sectionText: (title: string) => string): { message: string; heading: string }[] {
  const text = sectionText(CPI.protectiveFactors);
  const high = text.split('\n').some((l) => l.trim().startsWith(`${OVERALL_RISK_PREFIX} HIGH`));
  if (!high) return [];
  const withoutRiskLines = text
    .split('\n')
    .filter((l) => !l.trim().startsWith(OVERALL_RISK_PREFIX) && !l.trim().startsWith('Rationale:'))
    .join('\n');
  const hasPlan =
    /Stanley-Brown safety plan:/.test(text) ||
    text.split('\n').some((l) => l.trim().startsWith(SAFETY_PLAN_REFERENCE_PREFIX) && l.trim().length > SAFETY_PLAN_REFERENCE_PREFIX.length + 1);
  return hasPlan && safetyPlanDocumented(withoutRiskLines)
    ? []
    : [{ message: 'Overall suicide risk is HIGH: document a safety plan (or reference the saved plan) before signing.', heading: CPI.protectiveFactors }];
}

/**
 * Psychiatric Med Management note (Valant template 21774 equivalent).
 *
 * Pure helpers only (no React, no Prisma): section names, option lists, the
 * renderers that turn the structured editor state into note text, and the
 * sign-blocking rules shared by the editor, the note view and the server.
 *
 * Rules: nothing here invents a clinical finding. Chart data is rendered with a
 * "Source:" line, missing data renders as "None on file", and a field the
 * clinician has not chosen renders as nothing (or "Not selected").
 */
import { CPT_CODES } from '@/lib/constants/cpt';
import { CSSRS_BEHAVIOR, CSSRS_IDEATION, computeRisk, cssrsRiskLabel } from '@/lib/clinical/cssrsRisk';
import { NOTE_SECTIONS, normalizeNoteType } from '@/lib/ehr/noteTemplates';
import type { MseValue } from '@/components/clinical/MentalStatusExamWidget';

export const PSYCH_MED_MGMT = 'Psych Med Mgmt' as const;

export const PMM_SECTIONS = NOTE_SECTIONS[PSYCH_MED_MGMT];

export const PMM = {
  header: 'Header',
  hpi: 'History of Present Illness/Interval History',
  freeForm: 'Free Form Content',
  exam: 'Exam',
  measures: 'Measure Review',
  si: 'Suicidal Ideation',
  safetyPlan: 'Suicide Prevention Plan',
  diagnoses: 'Assessment - Diagnoses',
  meds: 'Meds & Allergies',
  sideEffects: 'Side Effects',
  labs: 'Lab Results',
  labsOrdered: 'Plan - Labs Ordered',
  plan: 'Plan',
  medChanges: 'Plan - Med Changes',
  nextAppt: 'Plan - Next Appointment',
  review: 'Review',
} as const;

export function isPsychMedMgmt(noteType: string | null | undefined): boolean {
  return Boolean(noteType) && normalizeNoteType(noteType as string) === PSYCH_MED_MGMT;
}

// ─── Billing codes (from the staging CPT catalog) ───────────────────────────

const EM_CODES = ['99212', '99213', '99214', '99215'];
const PSYCHOTHERAPY_ADDONS = ['90833', '90836', '90838'];

/** E/M codes 99212–99215 from the CPT catalog (99212 added 2026-10-21; no fee until the practice sets one). */
export const PMM_EM_OPTIONS = CPT_CODES.filter((c) => EM_CODES.includes(c.code)).map((c) => ({
  code: c.code,
  label: `${c.code} — ${c.desc}`,
}));

export const PMM_ADDON_OPTIONS = CPT_CODES.filter((c) => PSYCHOTHERAPY_ADDONS.includes(c.code)).map((c) => ({
  code: c.code,
  label: `+${c.code} — ${c.desc}`,
}));

export function cptLabel(code: string | null | undefined): string {
  if (!code) return '';
  const hit = CPT_CODES.find((c) => c.code === code);
  return hit ? `${hit.code} — ${hit.desc}` : code;
}

// ─── Small formatting helpers ───────────────────────────────────────────────

const clean = (v: string | null | undefined) => (v || '').trim();

/** Join a generated block and the clinician's own text. */
export function joinBlocks(...parts: (string | null | undefined)[]): string {
  return parts.map(clean).filter(Boolean).join('\n\n');
}

/** YYYY-MM-DD from an ISO string or date (UTC date part; dates of service are stored as UTC midnight). */
export function isoDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Whole years between dob and the reference date. */
export function ageOn(dob: string | null | undefined, onDate: string): number | null {
  if (!dob) return null;
  const b = new Date(dob);
  const r = new Date(`${onDate || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(b.getTime()) || Number.isNaN(r.getTime())) return null;
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// ─── Header ─────────────────────────────────────────────────────────────────

export type VisitType = '' | 'in-person' | 'telehealth';

export type HeaderInput = {
  patientName: string | null;
  dateOfBirth: string | null;
  mrn: string | null;
  dateOfService: string;
  providerName: string | null;
  providerRole: string | null;
  providerCredentials: string[];
  providerNpi: string | null;
  location: string;
  visitType: VisitType;
  placeOfService: string | null;
  durationMinutes: number | null;
  emCode: string;
  addOnCode: string;
  /** Psychotherapy minutes for the add-on, separate from E/M time */
  psychotherapyMinutes?: number | null;
  /** Telehealth by audio only: the claim takes the payer's audio-only modifier, not 95 */
  audioOnly?: boolean;
  /** Label for the code line (default "E/M code") */
  codeLabel?: string;
  /** Template-specific lines (e.g. informants), placed before the source line */
  extraLines?: string[];
};

export function renderHeader(h: HeaderInput): string {
  const dob = isoDate(h.dateOfBirth);
  const age = ageOn(h.dateOfBirth, h.dateOfService);
  const provider = [
    clean(h.providerName) || 'Not on file',
    clean(h.providerRole),
    h.providerCredentials.filter(Boolean).join(', '),
    h.providerNpi ? `NPI ${h.providerNpi}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const visit =
    h.visitType === 'telehealth'
      ? h.audioOnly
        ? `Telehealth, audio-only (POS ${h.placeOfService || '10'}; payer audio-only modifier)`
        : `Telehealth (POS ${h.placeOfService || '10'}, modifier 95)`
      : h.visitType === 'in-person'
        ? `In person (POS ${h.placeOfService || '11'})`
        : 'Not selected';
  const lines = [
    `Patient: ${clean(h.patientName) || 'Not on file'}`,
    `DOB: ${dob ? `${dob}${age != null ? ` (age ${age})` : ''}` : 'None on file'}`,
    `MRN: ${clean(h.mrn) || 'None on file'}`,
    `Date of service: ${h.dateOfService || 'Not entered'}`,
    `Provider: ${provider}`,
    `Location: ${clean(h.location) || 'None on file'}`,
    `Visit type: ${visit}`,
    `Total time: ${h.durationMinutes ? `${h.durationMinutes} min` : 'Not entered'}`,
    `${h.codeLabel || 'E/M code'}: ${h.emCode ? cptLabel(h.emCode) : 'Not selected'}`,
  ];
  if (h.addOnCode) {
    lines.push(`Psychotherapy add-on: +${cptLabel(h.addOnCode)}`);
    lines.push(h.psychotherapyMinutes ? `Psychotherapy time: ${h.psychotherapyMinutes} min (separate from E/M time)` : 'Psychotherapy time: Not entered');
  }
  for (const l of h.extraLines || []) if (l.trim()) lines.push(l.trim());
  lines.push('Source: patient demographics from the Altrixs chart; provider from the signed-in user profile.');
  return lines.join('\n');
}

/** "Psychotherapy time: 20 min" in a saved header ('' when absent) */
export function psychotherapyMinutesFromHeader(text: string): string {
  const m = text.match(/^Psychotherapy time:\s*(\d{1,3})\s*min/m);
  return m ? m[1] : '';
}

/** CPT psychotherapy add-on by separately documented psychotherapy minutes (16+ required). */
export function addOnCodeForMinutes(minutes: number | null | undefined): '90833' | '90836' | '90838' | null {
  if (!minutes || minutes < 16) return null;
  if (minutes >= 53) return '90838';
  if (minutes >= 38) return '90836';
  return '90833';
}

/**
 * Psychotherapy add-on checks (warnings; the claim scrubber rejects an add-on without minutes):
 * minutes documented, at least 16, matching the add-on code, and less than the total visit time
 * (E/M time and psychotherapy time are separate).
 */
export function addOnTimeIssue(input: { addOnCode: string; psychotherapyMinutes: number | null; totalMinutes: number | null }): string | null {
  if (!input.addOnCode) return null;
  const m = input.psychotherapyMinutes;
  if (!m) return `Psychotherapy add-on +${input.addOnCode}: enter the psychotherapy minutes (separate from E/M time), or the claim is held.`;
  const expected = addOnCodeForMinutes(m);
  if (!expected) return `Psychotherapy add-on needs at least 16 minutes of psychotherapy (${m} entered): remove the add-on or correct the time.`;
  if (expected !== input.addOnCode) return `${m} minutes of psychotherapy is +${expected}, not +${input.addOnCode}.`;
  if (input.totalMinutes && m >= input.totalMinutes) return `Psychotherapy time (${m} min) must be less than the total visit time (${input.totalMinutes} min): E/M time is counted separately.`;
  return null;
}

// ─── Exam (MSE) ─────────────────────────────────────────────────────────────

/** Only what the clinician selected; an empty exam renders as ''. */
export function renderMse(v: MseValue | null | undefined): string {
  if (!v) return '';
  const list = (a: string[] | undefined) => (a && a.length ? a.join(', ') : '');
  const speech = [clean(v.speechRate), clean(v.speechVolume)].filter(Boolean).join(', ');
  const mood = [clean(v.mood), clean(v.moodDescription) ? `"${clean(v.moodDescription)}"` : ''].filter(Boolean).join(' — ');
  const rows: [string, string][] = [
    ['Appearance', list(v.appearance)],
    ['Behavior/motor', list(v.behavior)],
    ['Eye contact', clean(v.eyeContact)],
    ['Speech', speech],
    ['Mood', mood],
    ['Affect', list(v.affect)],
    ['Thought process', list(v.thoughtProcess)],
    ['Thought content', list(v.thoughtContent)],
    ['Perceptions', [list(v.perceptions), clean(v.perceptionDetails)].filter(Boolean).join('; ')],
    ['Cognition', clean(v.cognition)],
    ['Insight', clean(v.insight)],
    ['Judgment', clean(v.judgment)],
    ['Additional', clean(v.additionalNotes)],
  ];
  const lines = rows.filter(([, val]) => val).map(([k, val]) => `${k}: ${val}`);
  return lines.length ? ['Mental Status Exam', ...lines].join('\n') : '';
}

// ─── Measure Review ─────────────────────────────────────────────────────────

export type MeasureRecord = {
  instrument: string;
  score: number | null;
  severity: string | null;
  /** YYYY-MM-DD or ISO */
  date: string;
  source: string;
};

export type MeasureSummary = {
  instrument: string;
  latest: { score: number | null; severity: string | null; date: string; source: string };
  previous: { score: number | null; date: string } | null;
  change: number | null;
};

const normInstrument = (name: string) => name.trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');

/** Latest + previous score per instrument, newest instrument first. */
export function summarizeMeasures(records: MeasureRecord[]): MeasureSummary[] {
  const groups = new Map<string, MeasureRecord[]>();
  for (const r of records) {
    if (!r.instrument || !isoDate(r.date)) continue;
    const key = normInstrument(r.instrument);
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const out: MeasureSummary[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
    const [latest, previous] = sorted;
    const change =
      previous && latest.score != null && previous.score != null
        ? Math.round((latest.score - previous.score) * 100) / 100
        : null;
    out.push({
      instrument: latest.instrument,
      latest: { score: latest.score, severity: latest.severity, date: isoDate(latest.date), source: latest.source },
      previous: previous ? { score: previous.score, date: isoDate(previous.date) } : null,
      change,
    });
  }
  return out.sort((a, b) => b.latest.date.localeCompare(a.latest.date));
}

export function renderMeasures(rows: MeasureSummary[]): string {
  if (!rows.length) return 'Rating scales: None on file';
  const fmt = (n: number | null) => (n == null ? '—' : String(n));
  const lines = rows.map((r) => {
    const change = r.change == null ? 'n/a' : r.change > 0 ? `+${r.change}` : String(r.change);
    const prev = r.previous ? `${fmt(r.previous.score)} (${r.previous.date})` : 'none';
    return `- ${r.instrument}: ${fmt(r.latest.score)}${r.latest.severity ? ` ${r.latest.severity}` : ''} (${r.latest.date}); previous ${prev}; change ${change}`;
  });
  const sources = [...new Set(rows.map((r) => r.latest.source))].join('; ');
  return ['Rating scales (latest vs previous):', ...lines, `Source: ${sources}.`].join('\n');
}

// ─── Suicidal Ideation (C-SSRS screen) ──────────────────────────────────────

export type YesNo = 'yes' | 'no' | '';
export type SiAnswers = Record<string, YesNo>;

export const SI_QUESTIONS = [...CSSRS_IDEATION, ...CSSRS_BEHAVIOR].map((q) => {
  const [label, question] = q.text.split(' — ');
  return { id: q.id, label: label.trim(), question: (question || q.text).trim() };
});

export type SiStatus = 'not-started' | 'incomplete' | 'negative' | 'positive';

export function siScreenStatus(answers: SiAnswers): SiStatus {
  const vals = SI_QUESTIONS.map((q) => answers[q.id] || '');
  if (vals.some((v) => v === 'yes')) return 'positive';
  const answered = vals.filter(Boolean).length;
  if (answered === 0) return 'not-started';
  return answered === SI_QUESTIONS.length ? 'negative' : 'incomplete';
}

export const SI_POSITIVE_LINE = 'C-SSRS screen result: POSITIVE';

export function renderSiScreen(input: {
  answers: SiAnswers;
  timeframe: string;
  crisisResourcesReviewed: boolean;
}): string {
  const status = siScreenStatus(input.answers);
  if (status === 'not-started') return '';
  const lines = [`C-SSRS screener (${clean(input.timeframe) || 'timeframe not specified'}):`];
  for (const q of SI_QUESTIONS) {
    const a = input.answers[q.id];
    lines.push(`- ${q.label}: ${a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not asked'}`);
  }
  if (status === 'positive') {
    const numeric = Object.fromEntries(SI_QUESTIONS.map((q) => [q.id, input.answers[q.id] === 'yes' ? 1 : 0]));
    lines.push(`${SI_POSITIVE_LINE} — ${cssrsRiskLabel(computeRisk(numeric))} by the C-SSRS algorithm. Suicide prevention plan required.`);
  } else if (status === 'negative') {
    lines.push('C-SSRS screen result: NEGATIVE (all items answered No)');
  } else {
    const answered = SI_QUESTIONS.filter((q) => input.answers[q.id]).length;
    lines.push(`C-SSRS screen result: INCOMPLETE (${answered} of ${SI_QUESTIONS.length} items answered)`);
  }
  if (input.crisisResourcesReviewed) {
    lines.push('Crisis resources reviewed with patient: 988 Suicide & Crisis Lifeline (call/text 988), 911 for emergencies.');
  }
  return lines.join('\n');
}

export function siPositiveInText(siSectionText: string): boolean {
  return siSectionText.split('\n').some((l) => l.trim().startsWith(SI_POSITIVE_LINE));
}

// ─── Suicide Prevention Plan (Stanley-Brown) ────────────────────────────────

export const SAFETY_PLAN_FIELDS = [
  { key: 'warningSigns', label: 'Warning signs' },
  { key: 'internalCoping', label: 'Internal coping strategies' },
  { key: 'socialContacts', label: 'Social contacts / settings for distraction' },
  { key: 'helpContacts', label: 'People to ask for help' },
  { key: 'professionals', label: 'Professionals / agencies (incl. 988)' },
  { key: 'meansRestriction', label: 'Means restriction / making the environment safe' },
] as const;

export type SafetyPlanKey = (typeof SAFETY_PLAN_FIELDS)[number]['key'];
export type SafetyPlanFields = Record<SafetyPlanKey, string>;

export const EMPTY_SAFETY_PLAN: SafetyPlanFields = {
  warningSigns: '',
  internalCoping: '',
  socialContacts: '',
  helpContacts: '',
  professionals: '',
  meansRestriction: '',
};

export const SAFETY_PLAN_NOT_INDICATED = 'Reviewed, not indicated';

export function renderSafetyPlan(input: {
  fields: SafetyPlanFields;
  notIndicated: boolean;
  sourceNote: string;
}): string {
  const lines = SAFETY_PLAN_FIELDS.filter((f) => clean(input.fields[f.key])).map(
    (f) => `${f.label}: ${clean(input.fields[f.key]).replace(/\n+/g, '; ')}`
  );
  if (lines.length) {
    return ['Stanley-Brown safety plan:', ...lines, clean(input.sourceNote)].filter(Boolean).join('\n');
  }
  return input.notIndicated ? `${SAFETY_PLAN_NOT_INDICATED} (C-SSRS screen not positive).` : '';
}

/** True when the section documents a plan (anything beyond the "not indicated" line). */
export function safetyPlanDocumented(sectionText: string): boolean {
  return sectionText
    .split('\n')
    .filter((l) => !l.trim().toLowerCase().startsWith(SAFETY_PLAN_NOT_INDICATED.toLowerCase()))
    .join('\n')
    .trim().length > 0;
}

type LooseContact = { name?: unknown; relationship?: unknown; phone?: unknown };
type LoosePlan = {
  steps?: { id?: unknown; title?: unknown; content?: unknown }[];
  distractionContacts?: LooseContact[];
  helpContacts?: LooseContact[];
  crisisResources?: { label?: unknown; value?: unknown }[];
  meansItems?: { label?: unknown; done?: unknown }[];
  meansNotes?: unknown;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function contactsText(list: LooseContact[] | undefined): string {
  return (list || [])
    .map((c) => [str(c.name), str(c.relationship) ? `(${str(c.relationship)})` : '', str(c.phone)].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
}

/** Map a saved Stanley-Brown plan (ehr-safety-plans module) onto the note fields. */
export function safetyPlanToFields(plan: LoosePlan): SafetyPlanFields {
  const step = (id: number) => str((plan.steps || []).find((s) => Number(s.id) === id)?.content);
  const resources = (plan.crisisResources || [])
    .map((r) => [str(r.label), str(r.value)].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
  const means = (plan.meansItems || []).filter((m) => m.done === true).map((m) => str(m.label)).filter(Boolean);
  return {
    warningSigns: step(1),
    internalCoping: step(2),
    socialContacts: joinInline(step(3), contactsText(plan.distractionContacts)),
    helpContacts: joinInline(step(4), contactsText(plan.helpContacts)),
    professionals: joinInline(step(5), resources),
    meansRestriction: joinInline(step(6), means.length ? `Completed: ${means.join('; ')}` : '', str(plan.meansNotes)),
  };
}

function joinInline(...parts: string[]): string {
  return parts.filter(Boolean).join('; ');
}

// ─── Diagnoses ──────────────────────────────────────────────────────────────

export type PmmDiagnosis = { code: string; description: string; isPrimary: boolean; fromChart: boolean };

const ICD_RE = /^([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b\s*[-–:]?\s*(.*)$/i;

/** Client.primaryDiagnosisCode / primaryDiagnosis / secondaryDiagnoses (comma- or semicolon-separated). */
export function parseChartDiagnoses(input: {
  primaryCode: string | null | undefined;
  primaryName: string | null | undefined;
  secondary: string | null | undefined;
}): PmmDiagnosis[] {
  const out: PmmDiagnosis[] = [];
  const primaryCode = clean(input.primaryCode).toUpperCase();
  if (primaryCode || clean(input.primaryName)) {
    out.push({ code: primaryCode, description: clean(input.primaryName), isPrimary: true, fromChart: true });
  }
  for (const raw of clean(input.secondary).split(/[;,\n]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const m = item.match(ICD_RE);
    const code = m ? m[1].toUpperCase() : '';
    const description = m ? m[2].trim() : item;
    if (code && out.some((d) => d.code === code)) continue;
    out.push({ code, description, isPrimary: false, fromChart: true });
  }
  return out;
}

export function renderDiagnoses(list: PmmDiagnosis[]): string {
  if (!list.length) return 'Diagnoses: None on file';
  const lines = list.map(
    (d, i) =>
      `${i + 1}. ${[d.code, d.description].filter(Boolean).join(' — ')}${d.isPrimary ? ' (primary)' : ''}${d.fromChart ? ' [on chart]' : ' [added this visit]'}`
  );
  return ['Diagnoses:', ...lines].join('\n');
}

// ─── Meds & Allergies ───────────────────────────────────────────────────────

export type PmmMedication = {
  id: string;
  name: string;
  dosage: string | null;
  route: string | null;
  frequency: string | null;
  asNeeded: boolean;
  prnReason: string | null;
  schedule: string | null;
  drFirst: boolean;
  startDate: string | null;
};

export type PmmAllergy = { allergen: string; reaction: string | null; severity: string | null; status: string | null };

export function medLine(m: PmmMedication): string {
  return [
    m.name,
    clean(m.dosage),
    clean(m.route),
    clean(m.frequency),
    m.asNeeded ? `PRN${m.prnReason ? ` ${m.prnReason}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function renderMedsAllergies(input: {
  meds: PmmMedication[];
  allergies: PmmAllergy[];
  reconciled: boolean;
}): string {
  const meds = input.meds.length
    ? ['Current medications:', ...input.meds.map((m) => `- ${medLine(m)}${m.drFirst ? ' (DrFirst)' : ''}`)]
    : ['Current medications: None on file'];
  const allergies = input.allergies.length
    ? [
        'Allergies:',
        ...input.allergies.map(
          (a) => `- ${a.allergen}${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${a.severity})` : ''}`
        ),
      ]
    : ['Allergies: None on file'];
  const lines = [
    ...meds,
    ...allergies,
    'Source: Altrixs medication list (DrFirst-synced items marked) and allergy list.',
  ];
  if (input.reconciled) lines.push('Medication list reviewed and reconciled with patient this visit.');
  return lines.join('\n');
}

/** Allergy list only (child intake "Patient Allergies"). */
export function renderAllergies(allergies: PmmAllergy[]): string {
  if (!allergies.length) return 'Allergies: None on file';
  return [
    'Allergies:',
    ...allergies.map((a) => `- ${a.allergen}${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${a.severity})` : ''}`),
    'Source: Altrixs allergy list.',
  ].join('\n');
}

// ─── Side Effects ───────────────────────────────────────────────────────────

export const SIDE_EFFECTS = [
  'Sedation',
  'Insomnia',
  'Weight gain',
  'GI upset',
  'Sexual dysfunction',
  'Dizziness',
  'Headache',
  'Tremor',
  'Akathisia / restlessness',
  'EPS / stiffness',
  'Tardive movements',
  'Dry mouth',
  'Activation / agitation',
  'Other',
] as const;

export const SIDE_EFFECT_RATINGS = ['None', 'Mild', 'Moderate', 'Severe'] as const;
export type SideEffectRating = (typeof SIDE_EFFECT_RATINGS)[number] | '';
export type SideEffectState = Record<string, { rating: SideEffectRating; comment: string }>;

export function renderSideEffects(input: { state: SideEffectState; otherLabel: string; noneReported: boolean }): string {
  const name = (k: string) => (k === 'Other' && clean(input.otherLabel) ? `Other (${clean(input.otherLabel)})` : k);
  const rated = SIDE_EFFECTS.filter((k) => input.state[k]?.rating);
  const present = rated.filter((k) => input.state[k].rating !== 'None');
  const denied = rated.filter((k) => input.state[k].rating === 'None');
  const lines: string[] = [];
  if (input.noneReported && present.length === 0) lines.push('No side effects reported by patient.');
  for (const k of present) {
    const s = input.state[k];
    lines.push(`- ${name(k)}: ${s.rating}${clean(s.comment) ? ` — ${clean(s.comment)}` : ''}`);
  }
  if (denied.length && !(input.noneReported && present.length === 0)) {
    lines.push(`Denied: ${denied.map(name).join(', ')}`);
  }
  for (const k of denied) {
    const c = clean(input.state[k].comment);
    if (c) lines.push(`- ${name(k)}: ${c}`);
  }
  return lines.join('\n');
}

// ─── Lab Results ────────────────────────────────────────────────────────────

export type PmmLabResult = {
  id: string;
  testName: string;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: string | null;
  /** Resulted (or ordered) date */
  date: string;
};

export function renderLabs(rows: PmmLabResult[], available: boolean): string {
  if (!available) return '';
  if (!rows.length) return 'Lab results: None on file';
  const lines = rows.map((r) => {
    const flag = r.flag && r.flag !== 'N' ? ` [${r.flag}]` : '';
    return `- ${isoDate(r.date)} ${r.testName}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.refRange ? ` (ref ${r.refRange})` : ''}${flag}`;
  });
  return ['Lab results:', ...lines, 'Source: Altrixs lab orders/results.'].join('\n');
}

// ─── Plan - Labs Ordered ────────────────────────────────────────────────────

export const PSYCH_LABS = [
  'CBC',
  'CMP',
  'Lipid panel',
  'Hemoglobin A1c',
  'TSH',
  'Lithium level',
  'Valproate level',
  'Carbamazepine level',
  'Clozapine level / ANC',
  'Prolactin',
  'EKG / QTc',
  'Urine drug screen',
  'Pregnancy test',
  'Vitamin D',
  'B12 / folate',
] as const;

export function renderLabsOrdered(input: { selected: string[]; other: string; noneOrdered: boolean }): string {
  const items = [...input.selected, ...clean(input.other).split(/[;\n]+/).map((s) => s.trim())].filter(Boolean);
  if (items.length) return `Labs ordered: ${items.join(', ')}`;
  return input.noneOrdered ? 'No labs ordered this visit.' : '';
}

// ─── Plan - Med Changes ─────────────────────────────────────────────────────

export const MED_ACTIONS = ['Continue', 'Increase', 'Decrease', 'Stop'] as const;
export type MedAction = (typeof MED_ACTIONS)[number] | 'Start' | '';

export type MedChangeRow = {
  key: string;
  medId: string | null;
  name: string;
  currentDose: string;
  action: MedAction;
  newDose: string;
  sig: string;
  reason: string;
  /** Schedule II–V per DrFirst or name match */
  controlled: boolean;
};

/**
 * Common controlled psychotropics and related drugs (generic and brand). Used only
 * to show the PDMP-review reminder — never to claim a review happened.
 */
const CONTROLLED_NAMES = [
  'alprazolam', 'lorazepam', 'clonazepam', 'diazepam', 'chlordiazepoxide', 'clorazepate', 'oxazepam', 'temazepam',
  'triazolam', 'midazolam', 'clobazam', 'zolpidem', 'eszopiclone', 'zaleplon', 'suvorexant', 'lemborexant', 'daridorexant',
  'amphetamine', 'dextroamphetamine', 'lisdexamfetamine', 'methamphetamine', 'methylphenidate', 'dexmethylphenidate',
  'serdexmethylphenidate', 'modafinil', 'armodafinil', 'solriamfetol', 'phentermine', 'buprenorphine', 'methadone',
  'phenobarbital', 'butalbital', 'pregabalin', 'lacosamide', 'brivaracetam', 'cenobamate', 'tramadol', 'carisoprodol',
  'esketamine', 'ketamine', 'sodium oxybate', 'oxybate', 'testosterone', 'dronabinol', 'nabilone', 'oxycodone',
  'hydrocodone', 'morphine', 'hydromorphone', 'fentanyl', 'tapentadol', 'codeine',
  'xanax', 'ativan', 'klonopin', 'valium', 'librium', 'restoril', 'halcion', 'onfi', 'ambien', 'lunesta', 'sonata',
  'belsomra', 'dayvigo', 'quviviq', 'adderall', 'mydayis', 'vyvanse', 'dexedrine', 'zenzedi', 'evekeo', 'desoxyn',
  'ritalin', 'concerta', 'methylin', 'focalin', 'azstarys', 'jornay', 'daytrana', 'cotempla', 'quillichew', 'quillivant',
  'relexxii', 'adzenys', 'dyanavel', 'provigil', 'nuvigil', 'sunosi', 'suboxone', 'subutex', 'zubsolv', 'sublocade',
  'brixadi', 'lyrica', 'spravato', 'xyrem', 'xywav', 'lumryz',
];

export function isControlledSubstance(name: string, schedule?: string | null): boolean {
  const s = clean(schedule).toLowerCase();
  if (s && s !== 'nonscheduled' && s !== 'none' && s !== 'n/a') return true;
  const n = name.toLowerCase();
  return CONTROLLED_NAMES.some((c) => new RegExp(`\\b${c.replace(/ /g, '\\s+')}\\b`).test(n));
}

export function medChangeLine(r: MedChangeRow): string {
  const name = clean(r.name);
  const reason = clean(r.reason) ? `; reason: ${clean(r.reason)}` : '';
  const sig = clean(r.sig) ? `; sig: ${clean(r.sig)}` : '';
  const cur = clean(r.currentDose);
  const next = clean(r.newDose);
  switch (r.action) {
    case 'Continue':
      return `- Continue ${name}${cur ? ` ${cur}` : ''}${sig}${reason}`;
    case 'Increase':
    case 'Decrease':
      return `- ${r.action} ${name}${cur ? ` from ${cur}` : ''}${next ? ` to ${next}` : ''}${sig}${reason}`;
    case 'Stop':
      return `- Stop ${name}${cur ? ` (was ${cur})` : ''}${reason}`;
    case 'Start':
      return `- Start ${name}${next ? ` ${next}` : ''}${sig}${reason}`;
    default:
      return '';
  }
}

/** Rows whose action changes a controlled substance (start/increase/decrease/stop). */
export function controlledChanges(rows: MedChangeRow[]): MedChangeRow[] {
  return rows.filter((r) => r.controlled && r.action && r.action !== 'Continue' && clean(r.name));
}

export function renderMedChanges(input: { rows: MedChangeRow[]; pdmpReviewed: boolean }): string {
  const lines = input.rows.filter((r) => r.action && clean(r.name)).map(medChangeLine).filter(Boolean);
  if (!lines.length) return '';
  const out = ['Medication plan:', ...lines];
  const controlled = controlledChanges(input.rows);
  if (controlled.length) {
    out.push(
      `Controlled substance change: ${controlled.map((r) => clean(r.name)).join(', ')}. ` +
        (input.pdmpReviewed
          ? 'Prescriber attests the Maryland PDMP (CRISP) was reviewed for this prescription.'
          : 'Maryland PDMP (CRISP) review required before prescribing; not documented in this note.')
    );
  }
  out.push('Prescriptions are transmitted in DrFirst Rcopia; this note does not send prescriptions.');
  return out.join('\n');
}

// ─── Plan - Next Appointment ────────────────────────────────────────────────

export const RETURN_INTERVALS = [1, 2, 4, 6, 8, 12] as const;

export type NextAppointment = { startsAt: string; type: string; isVirtual: boolean; clinicianName: string | null } | null;

export function formatApptTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function renderNextAppointment(input: {
  returnWeeks: number | null;
  next: NextAppointment;
  includeScheduled: boolean;
}): string {
  const lines: string[] = [];
  if (input.returnWeeks) lines.push(`Return in ${input.returnWeeks} week${input.returnWeeks === 1 ? '' : 's'}.`);
  if (input.includeScheduled) {
    lines.push(
      input.next
        ? `Next scheduled appointment: ${formatApptTime(input.next.startsAt)} ET — ${input.next.type}${input.next.isVirtual ? ' (telehealth)' : ''}${input.next.clinicianName ? ` with ${input.next.clinicianName}` : ''} (Altrixs schedule).`
        : 'Next scheduled appointment: None on file.'
    );
  }
  return lines.join('\n');
}

// ─── Sign blocking (template-specific part) ──────────────────────────────────

/** Med-management rule: a positive SI screen needs a documented suicide prevention plan. */
export function pmmRiskBlockers(sectionText: (title: string) => string): { message: string; heading: string }[] {
  if (siPositiveInText(sectionText(PMM.si)) && !safetyPlanDocumented(sectionText(PMM.safetyPlan))) {
    return [
      {
        message: 'The suicidal ideation screen is positive: complete the Suicide Prevention Plan before signing.',
        heading: PMM.safetyPlan,
      },
    ];
  }
  return [];
}

/**
 * "Identifying Information" for every initial intake / evaluation and re-evaluation note
 * (psychiatry: Adult / Child Psychiatry Intake and Re-Eval, Psychiatric Evaluation; therapy:
 * MD Therapy Intake, Clinical Intake Assessment; Substance Abuse Intake). Pure, browser-safe.
 *
 * Replaces the Valant-era block ("Gender: Male / Female / Transgender F-M", "Caucasian / African
 * American / Latino / Pacific Islander", "his/her") with the ONC / USCDI data elements the chart
 * already stores (src/lib/clients/demographics.ts): sex assigned at birth, gender identity and
 * pronouns, OMB race (multi-select) and ethnicity, HL7 marital status, preferred language +
 * interpreter, legal guardian. Plus the visit facts a prescriber needs at the top of an
 * evaluation: modality and (telehealth) the patient's state, who came with the patient,
 * patient-reported weight / height (dosing) with BMI, and the chief complaint in the patient's
 * own words.
 *
 * Rules:
 *  - Nothing is invented. Chart / visit / vitals values are PREFILLED (labeled with their source)
 *    for the clinician to confirm; a blank field writes nothing (its clause is left out).
 *  - The note text is "Label: value" lines under a generated narrative sentence, so the note
 *    prints / reads like any other note and a reopened draft restores the fields (parse below).
 *  - Pronouns in the narrative come from the chosen pronouns (never "his/her"); without pronouns
 *    the narrative uses the name / "the patient".
 *  - The chart is only changed by the clinician's explicit "Update chart demographics" (audited,
 *    POST /api/clients/[id]/identifying-info). AI Scribe values are suggestions for the chief
 *    complaint and accompanied-by only and never reach the chart (chartDemographicChanges skips
 *    any field whose source is 'ai').
 *  - Sign rules (chief complaint, modality, a minor's legal guardian) follow the note-format
 *    enforcement date: warnings until formatElementsEnforceFrom, then they block
 *    (notes/standard.ts noteTypeIssues).
 */
import { normalizeNoteType, structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { IDENTIFYING_INFO, SUD_INTAKE, THERAPY_INTAKE } from '@/lib/ehr/therapy/sections';
import { LANGUAGES, MARITAL_STATUS, US_STATES, genderIdentityFromText, relationshipFromText, languageFromText } from '@/lib/clients/demographics';

export const IDENTIFYING_INFO_HEADING = IDENTIFYING_INFO;

/** Initial intake / evaluation and re-evaluation note types that carry the section (= notes/typeChange INTAKE_NOTE_TYPES). */
export const IDENTIFYING_INFO_NOTE_TYPES: readonly string[] = [
  THERAPY_INTAKE,
  SUD_INTAKE,
  'Intake',
  'Psych Eval',
  'Child Psych Initial Intake',
  'Child Psych Intake',
  'Adult Psych Intake',
  'Adult Psych Re-Eval',
];
/** Re-evaluations: prefilled from the last evaluation, with "changed since last evaluation" markers. 'Child Psych Intake' is the child re-eval (Valant 46444). */
export const REEVAL_NOTE_TYPES: readonly string[] = ['Child Psych Intake', 'Adult Psych Re-Eval'];

export function hasIdentifyingInfo(noteType: string | null | undefined): boolean {
  return IDENTIFYING_INFO_NOTE_TYPES.includes(normalizeNoteType(String(noteType ?? '')));
}
export function isReEvalNoteType(noteType: string | null | undefined): boolean {
  return REEVAL_NOTE_TYPES.includes(normalizeNoteType(String(noteType ?? '')));
}

/** Visit wording in the narrative ("… was seen in the office for an initial psychiatric evaluation"). */
const VISIT_PHRASE: Record<string, string> = {
  [THERAPY_INTAKE]: 'an initial therapy intake assessment',
  [SUD_INTAKE]: 'a substance use intake assessment',
  Intake: 'an initial clinical intake assessment',
  'Psych Eval': 'a psychiatric evaluation',
  'Child Psych Initial Intake': 'an initial psychiatric evaluation',
  'Adult Psych Intake': 'an initial psychiatric evaluation',
  'Child Psych Intake': 'a psychiatric re-evaluation',
  'Adult Psych Re-Eval': 'a psychiatric re-evaluation',
};
export function visitPhrase(noteType: string | null | undefined): string {
  return VISIT_PHRASE[normalizeNoteType(String(noteType ?? ''))] ?? 'an evaluation';
}

// ─── Options (codes = the chart's code sets, so the chart update is exact) ───

export type Option = { code: string; label: string };

export const DECLINED = 'ASKU';
export const OTHER = 'OTH';

export const SEX_AT_BIRTH_OPTIONS: Option[] = [
  { code: 'F', label: 'Female' },
  { code: 'M', label: 'Male' },
  { code: 'UNK', label: 'Unknown' },
  { code: DECLINED, label: 'Prefers not to say' },
];

export const GENDER_MALE = '446151000124109';
export const GENDER_FEMALE = '446141000124107';
export const GENDER_TRANS_MALE = '407377005';
export const GENDER_TRANS_FEMALE = '407376001';
export const GENDER_NONBINARY = '33791000087105';
const GENDER_QUEER = '446131000124102';
/** Gender identity (USCDI; SNOMED CT codes as stored on the chart). */
export const GENDER_IDENTITY_OPTIONS: Option[] = [
  { code: GENDER_MALE, label: 'Male' },
  { code: GENDER_FEMALE, label: 'Female' },
  { code: GENDER_TRANS_MALE, label: 'Transgender male / trans man (F→M)' },
  { code: GENDER_TRANS_FEMALE, label: 'Transgender female / trans woman (M→F)' },
  { code: GENDER_NONBINARY, label: 'Non-binary' },
  { code: OTHER, label: 'Other' },
  { code: DECLINED, label: 'Prefers not to say' },
];

export const PRONOUN_SHE = 'LA29519-8';
export const PRONOUN_HE = 'LA29518-0';
export const PRONOUN_THEY = 'LA29520-6';
/** Pronouns (LOINC LL5144-2 answers as stored on the chart). */
export const PRONOUN_OPTIONS: Option[] = [
  { code: PRONOUN_SHE, label: 'she/her' },
  { code: PRONOUN_HE, label: 'he/him' },
  { code: PRONOUN_THEY, label: 'they/them' },
  { code: OTHER, label: 'Other' },
  { code: DECLINED, label: 'Prefers not to say' },
];

/** Note-only race answer (the chart's OMB list has no "Other"): written as "Other (text)", not sent to the chart. */
export const RACE_OTHER = 'OTHER_RACE';
/** OMB race categories (CDC race codes), multi-select. */
export const RACE_OPTIONS: Option[] = [
  { code: '1002-5', label: 'American Indian or Alaska Native' },
  { code: '2028-9', label: 'Asian' },
  { code: '2054-5', label: 'Black or African American' },
  { code: '2076-8', label: 'Native Hawaiian or Other Pacific Islander' },
  { code: '2106-3', label: 'White' },
  { code: RACE_OTHER, label: 'Other' },
  { code: DECLINED, label: 'Declined' },
];

export const HISPANIC = '2135-2';
export const NOT_HISPANIC = '2186-5';
export const ETHNICITY_OPTIONS: Option[] = [
  { code: HISPANIC, label: 'Hispanic or Latino' },
  { code: NOT_HISPANIC, label: 'Not Hispanic or Latino' },
  { code: DECLINED, label: 'Declined' },
];

/** Marital status (HL7 v3 codes as stored on the chart). "Declined" is note-only (the chart list has no ASKU). */
export const MARITAL_OPTIONS: Option[] = [
  { code: 'S', label: 'Single' },
  { code: 'M', label: 'Married' },
  { code: 'T', label: 'Domestic partnership' },
  { code: 'L', label: 'Separated' },
  { code: 'D', label: 'Divorced' },
  { code: 'W', label: 'Widowed' },
  { code: DECLINED, label: 'Declined' },
];

export const GUARDIAN_OPTIONS = ['Self', 'Parent', 'Legal guardian', 'Other'] as const;
export type GuardianKind = (typeof GUARDIAN_OPTIONS)[number] | '';

export const MODALITY_OPTIONS = [
  { code: 'in_office', label: 'In office' },
  { code: 'telehealth_video', label: 'Telehealth video' },
  { code: 'telehealth_audio', label: 'Telehealth audio-only' },
] as const;
export type Modality = (typeof MODALITY_OPTIONS)[number]['code'] | '';

export const NAME_TITLES = ['Mr.', 'Ms.', 'Mrs.', 'Mx.', 'Dr.'] as const;

export const LANGUAGE_OTHER = 'other';
export const LANGUAGE_OPTIONS: Option[] = [...LANGUAGES, { code: LANGUAGE_OTHER, label: 'Other' }];

export const PATIENT_REPORTED = 'patient-reported';

// ─── State ──────────────────────────────────────────────────────────────────

export type Companion = { name: string; relationship: string };

export type IdentifyingInfo = {
  /** Mr. / Ms. / Mrs. / Mx. / Dr. — only when the client uses one ('' = full name only) */
  title: string;
  sexAtBirth: string;
  genderIdentity: string;
  genderOther: string;
  pronouns: string;
  pronounsOther: string;
  race: string[];
  raceOther: string;
  ethnicity: string;
  maritalStatus: string;
  guardian: GuardianKind;
  guardianName: string;
  /** Relationship text for guardian "Other" (e.g. "Aunt") */
  guardianRelationship: string;
  language: string;
  languageOther: string;
  interpreterNeeded: '' | 'yes' | 'no';
  interpreterName: string;
  modality: Modality;
  /** USPS state code where the patient is during telehealth */
  patientLocationState: string;
  /** true = "None" (came alone) */
  accompaniedNone: boolean;
  companions: Companion[];
  weightLb: string;
  heightFt: string;
  heightIn: string;
  /** 'patient-reported' or e.g. 'chart vitals 2026-09-01' */
  weightSource: string;
  heightSource: string;
  chiefComplaint: string;
};

export type IdentifyingField = keyof IdentifyingInfo;

export function emptyIdentifyingInfo(): IdentifyingInfo {
  return {
    title: '',
    sexAtBirth: '',
    genderIdentity: '',
    genderOther: '',
    pronouns: '',
    pronounsOther: '',
    race: [],
    raceOther: '',
    ethnicity: '',
    maritalStatus: '',
    guardian: '',
    guardianName: '',
    guardianRelationship: '',
    language: '',
    languageOther: '',
    interpreterNeeded: '',
    interpreterName: '',
    modality: '',
    patientLocationState: '',
    accompaniedNone: false,
    companions: [],
    weightLb: '',
    heightFt: '',
    heightIn: '',
    weightSource: PATIENT_REPORTED,
    heightSource: PATIENT_REPORTED,
    chiefComplaint: '',
  };
}

/** Where a prefilled value came from (shown next to the field; 'ai' values never go to the chart). */
export type FieldSource = 'chart' | 'visit' | 'vitals' | 'prior' | 'saved' | 'ai';
export type FieldSources = Partial<Record<IdentifyingField, FieldSource>>;

// ─── Calculations ───────────────────────────────────────────────────────────

const t = (v: string | null | undefined) => (v ?? '').trim();

/** Whole years on the date of service (YYYY-MM-DD strings or ISO). Null when either date is missing / invalid. */
export function ageOn(dateOfBirth: string | null | undefined, dateOfService?: string | null): number | null {
  const dob = t(dateOfBirth).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const ref = /^\d{4}-\d{2}-\d{2}/.test(t(dateOfService)) ? t(dateOfService).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ry, rm, rd] = ref.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

const num = (v: string) => {
  const s = t(v);
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Total height in inches from ft / in strings (null when feet is missing or values are out of range). */
export function heightInches(ft: string, inch: string): number | null {
  const f = num(ft);
  const i = t(inch) ? num(inch) : 0;
  if (f == null || i == null || f < 1 || f > 8 || i >= 12) return null;
  return f * 12 + i;
}

/** BMI = 703 × lb / in², one decimal. Null when weight or height is missing / implausible. */
export function bmiFrom(weightLb: string, ft: string, inch: string): number | null {
  const w = num(weightLb);
  const h = heightInches(ft, inch);
  if (w == null || h == null || w < 10 || w > 1000) return null;
  return Math.round((703 * w * 10) / (h * h)) / 10;
}

export function feetInches(totalInches: number | null | undefined): { ft: string; in: string } | null {
  if (totalInches == null || !Number.isFinite(totalInches) || totalInches <= 0) return null;
  const rounded = Math.round(totalInches);
  return { ft: String(Math.floor(rounded / 12)), in: String(rounded % 12) };
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const labelOf = (list: readonly Option[], code: string) => list.find((o) => o.code === code)?.label ?? '';
const stateName = (code: string) => US_STATES.find((s) => s.code === code.toUpperCase())?.label ?? '';

export function genderLabel(info: Pick<IdentifyingInfo, 'genderIdentity' | 'genderOther'>): string {
  if (info.genderIdentity === OTHER) return t(info.genderOther) ? `Other (${t(info.genderOther)})` : 'Other';
  return labelOf(GENDER_IDENTITY_OPTIONS, info.genderIdentity);
}
export function pronounLabel(info: Pick<IdentifyingInfo, 'pronouns' | 'pronounsOther'>): string {
  if (info.pronouns === OTHER) return t(info.pronounsOther) ? `Other (${t(info.pronounsOther)})` : 'Other';
  return labelOf(PRONOUN_OPTIONS, info.pronouns);
}
export function raceLabels(info: Pick<IdentifyingInfo, 'race' | 'raceOther'>): string[] {
  return RACE_OPTIONS.filter((o) => info.race.includes(o.code)).map((o) =>
    o.code === RACE_OTHER && t(info.raceOther) ? `Other (${t(info.raceOther)})` : o.label
  );
}
export function maritalLabel(code: string): string {
  return labelOf(MARITAL_OPTIONS, code) || labelOf(MARITAL_STATUS, code);
}
export function languageLabel(info: Pick<IdentifyingInfo, 'language' | 'languageOther'>): string {
  if (info.language === LANGUAGE_OTHER) return t(info.languageOther) ? `Other (${t(info.languageOther)})` : '';
  return labelOf(LANGUAGES, info.language) || t(info.language);
}
export function modalityLabel(m: Modality | string): string {
  return MODALITY_OPTIONS.find((o) => o.code === m)?.label ?? '';
}
export function guardianLabel(info: Pick<IdentifyingInfo, 'guardian' | 'guardianName' | 'guardianRelationship'>): string {
  if (!info.guardian) return '';
  const kind = info.guardian === 'Other' ? (t(info.guardianRelationship) ? `Other (${t(info.guardianRelationship)})` : 'Other') : info.guardian;
  return info.guardian !== 'Self' && t(info.guardianName) ? `${kind} — ${t(info.guardianName)}` : kind;
}
export function companionLabel(c: Companion): string {
  return [t(c.relationship), t(c.name)].filter(Boolean).join(' — ');
}
const heightText = (ft: string, inch: string) => {
  const h = heightInches(ft, inch);
  return h == null ? '' : `${Math.floor(h / 12)}'${Math.round(h % 12)}"`;
};

// ─── Note text ──────────────────────────────────────────────────────────────

/** Line labels (the parser reads these back). */
export const LINE = {
  title: 'Title',
  sexAtBirth: 'Sex assigned at birth',
  gender: 'Gender identity',
  pronouns: 'Pronouns',
  age: 'Age',
  race: 'Race',
  ethnicity: 'Ethnicity',
  marital: 'Marital status',
  guardian: 'Legal guardian',
  language: 'Preferred language',
  interpreter: 'Interpreter needed',
  modality: 'Visit modality',
  location: 'Patient location',
  accompanied: 'Accompanied by',
  weight: 'Weight',
  height: 'Height',
  bmi: 'BMI',
  chiefComplaint: "Chief complaint (patient's own words)",
} as const;
const LINE_LABELS = new Set<string>(Object.values(LINE));

export type RenderContext = {
  noteType: string;
  /** Chart name (full name); null when the chart is not loaded */
  patientName: string | null;
  preferredName?: string | null;
  dateOfBirth: string | null;
  dateOfService: string | null;
};

type PronounSet = { subject: string; possessive: string };
function pronounSet(info: Pick<IdentifyingInfo, 'pronouns'>): PronounSet | null {
  if (info.pronouns === PRONOUN_SHE) return { subject: 'she', possessive: 'her' };
  if (info.pronouns === PRONOUN_HE) return { subject: 'he', possessive: 'his' };
  if (info.pronouns === PRONOUN_THEY) return { subject: 'they', possessive: 'their' };
  return null;
}

function genderNoun(info: IdentifyingInfo, age: number | null): string {
  const minor = age != null && age < 18;
  switch (info.genderIdentity) {
    case GENDER_FEMALE:
      return minor ? 'girl' : 'woman';
    case GENDER_MALE:
      return minor ? 'boy' : 'man';
    case GENDER_TRANS_FEMALE:
      return minor ? 'transgender girl' : 'transgender woman';
    case GENDER_TRANS_MALE:
      return minor ? 'transgender boy' : 'transgender man';
    case GENDER_NONBINARY:
      return minor ? 'non-binary youth' : 'non-binary person';
    case OTHER:
      return 'person';
    default:
      return '';
  }
}

const joinList = (items: string[]) =>
  items.length <= 1 ? items.join('') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
const lowerRelationship = (r: string) => (/^[A-Z][a-z]+(?: [a-z/ -]+)?$/.test(r) ? r.toLowerCase() : r);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The narrative sentence(s) at the top of the section. Only answered fields are mentioned; a
 * blank field leaves its clause out (never "unknown" / a guess).
 */
export function identifyingNarrative(info: IdentifyingInfo, ctx: RenderContext): string {
  const age = ageOn(ctx.dateOfBirth, ctx.dateOfService);
  const name = t(ctx.patientName);
  const preferred = t(ctx.preferredName);
  const firstName = name.split(/\s+/)[0] || '';
  const who = name
    ? `${t(info.title) ? `${t(info.title)} ` : ''}${name}${preferred && preferred.toLowerCase() !== firstName.toLowerCase() && preferred.toLowerCase() !== name.toLowerCase() ? ` (goes by "${preferred}")` : ''}`
    : 'The patient';
  const ps = pronounSet(info);
  const possessive = ps ? ps.possessive : name ? `${name.split(/\s+/)[0]}'s` : "the patient's";

  // "a 34-year-old Black or African American, non-Hispanic woman (she/her)"
  const races = info.race.includes(DECLINED) ? [] : raceLabels(info);
  const raceText = races.length ? joinList(races) : '';
  const ethText = info.ethnicity === HISPANIC ? 'Hispanic or Latino' : info.ethnicity === NOT_HISPANIC ? 'non-Hispanic' : '';
  const raceEth = [raceText, ethText].filter(Boolean).join(', ');
  let noun = genderNoun(info, age);
  const ageText = age != null ? `${age}-year-old` : '';
  if (!noun && (ageText || raceEth)) noun = 'patient';
  const pronounParen = ps ? ` (${labelOf(PRONOUN_OPTIONS, info.pronouns)})` : info.pronouns === OTHER && t(info.pronounsOther) ? ` (${t(info.pronounsOther)})` : '';
  const descriptorCore = [ageText, raceEth, noun].filter(Boolean).join(' ');
  const descriptor = descriptorCore ? `${/^[aeiou8]|^1[18]-/i.test(descriptorCore) ? 'an' : 'a'} ${descriptorCore}${pronounParen}` : '';

  const seen =
    info.modality === 'in_office'
      ? ' in the office'
      : info.modality === 'telehealth_video'
        ? ' via telehealth video'
        : info.modality === 'telehealth_audio'
          ? ' via telehealth (audio only)'
          : '';
  const where = info.modality.startsWith('telehealth') && stateName(info.patientLocationState) ? ` (patient located in ${stateName(info.patientLocationState)})` : '';
  const companions = info.companions.filter((c) => t(c.name) || t(c.relationship));
  const accompanied = companions.length
    ? `, accompanied by ${joinList(
        companions.map((c) => {
          const rel = t(c.relationship);
          const nm = t(c.name);
          if (rel && nm) return `${possessive} ${lowerRelationship(rel)}, ${nm}`;
          if (rel) return `${possessive} ${lowerRelationship(rel)}`;
          return nm;
        })
      )}`
    : info.accompaniedNone
      ? ', unaccompanied'
      : '';
  const sentences: string[] = [
    `${who}${descriptor ? `, ${descriptor},` : ''} was seen${seen}${where} for ${visitPhrase(ctx.noteType)}${accompanied}.`,
  ];

  const lang = languageLabel(info).replace(/^Other \((.+)\)$/, '$1');
  const interp =
    info.interpreterNeeded === 'yes'
      ? `interpreter needed${t(info.interpreterName) ? ` (interpreter: ${t(info.interpreterName)})` : ''}`
      : info.interpreterNeeded === 'no'
        ? 'no interpreter needed'
        : '';
  if (lang || interp) sentences.push(`${[lang ? `Preferred language ${lang}` : '', interp].filter(Boolean).map((s, i) => (i === 0 ? capitalize(s) : s)).join('; ')}.`);

  if (info.guardian && info.guardian !== 'Self') {
    const g = guardianLabel(info).replace(/^Other \((.+?)\)/, '$1');
    sentences.push(`Legal guardian: ${g.replace(' — ', ', ')}.`);
  }

  const w = num(info.weightLb);
  const h = heightText(info.heightFt, info.heightIn);
  const bmi = bmiFrom(info.weightLb, info.heightFt, info.heightIn);
  if (w != null || h) {
    const bothReported = (w == null || info.weightSource === PATIENT_REPORTED) && (!h || info.heightSource === PATIENT_REPORTED);
    const wTxt = w != null ? `weight ${w} lb${bothReported || info.weightSource === PATIENT_REPORTED ? '' : ` (${info.weightSource})`}` : '';
    const hTxt = h ? `height ${h}${bothReported || info.heightSource === PATIENT_REPORTED ? '' : ` (${info.heightSource})`}` : '';
    const parts = [wTxt, hTxt].filter(Boolean).join(', ');
    const lead = bothReported ? `Patient-reported ${parts}` : capitalize(parts);
    sentences.push(`${lead}${bmi != null ? ` (BMI ${bmi.toFixed(1)})` : ''}.`);
  }
  return sentences.join(' ');
}

const quote = (s: string) => {
  const v = t(s).replace(/^["“”]+|["“”]+$/g, '').trim();
  return v ? `"${v}"` : '';
};

/** Section text: the narrative, then one "Label: value" line per answered field. */
export function renderIdentifyingInfo(info: IdentifyingInfo, ctx: RenderContext): string {
  const age = ageOn(ctx.dateOfBirth, ctx.dateOfService);
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (t(value)) lines.push(`${label}: ${t(value)}`);
  };
  add(LINE.title, info.title);
  add(LINE.sexAtBirth, labelOf(SEX_AT_BIRTH_OPTIONS, info.sexAtBirth));
  add(LINE.gender, genderLabel(info));
  add(LINE.pronouns, pronounLabel(info));
  if (age != null) add(LINE.age, `${age}${ctx.dateOfBirth ? ` (DOB ${t(ctx.dateOfBirth).slice(0, 10)})` : ''}`);
  add(LINE.race, raceLabels(info).join('; '));
  add(LINE.ethnicity, labelOf(ETHNICITY_OPTIONS, info.ethnicity));
  add(LINE.marital, maritalLabel(info.maritalStatus));
  add(LINE.guardian, guardianLabel(info));
  add(LINE.language, languageLabel(info));
  add(LINE.interpreter, info.interpreterNeeded === 'yes' ? `Yes${t(info.interpreterName) ? ` — ${t(info.interpreterName)}` : ''}` : info.interpreterNeeded === 'no' ? 'No' : '');
  add(LINE.modality, modalityLabel(info.modality));
  if (info.modality.startsWith('telehealth') && stateName(info.patientLocationState)) {
    add(LINE.location, `${stateName(info.patientLocationState)} (${info.patientLocationState.toUpperCase()})`);
  }
  const companions = info.companions.map(companionLabel).filter(Boolean);
  add(LINE.accompanied, companions.length ? companions.join('; ') : info.accompaniedNone ? 'None' : '');
  const w = num(info.weightLb);
  if (w != null) add(LINE.weight, `${w} lb (${t(info.weightSource) || PATIENT_REPORTED})`);
  const h = heightText(info.heightFt, info.heightIn);
  if (h) add(LINE.height, `${h} (${t(info.heightSource) || PATIENT_REPORTED})`);
  const bmi = bmiFrom(info.weightLb, info.heightFt, info.heightIn);
  if (bmi != null) add(LINE.bmi, `${bmi.toFixed(1)} (calculated)`);
  add(LINE.chiefComplaint, quote(info.chiefComplaint));
  const narrative = identifyingNarrative(info, ctx);
  // Nothing answered and no chart name: no text at all (an empty section, not a sentence of blanks)
  if (!lines.length && !t(ctx.patientName)) return '';
  return [narrative, ...lines].join('\n');
}

// ─── Reading the text back (reopened draft, prior evaluation, sign rules) ────

function lineMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of (text || '').replace(/\r\n/g, '\n').split('\n')) {
    const l = raw.trim();
    const i = l.indexOf(': ');
    if (i <= 0) continue;
    const label = l.slice(0, i);
    if (LINE_LABELS.has(label) && !map.has(label)) map.set(label, l.slice(i + 2).trim());
  }
  return map;
}
const codeFor = (list: readonly Option[], label: string) => list.find((o) => o.label === label)?.code ?? '';
const otherText = (v: string) => v.match(/^Other \((.+)\)$/)?.[1] ?? '';

/** Fields recovered from a section's text ("Label: value" lines; the narrative line is regenerated). */
export function parseIdentifyingInfo(text: string): IdentifyingInfo {
  const m = lineMap(text);
  const info = emptyIdentifyingInfo();
  const get = (label: string) => m.get(label) ?? '';
  info.title = (NAME_TITLES as readonly string[]).includes(get(LINE.title)) ? get(LINE.title) : '';
  info.sexAtBirth = codeFor(SEX_AT_BIRTH_OPTIONS, get(LINE.sexAtBirth));
  const g = get(LINE.gender);
  if (g.startsWith('Other')) {
    info.genderIdentity = OTHER;
    info.genderOther = otherText(g);
  } else info.genderIdentity = codeFor(GENDER_IDENTITY_OPTIONS, g);
  const p = get(LINE.pronouns);
  if (p.startsWith('Other')) {
    info.pronouns = OTHER;
    info.pronounsOther = otherText(p);
  } else info.pronouns = codeFor(PRONOUN_OPTIONS, p);
  for (const part of get(LINE.race).split(';').map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith('Other')) {
      info.race.push(RACE_OTHER);
      info.raceOther = otherText(part);
    } else {
      const c = codeFor(RACE_OPTIONS, part);
      if (c && !info.race.includes(c)) info.race.push(c);
    }
  }
  info.ethnicity = codeFor(ETHNICITY_OPTIONS, get(LINE.ethnicity));
  const marital = get(LINE.marital);
  info.maritalStatus = codeFor(MARITAL_OPTIONS, marital) || codeFor(MARITAL_STATUS, marital);
  const gu = get(LINE.guardian);
  if (gu) {
    const [kind, ...nameParts] = gu.split(' — ');
    const k = kind.trim();
    if (k.startsWith('Other')) {
      info.guardian = 'Other';
      info.guardianRelationship = otherText(k);
    } else if ((GUARDIAN_OPTIONS as readonly string[]).includes(k)) info.guardian = k as GuardianKind;
    info.guardianName = nameParts.join(' — ').trim();
  }
  const lang = get(LINE.language);
  if (lang.startsWith('Other')) {
    info.language = LANGUAGE_OTHER;
    info.languageOther = otherText(lang);
  } else info.language = codeFor(LANGUAGES, lang) || (lang ? languageFromText(lang).code ?? '' : '');
  const interp = get(LINE.interpreter);
  if (/^Yes\b/.test(interp)) {
    info.interpreterNeeded = 'yes';
    info.interpreterName = interp.split(' — ').slice(1).join(' — ').trim();
  } else if (interp === 'No') info.interpreterNeeded = 'no';
  info.modality = (MODALITY_OPTIONS.find((o) => o.label === get(LINE.modality))?.code ?? '') as Modality;
  info.patientLocationState = get(LINE.location).match(/\(([A-Z]{2})\)$/)?.[1] ?? '';
  const acc = get(LINE.accompanied);
  if (acc === 'None') info.accompaniedNone = true;
  else if (acc) {
    info.companions = acc
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [a, ...b] = s.split(' — ');
        return b.length ? { relationship: a.trim(), name: b.join(' — ').trim() } : { relationship: a.trim(), name: '' };
      });
  }
  const wm = get(LINE.weight).match(/^(\d+(?:\.\d+)?) lb(?: \((.+)\))?$/);
  if (wm) {
    info.weightLb = wm[1];
    info.weightSource = wm[2] || PATIENT_REPORTED;
  }
  const hm = get(LINE.height).match(/^(\d)'(\d{1,2})"(?: \((.+)\))?$/);
  if (hm) {
    info.heightFt = hm[1];
    info.heightIn = hm[2];
    info.heightSource = hm[3] || PATIENT_REPORTED;
  }
  info.chiefComplaint = get(LINE.chiefComplaint).replace(/^"|"$/g, '');
  return info;
}

/** The Identifying Information section of a saved note body ('' when the note has none). */
export function identifyingSectionText(noteType: string, body: string): string {
  return structuredNoteSections(normalizeNoteType(noteType), body)
    .filter((s) => s.title === IDENTIFYING_INFO)
    .map((s) => s.text)
    .join('\n')
    .trim();
}

/** Age written in the section ("Age: 15 (DOB …)"), or null. */
export function ageFromText(sectionText: string): number | null {
  const v = lineMap(sectionText).get(LINE.age);
  const m = v?.match(/^(\d{1,3})\b/);
  return m ? Number(m[1]) : null;
}

// ─── Prefill ────────────────────────────────────────────────────────────────

/** Chart values the section is prefilled from (GET /api/clients/[id]/identifying-info). */
export type ChartIdentifying = {
  name: string;
  preferredName: string | null;
  namePrefix: string | null;
  dateOfBirth: string | null;
  /** Legacy free-text gender (used only when genderIdentity is not coded) */
  gender: string | null;
  sexAtBirth: string | null;
  genderIdentity: string | null;
  pronouns: string | null;
  race: string[];
  ethnicity: string | null;
  maritalStatus: string | null;
  preferredLanguage: string | null;
  interpreterNeeded: boolean | null;
  hasGuardian: boolean | null;
  guardianName: string | null;
  guardianRelationship: string | null;
};

export type ChartVitals = { weightLbs: number | null; heightInches: number | null; recordedAt: string } | null;

/** The visit as the note knows it (appointment / service details). */
export type VisitFacts = { known: boolean; telehealth: boolean; audioOnly: boolean; patientLocationState: string | null };

const PARENT_CODES = new Set(['PRN', 'MTH', 'FTH', 'STPPRN']);
const RELATIONSHIP_LABEL: Record<string, string> = { GRPRN: 'Grandparent', FAMMEMB: 'Family member', SPS: 'Spouse', DOMPART: 'Domestic partner', SIB: 'Sibling', FRND: 'Friend', OTH: '' };

/**
 * Values from the chart (only what is recorded; Unknown / null stays blank). The legacy free-text
 * gender is used only when it maps exactly to a gender identity.
 */
export function prefillFromChart(chart: ChartIdentifying, vitals: ChartVitals = null): { values: Partial<IdentifyingInfo>; sources: FieldSources } {
  const values: Partial<IdentifyingInfo> = {};
  const sources: FieldSources = {};
  const set = <K extends IdentifyingField>(k: K, v: IdentifyingInfo[K], src: FieldSource = 'chart') => {
    values[k] = v;
    sources[k] = src;
  };
  if (chart.namePrefix && (NAME_TITLES as readonly string[]).includes(chart.namePrefix)) set('title', chart.namePrefix);
  if (chart.sexAtBirth && SEX_AT_BIRTH_OPTIONS.some((o) => o.code === chart.sexAtBirth) && chart.sexAtBirth !== 'UNK') set('sexAtBirth', chart.sexAtBirth);
  const gi = chart.genderIdentity || genderIdentityFromText(chart.gender).code;
  if (gi === GENDER_QUEER) {
    set('genderIdentity', OTHER);
    set('genderOther', 'Genderqueer / gender non-conforming');
  } else if (gi && GENDER_IDENTITY_OPTIONS.some((o) => o.code === gi)) set('genderIdentity', gi);
  if (chart.pronouns && PRONOUN_OPTIONS.some((o) => o.code === chart.pronouns)) set('pronouns', chart.pronouns);
  const race = (chart.race || []).filter((c) => RACE_OPTIONS.some((o) => o.code === c));
  if (race.length) set('race', race);
  if (chart.ethnicity && ETHNICITY_OPTIONS.some((o) => o.code === chart.ethnicity)) set('ethnicity', chart.ethnicity);
  if (chart.maritalStatus && chart.maritalStatus !== 'UNK' && maritalLabel(chart.maritalStatus)) set('maritalStatus', chart.maritalStatus);
  if (chart.preferredLanguage) {
    if (LANGUAGES.some((l) => l.code === chart.preferredLanguage)) set('language', chart.preferredLanguage);
    else {
      set('language', LANGUAGE_OTHER);
      set('languageOther', chart.preferredLanguage);
    }
  }
  if (chart.interpreterNeeded != null) set('interpreterNeeded', chart.interpreterNeeded ? 'yes' : 'no');
  const gName = t(chart.guardianName);
  const gRel = t(chart.guardianRelationship).toUpperCase();
  if (gName || (chart.hasGuardian && gRel)) {
    if (PARENT_CODES.has(gRel)) set('guardian', 'Parent');
    else if (gRel === 'GUARD' || !gRel) set('guardian', 'Legal guardian');
    else {
      set('guardian', 'Other');
      set('guardianRelationship', RELATIONSHIP_LABEL[gRel] ?? '');
    }
    if (gName) set('guardianName', gName);
  } else if (chart.hasGuardian === false) set('guardian', 'Self');
  if (vitals) {
    const date = vitals.recordedAt.slice(0, 10);
    if (vitals.weightLbs != null && vitals.weightLbs > 0) {
      set('weightLb', String(Math.round(vitals.weightLbs * 10) / 10), 'vitals');
      set('weightSource', `chart vitals ${date}`, 'vitals');
    }
    const fi = feetInches(vitals.heightInches);
    if (fi) {
      set('heightFt', fi.ft, 'vitals');
      set('heightIn', fi.in, 'vitals');
      set('heightSource', `chart vitals ${date}`, 'vitals');
    }
  }
  return { values, sources };
}

/** Modality and telehealth state from the appointment / service details (only when the visit is known). */
export function prefillFromVisit(visit: VisitFacts): { values: Partial<IdentifyingInfo>; sources: FieldSources } {
  if (!visit.known) return { values: {}, sources: {} };
  const values: Partial<IdentifyingInfo> = { modality: visit.telehealth ? (visit.audioOnly ? 'telehealth_audio' : 'telehealth_video') : 'in_office' };
  const sources: FieldSources = { modality: 'visit' };
  if (visit.telehealth && visit.patientLocationState && US_STATES.some((s) => s.code === visit.patientLocationState!.toUpperCase())) {
    values.patientLocationState = visit.patientLocationState.toUpperCase();
    sources.patientLocationState = 'visit';
  }
  return { values, sources };
}

/** Re-evaluation: the stable fields of the last evaluation (not the visit, measurements or chief complaint). */
export const PRIOR_CARRY_FIELDS: readonly IdentifyingField[] = [
  'title', 'sexAtBirth', 'genderIdentity', 'genderOther', 'pronouns', 'pronounsOther', 'race', 'raceOther', 'ethnicity',
  'maritalStatus', 'guardian', 'guardianName', 'guardianRelationship', 'language', 'languageOther', 'interpreterNeeded', 'interpreterName',
];
export function prefillFromPrior(prior: IdentifyingInfo): { values: Partial<IdentifyingInfo>; sources: FieldSources } {
  const values: Partial<IdentifyingInfo> = {};
  const sources: FieldSources = {};
  for (const k of PRIOR_CARRY_FIELDS) {
    if (!isBlank(prior[k])) {
      (values as Record<string, unknown>)[k] = prior[k];
      sources[k] = 'prior';
    }
  }
  return { values, sources };
}

function isBlank(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'boolean') return !v;
  return t(v as string) === '';
}

/**
 * Fill only blank fields (a value the clinician entered, or an earlier source, is never
 * overwritten). Sources in order of preference: pass the most authoritative first.
 */
export function mergePrefill(
  current: IdentifyingInfo,
  currentSources: FieldSources,
  ...patches: { values: Partial<IdentifyingInfo>; sources: FieldSources }[]
): { info: IdentifyingInfo; sources: FieldSources } {
  const info: IdentifyingInfo = { ...current, race: [...current.race], companions: current.companions.map((c) => ({ ...c })) };
  const sources: FieldSources = { ...currentSources };
  const taken = new Set<string>();
  for (const patch of patches) {
    // Measurement pairs move together (value + its source label)
    for (const [k, v] of Object.entries(patch.values) as [IdentifyingField, unknown][]) {
      if (k === 'weightSource' || k === 'heightSource') continue;
      if (taken.has(k) || !isBlank(info[k])) continue;
      (info as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v;
      if (patch.sources[k]) sources[k] = patch.sources[k];
      taken.add(k);
      if (k === 'weightLb' && patch.values.weightSource) info.weightSource = patch.values.weightSource;
      if (k === 'heightFt' && patch.values.heightSource) info.heightSource = patch.values.heightSource;
    }
  }
  return { info, sources };
}

// ─── Changes since the last evaluation (re-evals) ───────────────────────────

export type FieldChange = { field: string; label: string; was: string; now: string };

/** What reads differently from the prior evaluation's section (both sides as written in the note). */
export function changesSincePrior(current: IdentifyingInfo, prior: IdentifyingInfo): FieldChange[] {
  const rows: [string, string, (i: IdentifyingInfo) => string][] = [
    ['sexAtBirth', LINE.sexAtBirth, (i) => labelOf(SEX_AT_BIRTH_OPTIONS, i.sexAtBirth)],
    ['genderIdentity', LINE.gender, genderLabel],
    ['pronouns', LINE.pronouns, pronounLabel],
    ['race', LINE.race, (i) => raceLabels(i).join('; ')],
    ['ethnicity', LINE.ethnicity, (i) => labelOf(ETHNICITY_OPTIONS, i.ethnicity)],
    ['maritalStatus', LINE.marital, (i) => maritalLabel(i.maritalStatus)],
    ['guardian', LINE.guardian, guardianLabel],
    ['language', LINE.language, languageLabel],
    ['interpreterNeeded', LINE.interpreter, (i) => (i.interpreterNeeded === 'yes' ? 'Yes' : i.interpreterNeeded === 'no' ? 'No' : '')],
    ['weightLb', LINE.weight, (i) => (num(i.weightLb) != null ? `${num(i.weightLb)} lb` : '')],
    ['height', LINE.height, (i) => heightText(i.heightFt, i.heightIn)],
  ];
  const out: FieldChange[] = [];
  for (const [field, label, read] of rows) {
    const was = read(prior);
    const now = read(current);
    if (was && now && was !== now) out.push({ field, label, was, now });
  }
  return out;
}

// ─── Chart update ("Update chart demographics", explicit + audited) ─────────

/** Fields POST /api/clients/[id]/identifying-info accepts (Client columns). */
export type ChartDemographicPatch = {
  namePrefix?: string | null;
  sexAtBirth?: string | null;
  genderIdentity?: string | null;
  pronouns?: string | null;
  race?: string[];
  ethnicity?: string | null;
  maritalStatus?: string | null;
  preferredLanguage?: string | null;
  interpreterNeeded?: boolean | null;
  hasGuardian?: boolean | null;
  guardianName?: string | null;
  guardianRelationship?: string | null;
};
export const CHART_PATCH_KEYS: readonly (keyof ChartDemographicPatch)[] = [
  'namePrefix', 'sexAtBirth', 'genderIdentity', 'pronouns', 'race', 'ethnicity', 'maritalStatus', 'preferredLanguage', 'interpreterNeeded',
  'hasGuardian', 'guardianName', 'guardianRelationship',
];

/** Which note fields feed each chart column (an 'ai'-sourced note field never updates the chart). */
const FEEDS: Record<keyof ChartDemographicPatch, IdentifyingField[]> = {
  namePrefix: ['title'],
  sexAtBirth: ['sexAtBirth'],
  genderIdentity: ['genderIdentity', 'genderOther'],
  pronouns: ['pronouns'],
  race: ['race'],
  ethnicity: ['ethnicity'],
  maritalStatus: ['maritalStatus'],
  preferredLanguage: ['language', 'languageOther'],
  interpreterNeeded: ['interpreterNeeded'],
  hasGuardian: ['guardian'],
  guardianName: ['guardian', 'guardianName'],
  guardianRelationship: ['guardian', 'guardianRelationship'],
};

export type ChartChange = { key: keyof ChartDemographicPatch; label: string; chart: string; note: string };

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Differences between what the clinician confirmed in the note and the chart, as the patch the
 * "Update chart demographics" button sends. Blank note fields never clear the chart; note-only
 * answers the chart cannot store (race "Other", marital "Declined", an unmapped language) are skipped.
 */
export function chartDemographicChanges(info: IdentifyingInfo, chart: ChartIdentifying, sources: FieldSources = {}): { patch: ChartDemographicPatch; changes: ChartChange[] } {
  const patch: ChartDemographicPatch = {};
  const changes: ChartChange[] = [];
  const fromAi = (k: keyof ChartDemographicPatch) => FEEDS[k].some((f) => sources[f] === 'ai');
  const put = <K extends keyof ChartDemographicPatch>(k: K, value: ChartDemographicPatch[K], label: string, chartText: string, noteText: string) => {
    if (fromAi(k)) return;
    patch[k] = value;
    changes.push({ key: k, label, chart: chartText || 'not recorded', note: noteText });
  };
  if (info.title && info.title !== (chart.namePrefix ?? '')) put('namePrefix', info.title, LINE.title, chart.namePrefix ?? '', info.title);
  if (info.sexAtBirth && info.sexAtBirth !== (chart.sexAtBirth ?? '')) {
    put('sexAtBirth', info.sexAtBirth, LINE.sexAtBirth, labelOf(SEX_AT_BIRTH_OPTIONS, chart.sexAtBirth ?? ''), labelOf(SEX_AT_BIRTH_OPTIONS, info.sexAtBirth));
  }
  if (info.genderIdentity) {
    const code = info.genderIdentity === OTHER && /^genderqueer/i.test(info.genderOther) ? GENDER_QUEER : info.genderIdentity;
    if (code !== (chart.genderIdentity ?? '')) {
      put('genderIdentity', code, LINE.gender, labelOf(GENDER_IDENTITY_OPTIONS, chart.genderIdentity ?? '') || (chart.genderIdentity === GENDER_QUEER ? 'Genderqueer / gender non-conforming' : ''), genderLabel(info));
    }
  }
  if (info.pronouns && info.pronouns !== (chart.pronouns ?? '')) put('pronouns', info.pronouns, LINE.pronouns, labelOf(PRONOUN_OPTIONS, chart.pronouns ?? ''), pronounLabel(info));
  const race = info.race.filter((c) => c !== RACE_OTHER);
  if (race.length && !sameList(race, chart.race || [])) {
    put('race', race, LINE.race, RACE_OPTIONS.filter((o) => (chart.race || []).includes(o.code)).map((o) => o.label).join('; '), raceLabels({ race, raceOther: '' }).join('; '));
  }
  if (info.ethnicity && info.ethnicity !== (chart.ethnicity ?? '')) put('ethnicity', info.ethnicity, LINE.ethnicity, labelOf(ETHNICITY_OPTIONS, chart.ethnicity ?? ''), labelOf(ETHNICITY_OPTIONS, info.ethnicity));
  if (info.maritalStatus && info.maritalStatus !== DECLINED && info.maritalStatus !== (chart.maritalStatus ?? '')) {
    put('maritalStatus', info.maritalStatus, LINE.marital, maritalLabel(chart.maritalStatus ?? ''), maritalLabel(info.maritalStatus));
  }
  const langCode = info.language === LANGUAGE_OTHER ? languageFromText(info.languageOther).code : info.language;
  if (langCode && langCode !== (chart.preferredLanguage ?? '')) put('preferredLanguage', langCode, LINE.language, chart.preferredLanguage ?? '', languageLabel(info));
  if (info.interpreterNeeded) {
    const v = info.interpreterNeeded === 'yes';
    if (chart.interpreterNeeded !== v) put('interpreterNeeded', v, LINE.interpreter, chart.interpreterNeeded == null ? '' : chart.interpreterNeeded ? 'Yes' : 'No', v ? 'Yes' : 'No');
  }
  if (info.guardian === 'Self') {
    if (chart.hasGuardian !== false && !t(chart.guardianName)) put('hasGuardian', false, LINE.guardian, chart.hasGuardian ? 'Has a guardian' : '', 'Self');
  } else if (info.guardian) {
    const chartRel = t(chart.guardianRelationship).toUpperCase();
    const rel =
      info.guardian === 'Parent'
        ? PARENT_CODES.has(chartRel)
          ? chartRel
          : 'PRN'
        : info.guardian === 'Legal guardian'
          ? 'GUARD'
          : relationshipFromText(info.guardianRelationship).code ?? 'OTH';
    const name = t(info.guardianName);
    const nameChanged = Boolean(name) && name !== t(chart.guardianName);
    const relChanged = rel !== chartRel;
    if (nameChanged || relChanged || chart.hasGuardian !== true) {
      put('hasGuardian', true, LINE.guardian, [chart.guardianName, chartRel].filter(Boolean).join(', '), guardianLabel(info));
      if (nameChanged) patch.guardianName = name;
      if (relChanged) patch.guardianRelationship = rel;
    }
  }
  return { patch, changes };
}

// ─── Sign rules (warn until the format-element enforcement date, then block) ─

export type IdentifyingIssue = { id: string; message: string; heading: string };

/** Missing required items, read from the saved body (editor, note view and sign path agree). */
export function identifyingInfoIssues(noteType: string | null | undefined, body: string): IdentifyingIssue[] {
  const type = normalizeNoteType(String(noteType ?? ''));
  if (!IDENTIFYING_INFO_NOTE_TYPES.includes(type)) return [];
  const text = identifyingSectionText(type, body);
  const m = lineMap(text);
  const out: IdentifyingIssue[] = [];
  const h = IDENTIFYING_INFO;
  if (!t(m.get(LINE.chiefComplaint)).replace(/"/g, '')) {
    out.push({ id: 'identifying.chief_complaint', message: `${h}: record the chief complaint in the patient's own words.`, heading: h });
  }
  if (!m.get(LINE.modality)) {
    out.push({ id: 'identifying.modality', message: `${h}: choose the visit modality (in office, telehealth video or telehealth audio-only).`, heading: h });
  }
  const age = ageFromText(text);
  if (age != null && age < 18) {
    const g = t(m.get(LINE.guardian));
    if (!g) out.push({ id: 'identifying.guardian', message: `${h}: the patient is a minor (${age}) — record the legal guardian.`, heading: h });
    else if (g === 'Self') {
      out.push({ id: 'identifying.guardian', message: `${h}: the patient is a minor (${age}) and the legal guardian is "Self" — record the parent / legal guardian (Self only for an emancipated minor).`, heading: h });
    }
  }
  return out;
}

/** Editor-side warning for a minor whose guardian is not set (same rule as the sign check). */
export function minorGuardianWarning(info: IdentifyingInfo, age: number | null): string | null {
  if (age == null || age >= 18) return null;
  if (!info.guardian) return `The patient is a minor (${age}): record the legal guardian.`;
  if (info.guardian === 'Self') return `The patient is a minor (${age}): a legal guardian of "Self" applies only to an emancipated minor. Record the parent / legal guardian.`;
  return null;
}

/** The chief complaint in a section's text (for the format-element check of the template's own Chief Complaint section). */
export function chiefComplaintFromText(sectionText: string): string {
  return t(lineMap(sectionText).get(LINE.chiefComplaint)).replace(/^"|"$/g, '');
}

// ─── AI Scribe suggestions (transcript-grounded; clinician accepts) ──────────

/** Minimal transcript line (src/lib/scribe/diarization.ts TranscriptLine). */
export type ScribeLine = { id: string; role: string; text: string };

export type IdentifyingSuggestions = {
  /** Verbatim CLIENT statements, each citing its transcript line */
  chiefComplaint: { text: string; cite: string }[];
  /** Other people who spoke (guardian / family / other), from the speaker roles */
  accompaniedBy: { relationship: string; cite: string }[];
  /** An interpreter spoke: a reminder only (interpreter fields are the clinician's) */
  interpreterHeard: boolean;
};

const CC_PROMPT = /\b(what brings you|brought you (in|here|to)|reason (for|you('re| are)) (coming|here|the visit|today)|what('s| is| has)( been)? going on|how can (i|we) help|what would you like (help|to work on)|main (concern|problem)|tell me (a little )?(about )?(why|what))\b/i;
const GREETING = /^(hi|hello|hey|good (morning|afternoon|evening)|thanks?|thank you|yes|yeah|yep|no|nope|ok(ay)?|sure|mm+-?hmm|uh+|um+)[\s.,!?]*$/i;
const ROLE_RELATIONSHIP: Record<string, string> = { GUARDIAN: 'Parent / guardian', FAMILY: 'Family member', OTHER: 'Other' };

function trimQuote(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= 240) return s;
  const cut = s.slice(0, 240);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

/**
 * Chief complaint candidates: the CLIENT's answer to the clinician's "what brings you in"
 * question (else the client's first substantive statements), quoted verbatim with the line id.
 * Accompanied-by from who else spoke. Guardian / family / interpreter lines are never quoted as
 * the chief complaint. Nothing here writes to the note or the chart; the editor offers "Use".
 */
export function identifyingSuggestionsFromTranscript(lines: readonly ScribeLine[]): IdentifyingSuggestions {
  const cc: { text: string; cite: string }[] = [];
  const isClient = (l: ScribeLine) => l.role === 'CLIENT';
  const substantive = (l: ScribeLine) => isClient(l) && !GREETING.test(l.text.trim()) && l.text.trim().split(/\s+/).length >= 4;
  for (let i = 0; i < lines.length && cc.length < 2; i++) {
    const l = lines[i];
    if (l.role !== 'CLINICIAN' || !CC_PROMPT.test(l.text)) continue;
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
      if (lines[j].role === 'CLINICIAN' && j > i + 1) break;
      if (substantive(lines[j])) {
        cc.push({ text: trimQuote(lines[j].text), cite: lines[j].id });
        break;
      }
    }
  }
  if (!cc.length) {
    const first = lines.find(substantive);
    if (first) cc.push({ text: trimQuote(first.text), cite: first.id });
  }
  const accompaniedBy: { relationship: string; cite: string }[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const rel = ROLE_RELATIONSHIP[l.role];
    if (!rel || seen.has(l.role)) continue;
    seen.add(l.role);
    accompaniedBy.push({ relationship: rel, cite: l.id });
  }
  return { chiefComplaint: cc, accompaniedBy, interpreterHeard: lines.some((l) => l.role === 'INTERPRETER') };
}

/**
 * Accepting a suggestion changes only the note's chief complaint / accompanied-by (source 'ai'),
 * never a demographic field.
 */
export function applySuggestion(
  info: IdentifyingInfo,
  sources: FieldSources,
  s: { kind: 'chiefComplaint'; text: string } | { kind: 'companion'; relationship: string }
): { info: IdentifyingInfo; sources: FieldSources } {
  if (s.kind === 'chiefComplaint') return { info: { ...info, chiefComplaint: s.text }, sources: { ...sources, chiefComplaint: 'ai' } };
  if (info.companions.some((c) => c.relationship === s.relationship)) return { info, sources };
  return {
    info: { ...info, accompaniedNone: false, companions: [...info.companions, { relationship: s.relationship, name: '' }] },
    sources: { ...sources, companions: 'ai' },
  };
}

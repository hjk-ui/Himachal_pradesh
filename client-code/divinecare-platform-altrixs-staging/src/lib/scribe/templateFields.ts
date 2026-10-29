/**
 * Map a grounded AI draft onto the practice's templates. Pure, browser-safe.
 *
 * Therapist templates (MD Therapy Intake 90791, Substance Abuse Intake 90791, Therapy Progress
 * 90832/90834/90837) are filled FIELD BY FIELD through the same template engine the structured note
 * editor uses (renderSection), so the saved note body has "Label: value" lines that the editor's
 * restoreValues turns back into chips when the clinician opens the draft. Formats (SOAP, DAP,
 * BIRP, GIRP, PIRP) and every other note template the EHR uses (prescriber templates: Psych Med Mgmt,
 * Med Mgmt, Psych Eval, adult / child psychiatry intake and re-eval; primary care SOAP; CBT, DBT,
 * MFT, EMDR, PIE, clinical intake, SUD, crisis, collateral, telephone, discharge, PRP, peer support)
 * are filled section by section under the note type's own headings (NOTE_SECTIONS, formatCatalog.ts),
 * so the structured prescriber editor opens each section with the drafted text in place. Sections that
 * are clinician decisions or attestations (NEVER_AI_HEADINGS: header, review, suicide screen / risk
 * formulation, safety plan, diagnoses, labs, level of care) stay blank; a mental status section
 * (Exam / Mental Status Exam / Mental Status) is filled domain by domain like the therapist templates.
 *
 * Never filled by AI (clinician decisions or compliance attestations): risk level, level of care,
 * frequency, diagnoses, C-SSRS, safety plan, Part 2 consent, telehealth consent / location, custody
 * and consent-for-treatment, mandated report, treatment plan timing, code override reason.
 * Mental status: each domain only when the transcript states or shows it; otherwise "Not assessed".
 * Every AI-filled section starts with the AI DRAFT marker; signing is blocked until the clinician
 * removes it from each section after review.
 */
import { renderSection, type FieldDef, type SectionDef, type Values } from '@/lib/ehr/therapy/engine';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { SUD_INTAKE, THERAPY_INTAKE, THERAPY_PROGRESS, TS, type TherapyNoteType } from '@/lib/ehr/therapy/sections';
import { NOTE_SECTIONS, type NoteType } from '@/lib/ehr/noteTemplates';
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';
import type { CheckedSentence } from './grounding';
import type { ScribeFormat } from './settings';
import { FORMAT_CODES, FORMAT_NOTE_TYPE, PART2_FORMATS } from './formatCatalog';

export type FormatSpec =
  | { format: ScribeFormat; kind: 'template'; noteType: TherapyNoteType; headings: string[]; part2: boolean; codes: readonly string[] }
  | {
      format: ScribeFormat;
      kind: 'sections';
      noteType: NoteType;
      headings: string[];
      /** Headings the model may fill (headings minus NEVER_AI_HEADINGS and the MSE heading) */
      aiHeadings: string[];
      /** Mental status section, filled domain by domain (else null) */
      mseHeading: string | null;
      part2: boolean;
      codes: readonly string[];
    }
  | { format: 'TREATMENT_PLAN_REVIEW'; kind: 'plan'; noteType: null; headings: string[]; part2: false; codes: readonly string[] };

/**
 * Medication sections only the prescriber writes. The AI may offer what was discussed as a
 * suggestion panel in review (GroundedResult.medSuggestions); it never inserts text here.
 */
export const CLINICIAN_ONLY_MED_HEADINGS: ReadonlySet<string> = new Set(['Plan - Med Changes', 'Current Medications']);

/**
 * Section headings never drafted by AI in the section formats: visit header and review, suicide
 * screen / risk formulation, safety plan, diagnoses, labs, level of care, releases, EMDR phase pick,
 * medication changes / current medications (CLINICIAN_ONLY_MED_HEADINGS).
 * The clinician completes them in Notes (the structured editor has its own inputs for most).
 */
export const NEVER_AI_HEADINGS: ReadonlySet<string> = new Set([
  ...CLINICIAN_ONLY_MED_HEADINGS,
  'Header',
  // Demographics + visit facts: prefilled from the chart / appointment and confirmed by the clinician.
  // AI may only SUGGEST the quoted chief complaint (CLIENT lines) and who came with the patient
  // (speaker roles) there: src/lib/ehr/identifyingInfo.ts identifyingSuggestionsFromTranscript.
  'Identifying Information',
  'Review',
  'Suicidal Ideation',
  'Suicide Prevention Plan',
  'Assessment - Sources of Risk',
  'Suicide Risk Factors',
  'Suicide Protective Factors',
  'Risk Assessment',
  'Risk Review',
  'Disposition / Safety Plan',
  'Assessment - Diagnoses',
  'Diagnosis',
  'Diagnostic Impression',
  'Lab Results',
  'Plan - Labs Ordered',
  'ASAM Level of Care',
  'Release of Information',
  'Phase',
]);

/** Mental status section names across the section templates. */
export const MSE_HEADINGS: ReadonlySet<string> = new Set(['Exam', 'Mental Status Exam', 'Mental Status']);

const TEMPLATE_OF: Partial<Record<ScribeFormat, TherapyNoteType>> = {
  THERAPY_PROGRESS: THERAPY_PROGRESS,
  THERAPY_INTAKE: THERAPY_INTAKE,
  SUD_INTAKE: SUD_INTAKE,
};

export function formatSpec(format: ScribeFormat): FormatSpec {
  const t = TEMPLATE_OF[format];
  if (t) {
    const tpl = THERAPY_TEMPLATES[t];
    return { format, kind: 'template', noteType: t, headings: tpl.sections.map((s) => s.heading), part2: tpl.part2, codes: tpl.codes };
  }
  if (format === 'TREATMENT_PLAN_REVIEW') return { format, kind: 'plan', noteType: null, headings: [], part2: false, codes: [] };
  const nt = FORMAT_NOTE_TYPE[format];
  const headings = [...NOTE_SECTIONS[nt]];
  const mseHeading = headings.find((h) => MSE_HEADINGS.has(h)) ?? null;
  return {
    format,
    kind: 'sections',
    noteType: nt,
    headings,
    aiHeadings: headings.filter((h) => !NEVER_AI_HEADINGS.has(h) && h !== mseHeading),
    mseHeading,
    part2: PART2_FORMATS.has(format),
    codes: FORMAT_CODES[format] ?? ['90832', '90834', '90837'],
  };
}

export const NEVER_AI_FIELDS = new Set([
  'patientLocation',
  'telehealthConsent',
  'overrideReason',
  'part2Consent',
  'part2Notice',
  'consentBy',
  'custody',
  'guardians',
  'planTiming',
  'levelOfCare',
  'frequency',
  'riskLevel',
  'riskRationale',
  'mandatedReport',
  'referralSource',
  'personsPresent',
]);

export type AiField = {
  id: string;
  heading: string;
  label: string;
  kind: 'text' | 'textarea' | 'single' | 'multi' | 'tri';
  options?: readonly string[];
};

/** Fields the model may fill for a therapist template. */
export function aiFieldCatalog(type: TherapyNoteType): AiField[] {
  const out: AiField[] = [];
  for (const s of THERAPY_TEMPLATES[type].sections) {
    for (const f of s.fields) {
      if (NEVER_AI_FIELDS.has(f.id)) continue;
      if (f.kind === 'text' || f.kind === 'textarea') out.push({ id: f.id, heading: s.heading, label: f.label, kind: f.kind });
      else if (f.kind === 'single' || f.kind === 'multi') out.push({ id: f.id, heading: s.heading, label: f.label, kind: f.kind, options: f.options });
      else if (f.kind === 'tri') out.push({ id: f.id, heading: s.heading, label: f.label, kind: 'tri', options: ['Denies', 'Endorses'] });
    }
  }
  return out;
}

export const MSE_DOMAINS = [
  'Appearance',
  'Behavior',
  'Speech',
  'Mood',
  'Affect',
  'Thought process',
  'Thought content',
  'Perception',
  'Cognition',
  'Insight',
  'Judgment',
] as const;
export const NOT_ASSESSED = 'Not assessed';

/**
 * Model MSE keys → domains. The model often writes "Thought Content", "Perceptions",
 * "Insight/Judgment" or "Orientation"; an exact-match lookup dropped those silently and the domain
 * showed "Not assessed" although it was said.
 */
const MSE_ALIASES: [RegExp, (typeof MSE_DOMAINS)[number]][] = [
  [/^appearance|^grooming|^hygiene|^dress/, 'Appearance'],
  [/^behaviou?r|^psychomotor|^attitude|^eye contact|^motor|^engagement/, 'Behavior'],
  [/^speech/, 'Speech'],
  [/^mood/, 'Mood'],
  [/^affect/, 'Affect'],
  [/^thought (process|form)|^thought processes|^process/, 'Thought process'],
  [/^thought content|^thoughts?$|^content|^delusion|^obsession|^preoccupation/, 'Thought content'],
  [/^percept|^hallucinat|^sensory/, 'Perception'],
  [/^cogniti|^orientation|^oriented|^memory|^attention|^concentration|^sensorium|^intellect|^fund of knowledge|^alert/, 'Cognition'],
  [/^insight/, 'Insight'],
  [/^judge?ment/, 'Judgment'],
];

/** Domains a model MSE key names ("Insight/Judgment" → both; unknown → none). */
export function mseDomainsForKey(key: string): (typeof MSE_DOMAINS)[number][] {
  const parts = key
    .toLowerCase()
    .replace(/[_]/g, ' ')
    .split(/\s*(?:\/|&|,|\band\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: (typeof MSE_DOMAINS)[number][] = [];
  for (const p of parts) {
    const hit = MSE_ALIASES.find(([re]) => re.test(p));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  // "Mood and affect" style keys split fine; a lone "thought" after a split ("process" / "content") was handled above
  return out;
}

/** Normalize a model's "mse" object onto MSE_DOMAINS, merging entries that land on the same domain. */
export function normalizeMseKeys<T extends { text: string; cites: string[]; basis: 'stated' | 'observed' }>(mse: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(mse)) {
    for (const d of mseDomainsForKey(k)) {
      const cur = out[d];
      out[d] = cur ? { ...cur, text: `${cur.text.trim().replace(/([^.!?])$/, '$1.')} ${v.text.trim()}`, cites: [...new Set([...cur.cites, ...v.cites])] } : { ...v };
    }
  }
  return out;
}

/**
 * What each terse prescriber heading holds, so the model files history where the clinician
 * expects it (an unnamed "Inpatient Hx" or "Substance Use Consequences" was often left empty).
 */
export const SECTION_HINTS: Record<string, string> = {
  'Inpatient Hx': 'psychiatric hospitalizations, inpatient / residential / partial-hospital (PHP) / IOP admissions: where, when, why, how long',
  'Outpatient Hx': 'prior outpatient therapy / psychiatry: provider, dates, response',
  'Suicide/Self-Harm Hx': 'past suicide attempts, past suicidal ideation, past self-harm (history only)',
  'Psychiatric Med Hx': 'past psychiatric medication trials: drug, dose, duration, response, side effects, reason stopped',
  Abuse: 'history of physical / sexual / emotional abuse or neglect, as reported',
  'Past Medical Hx': 'medical conditions, surgeries, head injury, seizures, medical hospitalizations',
  'Substance Use Hx': 'every substance discussed (alcohol, cannabis, nicotine, stimulants, opioids, benzodiazepines, other): age of first use, pattern, amount, frequency, last use, route',
  'Substance Use Consequences': 'consequences of use: legal (DUI, arrests), work / school, relationships, health, blackouts, withdrawal, overdose, tolerance, failed attempts to cut down',
  'Substance Treatment Hx': 'detox, rehab, residential, IOP, MAT, AA / NA, sober living: when and outcome',
  'Family Hx': 'family psychiatric / substance / suicide / medical history: which relative and which condition',
  'Family Relationships': 'family members, relationships, household, support',
  'Developmental and Educational Hx': 'birth, milestones, schooling, IEP / 504, grades',
  'General Social Hx': 'living situation, work, finances, relationships, faith, supports',
  'Legal History': 'arrests, charges, probation, court involvement',
  'Violence Hx': 'history of violence or aggression, as reported',
  'Trauma/Stressors': 'traumatic events and their impact',
  Stressors: 'current stressors',
  'Review of Systems': 'physical symptoms the client reported (sleep, appetite, energy, pain, etc.)',
  'Medical / Substance History': 'medical conditions and all substance use history and consequences',
  'Psychiatric History': 'prior diagnoses, hospitalizations, outpatient treatment, medication trials, suicide attempts',
  'Psychosocial History': 'family history, relationships, living situation, work / school, legal, trauma',
  'Measure Review': 'measure scores discussed, and measures the clinician asked the client to complete',
  Plan: 'the overall plan, incl. therapy, referrals, education, and measures to complete before the next session',
};

/** Heading key the model used → one of the targets ("Family History" → "Family Hx"). */
export function resolveTargetKey(key: string, targets: readonly string[]): string | null {
  if (targets.includes(key)) return key;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\bhistory\b/g, 'hx')
      .replace(/\btreatment\b/g, 'tx')
      .replace(/\bin[\s-]patient\b/g, 'inpatient')
      .replace(/\bout[\s-]patient\b/g, 'outpatient')
      .replace(/[^a-z0-9]/g, '');
  const k = norm(key);
  return targets.find((t) => norm(t) === k) ?? null;
}

/** Model output after grounding, ready to place. */
export type GroundedDraft = {
  /** Narrative fields (text / textarea) and format sections: grounded sentences */
  narrative: Record<string, CheckedSentence[]>;
  /** Option fields: chosen value(s), each with its citations (already validated) */
  options: Record<string, { value: string | string[]; cites: string[] }>;
  /** MSE domain → grounded sentence + whether it was stated by the client or observed */
  mse: Record<string, { sentence: CheckedSentence; basis: 'stated' | 'observed' }>;
  /** MSE domains the model filled but grounding withheld: left blank (not "Not assessed") and offered as a suggestion in review */
  mseSuggested?: string[];
};

/** Keep only option values the template allows (unknown values are dropped, never put in "Other"). */
export function validOptionValue(field: AiField, value: unknown): string | string[] | null {
  const opts = field.options ?? [];
  if (field.kind === 'multi') {
    const list = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string').map((v) => v.trim());
    const kept = [...new Set(list.filter((v) => opts.includes(v)))];
    return kept.length ? kept : null;
  }
  return typeof value === 'string' && opts.includes(value.trim()) ? value.trim() : null;
}

const usable = (list: CheckedSentence[] | undefined) => (list ?? []).filter((s) => s.status !== 'withheld');
const joinSentences = (list: CheckedSentence[]) => list.map((s) => s.text.trim().replace(/([^.!?])$/, '$1.')).join(' ');

/**
 * MSE lines. "Not assessed" only when nothing was drafted for the domain; a domain the model filled
 * but grounding withheld is left blank ("Insight:") and offered as a suggestion in review, instead
 * of a misleading "Not assessed".
 */
export function renderMse(mse: GroundedDraft['mse'], suggested: readonly string[] = []): string {
  return MSE_DOMAINS.map((d) => {
    const hit = mse[d];
    if (hit && hit.sentence.status !== 'withheld') return `${d}: ${hit.sentence.text.trim()} (${hit.basis})`;
    return suggested.includes(d) ? `${d}:` : `${d}: ${NOT_ASSESSED}`;
  }).join('\n');
}

/** Values for the template engine from the grounded draft. */
export function templateValues(type: TherapyNoteType, draft: GroundedDraft): Values {
  const values: Values = {};
  for (const f of aiFieldCatalog(type)) {
    if (f.kind === 'text' || f.kind === 'textarea') {
      const s = usable(draft.narrative[f.id]);
      if (s.length) values[f.id] = joinSentences(f.kind === 'text' ? s.slice(0, 2) : s);
    } else {
      const o = draft.options[f.id];
      if (!o || !o.cites.length) continue;
      const v = validOptionValue(f, o.value);
      if (v != null) values[f.id] = v;
    }
  }
  return values;
}

function sectionWhenless(s: SectionDef): SectionDef {
  // Render every section the draft touched; the editor re-applies visibility when it opens.
  return { ...s, when: undefined, fields: s.fields.map((f: FieldDef) => ({ ...f, when: undefined }) as FieldDef) };
}

/**
 * Section texts for the note body. Template formats: engine-rendered field lines (+ MSE lines in
 * the MSE section); sections formats: grounded sentences. AI-touched sections get the marker.
 */
export function applyDraft(spec: FormatSpec, draft: GroundedDraft, opts: { minor?: boolean; telehealth?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (spec.kind === 'plan') return out;
  if (spec.kind === 'sections') {
    for (const h of spec.headings) {
      if (h === spec.mseHeading) {
        out[h] = Object.keys(draft.mse).length || draft.mseSuggested?.length ? `${AI_DRAFT_MARKER}\n${renderMse(draft.mse, draft.mseSuggested)}` : '';
        continue;
      }
      const s = spec.aiHeadings.includes(h) ? usable(draft.narrative[h]) : [];
      out[h] = s.length ? `${AI_DRAFT_MARKER}\n${joinSentences(s)}` : '';
    }
    return out;
  }
  const values = templateValues(spec.noteType, draft);
  const ctx = { minor: Boolean(opts.minor), telehealth: Boolean(opts.telehealth) };
  for (const section of THERAPY_TEMPLATES[spec.noteType].sections) {
    if (section.heading === TS.session || section.heading === TS.review || section.heading === TS.identifying) {
      out[section.heading] = '';
      continue;
    }
    const lines: string[] = [];
    const rendered = renderSection(sectionWhenless(section), values, ctx, {});
    if (rendered) lines.push(rendered);
    if (section.fields.some((f) => f.kind === 'widget' && f.widget === 'mse')) lines.push(renderMse(draft.mse, draft.mseSuggested));
    out[section.heading] = lines.length ? `${AI_DRAFT_MARKER}\n${lines.join('\n')}` : '';
  }
  return out;
}

/** Note body exactly as the editors store it: heading line, then its text; blank line between. */
export function composeBody(spec: FormatSpec, texts: Record<string, string>): string {
  return spec.headings.map((h) => `${h}\n${(texts[h] || '').trim()}`).join('\n\n');
}

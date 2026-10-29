/**
 * AI Scribe coding assist. Pure (the ICD-10 index is passed in). Every result is a SUGGESTION the
 * clinician confirms in the note; nothing is put on a claim from here.
 *
 *  CPT   psychotherapy from documented minutes (suggestTherapyCpt / CPT time rule: 16-37 → 90832,
 *        38-52 → 90834, 53+ → 90837; family 90846/90847 from 26 min); intakes → 90791; prescriber
 *        visits: E/M level is never guessed (the clinician picks it; MDM elements are shown to
 *        support the choice), the psychotherapy add-on (90833/90836/90838) only with a chosen E/M
 *        and from the clinician's "Psychotherapy minutes" (psychotherapyAddOnForMinutes).
 *        Crisis: 90839 for 30–74 min, +90840 for each additional 30 min (75–104 → 1 unit, 105–134 → 2 …).
 *  90785 interactive complexity only with transcript evidence from a non-clinician line (interpreter,
 *        caregiver conflict that interferes, a sentinel event / mandated report discussed, play or
 *        devices to communicate) or an interpreter confirmed on the recording consent / as a speaker.
 *  POS   in person → practice office POS (11); telehealth → resolveTelehealthPos (patient location
 *        from check-in; never guessed); modifier from practice settings (95 / GT / none).
 *  ICD   chart diagnoses checked against the FY2027 code set, plus FY2027 index search on
 *        conditions the client stated (cited lines). Never assigned automatically.
 */
import { suggestTherapyCpt, type TherapySessionType } from '@/lib/ehr/therapy/rules';
import { psychotherapyAddOnForMinutes } from '@/lib/telehealth/inCallCoding';
import { resolveTelehealthPos, type TelehealthPosSettings } from '@/lib/telehealth/pos';
import { searchIcd10, lookupIcd10, type Icd10Index } from '@/lib/icd10/search';
import { ICD10_FY_LABEL } from '@/lib/icd10/normalize';
import type { TranscriptLine } from './diarization';
import type { ScribeFormat } from './settings';
import { FORMAT_CODING } from './formatCatalog';

export type CptSuggestion = { code: string | null; rule: string; addOn: string | null; addOnRule: string | null; addOnUnits?: number };
export type Evidence = { lineId: string; quote: string };
export type IcdSuggestion = { code: string; description: string; billable: boolean; source: 'chart' | 'transcript'; evidence: Evidence[]; note: string };
export type PosSuggestion = { pos: string | null; modifier: string | null; note: string };

export type CodingSuggestion = {
  cpt: CptSuggestion;
  interactiveComplexity: { suggested: boolean; evidence: Evidence[]; rule: string };
  pos: PosSuggestion;
  icd10: IcdSuggestion[];
  disclaimer: string;
};

export const CODING_DISCLAIMER = 'Suggestions only. You choose the codes; the note documents the time and the services.';

export function suggestCptForSession(input: {
  format: ScribeFormat;
  minutes: number | null;
  sessionType?: TherapySessionType;
  isPrescriberVisit?: boolean;
  emCode?: string | null;
  /** Prescriber visits: psychotherapy minutes separate from the E/M (drives 90833 / 90836 / 90838) */
  psychotherapyMinutes?: number | null;
}): CptSuggestion {
  const basis = FORMAT_CODING[input.format];
  if (basis === 'intake') {
    return { code: '90791', rule: 'Psychiatric diagnostic evaluation (intake): 90791 is not time-based.', addOn: null, addOnRule: null };
  }
  if (input.format === 'TREATMENT_PLAN_REVIEW') return { code: null, rule: 'Treatment plan updates are documented on the plan, not billed from this draft.', addOn: null, addOnRule: null };
  if (input.format === 'CRISIS') return suggestCrisisCpt(input.minutes);
  if (basis === 'none') return { code: null, rule: 'No code suggested for this note type: code it from the service documented.', addOn: null, addOnRule: null };
  if (input.isPrescriberVisit || basis === 'em') {
    const em = input.emCode && /^9921[2-5]$/.test(input.emCode) ? input.emCode : null;
    if (!em) return { code: null, rule: 'E/M level is not suggested: choose it from your documentation.', addOn: null, addOnRule: 'Psychotherapy add-on only with a documented E/M.' };
    const pMin = input.psychotherapyMinutes ?? null;
    if (pMin == null) return { code: em, rule: `E/M ${em} as documented.`, addOn: null, addOnRule: 'Enter the psychotherapy minutes (separate from the E/M) for an add-on.' };
    const addOn = psychotherapyAddOnForMinutes(pMin);
    return { code: em, rule: `E/M ${em} as documented.`, addOn, addOnRule: addOn ? `${pMin} psychotherapy min → ${addOn}.` : 'No add-on (psychotherapy under 16 min).' };
  }
  const s = suggestTherapyCpt(input.minutes, input.sessionType ?? 'individual');
  return { code: s.code, rule: s.rule, addOn: null, addOnRule: null };
}

/** 90839 first 30–74 min of crisis psychotherapy; +90840 each additional 30 min (from 75 min). */
export function crisisAddOnUnits(minutes: number): number {
  return minutes >= 75 ? Math.floor((minutes - 75) / 30) + 1 : 0;
}

export function suggestCrisisCpt(minutes: number | null): CptSuggestion {
  if (minutes == null) return { code: null, rule: 'Crisis psychotherapy is time-based: record the total crisis minutes (90839 needs at least 30).', addOn: null, addOnRule: null };
  if (minutes < 30) return { code: null, rule: `${minutes} min is under 30: not 90839. Code the psychotherapy by time (90832 from 16 min) if appropriate.`, addOn: null, addOnRule: null };
  const units = crisisAddOnUnits(minutes);
  return {
    code: '90839',
    rule: '90839 covers the first 30–74 minutes of crisis psychotherapy.',
    addOn: units ? '90840' : null,
    addOnRule: units ? `${minutes} min → +90840 × ${units} (each additional 30 min beyond 74).` : '+90840 starts at 75 minutes.',
    ...(units ? { addOnUnits: units } : {}),
  };
}

const IC_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\binterpret(er|ing)\b|\btranslat(e|or|ing)\b/i, why: 'interpreter / translation' },
  { re: /\b(yelling|screaming|arguing|fighting) (at|with) (each other|you|him|her|me)\b|\bstop interrupting\b/i, why: 'caregiver conflict interfering with care' },
  { re: /\b(report(ed)? (to|it to) (cps|dss|child protective|social services|the police))|\bmandated report/i, why: 'sentinel event / mandated report discussed' },
  { re: /\b(play therapy|puppets?|toys?|drawing|sand ?tray|communication (board|device))\b/i, why: 'play equipment or devices to communicate' },
];

/**
 * 90785 evidence. Only non-clinician lines count (the clinician saying "interpreter" is not evidence
 * one was used); an interpreter is confirmed by the recording consent or an Interpreter speaker.
 * Empty = do not suggest 90785.
 */
export function interactiveComplexityEvidence(lines: (Pick<TranscriptLine, 'id' | 'text'> & { role?: string })[], opts: { interpreterPresent?: boolean } = {}): Evidence[] {
  const out: Evidence[] = [];
  const interpreterSpoke = lines.find((l) => l.role === 'INTERPRETER');
  for (const l of lines) {
    if (l.role === 'CLINICIAN') continue;
    const hit = IC_PATTERNS.find((p) => p.re.test(l.text));
    if (hit) out.push({ lineId: l.id, quote: `${hit.why}: "${l.text.slice(0, 160)}"` });
    if (out.length >= 5) break;
  }
  if (opts.interpreterPresent && !out.some((e) => e.quote.startsWith('interpreter'))) {
    out.unshift({ lineId: 'consent', quote: 'interpreter / translation: an interpreter was listed on the recording consent' });
  } else if (interpreterSpoke && !out.some((e) => e.quote.startsWith('interpreter'))) {
    out.unshift({ lineId: interpreterSpoke.id, quote: 'interpreter / translation: an interpreter speaks in the session (speaker confirmed)' });
  }
  return out;
}

export function suggestPos(input: {
  mode: 'in_person' | 'telehealth' | 'dictation';
  patientLocationType?: string | null;
  posOffice?: string | null;
  posSettings?: TelehealthPosSettings | null;
  telehealthModifierDefault?: string | null;
}): PosSuggestion {
  if (input.mode !== 'telehealth') return { pos: input.posOffice || '11', modifier: null, note: `POS ${input.posOffice || '11'} (office), in person.` };
  const r = resolveTelehealthPos({ patientLocationType: input.patientLocationType, settings: input.posSettings });
  const m = (input.telehealthModifierDefault || '95').replace(/^-/, '');
  const modifier = m === 'none' ? null : m;
  return {
    pos: r.pos,
    modifier,
    note: r.pos ? `POS ${r.pos} (telehealth, patient ${r.pos === '10' ? 'at home' : 'not at home'})${modifier ? `, modifier ${modifier}` : ''}.` : 'POS unknown: confirm where the client was during the visit.',
  };
}

export function suggestIcd10(input: {
  index: Icd10Index | null;
  chart: { code: string | null; description: string | null }[];
  /** Conditions / symptoms the model found the client stating, with grounded citations */
  terms: { term: string; cites: string[] }[];
  lines: Pick<TranscriptLine, 'id' | 'text'>[];
}): IcdSuggestion[] {
  const out: IcdSuggestion[] = [];
  const seen = new Set<string>();
  for (const c of input.chart) {
    if (!c.code) continue;
    const hit = input.index ? lookupIcd10(input.index, c.code) : null;
    const code = hit?.code ?? c.code;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      description: hit?.description ?? c.description ?? '',
      billable: hit ? hit.billable : false,
      source: 'chart',
      evidence: [],
      note: hit ? (hit.billable ? 'On the chart.' : 'On the chart, but not billable: pick a more specific code.') : `Not in the ${ICD10_FY_LABEL} code set: update the chart diagnosis.`,
    });
  }
  if (!input.index) return out;
  const lineById = new Map(input.lines.map((l) => [l.id, l.text]));
  for (const t of input.terms.slice(0, 6)) {
    const evidence = t.cites.filter((c) => lineById.has(c)).map((c) => ({ lineId: c, quote: (lineById.get(c) || '').slice(0, 160) }));
    if (!evidence.length) continue;
    for (const h of searchIcd10(input.index, t.term, { limit: 2, billableOnly: true, context: 'bh' })) {
      if (seen.has(h.code)) continue;
      seen.add(h.code);
      out.push({ code: h.code, description: h.description, billable: h.billable, source: 'transcript', evidence, note: `Consider: "${t.term}" was discussed. Confirm clinically before charting; not a diagnosis.` });
    }
  }
  return out.slice(0, 10);
}

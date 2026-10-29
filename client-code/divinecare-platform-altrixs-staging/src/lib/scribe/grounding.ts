/**
 * Grounding guardrail for AI Scribe drafts. Pure, browser-safe.
 *
 * Same pattern as src/lib/clinical/serviceEligibility/ai.ts and src/lib/insights/clinical/ai.ts:
 * the model gets numbered sources (t1… transcript lines, c1… chart facts) and must cite them on
 * every sentence. Here each sentence is checked against ONLY the sources it cites:
 *   withheld (never placed in the note; listed for the clinician):
 *     empty · no citation · citation to a source that does not exist · a date, number, ICD-10 code,
 *     screening instrument, medication or dose that is not in the cited sources · "normal"
 *     mental-status shorthand (WNL / unremarkable) the cited sources do not say · a polarity
 *     mismatch (the sentence negates what the source states, or states what it negates; polarity.ts)
 *   flagged (placed in the note, highlighted "check against transcript"):
 *     fewer than SUPPORT_MIN of its content words appear in the cited sources · a negation the
 *     cited lines do not contain · a medication / dose heard in the session but not on the client's
 *     medication list ("not on medication list — verify", medications.ts)
 * draft.ts then runs the entailment pass (entailment.ts: Bedrock Haiku, "does source X support claim
 * Y?") on weak / negated / risk / MSE / medication sentences and withholds weak ones in those sections.
 * The clinician still reviews, edits and signs everything; nothing here signs or files.
 */
import { checkMedications, type ChartMedication } from './medications';
import { hasNegation, sentencePolarity } from './polarity';
import { instrumentKey, measuresInText, normalizeSpokenInstruments } from './spokenMeasures';

/** Negation words in a sentence that a cited negation ("No.") supports. */
const SUPPORT_NEGATORS = new Set(['denies', 'denied', 'deny', 'denying', 'negative', 'never', 'none', 'without']);

/** Mental status / risk shorthand clinicians dictate, spelled out for the overlap check (case-sensitive). */
const SHORTHAND: [RegExp, string][] = [
  [/\bA\/?VH\b/g, ' auditory visual hallucinations '],
  [/\bAH\b/g, ' auditory hallucinations '],
  [/\bVH\b/g, ' visual hallucinations '],
  [/\bTH\b/g, ' tactile hallucinations '],
  [/\bSI\b/g, ' suicidal ideation '],
  [/\bHI\b/g, ' homicidal ideation '],
  [/\bNSSI\b/g, ' non-suicidal self-injury '],
  [/\bA\s?&\s?O\s?x?\s?[34]\b|\bAOx?[34]\b/gi, ' alert oriented '],
  [/\bLGD\b|\blinear,? goal[\s-]directed\b/gi, ' linear goal directed '],
  [/\bPMA\b/g, ' psychomotor agitation '],
  [/\bPMR\b/g, ' psychomotor retardation '],
  [/\bDTO\b/g, ' danger to others '],
  [/\bDTS\b/g, ' danger to self '],
];
export function expandClinicalShorthand(text: string): string {
  let out = text;
  for (const [re, words] of SHORTHAND) out = out.replace(re, (m) => `${m}${words}`);
  return out;
}

export type SourceKind = 'transcript' | 'chart';
export type Source = { id: string; kind: SourceKind; text: string };
export type DraftSentence = { text: string; cites: string[] };

export type WithholdReason =
  | 'empty'
  | 'no_citation'
  | 'unknown_citation'
  | 'ungrounded_date'
  | 'ungrounded_number'
  | 'ungrounded_code'
  | 'ungrounded_instrument'
  | 'ungrounded_medication'
  | 'ungrounded_dose'
  | 'assumed_normal'
  | 'polarity_mismatch'
  | 'not_entailed'
  | 'weak_sensitive'
  | 'option_role'
  | 'option_polarity'
  | 'clinician_only';

export type CheckedSentence = DraftSentence & {
  status: 'supported' | 'weak' | 'withheld';
  reason?: WithholdReason;
  /** Share of the sentence's content words found in the cited sources (0..1) */
  support: number;
  /** Why it is flagged (kept in the note, highlighted) */
  flags?: string[];
  /** One-line reason detail (polarity, option checks) */
  detail?: string;
  /** Entailment verdict of the second pass, when it ran */
  entailment?: 'yes' | 'no' | 'partly';
};

export const SUPPORT_MIN = 0.35;

/** Withheld for these reasons: never offered back as a one-click suggestion (suggestions.ts). */
export const NOT_SUGGESTED_REASONS: ReadonlySet<WithholdReason> = new Set<WithholdReason>(['option_role', 'option_polarity', 'polarity_mismatch', 'clinician_only', 'empty', 'no_citation', 'unknown_citation']);

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const ICD = /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/g;
const INSTRUMENT = /\b(?:PHQ-?9|PHQ-?2|PHQ-?15|PHQ-?A|GAD-?7|GAD-?2|C-?SSRS|AUDIT(?:-C)?|DAST(?:-10)?|CAGE(?:-AID)?|PCL-?5|DASS-?(?:21|42)|DSM-?5|ASAM|LOCUS|CANS|MDQ|ASRS)\b/gi;
/** "DSM-5 Level 1 Cross-Cutting": the level number is part of the measure name, not a stated number */
const MEASURE_LEVEL = /\bLevel 1 Cross-Cutting\b/gi;
const CITE_TOKEN = /\[?\b[tc]\d{1,4}\b\]?/gi;

export { MEDICATIONS } from './medicationNames';

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, once: 1, twice: 2, half: 0.5, couple: 2,
  // Spanish captures (language es-US): the English note may state a number the Spanish line spells out
  // ("once" is English "once" above, so Spanish 11 is not listed)
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12,
  quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, cien: 100,
};

const STOP = new Set(
  'that this with from have were their there about which would could should been being also into than then they them what when where while will your yours some more most very just over under after before during because reported reports reporting stated states stating said says client patient clinician session today discussed discuss discussing noted notes described describes describing indicated indicates expressed expresses shared shares explored explores provided provides continued continues ongoing week weeks time times feel feels feeling felt like make made does didnt dont doesnt really things thing going goes went able around through within without other others each such these those both only even well good'.split(
    ' '
  )
);

function stem(w: string): string {
  return w.slice(0, 5);
}

export function contentWords(text: string): string[] {
  return (text.toLowerCase().replace(CITE_TOKEN, ' ').match(/[a-z][a-z'-]{3,}/g) ?? [])
    .map((w) => w.replace(/'s$|'/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Numbers stated in a source, including number words ("three days" → 3). */
export function sourceNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const noDates = text.replace(ISO_DATE, ' ').replace(INSTRUMENT, ' ');
  for (const n of noDates.match(/\d+(?:\.\d+)?/g) ?? []) out.add(String(Number(n)));
  const words = noDates.toLowerCase().match(/[a-z]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const v = NUMBER_WORDS[words[i]];
    if (v == null) continue;
    out.add(String(v));
    const next = NUMBER_WORDS[words[i + 1]];
    if (v >= 20 && next != null && next < 10) out.add(String(v + next));
    if (words[i + 1] === 'hundred') out.add(String(v * 100));
  }
  return out;
}

export type CheckOptions = {
  /** The client's active medication list (chart truth for names / doses) */
  medList?: ChartMedication[];
};

/** Check one sentence against the sources it cites. */
export function checkDraftSentence(s: DraftSentence, sources: Map<string, Source>, opts: CheckOptions = {}): CheckedSentence {
  const text = (s.text || '').trim();
  const cites = [...new Set((s.cites || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
  const base = { text, cites };
  const withhold = (reason: WithholdReason, detail?: string): CheckedSentence => ({ ...base, status: 'withheld', reason, support: 0, ...(detail ? { detail } : {}) });
  if (!text) return withhold('empty');
  if (!cites.length) return withhold('no_citation');
  if (cites.some((c) => !sources.has(c))) return withhold('unknown_citation');
  const citedSources = cites.map((c) => sources.get(c)!);
  const cited = citedSources.map((x) => x.text).join('\n');
  const citedTranscript = citedSources.filter((x) => x.kind === 'transcript').map((x) => x.text).join('\n');
  const citedLower = cited.toLowerCase();
  const body = text.replace(CITE_TOKEN, ' ');

  const dates = new Set(cited.match(ISO_DATE) ?? []);
  for (const d of body.match(ISO_DATE) ?? []) if (!dates.has(d)) return withhold('ungrounded_date');
  for (const d of body.match(SLASH_DATE) ?? []) if (!cited.includes(d)) return withhold('ungrounded_date');
  const codes = new Set((cited.replace(ISO_DATE, ' ').match(ICD) ?? []).map((c) => c.toUpperCase()));
  const noIso = body.replace(ISO_DATE, ' ').replace(SLASH_DATE, ' ');
  for (const c of noIso.match(ICD) ?? []) if (!codes.has(c.toUpperCase())) return withhold('ungrounded_code');
  // Spoken names count ("GAD seven", "PHQ nine", "DASS 42", "DSM five cross cutting")
  const citedInstruments = new Set([...measuresInText(cited).map((m) => instrumentKey(m.name)), ...(cited.match(INSTRUMENT) ?? []).map(instrumentKey)]);
  const citedFlat = citedLower.replace(/-/g, '');
  for (const m of noIso.match(INSTRUMENT) ?? []) {
    if (!citedInstruments.has(instrumentKey(m)) && !citedFlat.includes(m.toLowerCase().replace(/-/g, ''))) return withhold('ungrounded_instrument');
  }
  const nums = sourceNumbers(cited);
  for (const n of noIso.replace(MEASURE_LEVEL, ' ').replace(INSTRUMENT, ' ').replace(ICD, ' ').match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!nums.has(String(Number(n)))) return withhold('ungrounded_number');
  }
  const med = checkMedications(body, { cited, citedTranscript, citedNumbers: nums, medList: opts.medList ?? [] });
  if (med.withhold) return withhold(med.withhold);
  if (/\b(wnl|within normal limits|unremarkable)\b/i.test(body) && !/\b(normal|unremarkable|wnl)\b/i.test(cited)) return withhold('assumed_normal');
  const polarity = sentencePolarity(body, citedSources.map((x) => x.text));
  if (polarity.status === 'mismatch') return withhold('polarity_mismatch', (polarity as { detail: string }).detail);

  const words = contentWords(normalizeSpokenInstruments(body));
  // Clinical shorthand in the cited lines ("no AH/VH", "SI/HI", "A&Ox3") counts for the spelled-out words
  const srcStems = new Set(contentWords(normalizeSpokenInstruments(expandClinicalShorthand(cited))).map(stem));
  const citedNegates = citedSources.some((x) => hasNegation(x.text));
  const hit = words.filter((w) => srcStems.has(stem(w)) || (citedNegates && SUPPORT_NEGATORS.has(w))).length;
  const support = words.length ? hit / words.length : 1;
  const flags = [...med.flags, ...(polarity.status === 'unsupported_negation' ? [NEGATION_FLAG] : [])];
  const status = support >= SUPPORT_MIN && polarity.status === 'ok' ? 'supported' : 'weak';
  return { ...base, status, support: Math.round(support * 100) / 100, ...(flags.length ? { flags } : {}) };
}

/** A negation ("denies", "no", "not") the cited lines do not contain. */
export const NEGATION_FLAG = 'negation not in the cited lines — check the meaning';

export function checkSentences(list: DraftSentence[], sources: Map<string, Source>, opts: CheckOptions = {}): CheckedSentence[] {
  return list.map((s) => checkDraftSentence(s, sources, opts));
}

export function sourceMap(sources: Source[]): Map<string, Source> {
  return new Map(sources.map((s) => [s.id.toLowerCase(), s]));
}

export const WITHHOLD_LABEL: Record<WithholdReason, string> = {
  empty: 'Empty sentence',
  no_citation: 'No transcript or chart source cited',
  unknown_citation: 'Cited a source that does not exist',
  ungrounded_date: 'Date not in the cited source',
  ungrounded_number: 'Number not in the cited source',
  ungrounded_code: 'Diagnosis code not in the cited source',
  ungrounded_instrument: 'Screening measure not in the cited source',
  ungrounded_medication: 'Medication not in the cited source',
  ungrounded_dose: 'Dose not in the cited source',
  assumed_normal: 'Assumed a normal finding the source does not state',
  polarity_mismatch: 'Says the opposite of the cited line (negation)',
  not_entailed: 'The cited lines do not support it (meaning check)',
  weak_sensitive: 'Weak support in a risk, mental status or medication section',
  option_role: 'Chip not set from what the client said',
  option_polarity: 'Chip value does not match the client’s answer',
  clinician_only: 'Clinician-only section: offered as a suggestion, not inserted',
};

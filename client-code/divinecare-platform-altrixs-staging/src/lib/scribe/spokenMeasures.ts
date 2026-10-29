/**
 * Measures named aloud in a session ("GAD seven", "PHQ nine", "DASS 42", "DSM five cross cutting").
 * Pure, browser-safe.
 *
 *  - normalizeSpokenInstruments: spoken / transcribed variants → canonical names, so grounding can
 *    check "GAD-7" in a draft sentence against "the GAD seven" in the transcript.
 *  - measurePlanFromTranscript: measures the clinician said are to be completed (before / at the next
 *    session), mapped to the Altrixs measures catalog. Suggestions only: the clinician assigns them
 *    with one click in review (nothing is assigned or sent from speech). A measure that is not in the
 *    catalog is shown as "not available in Altrixs", never invented; one that is in the catalog but
 *    cannot be sent digitally (licensed copy pending, clinician-rated) is shown as "give in session".
 */
import { instrumentById, NOT_SENDABLE_TEXT, sendableCheck } from '@/lib/measures/instruments';

const N = (digits: string, words: string) => `(?:${digits}|${words})`;
const SEP = `[\\s.-]*`;
/** Letters spoken one by one ("P H Q") or written together ("PHQ") */
const letters = (s: string) => s.split('').join('\\.?\\s?');

export type SpokenMeasure = {
  /** Canonical display name */
  name: string;
  /** Altrixs measures catalog id (null = not in the catalog) */
  instrumentId: string | null;
  pattern: RegExp;
};

export const SPOKEN_MEASURES: SpokenMeasure[] = [
  { name: 'PHQ-9', instrumentId: 'phq-9', pattern: new RegExp(`\\b${letters('phq')}${SEP}${N('9', 'nine')}\\b`, 'i') },
  { name: 'PHQ-2', instrumentId: 'phq-2', pattern: new RegExp(`\\b${letters('phq')}${SEP}${N('2', 'two')}\\b`, 'i') },
  { name: 'PHQ-15', instrumentId: 'phq-15', pattern: new RegExp(`\\b${letters('phq')}${SEP}${N('15', 'fifteen')}\\b`, 'i') },
  { name: 'PHQ-A', instrumentId: 'phq-a', pattern: new RegExp(`\\b${letters('phq')}${SEP}a\\b|\\bphq for adolescents\\b`, 'i') },
  { name: 'GAD-7', instrumentId: 'gad-7', pattern: new RegExp(`\\b${letters('gad')}${SEP}${N('7', 'seven')}\\b`, 'i') },
  { name: 'GAD-2', instrumentId: 'gad-2', pattern: new RegExp(`\\b${letters('gad')}${SEP}${N('2', 'two')}\\b`, 'i') },
  { name: 'DASS-42', instrumentId: 'dass-42', pattern: new RegExp(`\\b(?:dass|das)${SEP}${N('42', 'forty[\\s-]?two')}\\b`, 'i') },
  { name: 'DASS-21', instrumentId: 'dass-21', pattern: new RegExp(`\\b(?:dass|das)${SEP}${N('21', 'twenty[\\s-]?one')}\\b`, 'i') },
  {
    name: 'DSM-5 Level 1 Cross-Cutting Symptom Measure',
    instrumentId: 'dsm5-cc',
    pattern: new RegExp(`\\b${letters('dsm')}${SEP}(?:5|five|v)\\b|\\bcross[\\s-]?cutting\\b`, 'i'),
  },
  { name: 'C-SSRS', instrumentId: 'c-ssrs-brief', pattern: /\bc[\s.-]*ssrs\b|\bcolumbia(?:[\s-]suicide)?\b/i },
  { name: 'PCL-5', instrumentId: 'pcl-5', pattern: new RegExp(`\\b${letters('pcl')}${SEP}${N('5', 'five')}\\b`, 'i') },
  { name: 'AUDIT-C', instrumentId: 'audit-c', pattern: /\baudit[\s-]?c\b/i },
  { name: 'AUDIT', instrumentId: 'audit', pattern: /\bAUDIT\b(?![\s-]?C\b)|\b(?:the )?audit (?:questionnaire|screen|form)\b|\balcohol use disorders identification test\b/ },
  { name: 'DAST-10', instrumentId: 'dast-10', pattern: new RegExp(`\\bdast${SEP}(?:${N('10', 'ten')})?\\b`, 'i') },
  { name: 'CAGE-AID', instrumentId: 'cage-aid', pattern: /\bcage[\s-]?aid\b/i },
  { name: 'MDQ', instrumentId: 'mdq', pattern: new RegExp(`\\b${letters('mdq')}\\b|\\bmood disorder questionnaire\\b`, 'i') },
  { name: 'ASRS-v1.1', instrumentId: 'asrs', pattern: new RegExp(`\\b${letters('asrs')}\\b|\\badult adhd self[\\s-]report\\b`, 'i') },
  { name: 'EPDS', instrumentId: 'epds', pattern: /\bepds\b|\bedinburgh\b/i },
  { name: 'ISI', instrumentId: 'isi', pattern: /\binsomnia severity index\b/i },
  { name: 'OCI-R', instrumentId: 'oci-r', pattern: /\boci[\s-]?r\b/i },
  { name: 'ACEs', instrumentId: 'aces', pattern: /\baces? (?:questionnaire|screen|survey)\b|\badverse childhood experiences\b/i },
  { name: 'CRAFFT', instrumentId: 'crafft', pattern: /\bcrafft\b|\bcraft (?:screen|questionnaire)\b/i },
  { name: 'BDI-II', instrumentId: 'bdi-ii', pattern: /\bbdi(?:[\s-]?(?:ii|2|two))?\b|\bbeck depression\b/i },
  { name: 'BAI', instrumentId: 'bai', pattern: /\bbai\b|\bbeck anxiety\b/i },
  { name: 'WHO-5', instrumentId: 'who-5', pattern: /\bwho[\s-]?(?:5|five)\b/i },
  { name: 'Vanderbilt', instrumentId: 'vanderbilt', pattern: /\bvanderbilt\b/i },
  { name: 'SCARED', instrumentId: 'scared-c', pattern: /\bscared (?:screen|questionnaire|form)\b/i },
  // Named in sessions but not in the Altrixs catalog: shown as "not available in Altrixs"
  { name: 'MMPI', instrumentId: null, pattern: /\bmmpi(?:[\s-]?(?:2|3|rf))?\b/i },
  { name: 'PAI', instrumentId: null, pattern: /\bpersonality assessment inventory\b/i },
  { name: 'Conners', instrumentId: null, pattern: /\bconners\b/i },
  { name: 'Beck Hopelessness Scale', instrumentId: null, pattern: /\bbeck hopelessness\b/i },
];

/** Replace spoken / transcribed measure names with their canonical names. */
export function normalizeSpokenInstruments(text: string): string {
  let out = text;
  for (const m of SPOKEN_MEASURES) out = out.replace(new RegExp(m.pattern.source, m.pattern.flags.includes('g') ? m.pattern.flags : `${m.pattern.flags}g`), ` ${m.name} `);
  return out;
}

/** Canonical measures named in a text (catalog order, unique). */
export function measuresInText(text: string): SpokenMeasure[] {
  return SPOKEN_MEASURES.filter((m) => m.pattern.test(text));
}

/** Canonical key for comparing instrument mentions ("GAD-7" / "gad 7" / "GAD seven" → "gad7"). */
export function instrumentKey(name: string): string {
  const m = SPOKEN_MEASURES.find((x) => x.pattern.test(name));
  return (m?.name ?? name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "Complete / fill out / do / send / assign … (before / for / at) the next session / visit / appointment" */
const COMPLETE_INTENT =
  /\b(complete|completing|completed|fill(?:ing)? out|fill in|do|doing|take|taking|send(?:ing)?|assign(?:ing)?|give you|get you|have you|want you to|need you to|screen(?:ing)? with|administer|repeat)\b/i;
const NEXT_TIME = /\b(next (?:session|visit|appointment|time|week)|before (?:we meet|i see you|your next)|by (?:next|our next)|for next|follow[\s-]?up|at intake|before the visit|on the portal|link)\b/i;

export type MeasurePlanStatus = 'sendable' | 'in_session' | 'not_available' | 'ambiguous';

export type MeasurePlanItem = {
  name: string;
  instrumentId: string | null;
  status: MeasurePlanStatus;
  /** Why it cannot be assigned digitally / what to do */
  note: string | null;
  /** Transcript lines where the clinician said it */
  cites: string[];
};

export const NOT_IN_CATALOG_TEXT = 'Not available in Altrixs: give it from the official form outside Altrixs, or choose a measure in the catalog.';
export const DASS_VERSION_TEXT = 'Say which version (DASS-21 or DASS-42) to assign it.';

export type PlanLine = { id: string; role: string; text: string };

/**
 * Measures the clinician said are to be completed. Only CLINICIAN lines with a completion intent
 * (or a next-session cue) count: a client mentioning "the PHQ" is not a plan. Never assigns.
 */
export function measurePlanFromTranscript(lines: PlanLine[]): MeasurePlanItem[] {
  const out = new Map<string, MeasurePlanItem>();
  lines.forEach((l, i) => {
    if (l.role !== 'CLINICIAN') return;
    const found = measuresInText(l.text).sort((a, b) => l.text.search(a.pattern) - l.text.search(b.pattern));
    const bareDass = /\bdass\b/i.test(l.text) && !found.some((m) => m.name.startsWith('DASS'));
    if (!found.length && !bareDass) return;
    // The intent may be in this line or the clinician's line just before ("Before next time I want you to…")
    const prev = lines[i - 1]?.role === 'CLINICIAN' ? lines[i - 1].text : '';
    if (!COMPLETE_INTENT.test(l.text) && !NEXT_TIME.test(l.text) && !COMPLETE_INTENT.test(prev) && !NEXT_TIME.test(prev)) return;
    for (const m of found) {
      const key = m.instrumentId ?? m.name;
      const cur = out.get(key);
      if (cur) {
        if (!cur.cites.includes(l.id)) cur.cites.push(l.id);
        continue;
      }
      out.set(key, { name: m.name, instrumentId: m.instrumentId, ...measureStatus(m.instrumentId), cites: [l.id] });
    }
    if (bareDass && !out.has('DASS')) out.set('DASS', { name: 'DASS (version not stated)', instrumentId: null, status: 'ambiguous', note: DASS_VERSION_TEXT, cites: [l.id] });
  });
  return [...out.values()];
}

export function measureStatus(instrumentId: string | null): { status: MeasurePlanStatus; note: string | null } {
  if (!instrumentId || !instrumentById(instrumentId)) return { status: 'not_available', note: NOT_IN_CATALOG_TEXT };
  const check = sendableCheck(instrumentId);
  if (check.ok === true) return { status: 'sendable', note: null };
  return { status: 'in_session', note: NOT_SENDABLE_TEXT[(check as { reason: keyof typeof NOT_SENDABLE_TEXT }).reason] };
}

/** Plan sentence for the note: "Measures to complete before next session: GAD-7, PHQ-9, …" */
export function measurePlanSentence(items: MeasurePlanItem[]): string | null {
  const names = items.filter((i) => i.status !== 'ambiguous').map((i) => i.name);
  return names.length ? `Measures to complete before next session: ${names.join(', ')}.` : null;
}

/**
 * Assignment requests for the one-click "Assign these measures" action: sendable catalog measures
 * only, schedule "once", due on the next appointment day (or today). Sending follows the practice's
 * existing measure settings and the client's contact consents (the measures job), not this click.
 */
export function measureAssignments(items: MeasurePlanItem[], input: { clientId: string; nextAppointmentDate: string | null }) {
  return items
    .filter((i) => i.status === 'sendable' && i.instrumentId)
    .map((i) => ({ clientId: input.clientId, instrumentId: i.instrumentId as string, schedule: 'once' as const, startDate: input.nextAppointmentDate ?? null }));
}

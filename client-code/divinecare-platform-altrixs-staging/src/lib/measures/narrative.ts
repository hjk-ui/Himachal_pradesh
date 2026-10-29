/**
 * Measures in the note (pure; browser-safe). Completed measures since the last note become one line
 * ("PHQ-9 14 (moderate), down from 19 on 9/12; item 9 = 0. GAD-7 9 (mild).") that the clinician can
 * insert into the template's assessment / measures section, never at the top of the note (the
 * Valant complaint: the measure landed above the chief complaint / HPI). Clinicians can edit or
 * delete the inserted text like any other text.
 */
import { SAFETY_ITEMS } from './instruments';

/**
 * Section that holds measures, per note type (stored keys, src/lib/ehr/noteTemplates.ts). Types
 * without an assessment-style section return null: the line is offered to copy, never inserted at
 * the top.
 */
export const MEASURE_SECTION_BY_NOTE_TYPE: Readonly<Record<string, string>> = Object.freeze({
  // Therapist templates (src/lib/ehr/therapy/sections.ts)
  'Therapy Progress': 'Impression',
  'Therapy Intake': 'Diagnostic Impressions',
  'Substance Abuse Intake': 'Screening Scores',
  // Psychiatry templates (Valant order): the Measure Review section
  'Psych Med Mgmt': 'Measure Review',
  'Adult Psych Re-Eval': 'Measure Review',
  'Adult Psych Intake': 'Assessment - Diagnoses',
  'Child Psych Initial Intake': 'Assessment - Diagnoses',
  'Child Psych Intake': 'Assessment - Diagnoses',
  // Classic formats
  SOAP: 'Assessment',
  DAP: 'Assessment',
  BIRP: 'Response',
  GIRP: 'Response',
  PIE: 'Evaluation',
  PIRP: 'Response',
  MFT: 'Systemic Assessment',
  DBT: 'Diary Card Review',
  Intake: 'Diagnostic Impression',
  'Psych Eval': 'Diagnosis',
  'Med Mgmt': 'Assessment',
  PRP: 'Participant Response',
  'Peer Support': 'Participant Response',
  Group: 'Individual Response',
  Crisis: 'Risk Assessment',
  Discharge: 'Progress Toward Goals',
});

/** Stored note type keys differ from labels for the therapist templates; accept both */
const TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'MD Therapy Adult & Child Intake': 'Therapy Intake',
  'Therapy Progress Adult & Child': 'Therapy Progress',
});

export function measureSectionFor(noteType: string | null | undefined, headings?: readonly string[]): string | null {
  const t = String(noteType ?? '').trim();
  const key = TYPE_ALIASES[t] ?? t;
  const section = MEASURE_SECTION_BY_NOTE_TYPE[key] ?? null;
  if (!section) return null;
  // Only a section the open template really has
  if (headings && !headings.includes(section)) return null;
  return section;
}

export type NarrativeRecord = {
  id: string;
  instrumentId: string;
  instrumentName: string;
  totalScore: number | null;
  severity: string | null;
  /** ISO date-time or YYYY-MM-DD */
  date: string;
  /** item id -> score, for the safety item */
  items?: Record<string, number | null>;
};

const md = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${Number(m)}/${Number(d)}`;
};

const fmtScore = (n: number | null) => (n == null ? '—' : String(Math.round(n * 100) / 100));

/** "Mild Anxiety" -> "mild"; "Moderately Severe" -> "moderately severe" */
function severityWord(severity: string | null, instrumentName: string): string | null {
  if (!severity) return null;
  const s = severity
    .replace(new RegExp(`\\b${instrumentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '')
    .replace(/\b(anxiety|depression)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return s || null;
}

/**
 * One line for the note: for each instrument completed since `sinceDay` (latest result), the score,
 * severity, change from the previous result and the safety item. `history` is every result of the
 * client (any order), so "previous" can be before `sinceDay`. Empty string when nothing is new.
 */
export function measuresNarrative(history: NarrativeRecord[], sinceDay: string | null): { text: string; recordIds: string[] } {
  const byInstrument = new Map<string, NarrativeRecord[]>();
  for (const r of history) {
    if (!r.date) continue;
    byInstrument.set(r.instrumentId, [...(byInstrument.get(r.instrumentId) ?? []), r]);
  }
  const parts: { at: string; text: string; id: string }[] = [];
  for (const rows of byInstrument.values()) {
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
    const [latest, previous] = sorted;
    if (sinceDay && latest.date.slice(0, 10) < sinceDay) continue;
    const sev = severityWord(latest.severity, latest.instrumentName);
    let text = `${latest.instrumentName} ${fmtScore(latest.totalScore)}${sev ? ` (${sev})` : ''}`;
    if (previous && latest.totalScore != null && previous.totalScore != null) {
      const diff = latest.totalScore - previous.totalScore;
      const dir = diff < 0 ? 'down from' : diff > 0 ? 'up from' : 'unchanged from';
      text += `, ${dir} ${fmtScore(previous.totalScore)} on ${md(previous.date)}`;
    }
    const item = SAFETY_ITEMS[latest.instrumentId];
    const itemScore = item ? latest.items?.[item] : undefined;
    if (item && itemScore !== undefined && itemScore !== null) text += `; item ${item.replace(/^q/, '')} = ${itemScore}`;
    parts.push({ at: latest.date, text, id: latest.id });
  }
  parts.sort((a, b) => b.at.localeCompare(a.at));
  return { text: parts.length ? `${parts.map((p) => p.text).join('. ')}.` : '', recordIds: parts.map((p) => p.id) };
}

/** Append the line to a section's text on its own line; never twice */
export function appendNarrative(current: string | null | undefined, line: string): string {
  const cur = (current ?? '').trimEnd();
  if (!line.trim()) return cur;
  if (cur.includes(line.trim())) return cur;
  return cur ? `${cur}\n${line.trim()}` : line.trim();
}

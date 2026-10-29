/**
 * Risk language in a session transcript. Pure, browser-safe (also used for live cues).
 *
 * Reuses the Risk Watch engine (src/lib/ai/riskWatch: C-SSRS concepts, negation, idioms,
 * history vs recent). Client / other-participant turns are scanned as the client's words; the
 * clinician's own screening questions ("any thoughts of hurting yourself?") are not findings. When the
 * capture is the clinician speaking ABOUT the session (dictation, post-session recap, pasted summary:
 * scanClinician), clinician lines are scanned too, as note text (screening questions still excluded).
 * The findings are stored on the capture and gate signing (riskGate.ts). Each finding keeps
 * its transcript line and timestamp. Any suicide or self-harm finding prompts the C-SSRS screener
 * and a safety-plan review with the 988 reminder; homicide prompts a duty-to-warn / safety review;
 * abuse / neglect prompts the Maryland mandated-report check. Prompts never diagnose and never
 * fill the risk fields: the clinician documents the assessment.
 */
import { scanRiskText } from '@/lib/ai/riskWatch/engine';
import { CONCEPT_LABEL, type RiskCategory, type RiskConcept, type RiskSeverity } from '@/lib/ai/riskWatch/phrases';
import { STAFF_988_REMINDER } from '@/lib/ai/riskWatch/crisisResources';
import { formatTimestamp, type TranscriptLine } from './diarization';

export type TranscriptRiskFinding = {
  lineId: string;
  at: string;
  startMs: number;
  category: RiskCategory;
  concept: RiskConcept;
  label: string;
  severity: RiskSeverity;
  quote: string;
};

export type RiskPrompt = {
  kind: 'cssrs' | 'safety_plan' | 'homicide' | 'mandated_report';
  title: string;
  detail: string;
};

export type TranscriptRisk = {
  findings: TranscriptRiskFinding[];
  severity: RiskSeverity | null;
  prompts: RiskPrompt[];
  reminder988: string | null;
};

const RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Dictation, recap or pasted text: the clinician narrates what the client said. */
export function clinicianNarrates(cap: { mode?: string | null; source?: string | null; engine?: string | null }): boolean {
  return cap.mode === 'dictation' || cap.source === 'recap' || cap.engine === 'paste' || cap.engine === 'import';
}

/**
 * A clinician narrating the session ("Client stated she wants to kill herself"): scanned as note text,
 * and once more with the client's reported words in the first person ("…kill myself") so third-person
 * phrasing is not missed. Questions are never findings. One hit per concept.
 */
function narratedHits(text: string) {
  if (/\?\s*$/.test(text.trim())) return [];
  const asNote = scanRiskText(text, 'note').hits;
  const firstPerson = text.replace(/\b(herself|himself|themselves|themself)\b/gi, 'myself').replace(/\b(her|his|their) (own )?life\b/gi, 'my $2life');
  const reported = firstPerson === text ? [] : scanRiskText(firstPerson, 'patient_message').hits;
  const seen = new Set(asNote.map((h) => h.concept));
  return [...asNote, ...reported.filter((h) => !seen.has(h.concept))];
}

export function scanTranscriptRisk(lines: Pick<TranscriptLine, 'id' | 'role' | 'startMs' | 'text'>[], opts: { scanClinician?: boolean } = {}): TranscriptRisk {
  const findings: TranscriptRiskFinding[] = [];
  for (const l of lines) {
    if (l.role === 'CLINICIAN' && !opts.scanClinician) continue;
    const hits = l.role === 'CLINICIAN' ? narratedHits(l.text) : scanRiskText(l.text, 'patient_message').hits;
    for (const h of hits) {
      findings.push({
        lineId: l.id,
        at: formatTimestamp(l.startMs),
        startMs: l.startMs,
        category: h.category,
        concept: h.concept,
        label: CONCEPT_LABEL[h.concept],
        severity: h.severity,
        quote: h.quote,
      });
    }
  }
  const severity = findings.reduce<RiskSeverity | null>((m, f) => (!m || RANK[f.severity] > RANK[m] ? f.severity : m), null);
  const cats = new Set(findings.map((f) => f.category));
  const prompts: RiskPrompt[] = [];
  const suicidal = cats.has('suicide') || cats.has('self_harm');
  if (suicidal) {
    prompts.push({
      kind: 'cssrs',
      title: 'Risk language detected: complete the C-SSRS screener',
      detail: 'Suicide or self-harm language was heard from the client. Complete the C-SSRS screener in the note and document your risk formulation.',
    });
    prompts.push({
      kind: 'safety_plan',
      title: 'Review or update the safety plan',
      detail: 'Review the Stanley-Brown safety plan with the client before they leave, and give crisis resources.',
    });
  }
  if (cats.has('homicide')) {
    prompts.push({ kind: 'homicide', title: 'Homicidal language detected: assess and document', detail: 'Assess intent, plan, means and identifiable target; consider duty-to-warn obligations and consult your supervisor.' });
  }
  if (cats.has('abuse_danger')) {
    prompts.push({
      kind: 'mandated_report',
      title: 'Abuse or danger language detected',
      detail: 'Assess safety. Maryland requires a report to DSS / law enforcement for suspected child (or vulnerable adult) abuse or neglect.',
    });
  }
  return { findings, severity, prompts, reminder988: suicidal || cats.has('hopelessness') ? STAFF_988_REMINDER : null };
}

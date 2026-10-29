/**
 * The chart history section of the pre-visit brief facts. Pure.
 *
 * Compact and name-free (texts redacted again here; no ids, no quotes, no Part 2 facts), sliced by
 * audience:
 *  - prescriber: diagnoses, medication trials, hospitalizations, risk history (+ last risk
 *    assessment / safety plan), substance use, medical issues / allergies;
 *  - therapist: diagnoses, therapy modalities / goals / progress, social / functional themes,
 *    hospitalizations, risk history (+ last risk assessment / safety plan), trauma summary, open items.
 */
import type { ChartDigest, DigestItem, ItemSection, MedicationTrial } from '@/lib/ai/chartDigest/types';

export type ChartHistoryAudience = 'therapist' | 'prescriber';

export type ChartHistoryFacts = {
  /** YYYY-MM-DD the digest was generated */
  generated: string;
  stale: boolean;
  items: { section: string; text: string; date: string | null }[];
};

export const CHART_HISTORY_PER_SECTION = 5;
export const CHART_HISTORY_TEXT_MAX = 160;

const SECTION_LABEL: Record<ItemSection | 'medicationTrials' | 'lastRiskAssessment' | 'safetyPlan', string> = {
  diagnoses: 'Diagnosis history',
  medicationTrials: 'Medication trial',
  hospitalizations: 'Hospitalization / ER',
  riskHistory: 'Risk history',
  lastRiskAssessment: 'Last risk assessment',
  safetyPlan: 'Safety plan',
  substanceUse: 'Substance use',
  trauma: 'Trauma (summary)',
  socialFunctional: 'Social / functional',
  therapy: 'Therapy',
  openItems: 'Open item (last visit)',
  medical: 'Medical / allergy',
};

export const AUDIENCE_SECTIONS: Record<ChartHistoryAudience, Array<ItemSection | 'medicationTrials' | 'lastRiskAssessment' | 'safetyPlan'>> = {
  prescriber: ['lastRiskAssessment', 'safetyPlan', 'riskHistory', 'medicationTrials', 'diagnoses', 'hospitalizations', 'substanceUse', 'medical'],
  therapist: ['lastRiskAssessment', 'safetyPlan', 'riskHistory', 'diagnoses', 'hospitalizations', 'therapy', 'socialFunctional', 'trauma', 'openItems'],
};

export function medTrialText(t: MedicationTrial): string {
  const parts = [t.drug + (t.doses.length ? ` ${t.doses.join(' / ')}` : '')];
  if (t.start || t.end) parts.push(`${t.start ?? '?'} to ${t.end ?? 'current or unknown'}`);
  if (t.response) parts.push(`response: ${t.response}`);
  if (t.reasonStopped) parts.push(`stopped: ${t.reasonStopped}`);
  if (t.sideEffects.length) parts.push(`side effects: ${t.sideEffects.join(', ')}`);
  return parts.join('; ');
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > CHART_HISTORY_TEXT_MAX ? `${t.slice(0, CHART_HISTORY_TEXT_MAX - 1).trimEnd()}…` : t;
};

export function chartHistoryFacts(
  input: { digest: ChartDigest; generatedAt: Date; stale: boolean },
  audience: ChartHistoryAudience,
  redact: (text: string) => string
): ChartHistoryFacts {
  const d = input.digest;
  const items: ChartHistoryFacts['items'] = [];
  const push = (section: string, text: string, date: string | null) => items.push({ section, text: clip(redact(text)), date });
  for (const s of AUDIENCE_SECTIONS[audience]) {
    if (s === 'lastRiskAssessment' || s === 'safetyPlan') {
      const it = d[s];
      if (it && !it.part2) push(SECTION_LABEL[s], it.text, it.date);
      continue;
    }
    if (s === 'medicationTrials') {
      for (const t of (d.medicationTrials ?? []).filter((x) => !x.part2).slice(-CHART_HISTORY_PER_SECTION)) push(SECTION_LABEL[s], medTrialText(t), t.end ?? t.start);
      continue;
    }
    const picked = new Set([d.lastRiskAssessment?.text, d.safetyPlan?.text].filter(Boolean));
    const list: DigestItem[] = (d[s] ?? []).filter((x) => !x.part2 && !(s === 'riskHistory' && picked.has(x.text)));
    for (const it of list.slice(-CHART_HISTORY_PER_SECTION)) push(SECTION_LABEL[s], it.text, it.date);
  }
  return { generated: input.generatedAt.toISOString().slice(0, 10), stale: input.stale, items };
}

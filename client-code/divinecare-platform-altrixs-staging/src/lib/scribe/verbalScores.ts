/**
 * Screening scores stated aloud in session ("your PHQ-9 is 14"). Pure, browser-safe.
 * The draft offers "Save as PHQ-9 = 14 (verbal)"; the clinician confirms and the score is saved
 * as a ClinicalAssessmentRecord with source 'verbal_in_session' (no item answers: a verbal total).
 */

export type VerbalInstrument = { id: string; name: string; category: string; max: number; bands: { upTo: number; label: string }[] };

export const VERBAL_INSTRUMENTS: readonly VerbalInstrument[] = [
  { id: 'phq9', name: 'PHQ-9', category: 'Depression', max: 27, bands: [{ upTo: 4, label: 'Minimal' }, { upTo: 9, label: 'Mild' }, { upTo: 14, label: 'Moderate' }, { upTo: 19, label: 'Moderately severe' }, { upTo: 27, label: 'Severe' }] },
  { id: 'phq2', name: 'PHQ-2', category: 'Depression', max: 6, bands: [{ upTo: 2, label: 'Negative screen' }, { upTo: 6, label: 'Positive screen' }] },
  { id: 'gad7', name: 'GAD-7', category: 'Anxiety', max: 21, bands: [{ upTo: 4, label: 'Minimal' }, { upTo: 9, label: 'Mild' }, { upTo: 14, label: 'Moderate' }, { upTo: 21, label: 'Severe' }] },
  { id: 'pcl5', name: 'PCL-5', category: 'Trauma', max: 80, bands: [{ upTo: 32, label: 'Below the provisional PTSD cut point' }, { upTo: 80, label: 'At or above the provisional PTSD cut point (33)' }] },
  { id: 'auditc', name: 'AUDIT-C', category: 'Substance use', max: 12, bands: [{ upTo: 2, label: 'Negative screen' }, { upTo: 12, label: 'Positive screen (3+ women / 4+ men)' }] },
];

export const VERBAL_SOURCE = 'verbal_in_session';

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function verbalInstrument(name: string): VerbalInstrument | null {
  const k = key(name);
  return VERBAL_INSTRUMENTS.find((i) => key(i.name) === k || key(i.id) === k) ?? null;
}

export function verbalSeverity(inst: VerbalInstrument, score: number): string {
  return inst.bands.find((b) => score <= b.upTo)?.label ?? '';
}

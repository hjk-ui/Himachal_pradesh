/**
 * Measures that can go to a patient (pure; browser-safe). Built on the assessment catalog
 * (src/features/ehr/assessments/catalog.ts): same items, same scoring.
 *
 * Sendable = self-report, has digital items, and NOT "item content pending licensed copy"
 * (NIDA-Modified ASSIST and BAM stay in-session / paper until a licensed copy is added).
 */
import { ASSESSMENT_CATALOG, type AssessmentInstrument } from '@/features/ehr/assessments/catalog';

export const CATALOG_BY_ID: ReadonlyMap<string, AssessmentInstrument> = new Map(ASSESSMENT_CATALOG.map((i) => [i.id, i]));

export function instrumentById(id: string | null | undefined): AssessmentInstrument | null {
  return id ? CATALOG_BY_ID.get(id) ?? null : null;
}

export type SendableCheck = { ok: true } | { ok: false; reason: 'unknown' | 'pending_licensed_copy' | 'clinician_rated' | 'no_items' };

export function sendableCheck(id: string): SendableCheck {
  const i = instrumentById(id);
  if (!i) return { ok: false, reason: 'unknown' };
  if (i.itemContentPending) return { ok: false, reason: 'pending_licensed_copy' };
  if (i.adminType !== 'Self-Report') return { ok: false, reason: 'clinician_rated' };
  if (!i.hasDigitalQuestionnaire || !i.questions?.length) return { ok: false, reason: 'no_items' };
  return { ok: true };
}

export const NOT_SENDABLE_TEXT: Record<Exclude<SendableCheck, { ok: true }>['reason'], string> = {
  unknown: 'Unknown measure.',
  pending_licensed_copy: 'Item content pending licensed copy: give it in session from the official form.',
  clinician_rated: 'Clinician-rated: give it in session.',
  no_items: 'No digital questionnaire: give it in session.',
};

export function isSendable(id: string): boolean {
  return sendableCheck(id).ok;
}

/** Every measure a patient can complete from a link, catalog order */
export function sendableInstruments(): AssessmentInstrument[] {
  return ASSESSMENT_CATALOG.filter((i) => isSendable(i.id));
}

/** Substance-use instruments: 42 CFR Part 2 handling for Part 2 clients */
export function isSudInstrument(id: string): boolean {
  return instrumentById(id)?.category === 'Substance Use';
}

/**
 * Item-level safety items: a score above 0 is a positive safety screen whatever the total.
 * (SBQ-R has no single item; its total >= 7 is flagged by the catalog scoring.)
 */
export const SAFETY_ITEMS: Readonly<Record<string, string>> = Object.freeze({
  'phq-9': 'q9',
  'phq-a': 'q9',
  epds: 'q10',
});

/** PHQ-9 for adults; PHQ-A for 12–17 (the catalog's adolescent version, same thresholds) */
export function depressionInstrumentForAge(ageYears: number | null | undefined): 'phq-9' | 'phq-a' {
  return typeof ageYears === 'number' && ageYears < 18 && CATALOG_BY_ID.has('phq-a') ? 'phq-a' : 'phq-9';
}

/**
 * Clinically meaningful worsening (points up from the previous score). PHQ-9 / PHQ-A: 5 (the
 * standard minimal clinically important change); GAD-7: 4; PCL-5: 10; Y-BOCS: 5. Others: none (no inbox item).
 */
export const WORSENING_POINTS: Readonly<Record<string, number>> = Object.freeze({
  'phq-9': 5,
  'phq-a': 5,
  'gad-7': 4,
  'pcl-5': 10,
  // Y-BOCS total (clinician-entered, score only): 5 points, mirroring PHQ-9
  ybocs: 5,
});

/** Higher score = better (wellbeing / satisfaction): band tones and worsening run the other way */
export const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(['who-5', 'swls']);

export function isWorsening(instrumentId: string, latest: number | null, previous: number | null): boolean {
  const pts = WORSENING_POINTS[instrumentId];
  if (pts === undefined || latest == null || previous == null) return false;
  return latest - previous >= pts;
}

/** Short display name ("PHQ-9") for staff screens; never put in a patient message */
export function instrumentName(id: string): string {
  return instrumentById(id)?.name ?? id.toUpperCase();
}

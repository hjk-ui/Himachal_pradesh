/**
 * Medical (primary care) chart history digest: shapes. Pure; safe to import in the browser.
 *
 * Built from primary-care documents (Valant Family Practice notes, labs, imaging, consult letters,
 * discharge summaries, immunization records) and signed MedicalVisit notes (AI-extracted, every fact
 * cited with a quote found in the source), plus structured records (problems, medications,
 * allergies, vitals, labs, referrals, behavioral health minimum necessary) as deterministic facts
 * that cite their own record. "Preventive care due" is computed only from the structured
 * preventive-care (care gap) data; it is never inferred from documents.
 */
import type { DigestItem, MedicationTrial } from '@/lib/ai/chartDigest/types';

export const MEDICAL_DIGEST_PROMPT_VERSION = 'medical-digest-v1';
export const MEDICAL_DIGEST_FEATURE = 'medical-history-digest';

export const MEDICAL_ITEM_SECTIONS = [
  'problems',
  'allergies',
  'labs',
  'vitals',
  'preventive',
  'hospitalizations',
  'referrals',
  'socialFunctional',
  'openItems',
  'bhSummary',
] as const;
export type MedicalItemSection = (typeof MEDICAL_ITEM_SECTIONS)[number];

export type MedicalSections = Record<MedicalItemSection, DigestItem[]> & { medicationTrials: MedicationTrial[] };

/** One preventive-care line computed from structured care-gap data (no AI, no citation needed) */
export type PreventiveDue = {
  key: string;
  label: string;
  status: 'due' | 'overdue' | 'met';
  lastDate: string | null;
  nextDue: string | null;
};

export type MedicalDigest = MedicalSections & {
  kind: 'medical';
  /** key → { date, label, part2, pageCount } (documents / visits / records; never text) */
  sources: Record<string, { date: string; label: string; part2: boolean; pageCount: number }>;
  hasPart2: boolean;
  /** View-time only (structured care gaps); not stored */
  preventiveDue?: PreventiveDue[];
};

export function emptyMedicalSections(): MedicalSections {
  const out = Object.fromEntries(MEDICAL_ITEM_SECTIONS.map((s) => [s, [] as DigestItem[]])) as Record<MedicalItemSection, DigestItem[]>;
  return { ...out, medicationTrials: [] };
}

export function medicalDigestCounts(d: MedicalSections & { preventiveDue?: PreventiveDue[] }): Record<string, number> {
  const out: Record<string, number> = { medicationTrials: d.medicationTrials.length };
  for (const s of MEDICAL_ITEM_SECTIONS) out[s] = d[s].length;
  if (d.preventiveDue) out.preventiveDue = d.preventiveDue.length;
  return out;
}

export type MedicalPanelSection = MedicalItemSection | 'medicationTrials' | 'preventiveDue';

export const MEDICAL_SECTION_LABEL: Record<MedicalPanelSection, string> = {
  problems: 'Active problems / chronic conditions',
  medicationTrials: 'Medications (current and past)',
  allergies: 'Allergies / intolerances',
  labs: 'Key lab trends',
  vitals: 'Vitals trends (BP, weight / BMI)',
  preventiveDue: 'Preventive care due (from care-gap records)',
  preventive: 'Preventive care and screenings (documented)',
  hospitalizations: 'Hospitalizations / ER / procedures / surgeries',
  referrals: 'Specialists and referrals',
  socialFunctional: 'Social determinants / functional',
  openItems: 'Open items from the last visit',
  bhSummary: 'Behavioral health summary (minimum necessary)',
};

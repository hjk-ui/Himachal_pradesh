/**
 * Chart history digest: shapes shared by the pipeline, the store, the brief and the UI. Pure.
 *
 * A digest is built from a client's filed clinical documents (Valant imports, scans, uploads) and
 * signed native progress notes. Every fact carries at least one citation (source key + page + date
 * + a short quote) that the deterministic validator found in the cited source text.
 */

export const CHART_DIGEST_PROMPT_VERSION = 'chart-digest-v1';
export const CHART_DIGEST_RESOURCE = 'chartHistoryDigest';
export const CHART_DIGEST_FEATURE = 'chart-history-digest';
export const CHART_DIGEST_LABEL = 'AI-generated from chart documents — verify before relying on it';
/** 42 CFR 2.32 notice shown with any fact drawn from a Part 2 record */
export const PART2_REDISCLOSURE_NOTICE =
  '42 CFR Part 2: this information comes from records protected by federal confidentiality rules. ' +
  'Federal law prohibits further disclosure without the patient’s written consent or as otherwise permitted by 42 CFR Part 2.';

export type SourceKind = 'doc' | 'note';

/** One chart source (a filed document or a signed native note) as the pipeline sees it */
export type ChartSource = {
  /** "doc:<id>" | "note:<id>" */
  key: string;
  kind: SourceKind;
  id: string;
  /** YYYY-MM-DD (document date, date of service, or filed / created date) */
  date: string;
  /** Short non-PHI label: document type / note type */
  label: string;
  part2: boolean;
  /** Version marker for staleness (sha256 / updatedAt / page count) */
  version: string;
  /** Page texts (index 0 = page 1). Notes are one page. Empty until extracted. */
  pages: string[];
};

export type Citation = {
  /** ChartSource.key */
  source: string;
  /** 1-based page; null when the source has one page (native note) */
  page: number | null;
  date: string;
  /** ≤ 20 words, verbatim from the source */
  quote: string;
};

export type DigestItem = {
  text: string;
  date: string | null;
  /** Section-specific kind (e.g. suicide_attempt, inpatient, modality, allergy) */
  kind: string | null;
  cites: Citation[];
  /** Any cited source is a Part 2 record */
  part2?: boolean;
};

export type MedicationTrial = {
  drug: string;
  doses: string[];
  start: string | null;
  end: string | null;
  response: string | null;
  reasonStopped: string | null;
  sideEffects: string[];
  cites: Citation[];
  part2?: boolean;
};

export const ITEM_SECTIONS = [
  'diagnoses',
  'hospitalizations',
  'riskHistory',
  'substanceUse',
  'trauma',
  'socialFunctional',
  'therapy',
  'openItems',
  'medical',
] as const;
export type ItemSection = (typeof ITEM_SECTIONS)[number];

export type DigestSections = Record<ItemSection, DigestItem[]> & { medicationTrials: MedicationTrial[] };

export type ChartDigest = DigestSections & {
  /** Latest risk assessment / safety plan (picked from riskHistory kinds) */
  lastRiskAssessment: DigestItem | null;
  safetyPlan: DigestItem | null;
  /** Sources used: key → { date, label, part2, pages } (no text) */
  sources: Record<string, { date: string; label: string; part2: boolean; pageCount: number }>;
  hasPart2: boolean;
};

export function emptySections(): DigestSections {
  return {
    diagnoses: [],
    hospitalizations: [],
    riskHistory: [],
    substanceUse: [],
    trauma: [],
    socialFunctional: [],
    therapy: [],
    openItems: [],
    medical: [],
    medicationTrials: [],
  };
}

/** Counts per section (audit metadata / script output) */
export function digestCounts(d: DigestSections): Record<string, number> {
  const out: Record<string, number> = { medicationTrials: d.medicationTrials.length };
  for (const s of ITEM_SECTIONS) out[s] = d[s].length;
  return out;
}

/**
 * Service Eligibility Scanner — shared types (pure; safe for client and server).
 *
 * Decision support only: every result is a screening suggestion built from data already in
 * the chart. Nothing is inferred or generated; when the chart cannot answer a criterion the
 * criterion is listed as missing.
 */

export const PROGRAMS = ['prp', 'spravato', 'tms', 'aot', 'residential', 'iop'] as const;
export type ProgramKey = (typeof PROGRAMS)[number];

/**
 * candidate  — every criterion the chart can answer is met (clinician still confirms)
 * potential  — the core criterion is met but chart data is missing or a soft criterion is unmet
 * review     — needs clinical / legal review the chart cannot settle (AOT)
 * not_indicated — a required criterion is unmet (no qualifying diagnosis, age, contraindication)
 * screen     — diagnosis only: the qualifying diagnosis is charted but the evidence that makes the
 *              suggestion actionable is absent (no functional-impairment documentation for PRP, no
 *              medication history for TMS / Spravato). Hidden from the default worklist.
 * enrolled   — already in the program
 */
export const ELIGIBILITY_STATUSES = ['candidate', 'potential', 'review', 'screen', 'not_indicated', 'enrolled'] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export type EvidenceKind =
  | 'diagnosis'
  | 'problem-list'
  | 'medication'
  | 'assessment'
  | 'locus'
  | 'note'
  | 'enrollment'
  | 'referral'
  | 'crisis'
  | 'sud-radar'
  | 'allergy'
  | 'demographics'
  | 'insurance'
  | 'billing'
  | 'acute-care';

/**
 * Machine-readable data gaps behind a "missing" item — drives the "Missing data to confirm"
 * checklist and the exclusion statistics (scripts/check-service-eligibility.ts).
 */
export const GAP_KEYS = [
  'dob',
  'insurance',
  'med_history',
  'med_trials',
  'phq9',
  'cssrs',
  'locus',
  'problem_list',
  'asam_intake',
  'asam_level',
  'sud_dx',
  'mdd_severity',
  'functional_impairment',
  'acute_events',
] as const;
export type GapKey = (typeof GAP_KEYS)[number];

export const GAP_LABELS: Record<GapKey, string> = {
  dob: 'Date of birth',
  insurance: 'Insurance / payer',
  med_history: 'Medication history (no medication list on file)',
  med_trials: 'Documented antidepressant trials (dose, duration, outcome)',
  phq9: 'PHQ-9 in the last 90 days',
  cssrs: 'C-SSRS in the last 30 days',
  locus: 'LOCUS in the last 12 months',
  problem_list: 'Problem list (contraindication screen)',
  asam_intake: 'Signed Substance Abuse Intake with ASAM dimensions (12 months)',
  asam_level: 'ASAM recommended level of care / all 6 dimensions rated',
  sud_dx: 'Charted SUD diagnosis (F10–F19)',
  mdd_severity: 'MDD severity (severe code or PHQ-9 ≥ 20)',
  functional_impairment: 'Functional impairment documentation (LOCUS or signed PRP referral)',
  acute_events: 'Hospitalization / ED / crisis history (36 months)',
};

export type Evidence = {
  kind: EvidenceKind;
  /** What the chart says, verbatim or as a short factual summary (code, score, med, date) */
  text: string;
  date: string | null;
  href?: string;
};

export type ProgramResult = {
  program: ProgramKey;
  status: EligibilityStatus;
  met: string[];
  unmet: string[];
  missing: string[];
  /** Items the chart can never establish (dose adequacy, REMS, legal history) — clinician confirms */
  confirm: string[];
  /** Flags shown prominently (contraindications, conflicting services) */
  flags: string[];
  evidence: Evidence[];
  summary: string;
  /** Data gaps behind `missing` (keys only) */
  gaps: GapKey[];
};

export type ScannedClient = {
  id: string;
  name: string;
  mrn: string | null;
  age: number | null;
  primaryDx: string | null;
  clinician: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  /** Insurance type · payer as charted */
  payer: string | null;
  priority: ClientPriority;
  results: Record<ProgramKey, ProgramResult>;
};

/** Clinical urgency for sorting — every reason cites the charted fact and its date. */
export type ClientPriority = {
  score: number;
  level: 'high' | 'medium' | 'low';
  reasons: string[];
};

export type ProgramCounts = Record<EligibilityStatus, number>;

export type ScanResponse = {
  success: true;
  generatedAt: string;
  clientsScanned: number;
  sensitiveHidden: number;
  truncated: boolean;
  counts: Record<ProgramKey, ProgramCounts>;
  clients: ScannedClient[];
  /** Only clients with at least one candidate / potential / review / enrolled result are returned */
  notIndicatedOnly: number;
  clinicians: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  config: { tmsMinTrials: number; prpLocusMin: number };
};

/**
 * SUD Referral Radar — shared types. Pure module (no database, no network).
 *
 * A signal is a screening suggestion only: a licensed clinician must assess the client
 * before any referral or treatment. The scan never infers or writes a diagnosis code.
 */

export type DetectionSource = 'diagnosis' | 'note-keyword';
export type Confidence = 'high' | 'medium' | 'low';
/** Routed next step. 'tobacco-cessation' is for F17 (nicotine), which is never routed to SUD referral. */
export type RoutedAction = 'residential-referral' | 'sbirt' | 'chart-documentation' | 'tobacco-cessation';
export type Priority = 'urgent' | 'high' | 'routine' | 'low';
export type SignalStatus = 'new' | 'reviewed' | 'referred' | 'dismissed' | 'resolved';

export type SubstanceClass =
  | 'alcohol'
  | 'opioids'
  | 'cannabis'
  | 'sedatives'
  | 'cocaine'
  | 'stimulants'
  | 'hallucinogens'
  | 'nicotine'
  | 'inhalants'
  | 'other';

export type EvidenceSourceType = 'diagnosis' | 'problem-list' | 'progress-note' | 'document';

export type Evidence = {
  /** Quoted text: the code + description for diagnoses, the trimmed sentence for notes */
  quote: string;
  sourceType: EvidenceSourceType;
  /** Row id of the source (note id, document id, medical problem id, or client id for chart diagnoses) */
  sourceId: string;
  /** Human label for the source, e.g. "Progress note (Psych Med Mgmt)" or a document file name */
  sourceLabel: string;
  /** ISO date (YYYY-MM-DD) of the source when known */
  date: string | null;
  /** In-app link to open the source */
  href: string;
  /** Matched term (keyword path) */
  term?: string;
  /** Keyword-path confidence of this one sentence */
  confidence?: Confidence;
  /** Stable id of this piece of evidence (code, or source + quote) — new keys reopen a reviewed signal */
  key?: string;
  /** Optional AI read of the quoted sentence (keyword path, medium/low hits only) */
  aiVerdict?: 'confirmed' | 'historical' | 'uncertain';
};

export type Finding = {
  clientId: string;
  detectionSource: DetectionSource;
  /** Stable dedupe key within (client, detectionSource) */
  fingerprint: string;
  substanceClasses: SubstanceClass[];
  /** ICD-10 codes as charted (diagnosis path only — never inferred) */
  codes: string[];
  evidence: Evidence[];
  /** Keys of every evidence item found (evidence[] keeps only the strongest few) */
  evidenceKeys: string[];
  confidence: Confidence;
  confidencePercent: number;
  detectedCondition: string;
  recommendation: string;
  routedAction: RoutedAction;
  priority: Priority;
  /** Active SUD dx but no SUD screening (AUDIT/DAST/CAGE-AID/…) in the last 12 months */
  needsScreening: boolean;
};

export const SUBSTANCE_LABEL: Record<SubstanceClass, string> = {
  alcohol: 'Alcohol',
  opioids: 'Opioids',
  cannabis: 'Cannabis',
  sedatives: 'Sedatives / hypnotics / anxiolytics',
  cocaine: 'Cocaine',
  stimulants: 'Other stimulants',
  hallucinogens: 'Hallucinogens',
  nicotine: 'Nicotine',
  inhalants: 'Inhalants',
  other: 'Other / multiple substances',
};

export const ACTION_LABEL: Record<RoutedAction, string> = {
  'residential-referral': 'Residential / IOP referral',
  sbirt: 'SBIRT brief intervention',
  'chart-documentation': 'Chart documentation',
  'tobacco-cessation': 'Tobacco cessation note',
};

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, routine: 2, low: 3 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/**
 * Note quality check before co-sign (and as the author's pre-sign checklist).
 * Shared by the server and the browser panel: no Prisma, no server imports.
 *
 * Every item is a suggestion. Nothing here blocks signing or co-signing, and nothing edits the
 * note: the supervisor decides, and corrections to a signed note are made by its author as an
 * addendum.
 */

export type QualityStatus = 'pass' | 'warn' | 'fail' | 'na';

export type QualityCategory =
  | 'required'
  | 'time'
  | 'telehealth'
  | 'diagnosis'
  | 'plan'
  | 'risk'
  | 'signature'
  | 'timeliness'
  | 'cosign'
  | 'narrative';

export const QUALITY_CATEGORY_LABELS: Record<QualityCategory, string> = {
  required: 'Required fields',
  time: 'Service code and time',
  telehealth: 'Telehealth',
  diagnosis: 'Diagnosis',
  plan: 'Treatment plan',
  risk: 'Risk',
  signature: 'Signature',
  timeliness: 'Timeliness',
  cosign: 'Co-signature',
  narrative: 'Documentation narrative',
};

export type QualityItem = {
  /** Stable id (tests and the return-to-author record refer to it) */
  id: string;
  category: QualityCategory;
  label: string;
  status: QualityStatus;
  /** What was found, one line */
  detail: string;
  /** One-line fix (absent when the item passes) */
  fix?: string;
  /** 'rule' = deterministic; 'ai' = Bedrock narrative check (quotes verified against the note) */
  source: 'rule' | 'ai';
  /** AI items: text quoted from the note that supports the finding (each is a verified substring) */
  quotes?: string[];
};

export type NarrativeCheckId = 'medical_necessity' | 'interventions' | 'progress_toward_goals' | 'plan_next_session';

export const NARRATIVE_CHECKS: readonly { id: NarrativeCheckId; label: string; ask: string; fix: string }[] = [
  {
    id: 'medical_necessity',
    label: 'Medical necessity',
    ask: 'Current symptoms and/or functional impairment that justify the service, and the client\'s response to the intervention.',
    fix: 'State the current symptoms or functional impairment and how the client responded to today\'s intervention.',
  },
  {
    id: 'interventions',
    label: 'Interventions described',
    ask: 'The specific therapeutic interventions the clinician used in this session (what was done, not only a modality name).',
    fix: 'Describe what the clinician did in session (e.g. the CBT technique practised), not only the modality name.',
  },
  {
    id: 'progress_toward_goals',
    label: 'Progress toward goals',
    ask: 'Progress (or lack of progress) toward the treatment plan goals or objectives.',
    fix: 'Name the treatment plan goal worked on and whether the client progressed, stayed the same or regressed.',
  },
  {
    id: 'plan_next_session',
    label: 'Plan for next session',
    ask: 'The plan for the next session or continued care (focus, homework, frequency, referrals).',
    fix: 'Add the plan for the next session: focus, homework or follow-up, and when it is scheduled.',
  },
];

export type QualityMode = 'cosign' | 'presign';

export type AiStatus =
  | { state: 'used'; model: string }
  | { state: 'skipped'; reason: string }
  | { state: 'unavailable'; reason: string };

export type QualityReport = {
  noteId: string;
  mode: QualityMode;
  checkedAt: string;
  items: QualityItem[];
  counts: { pass: number; warn: number; fail: number; na: number };
  ai: AiStatus;
  /** Latest supervisor action recorded for this note (return to author / co-signed with findings) */
  lastReview: QualityReviewView | null;
};

export type QualityReviewAction = 'RETURNED' | 'COSIGNED';

export type QualityReviewView = {
  id: string;
  action: QualityReviewAction;
  reviewerName: string | null;
  comment: string | null;
  createdAt: string;
  /** Items that were warn / fail when the supervisor acted */
  findings: { id: string; label: string; status: QualityStatus; fix: string | null }[];
  /** Addenda the author added after this review */
  addendaSince: number;
};

export function countStatuses(items: readonly QualityItem[]): QualityReport['counts'] {
  const counts = { pass: 0, warn: 0, fail: 0, na: 0 };
  for (const i of items) counts[i.status] += 1;
  return counts;
}

/** Warn / fail items, as recorded on a return-to-author or co-sign with findings. */
export function findingsOf(items: readonly QualityItem[]): QualityReviewView['findings'] {
  return items
    .filter((i) => i.status === 'warn' || i.status === 'fail')
    .map((i) => ({ id: i.id, label: i.label, status: i.status, fix: i.fix ?? null }));
}

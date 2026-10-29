/**
 * Visit Guide contract (shared by the protocol registry, the server loader / API and the UI).
 *
 * A Visit Guide is what a clinician sees when they start a visit: the visit kind (resolved from the
 * appointment), a short briefing, the protocol's ordered steps with what is already done, the
 * assessments / monitoring that are due for THIS patient, the requirements behind each item, and a
 * suggested follow-up. Nothing in a guide is a clinical finding: steps are prompts, "done" is only
 * claimed when the chart shows it (or the clinician marked it), and every requirement names its basis.
 */

/** One per documentation workflow. Resolved from appointment type, Valant code, CPT, group, program. */
export type VisitKind =
  | 'therapy_intake'
  | 'psych_eval_adult'
  | 'psych_eval_child'
  | 'psych_reeval'
  | 'med_management'
  | 'therapy_individual'
  | 'therapy_family'
  | 'group_therapy'
  | 'sud_individual'
  | 'sud_group'
  | 'sud_intake'
  | 'prp'
  | 'iop'
  /** Partial hospitalization program day (src/lib/intensive) */
  | 'php'
  | 'crisis_followup'
  | 'telephone'
  | 'primary_care'
  | 'tms'
  | 'spravato'
  | 'treatment_plan_review'
  | 'discharge'
  | 'no_show'
  | 'other';

export type Audience = 'therapist' | 'prescriber' | 'medical' | 'program';

/** How strongly the protocol asks for a step. Only 'required' ever appears as a sign-time warning. */
export type StepLevel = 'required' | 'recommended' | 'optional';

/**
 * Where a step's "done" state comes from:
 * - 'auto'   the loader checks the chart (e.g. a C-SSRS recorded today, PDMP attested in the note)
 * - 'manual' the clinician ticks it in the guide (stored in visit_checklist_items)
 * - 'note'   a section of the note being written (done when the section has text)
 */
export type StepSource = 'auto' | 'manual' | 'note';

/** In-app actions a step / due item can offer (the UI maps each to a route or handler). */
export type GuideAction =
  | { kind: 'assessment'; instrument: AssessmentInstrument }
  | { kind: 'drfirst'; screen: 'patient' | 'manage_medications' | 'manage_allergies' | 'message' }
  | { kind: 'labs' }
  | { kind: 'safety_plan' }
  | { kind: 'treatment_plan' }
  | { kind: 'consents'; template?: string }
  | { kind: 'sdoh' }
  | { kind: 'book_follow_up'; weeks?: number }
  | { kind: 'scribe' }
  /** Prescriber records that they queried the Maryland PDMP (CRISP) for this patient (POST /api/prescribing/pdmp-check) */
  | { kind: 'pdmp_attest' }
  | { kind: 'note_section'; section: string }
  | { kind: 'link'; href: string; label: string };

export type AssessmentInstrument =
  | 'PHQ-9' | 'PHQ-A' | 'GAD-7' | 'C-SSRS' | 'AIMS' | 'AUDIT-C' | 'DAST-10' | 'PCL-5' | 'ASRS'
  | 'MDQ' | 'Vanderbilt' | 'CRAFFT' | 'EPDS' | 'ACE' | 'PROMIS' | 'LOCUS' | 'ASAM' | 'MORS' | 'SDOH';

export interface ProtocolStep {
  id: string;
  label: string;
  /** one line on what to do / capture, plain language */
  help?: string;
  level: StepLevel;
  source: StepSource;
  /** note section that satisfies a 'note' step */
  noteSection?: string;
  action?: GuideAction;
  /** requirement ids (Requirement.id) this step satisfies */
  basis?: string[];
  /** only for these audiences (default: all) */
  audiences?: Audience[];
  /**
   * Only when this condition holds for the patient (default: always). The loader drops the step
   * otherwise. controlled_meds: an active Schedule II–V med; antipsychotic: an active antipsychotic;
   * minor: under 18; telehealth: virtual visit; new_med: a med started since the last visit;
   * elevated_risk: chart / C-SSRS risk moderate or high; positive_bh_screen: primary care PHQ-9 or
   * GAD-7 of 10 or more.
   */
  when?: StepCondition;
}

export type StepCondition = 'controlled_meds' | 'antipsychotic' | 'minor' | 'telehealth' | 'new_med' | 'elevated_risk' | 'positive_bh_screen';

export interface Requirement {
  id: string;
  /** short name, e.g. 'Maryland PDMP query' */
  title: string;
  /** who sets it: 'Maryland law', 'COMAR', 'Joint Commission', 'CMS', 'DEA', 'HEDIS', 'Clinical guideline', 'Practice policy' */
  authority: string;
  /** plain-language rule, one or two sentences */
  rule: string;
  /** optional citation text (never a link we have not verified) */
  citation?: string;
  /** true when the owner / compliance lead must still confirm the detail */
  confirm?: boolean;
  /** who confirmed the item for this practice (e.g. 'Practice owner'); shown instead of the confirm badge */
  confirmedBy?: string;
  /** YYYY-MM-DD the item was confirmed */
  confirmedOn?: string;
}

export interface VisitProtocol {
  kind: VisitKind;
  label: string;
  audience: Audience;
  /** NOTE_TYPES value the note editor opens with */
  noteType: string;
  /** suggested CPT / HCPCS (first = default) */
  cpt: string[];
  /** ordered steps: before → during → wrap-up */
  steps: { phase: 'prepare' | 'during' | 'wrap_up'; step: ProtocolStep }[];
  /** default follow-up interval in days (null = per clinician) */
  followUpDays: number | null;
  /** 42 CFR Part 2 visit (SUD): brief and guide never pull non-consented Part 2 content into other notes */
  part2?: boolean;
}

/** A per-patient item that is due (computed, never stored). */
export interface DueItem {
  id: string;
  label: string;
  /** why it is due, from chart data: 'last PHQ-9 41 days ago (interval 30)' / 'on quetiapine; no A1c on file' */
  reason: string;
  severity: 'overdue' | 'due' | 'info';
  action?: GuideAction;
  basis?: string[];
}

export type StepStatus = 'done' | 'not_done' | 'not_applicable' | 'deferred';

export interface GuideStep extends ProtocolStep {
  phase: 'prepare' | 'during' | 'wrap_up';
  status: StepStatus;
  /** evidence for an auto 'done', or the clinician's reason for n/a / deferred */
  detail?: string;
}

/** Briefing: short facts only (reuses the pre-visit brief facts; no AI needed to render). */
export interface GuideBrief {
  lastVisit: { date: string; type: string } | null;
  lastPlan: { date: string; text: string } | null;
  /** open follow-ups / homework carried from earlier visits */
  openFollowUps: { id: string; kind: string; text: string; from: string }[];
  scores: { instrument: string; latest: number | null; previous: number | null; date: string | null }[];
  risk: { level: string; openAlerts: number; safetyPlanOnFile: boolean };
  meds: { name: string; controlled: boolean; startedRecently: boolean }[];
  changesSinceLastVisit: string[];
  /** e.g. therapist note since last med visit, pending renewals, labs awaiting review */
  careTeam: string[];
}

export interface VisitGuide {
  kind: VisitKind;
  label: string;
  audience: Audience;
  noteType: string;
  cpt: string[];
  appointmentId: string | null;
  clientId: string;
  /** how the kind was resolved, for transparency: 'appointment type "Medication Management"' */
  resolvedFrom: string;
  brief: GuideBrief;
  steps: GuideStep[];
  due: DueItem[];
  requirements: Requirement[];
  followUp: { suggestedDays: number | null; reason: string; nextBooked: string | null };
  /** counts for the header chip */
  summary: { required: number; requiredDone: number; dueCount: number };
}

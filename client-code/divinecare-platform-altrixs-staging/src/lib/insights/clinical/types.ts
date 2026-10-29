/**
 * Clinical Insights — shared types (pure; safe for client components).
 *
 * ClientFacts are the per-client inputs the loader (load.ts) reads from the database in one
 * batched pass. rules.ts turns them into signals and a tier. Nothing here is a prediction: every
 * value is a recorded score, date, count or status, and a missing source is `null` (shown as "—"
 * with the reason), never 0.
 */

export const TIERS = ['urgent', 'high', 'watch', 'stable'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = { urgent: 'Urgent', high: 'High', watch: 'Watch', stable: 'Stable' };

export const SIGNAL_CATEGORIES = ['safety', 'symptoms', 'engagement', 'treatment', 'medication', 'social'] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<SignalCategory, string> = {
  safety: 'Safety',
  symptoms: 'Symptoms',
  engagement: 'Engagement',
  treatment: 'Treatment',
  medication: 'Medication',
  social: 'Social & coverage',
};

export const INSTRUMENTS = ['phq9', 'gad7', 'pcl5'] as const;
export type InstrumentKey = (typeof INSTRUMENTS)[number];

export type ScoreSource = 'assessment' | 'valant' | 'tms';

/** One recorded total score. `date` is the clinic-day YYYY-MM-DD. */
export type ScorePoint = { score: number; date: string; source: ScoreSource };

export type TrajectoryStatus = 'worsening' | 'improving' | 'no_change' | 'baseline_only';

export type Trajectory = {
  instrument: InstrumentKey;
  label: string;
  /** Reliable-change threshold in points (rules.ts RELIABLE_CHANGE) */
  threshold: number;
  scores: number;
  latest: ScorePoint;
  prior: ScorePoint | null;
  baseline: ScorePoint | null;
  /** latest − baseline / latest − prior (positive = more symptoms; null without that point) */
  changeVsBaseline: number | null;
  changeVsPrior: number | null;
  status: TrajectoryStatus;
  /** Latest score is older than SCORE_CURRENT_DAYS: shown, but it does not set the tier */
  stale: boolean;
};

export type CadenceStatus = 'on_track' | 'due_soon' | 'scheduled' | 'overdue' | 'no_sessions' | 'not_tracked';

/** Per-client facts read by load.ts. Dates are clinic-day YYYY-MM-DD strings. */
export type ClientFacts = {
  clientId: string;
  clientStatus: 'ACTIVE' | 'INACTIVE' | 'DISCHARGED';
  /** Client.riskLevel as set on the chart (defaults to LOW) */
  chartRisk: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Ascending by date, last LOOKBACK_DAYS */
  scores: Record<InstrumentKey, ScorePoint[]>;
  /** Latest PHQ-9 assessment carries the safety flag (item 9 answered above 0) */
  phq9SafetyFlagDate: string | null;
  /** Latest C-SSRS screen; null = none on file */
  cssrs: { positive: boolean; date: string } | null;
  /** Crisis episodes in the last LOOKBACK_DAYS. followedUp7d null = fewer than 7 days ago */
  crises: { id: string; date: string; followedUp7d: boolean | null }[];
  /** Unreviewed risk alerts */
  openAlerts: { severity: 'HIGH' | 'MEDIUM' | 'LOW'; type: string; source: string; date: string }[];
  /** Risk-language-watch alerts (any review state) in the last 30 days */
  riskLanguage: { severity: 'HIGH' | 'MEDIUM' | 'LOW'; date: string; reviewed: boolean }[];
  /** Safety plan on file (linked safety-plan module entry or a finalized evaluation safety plan) */
  safetyPlan: boolean;
  /** No-shows and late cancels in the last 90 days */
  missedVisits: { date: string; status: 'NO_SHOW' | 'LATE_CANCEL' }[];
  /** Last attended visit (appointment, signed note or billed charge); null = none on file */
  lastVisit: string | null;
  /** Next scheduled appointment; null = none */
  nextAppointment: string | null;
  /** Session-frequency cadence (src/lib/clinical/sessionFrequency.ts); null = could not be computed */
  cadence: {
    therapy: { status: CadenceStatus; daysOverdue: number; label: string };
    med: { status: CadenceStatus; daysOverdue: number; label: string };
  } | null;
  /** Portal messages from the patient in the last 30 days; oldest unanswered patient message */
  portal: { patientMessages30d: number; lastPatientMessage: string | null; unansweredSince: string | null };
  /** Active (ACTIVE / NEEDS_REVIEW) treatment plan written in Altrixs; null = none */
  plan: { status: 'ACTIVE' | 'NEEDS_REVIEW'; reviewDue: string | null; createdOn: string } | null;
  /** Plan imported from Valant (any status but CLOSED); counts as a plan on file */
  importedPlan: { status: string; reviewDue: string | null } | null;
  /** Chart came over from Valant (Client.sourcePlatform) */
  valantClient: boolean;
  /** Last day (inclusive) of the go-live plan transition for Valant clients; null = none */
  planTransitionUntil: string | null;
  /** Latest goal progress chip per goal from signed notes in the last 120 days */
  goalChips: { goal: number; status: 'Progress made' | 'No change' | 'Regression'; date: string }[];
  /** Unsigned (draft) notes past the practice signing deadline */
  unsignedNotes: { count: number; oldest: string | null };
  /** Pending refill requests (DrFirst refill notifications + Altrixs refill requests) */
  refillsPending: { count: number; oldest: string | null };
  /** DrFirst fill events flagged "not dispensed" in the last 90 days */
  fillProblems: { date: string }[];
  /** Monitoring labs: null = no monitored medication on file; otherwise the overdue order sets */
  labs: { monitoredSets: string[]; overdue: boolean } | null;
  /** Latest AHC HRSN screening in the last 365 days; null = none */
  sdoh: { date: string; domains: string[] } | null;
  /** Approved prior authorization ending soonest (that has not ended more than 30 days ago) */
  auth: { endDate: string | null; unitsLeft: number | null } | null;
  /** Client.insuranceEffectiveTo */
  insuranceEndsOn: string | null;
  /** Linked discharge case discharged in the last 90 days */
  discharge: { date: string | null; followUpDocumented: boolean } | null;
  /** Chart created in Altrixs (YYYY-MM-DD); null = imported chart (established before go-live) */
  firstSeen: string | null;
};

export type SignalKey =
  // safety
  | 'cssrs_positive_30d'
  | 'cssrs_positive_90d'
  | 'crisis_30d'
  | 'crisis_90d'
  | 'crisis_no_followup'
  | 'alert_open_high'
  | 'alert_open_medium'
  | 'alert_open_low'
  | 'risk_language_30d'
  | 'safety_plan_missing'
  | 'chart_risk_high'
  | 'phq9_item9_30d'
  // symptoms
  | 'worsening'
  | 'improving'
  | 'phq9_severe_30d'
  | 'phq9_overdue'
  // engagement
  | 'missed_visits_90'
  | 'no_visit_60'
  | 'no_future_appt'
  | 'cadence_overdue'
  | 'portal_unanswered'
  | 'not_in_care'
  // treatment
  | 'plan_missing'
  | 'valant_plan_not_imported'
  | 'plan_review_overdue'
  | 'plan_review_due'
  | 'goal_regression'
  | 'unsigned_notes'
  | 'discharge_no_followup'
  // medication
  | 'refill_pending'
  | 'fill_not_dispensed'
  | 'labs_due'
  // social / coverage
  | 'sdoh_positive'
  | 'auth_expiring'
  | 'insurance_ending';

/** How much a signal weighs: a tier, or info / positive (shown, never raises the tier) */
export type SignalLevel = Tier | 'info' | 'positive';

export type Signal = {
  key: SignalKey;
  category: SignalCategory;
  level: SignalLevel;
  /** Short chip text, e.g. "PHQ-9 worsening +6" */
  label: string;
  /** Plain-language detail with values, e.g. "PHQ-9 18 on 2026-10-02 (baseline 12 on 2026-07-01)" */
  detail: string;
  /** Date the signal refers to (YYYY-MM-DD) or null */
  date: string | null;
};

export type TierRuleId = string;

export type Evaluation = {
  tier: Tier;
  /** Ids of the tier rules that fired (rules.ts TIER_RULES), highest tier first */
  rules: TierRuleId[];
  /** Every signal, highest level first */
  signals: Signal[];
  trajectories: Trajectory[];
  /** What is missing from the chart, in words (e.g. "No PHQ-9 on file") */
  dataGaps: string[];
  /** Sort key within a tier: more and more recent signals first */
  rank: number;
};

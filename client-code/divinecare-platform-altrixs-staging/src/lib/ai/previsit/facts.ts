/**
 * Pre-visit brief: the FACTS object. Pure (no prisma, no AWS) so it is unit-tested directly.
 *
 * The loader (prismaSource.ts) reads raw chart rows; this module turns them into a small,
 * name-free set of structured facts. Everything the brief says (rule-based or AI) must come
 * from here, and the AI only ever sees `modelFacts(facts)`.
 */
import { summarizeRisk, type RiskAlertRow, type CssrsRow, type RiskSummary, type BannerSessionFrequency } from '@/lib/clients/chartBanner';
import { standingDueState } from '@/lib/labs/standing';
import { planGoals, templateValuesFromGoalsJson } from '@/lib/ehr/therapy/planTemplate';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { chartHistoryFacts, type ChartHistoryFacts } from '@/lib/ai/chartDigest/briefFacts';
import type { ChartDigest } from '@/lib/ai/chartDigest/types';
import {
  MED_CHANGE_WINDOW_DAYS,
  VISIT_KIND_LABEL,
  cadenceStatusText,
  careTeamFacts,
  currentMedFacts,
  diagnosisFacts,
  labsExtra,
  medChangeFacts,
  notesFacts,
  openReferrals,
  overdueMeasures,
  sessionFrequencyDetail,
  visitFacts,
  type CareTeamFact,
  type CurrentMedFact,
  type DiagnosisFact,
  type LabsExtra,
  type MedChangeFact,
  type NotesFact,
  type OverdueMeasureFact,
  type RawCareTeam,
  type RawDiagnosis,
  type RawDocumentLab,
  type RawFiledDocument,
  type RawLabOrder,
  type RawMeasureAssignment,
  type RawMedicalVisit,
  type RawNoteDocument,
  type RawReferral,
  type ReferralFact,
  type VisitsFact,
} from '@/lib/ai/previsit/enrich';
import { chartHistoryEmptyState } from '@/lib/ai/chartDigest/emptyState';

export type {
  RawCareTeam,
  RawDiagnosis,
  RawDocumentLab,
  RawFiledDocument,
  RawLabOrder,
  RawMeasureAssignment,
  RawMedicalVisit,
  RawNoteDocument,
  RawReferral,
} from '@/lib/ai/previsit/enrich';

const DAY_MS = 86_400_000;
/** No completed visit on file: look back this far for "changes" */
export const DEFAULT_LOOKBACK_DAYS = 30;
/** Plan review shows as "due soon" inside this window */
export const PLAN_REVIEW_SOON_DAYS = 14;
export const PLAN_TEXT_MAX = 400;
export const GOAL_TEXT_MAX = 140;
const MAX_LIST = 6;

export type PreVisitAudience = 'therapist' | 'prescriber' | 'primary_care';

// ─── Raw inputs (what the loader reads) ──────────────────────────────────────

export type RawAppointment = {
  id: string;
  startsAt: Date;
  type: string;
  status: string;
  /** Valant code lives here for imported visits ("Valant code: 90837") */
  notes?: string | null;
  /** 'valant_history' = imported Valant visit */
  source?: string | null;
  clinicianName?: string | null;
  clinicianRole?: string | null;
};
export type RawMedication = {
  id: string;
  medicationName: string;
  drugName?: string | null;
  dosage?: string | null;
  dosageText?: string | null;
  startDate: Date | null;
  createdAt: Date;
  stopDate?: Date | null;
  endDate?: Date | null;
  active: boolean;
  status?: string | null;
  rcopiaMedId?: string | null;
  route?: string | null;
  frequency?: string | null;
  instructions?: string | null;
  asNeeded?: boolean | null;
  isAntipsychotic?: boolean | null;
};
export type RawProblem = { id: string; name: string; icd10Code: string | null; status: string; createdAt: Date; source: string | null };
export type RawCrisisEpisode = { id: string; startedAt: Date; status: string; priority: number };
export type RawAssessment = {
  id: string;
  instrumentId: string;
  instrumentName: string;
  totalScore: number | null;
  severity: string | null;
  safetyFlagged: boolean;
  createdAt: Date;
};
export type RawMeasurement = { id: string; instrumentKey: string | null; valueNumeric: number | null; measuredAt: Date };
export type RawTreatmentPlan = { id: string; status: string; reviewDueAt: Date | null; goals: unknown };
export type RawSdohReferral = { id: string; domain: string; status: string; createdAt: Date };
export type RawStandingLab = { id: string; tests: unknown; nextDueAt: Date; active: boolean; endDate: Date | null };
export type RawNote = { id: string; noteType: string | null; body: string; dateOfService: Date | null; createdAt: Date; part2: boolean; cptCode?: string | null; authorRole?: string | null };

export type PreVisitInputs = {
  client: {
    riskLevel: string;
    /** Names are used only to redact free text; they never enter the facts */
    names: string[];
  };
  appointments: RawAppointment[];
  medications: RawMedication[];
  problems: RawProblem[];
  riskAlerts: RiskAlertRow[];
  crisisEpisodes: RawCrisisEpisode[];
  assessments: RawAssessment[];
  measurements: RawMeasurement[];
  treatmentPlan: RawTreatmentPlan | null;
  sessionFrequency: BannerSessionFrequency;
  draftNoteCount: number;
  pendingConsentCount: number;
  sdohReferrals: RawSdohReferral[];
  /** prescriber audience only (empty otherwise) */
  standingLabs: RawStandingLab[];
  labResultsAwaitingReview: number;
  /** newest first; the builder picks the newest non–Part 2 note with a plan section */
  recentNotes: RawNote[];
  /** Latest chart history digest (Part 2 facts already removed); chart-note readers only */
  chartDigest?: { digest: ChartDigest; generatedAt: Date; stale: boolean } | null;
  // ── Enriched inputs (all optional; empty when not loaded) ──
  /** ClientDiagnosis rows (the diagnosis list) */
  diagnoses?: RawDiagnosis[];
  /** Future visits (soonest first), for "next appointment" */
  upcomingAppointments?: RawAppointment[];
  /** Signed primary-care visits */
  medicalVisits?: RawMedicalVisit[];
  /** Lab orders with results (prescriber / primary care only) */
  labOrders?: RawLabOrder[];
  /** Lab facts cited from documents by the medical chart history (used only when no structured results) */
  documentLabs?: RawDocumentLab[];
  /** Imported progress-note documents (Valant), newest first */
  noteDocuments?: RawNoteDocument[];
  /** Chart documents filed in the lookback (type label only) */
  filedDocuments?: RawFiledDocument[];
  careTeam?: RawCareTeam;
  /** Unsigned notes past the documentation deadline */
  overdueNoteCount?: number;
  measureAssignments?: RawMeasureAssignment[];
  referrals?: RawReferral[];
  /** Pending DrFirst change requests (prescriber only) */
  drFirstPendingCount?: number;
  /** Nightly chart-history prep job enabled on this server */
  nightlyPrepEnabled?: boolean;
  /** Viewer may generate the chart history digest on demand */
  canGenerateDigest?: boolean;
};

// ─── Facts ───────────────────────────────────────────────────────────────────

export type ScoreInstrument = 'PHQ-9' | 'GAD-7' | 'C-SSRS' | 'PCL-5' | 'AUDIT' | 'AUDIT-C' | 'DAST-10' | 'MDQ';
export type ScoreFact = {
  instrument: ScoreInstrument;
  latest: { score: number | null; severity: string | null; date: string; safetyFlagged: boolean };
  previous: { score: number | null; date: string } | null;
  /** latest - previous, when both are numbers */
  change: number | null;
  trend: 'up' | 'down' | 'same' | 'single';
  /** oldest → newest, at most 3 points */
  history: { score: number | null; date: string }[];
};

export type PreVisitFacts = {
  version: 1;
  asOf: string;
  audience: PreVisitAudience;
  lastVisit: { date: string; type: string } | null;
  /** "changes since" window start (last visit, else asOf - 30 days) */
  since: string;
  changes: {
    medsStarted: { name: string; dose: string | null; date: string; fromDrFirst: boolean }[];
    medsStopped: { name: string; date: string; fromDrFirst: boolean }[];
    newProblems: { name: string; code: string | null; date: string; fromDrFirst: boolean }[];
    newRiskAlerts: { type: string; severity: string; date: string; reviewed: boolean }[];
    crisisEpisodes: { date: string; status: string; priority: number }[];
    missedVisits: { date: string; type: string; status: 'no-show' | 'cancelled' | 'late-cancel' }[];
    newDiagnoses: { code: string | null; name: string; date: string }[];
    newScores: { instrument: ScoreInstrument; score: number | null; date: string }[];
    newDocuments: { label: string; date: string }[];
  };
  scores: ScoreFact[];
  risk: { level: RiskSummary['level']; chartLevel: RiskSummary['chartLevel']; openAlerts: number; cssrsSafetyFlagged: boolean };
  treatmentPlan: { status: string; reviewDueAt: string | null; reviewState: 'overdue' | 'due_soon' | 'ok' | 'not_set'; goals: string[] } | null;
  /** Counts therapy sessions only (medication management has its own cadence) */
  sessionFrequency: { counts: 'therapy sessions'; status: string; recommendation: string; detail: string } | null;
  openItems: {
    draftNotes: number;
    overdueNotes: number;
    pendingConsents: number;
    sdohReferrals: { need: string; status: string; since: string }[];
    overdueMeasures: OverdueMeasureFact[];
    referrals: ReferralFact[];
    drFirstPending: number;
  };
  labs: ({ due: { tests: string[]; dueDate: string; state: 'overdue' | 'due_soon' }[]; resultsAwaitingReview: number } & Partial<LabsExtra>) | null;
  /** Active / provisional diagnosis list, primary first */
  diagnoses: DiagnosisFact[];
  currentMedications: CurrentMedFact[];
  medChangeWindowDays: number;
  /** Starts / stops in the last medChangeWindowDays days */
  recentMedChanges: MedChangeFact[];
  visits: VisitsFact;
  notes: NotesFact;
  careTeam: CareTeamFact;
  /** Chart history digest state (BH chart-note readers only) */
  chartHistoryStatus: { state: 'ready' | 'stale' | 'not_generated'; message: string } | null;
  lastNotePlan: { date: string; text: string } | null;
  /** AI-extracted, cited history from chart documents (src/lib/ai/chartDigest); audience-sliced */
  chartHistory?: ChartHistoryFacts | null;
};

const MISSED: Record<string, 'no-show' | 'cancelled' | 'late-cancel'> = {
  NO_SHOW: 'no-show',
  CANCELLED: 'cancelled',
  LATE_CANCEL: 'late-cancel',
};

function day(d: Date, tz: string): string {
  return toPracticeWallTime(d, tz).date;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Replace the client's names (and phone numbers / emails) in free text with neutral words. */
export function redactNames(text: string, names: string[]): string {
  let out = text;
  const tokens = new Set<string>();
  for (const n of names) {
    for (const part of (n || '').split(/[\s,]+/)) {
      const p = part.replace(/[^\p{L}'-]/gu, '');
      if (p.length >= 3) tokens.add(p);
    }
  }
  for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'giu'), 'the client');
  }
  out = out.replace(/(the client)(\s+the client)+/gi, '$1');
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  out = out.replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]');
  return out;
}

const PLAN_HEADING = /^(?:#{1,3}\s*)?(?:P\s*[-–:]\s*)?(plan(?:\s*(?:\/|&|and)\s*(?:homework|next steps))?|homework|next steps|treatment plan\s*\/\s*next steps|plan for next session)\s*:?\s*(.*)$/i;
const ANY_HEADING = /^(?:#{1,3}\s+\S.*|[A-Z][A-Za-z /&()-]{2,40}:\s*$)/;

/**
 * Only the plan / homework section of a note (never the rest of the body).
 * Recognizes "Plan", "P: ...", "## Plan", "Plan/Homework:", "Homework:" headings; stops at the
 * next heading. Hidden metadata comments are dropped. Returns '' when there is no plan section.
 */
export function extractPlanSection(body: string): string {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inPlan = false;
  for (const raw of lines) {
    const line = raw.trim();
    // SOAP shorthand "P: ..." (capital P only), else a Plan / Homework heading
    const soap = /^P\s*[-–:]\s*(.*)$/.exec(line);
    const m: string[] | null = soap ? [line, 'plan', soap[1]] : PLAN_HEADING.exec(line);
    if (m && (m[2] === '' ? line.length <= 80 : Boolean(soap) || /^(?:#{1,3}\s*)?(plan|homework|next steps)[^:]{0,20}:/i.test(line))) {
      // A "Homework:" / "Next steps:" line inside the plan stays part of it
      if (inPlan) {
        out.push(line);
        continue;
      }
      inPlan = true;
      if (m[2]) out.push(m[2]);
      continue;
    }
    if (inPlan) {
      if (line && ANY_HEADING.test(line)) break;
      if (line) out.push(line);
    }
  }
  return out.join(' ').trim();
}

export function instrumentOf(id: string, name: string): ScoreInstrument | null {
  const s = `${id} ${name}`.toLowerCase();
  if (/c-?ssrs|columbia/.test(s)) return 'C-SSRS';
  if (/phq-?9(?![\d])/.test(s) && !/phq-?9-?a\b|modified/.test(s)) return 'PHQ-9';
  if (/gad-?7/.test(s)) return 'GAD-7';
  if (/pcl-?5/.test(s)) return 'PCL-5';
  if (/audit-?c\b/.test(s)) return 'AUDIT-C';
  if (/\baudit\b/.test(s)) return 'AUDIT';
  if (/dast-?10/.test(s)) return 'DAST-10';
  if (/\bmdq\b|mood disorder questionnaire/.test(s)) return 'MDQ';
  return null;
}

/** Instruments a viewer without BH chart-note access may see (safety + alcohol screening) */
const NON_BH_INSTRUMENTS = new Set<ScoreInstrument>(['C-SSRS', 'AUDIT', 'AUDIT-C']);

function scoreFacts(inputs: PreVisitInputs, tz: string): ScoreFact[] {
  type Pt = { score: number | null; severity: string | null; safetyFlagged: boolean; at: Date };
  const byInst = new Map<ScoreInstrument, Pt[]>();
  const push = (inst: ScoreInstrument | null, p: Pt) => {
    if (!inst) return;
    const list = byInst.get(inst) ?? [];
    // Same instrument, same day, same score from both sources = one administration
    if (!list.some((q) => q.score === p.score && day(q.at, tz) === day(p.at, tz))) list.push(p);
    byInst.set(inst, list);
  };
  for (const a of inputs.assessments) {
    push(instrumentOf(a.instrumentId, a.instrumentName), { score: a.totalScore, severity: a.severity, safetyFlagged: a.safetyFlagged, at: a.createdAt });
  }
  for (const m of inputs.measurements) {
    push(instrumentOf(m.instrumentKey || '', ''), { score: m.valueNumeric, severity: null, safetyFlagged: false, at: m.measuredAt });
  }
  const order: ScoreInstrument[] = ['C-SSRS', 'PHQ-9', 'GAD-7', 'PCL-5', 'AUDIT', 'AUDIT-C', 'DAST-10', 'MDQ'];
  const out: ScoreFact[] = [];
  for (const inst of order) {
    const pts = (byInst.get(inst) ?? []).sort((a, b) => b.at.getTime() - a.at.getTime());
    if (!pts.length) continue;
    const [latest, prev] = pts;
    const change = prev && latest.score != null && prev.score != null ? Math.round((latest.score - prev.score) * 10) / 10 : null;
    out.push({
      instrument: inst,
      latest: { score: latest.score, severity: latest.severity ? clip(latest.severity, 40) : null, date: day(latest.at, tz), safetyFlagged: latest.safetyFlagged },
      previous: prev ? { score: prev.score, date: day(prev.at, tz) } : null,
      change,
      trend: !prev ? 'single' : change == null || change === 0 ? 'same' : change > 0 ? 'up' : 'down',
      history: pts.slice(0, 3).reverse().map((p) => ({ score: p.score, date: day(p.at, tz) })),
    });
  }
  return out;
}

function goalTexts(goals: unknown, names: string[]): string[] {
  let texts: string[] = [];
  const values = templateValuesFromGoalsJson(goals);
  if (values) texts = planGoals(values).map((g) => g.goal).filter(Boolean);
  else {
    const items = goals && typeof goals === 'object' && !Array.isArray(goals) ? (goals as { items?: unknown }).items : Array.isArray(goals) ? goals : null;
    texts = (Array.isArray(items) ? items : [])
      .map((g) => (g && typeof g === 'object' ? (g as { text?: unknown; goal?: unknown }).text ?? (g as { goal?: unknown }).goal : null))
      .filter((t): t is string => typeof t === 'string' && Boolean(t.trim()));
  }
  return texts.slice(0, 3).map((t) => clip(redactNames(t, names), GOAL_TEXT_MAX));
}

function labTestNames(tests: unknown): string[] {
  if (!Array.isArray(tests)) return [];
  return tests
    .map((t) => (t && typeof t === 'object' ? (t as { name?: unknown; key?: unknown }).name ?? (t as { key?: unknown }).key : null))
    .filter((n): n is string => typeof n === 'string' && Boolean(n.trim()))
    .map((n) => clip(n, 60));
}

function isStopped(m: RawMedication): boolean {
  return !m.active || /stop|discontinu|inactive|cancel/i.test(m.status || '');
}

/**
 * Build the facts. `now` is the request instant; `timeZone` the practice clock (dates are
 * practice-local YYYY-MM-DD so they match what the clinician sees on the schedule).
 */
export function buildPreVisitFacts(
  inputs: PreVisitInputs,
  opts: { now: Date; timeZone: string; audience: PreVisitAudience; /** canAccessClientChartNotes(role); default true */ bhChartNotes?: boolean },
): PreVisitFacts {
  const { now, timeZone: tz, audience } = opts;
  // Primary care (PHYSICIAN / MEDICAL_NP) and other non-chart-note roles: no behavioral-health
  // note content (last note plan), treatment-plan goals or PHQ-9 / GAD-7 scores (minimum necessary).
  const bhChartNotes = opts.bhChartNotes !== false;
  const asOf = day(now, tz);
  const names = inputs.client.names;

  const pastCompleted = inputs.appointments
    .filter((a) => a.status === 'COMPLETED' && day(a.startsAt, tz) < asOf)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const last = pastCompleted[0] ?? null;
  const sinceInstant = last ? last.startsAt : new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * DAY_MS);
  const since = day(sinceInstant, tz);
  const inWindow = (d: Date | null | undefined) => Boolean(d) && day(d!, tz) >= since && d!.getTime() <= now.getTime();

  const medsStarted = inputs.medications
    .filter((m) => inWindow(m.startDate ?? m.createdAt) && !isStopped(m))
    .sort((a, b) => (b.startDate ?? b.createdAt).getTime() - (a.startDate ?? a.createdAt).getTime())
    .slice(0, MAX_LIST)
    .map((m) => ({
      name: clip(m.medicationName || m.drugName || 'Medication', 60),
      dose: (m.dosage || m.dosageText) ? clip(String(m.dosage || m.dosageText), 40) : null,
      date: day(m.startDate ?? m.createdAt, tz),
      fromDrFirst: Boolean(m.rcopiaMedId),
    }));
  const medsStopped = inputs.medications
    .filter((m) => isStopped(m) && inWindow(m.stopDate ?? m.endDate ?? null))
    .slice(0, MAX_LIST)
    .map((m) => ({ name: clip(m.medicationName || m.drugName || 'Medication', 60), date: day((m.stopDate ?? m.endDate)!, tz), fromDrFirst: Boolean(m.rcopiaMedId) }));

  const newProblems = inputs.problems
    .filter((p) => inWindow(p.createdAt) && !/resolved|inactive/i.test(p.status))
    .slice(0, MAX_LIST)
    .map((p) => ({ name: clip(p.name, 80), code: p.icd10Code, date: day(p.createdAt, tz), fromDrFirst: p.source === 'drfirst' }));

  const newRiskAlerts = inputs.riskAlerts
    .filter((a) => inWindow(a.createdAt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_LIST)
    .map((a) => ({ type: a.type.replace(/_/g, ' '), severity: String(a.severity).toLowerCase(), date: day(a.createdAt, tz), reviewed: a.reviewed }));

  const crisisEpisodes = inputs.crisisEpisodes
    .filter((c) => inWindow(c.startedAt))
    .slice(0, MAX_LIST)
    .map((c) => ({ date: day(c.startedAt, tz), status: c.status, priority: c.priority }));

  const missedVisits = inputs.appointments
    .filter((a) => MISSED[a.status] && inWindow(a.startsAt))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, MAX_LIST)
    .map((a) => ({ date: day(a.startsAt, tz), type: clip(a.type, 50), status: MISSED[a.status] }));

  const scores = scoreFacts(inputs, tz).filter((s) => bhChartNotes || NON_BH_INSTRUMENTS.has(s.instrument));
  const cssrs = [...inputs.assessments]
    .filter((a) => instrumentOf(a.instrumentId, a.instrumentName) === 'C-SSRS')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const latestCssrs: CssrsRow | null = cssrs
    ? { id: cssrs.id, instrumentName: cssrs.instrumentName, totalScore: cssrs.totalScore, severity: cssrs.severity, safetyFlagged: cssrs.safetyFlagged, createdAt: cssrs.createdAt }
    : null;
  const risk = summarizeRisk({ riskLevel: inputs.client.riskLevel, alerts: inputs.riskAlerts, latestCssrs });

  let treatmentPlan: PreVisitFacts['treatmentPlan'] = null;
  if (inputs.treatmentPlan) {
    const p = inputs.treatmentPlan;
    const due = p.reviewDueAt ? day(p.reviewDueAt, tz) : null;
    const soon = day(new Date(now.getTime() + PLAN_REVIEW_SOON_DAYS * DAY_MS), tz);
    treatmentPlan = {
      status: p.status,
      reviewDueAt: due,
      reviewState: !due ? 'not_set' : due < asOf ? 'overdue' : due <= soon ? 'due_soon' : 'ok',
      goals: bhChartNotes ? goalTexts(p.goals, names) : [],
    };
  }

  const dayOf = (d: Date) => day(d, tz);
  const redact = (t: string) => redactNames(t, names);
  const sf = inputs.sessionFrequency;
  const visits = visitFacts({
    past: inputs.appointments,
    upcoming: inputs.upcomingAppointments ?? [],
    medicalVisits: inputs.medicalVisits ?? [],
    therapyLastAttended: sf?.therapyLastAttended ?? null,
    medLastAttended: sf?.medLastAttended ?? null,
    now,
    day: dayOf,
    wall: (d) => toPracticeWallTime(d, tz),
  });
  // The banner cadence counts therapy sessions only: say so, never "no sessions" when med visits exist
  const sessionFrequency = sf
    ? {
        counts: 'therapy sessions' as const,
        status: cadenceStatusText(String(sf.status ?? sf.bucket)),
        recommendation: clip(sf.recommendation, 80),
        detail: clip(sessionFrequencyDetail(sf.statusDetail, visits.last.therapy), 160),
      }
    : null;

  const sdohReferrals = inputs.sdohReferrals
    .filter((r) => r.status === 'open' || r.status === 'connected')
    .slice(0, MAX_LIST)
    .map((r) => ({ need: r.domain.replace(/_/g, ' '), status: r.status, since: day(r.createdAt, tz) }));

  let labs: PreVisitFacts['labs'] = null;
  if (audience === 'prescriber' || audience === 'primary_care') {
    const due = inputs.standingLabs
      .map((s) => ({ s, state: standingDueState(s, now) }))
      .filter((x): x is { s: RawStandingLab; state: 'overdue' | 'due_soon' } => x.state === 'overdue' || x.state === 'due_soon')
      .slice(0, MAX_LIST)
      .map(({ s, state }) => ({ tests: labTestNames(s.tests), dueDate: day(s.nextDueAt, tz), state }));
    const extra = labsExtra({
      audience,
      orders: inputs.labOrders ?? [],
      activeMeds: inputs.medications.filter((m) => !isStopped(m)).map((m) => ({ name: `${m.medicationName} ${m.drugName ?? ''}`, isAntipsychotic: Boolean(m.isAntipsychotic) })),
      documentLabs: inputs.documentLabs ?? [],
      now,
      day: dayOf,
      redact,
    });
    labs = { due, resultsAwaitingReview: inputs.labResultsAwaitingReview, ...extra };
  }

  const diagnoses = diagnosisFacts(inputs.diagnoses ?? [], dayOf, redact, { hideSud: !bhChartNotes });
  const newDiagnoses = (inputs.diagnoses ?? [])
    .filter((d) => inWindow(d.createdAt) && /^(active|provisional)$/i.test(d.status) && (bhChartNotes || !/^F1\d/i.test(d.code ?? '')))
    .slice(0, MAX_LIST)
    .map((d) => ({ code: d.code, name: clip(redact(d.dsmName || d.description), 80), date: dayOf(d.createdAt) }));
  const newScores = scores
    .flatMap((s) => s.history.filter((h) => h.date >= since && h.date <= asOf).map((h) => ({ instrument: s.instrument, score: h.score, date: h.date })))
    .slice(0, MAX_LIST);
  const newDocuments = (inputs.filedDocuments ?? [])
    .filter((d) => inWindow(d.filedAt))
    .sort((a, b) => b.filedAt.getTime() - a.filedAt.getTime())
    .slice(0, MAX_LIST)
    .map((d) => ({ label: clip(d.label || 'Document', 40), date: dayOf(d.filedAt) }));

  const scoreDays = new Map<string, string>();
  for (const a of inputs.assessments) {
    const k = a.instrumentId.toLowerCase();
    const d = dayOf(a.createdAt);
    if (!scoreDays.has(k) || d > scoreDays.get(k)!) scoreDays.set(k, d);
  }
  for (const m of inputs.measurements) {
    const k = String(m.instrumentKey || '').toLowerCase();
    const d = dayOf(m.measuredAt);
    if (k && (!scoreDays.has(k) || d > scoreDays.get(k)!)) scoreDays.set(k, d);
  }
  const overdue = bhChartNotes ? overdueMeasures(inputs.measureAssignments ?? [], (id) => scoreDays.get(id.toLowerCase()) ?? null, asOf, dayOf) : [];

  let chartHistoryStatus: PreVisitFacts['chartHistoryStatus'] = null;
  if (bhChartNotes) {
    if (inputs.chartDigest) chartHistoryStatus = inputs.chartDigest.stale ? { state: 'stale', message: 'Chart history is out of date; regenerate to include the latest documents.' } : { state: 'ready', message: `Generated ${inputs.chartDigest.generatedAt.toISOString().slice(0, 10)}` };
    else
      chartHistoryStatus = {
        state: 'not_generated',
        message: chartHistoryEmptyState({ upcomingVisitWithin7Days: visits.nextWithin7Days, nightlyPrepEnabled: Boolean(inputs.nightlyPrepEnabled), canGenerate: Boolean(inputs.canGenerateDigest) }).text,
      };
  }

  let lastNotePlan: PreVisitFacts['lastNotePlan'] = null;
  for (const n of bhChartNotes ? inputs.recentNotes : []) {
    if (n.part2) continue; // 42 CFR Part 2 note content never feeds the brief
    const plan = extractPlanSection(n.body || '');
    if (!plan) continue;
    lastNotePlan = { date: day(n.dateOfService ?? n.createdAt, tz), text: clip(redactNames(plan, names), PLAN_TEXT_MAX) };
    break;
  }

  return {
    version: 1,
    asOf,
    audience,
    lastVisit: last ? { date: day(last.startsAt, tz), type: clip(last.type, 50) } : null,
    since,
    changes: { medsStarted, medsStopped, newProblems, newRiskAlerts, crisisEpisodes, missedVisits, newDiagnoses, newScores, newDocuments },
    scores,
    risk: { level: risk.level, chartLevel: risk.chartLevel, openAlerts: risk.openAlerts, cssrsSafetyFlagged: Boolean(latestCssrs?.safetyFlagged) },
    treatmentPlan,
    sessionFrequency,
    openItems: {
      draftNotes: inputs.draftNoteCount,
      overdueNotes: inputs.overdueNoteCount ?? 0,
      pendingConsents: inputs.pendingConsentCount,
      sdohReferrals,
      overdueMeasures: overdue,
      referrals: openReferrals(inputs.referrals ?? [], dayOf),
      drFirstPending: audience === 'therapist' ? 0 : inputs.drFirstPendingCount ?? 0,
    },
    labs,
    lastNotePlan,
    chartHistory:
      bhChartNotes && inputs.chartDigest ? chartHistoryFacts(inputs.chartDigest, audience === 'therapist' ? 'therapist' : 'prescriber', (t) => redactNames(t, names)) : null,
    diagnoses,
    currentMedications: currentMedFacts(inputs.medications, dayOf),
    medChangeWindowDays: MED_CHANGE_WINDOW_DAYS,
    recentMedChanges: medChangeFacts(inputs.medications, now, dayOf),
    visits,
    notes: notesFacts({
      audience,
      bhChartNotes,
      notes: inputs.recentNotes,
      medicalVisits: inputs.medicalVisits ?? [],
      documents: inputs.noteDocuments ?? [],
      digestAvailable: Boolean(inputs.chartDigest),
      day: dayOf,
      redact,
      planFallback: extractPlanSection,
    }),
    careTeam: careTeamFacts(inputs.careTeam ?? null),
    chartHistoryStatus,
  };
}

/** Counts only (for audit metadata) */
export function factCounts(f: PreVisitFacts): Record<string, number> {
  return {
    medsStarted: f.changes.medsStarted.length,
    medsStopped: f.changes.medsStopped.length,
    newProblems: f.changes.newProblems.length,
    newRiskAlerts: f.changes.newRiskAlerts.length,
    crisisEpisodes: f.changes.crisisEpisodes.length,
    missedVisits: f.changes.missedVisits.length,
    scores: f.scores.length,
    goals: f.treatmentPlan?.goals.length ?? 0,
    sdohReferrals: f.openItems.sdohReferrals.length,
    labsDue: f.labs?.due.length ?? 0,
    lastNotePlan: f.lastNotePlan ? 1 : 0,
    chartHistory: f.chartHistory?.items.length ?? 0,
    diagnoses: f.diagnoses.length,
    currentMedications: f.currentMedications.length,
    recentMedChanges: f.recentMedChanges.length,
    labResults: f.labs?.results?.length ?? 0,
    labsPending: f.labs?.pending?.length ?? 0,
    labMonitoring: f.labs?.monitoring?.length ?? 0,
    notes: f.notes.therapy.length + f.notes.medManagement.length + f.notes.primaryCare.length,
    noteDocuments: f.notes.documents.length,
    newDiagnoses: f.changes.newDiagnoses.length,
    newDocuments: f.changes.newDocuments.length,
  };
}

/** What the model sees: the facts, nothing else (no ids, no names; free text already redacted). */
export function modelFacts(f: PreVisitFacts): Omit<PreVisitFacts, 'version'> {
  const { version: _v, ...rest } = f;
  // Staff names, note ids and links stay out of the prompt (roles only)
  return {
    ...rest,
    visits: { ...rest.visits, next: rest.visits.next ? { ...rest.visits.next, clinician: null } : null },
    careTeam: rest.careTeam
      ? { primary: rest.careTeam.primary ? { role: rest.careTeam.primary.role, name: '' } : null, others: rest.careTeam.others.map((o) => ({ role: o.role, name: '' })) }
      : null,
    notes: {
      ...rest.notes,
      therapy: rest.notes.therapy.map((n) => ({ ...n, ref: '' })),
      medManagement: rest.notes.medManagement.map((n) => ({ ...n, ref: '' })),
      primaryCare: rest.notes.primaryCare.map((n) => ({ ...n, ref: '' })),
      documents: rest.notes.documents.map((d) => ({ ...d, href: null })),
    },
    chartHistoryStatus: rest.chartHistoryStatus ? { state: rest.chartHistoryStatus.state, message: '' } : null,
  };
}

// ─── Human-readable fact list (shown under the bullets) ─────────────────────

/** One "Chart facts used" line; `source` names where it came from (chart section / record) */
export type FactLine = { section: string; text: string; source?: string };

const scoreText = (s: ScoreFact) =>
  `${s.instrument} ${s.latest.score ?? 'n/a'}${s.latest.severity ? ` (${s.latest.severity})` : ''} on ${s.latest.date}` +
  (s.previous ? `; previous ${s.previous.score ?? 'n/a'} on ${s.previous.date}` : '') +
  (s.change != null && s.change !== 0 ? ` (${s.change > 0 ? '+' : ''}${s.change})` : '') +
  (s.latest.safetyFlagged ? ' — safety-flagged' : '');

export function factLines(f: PreVisitFacts): FactLine[] {
  const L: FactLine[] = [];
  const add = (section: string, text: string, source?: string) => L.push(source ? { section, text, source } : { section, text });
  add('Window', f.lastVisit ? `Last completed visit ${f.lastVisit.date} (${f.lastVisit.type}); changes since ${f.since}` : `No completed visit on file; changes since ${f.since}`, 'Schedule');
  add('Risk', `Risk level ${f.risk.level} (chart ${f.risk.chartLevel}); ${f.risk.openAlerts} unreviewed risk alert(s)${f.risk.cssrsSafetyFlagged ? '; latest C-SSRS safety-flagged' : ''}`, 'Risk alerts / C-SSRS');
  for (const a of f.changes.newRiskAlerts) add('Risk alert', `${a.date}: ${a.type} (${a.severity})${a.reviewed ? ', reviewed' : ', unreviewed'}`, 'Risk alerts');
  for (const c of f.changes.crisisEpisodes) add('Crisis episode', `${c.date}: priority ${c.priority}, ${c.status}`, 'Crisis episodes');
  // Visits by type (therapy and med management counted separately; imported Valant history included)
  const v = f.visits;
  const ref = (r: { date: string; type: string; imported: boolean } | null) => (r ? `${r.date} (${r.type}${r.imported ? ', imported from Valant' : ''})` : 'none on record');
  add('Visits', `Last therapy session: ${ref(v.last.therapy)} / Last med management: ${ref(v.last.medManagement)}${v.last.primaryCare ? ` / Last primary care: ${ref(v.last.primaryCare)}` : ''}`, 'Schedule (incl. imported Valant history), medical visits');
  add(
    'Next appointment',
    v.next ? `${v.next.date} ${v.next.time} ${v.next.type} (${VISIT_KIND_LABEL[v.next.kind]})${v.next.clinician ? ` with ${v.next.clinician}` : ''}${v.next.clinicianRole ? `, ${v.next.clinicianRole}` : ''}` : 'Nothing scheduled',
    'Schedule'
  );
  if (f.sessionFrequency) add('Session frequency', `${f.sessionFrequency.recommendation} therapy: ${f.sessionFrequency.detail} (${f.sessionFrequency.status})`, 'Session frequency (therapy sessions only)');
  if (f.careTeam) {
    if (f.careTeam.primary) add('Care team', `${f.careTeam.primary.role} (primary): ${f.careTeam.primary.name}`, 'Care team');
    for (const o of f.careTeam.others) add('Care team', `${o.role}: ${o.name}`, 'Care team');
  }
  for (const d of f.diagnoses) add('Diagnosis', `${d.code ? `${d.code} ` : ''}${d.name}${d.primary ? ' (primary)' : ''}${d.status === 'provisional' ? ' (provisional)' : ''}`, 'Diagnosis list');
  for (const m of f.currentMedications) add('Current medication', `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.sig ? `, ${m.sig}` : ''} (since ${m.since})`, m.fromDrFirst ? 'Medication list (DrFirst)' : 'Medication list');
  for (const m of f.recentMedChanges) add('Medication change', `${m.date}: ${m.change} ${m.name}${m.dose ? ` ${m.dose}` : ''}`, m.fromDrFirst ? 'Medication list (DrFirst)' : 'Medication list');
  for (const m of f.changes.medsStarted) add('Medication started', `${m.date}: ${m.name}${m.dose ? ` ${m.dose}` : ''}${m.fromDrFirst ? ' (DrFirst)' : ''}`, 'Medication list');
  for (const m of f.changes.medsStopped) add('Medication stopped', `${m.date}: ${m.name}${m.fromDrFirst ? ' (DrFirst)' : ''}`, 'Medication list');
  for (const p of f.changes.newProblems) add('New problem / diagnosis', `${p.date}: ${p.name}${p.code ? ` (${p.code})` : ''}${p.fromDrFirst ? ' (DrFirst)' : ''}`, 'Problem list');
  for (const d of f.changes.newDiagnoses) add('New diagnosis', `${d.date}: ${d.code ? `${d.code} ` : ''}${d.name}`, 'Diagnosis list');
  for (const d of f.changes.newDocuments) add('New document', `${d.date}: ${d.label}`, 'Chart documents');
  for (const x of f.changes.missedVisits) add('Missed / cancelled visit', `${x.date}: ${x.type} — ${x.status}`, 'Schedule');
  for (const s of f.scores) add('Score', scoreText(s), 'Measures');
  if (f.treatmentPlan) {
    const tp = f.treatmentPlan;
    add('Treatment plan', `${tp.status}; review ${tp.reviewDueAt ? `due ${tp.reviewDueAt} (${tp.reviewState.replace('_', ' ')})` : 'date not set'}`, 'Treatment plan');
    for (const g of tp.goals) add('Goal', g, 'Treatment plan');
  } else add('Treatment plan', 'No active, draft or needs-review treatment plan on file', 'Treatment plan');
  if (f.openItems.draftNotes) add('Open item', `${f.openItems.draftNotes} draft note(s) not signed`, 'Progress notes');
  if (f.openItems.overdueNotes) add('Open item', `${f.openItems.overdueNotes} unsigned note(s) past the documentation deadline`, 'Progress notes');
  if (f.openItems.pendingConsents) add('Open item', `${f.openItems.pendingConsents} consent(s) pending`, 'Consents');
  for (const m of f.openItems.overdueMeasures) add('Measure overdue', `${m.instrument} every ${m.everyDays} days; last ${m.lastDate ?? 'none on file'}`, 'Measure assignments');
  for (const r of f.openItems.referrals) add('Referral', `${r.kind}: ${r.status} since ${r.since}`, 'Referrals');
  if (f.openItems.drFirstPending) add('Open item', `${f.openItems.drFirstPending} pending DrFirst change request(s)`, 'DrFirst');
  for (const r of f.openItems.sdohReferrals) add('SDOH referral', `${r.need}: ${r.status} since ${r.since}`, 'SDOH referrals');
  if (f.labs) {
    for (const l of f.labs.results ?? []) {
      const earlier = l.history.length > 1 ? `; earlier ${l.history.slice(1).map((h) => `${h.value}${h.flag ? ` [${h.flag}]` : ''} on ${h.date}`).join(', ')}` : '';
      add('Lab result', `${l.test} ${l.latest.value}${l.latest.unit ? ` ${l.latest.unit}` : ''}${l.latest.flag ? ` [${l.latest.flag}]` : ''}${l.latest.refRange ? ` (ref ${l.latest.refRange})` : ''} on ${l.latest.date}${earlier}`, `Lab results (${l.latest.date})`);
    }
    for (const p of f.labs.pending ?? []) add('Lab pending', `${p.tests}: ${p.status} since ${p.orderedDate}`, 'Lab orders');
    for (const m of f.labs.monitoring ?? []) add('Lab monitoring', `${m.test} for ${m.medication}: ${m.state === 'overdue' ? `overdue, last ${m.lastDate}` : 'no result on file'}`, `Monitoring rule: ${m.rule}`);
    for (const d of f.labs.fromDocuments ?? []) add('Lab (document)', `${d.date ? `${d.date}: ` : ''}${d.text}`, `Chart history: ${d.source}`);
    for (const l of f.labs.due) add('Labs due', `${l.tests.join(', ') || 'Standing order'} — ${l.state === 'overdue' ? 'overdue since' : 'due'} ${l.dueDate}`, 'Standing lab orders');
    if (f.labs.resultsAwaitingReview) add('Labs', `${f.labs.resultsAwaitingReview} resulted order(s) awaiting review`, 'Lab orders');
    if (!(f.labs.results ?? []).length && !(f.labs.fromDocuments ?? []).length) add('Labs', 'No structured lab results on file', 'Lab results');
  }
  const kindList = { therapy: f.notes.therapy, med_management: f.notes.medManagement, primary_care: f.notes.primaryCare } as const;
  const kindName = { therapy: 'Therapy note', med_management: 'Med management note', primary_care: 'Primary care note' } as const;
  for (const k of f.notes.order) {
    for (const n of kindList[k]) {
      add(kindName[k], `${n.date} ${n.type}${n.authorRole ? ` (${n.authorRole})` : ''}${n.sections.length ? `: ${n.sections.map((x) => `${x.label}: ${x.text}`).join(' | ')}` : ''}`, `Signed note ${n.date}`);
    }
  }
  for (const d of f.notes.documents) add('Imported note', `${d.date} ${d.label} (not summarized yet)`, 'Imported document (Valant)');
  if (f.lastNotePlan) add('Last note plan', `${f.lastNotePlan.date}: ${f.lastNotePlan.text}`, `Signed note ${f.lastNotePlan.date}`);
  for (const h of f.chartHistory?.items ?? []) add(`Chart history: ${h.section}`, `${h.date ? `${h.date}: ` : ''}${h.text}`, 'Chart history digest (cited documents)');
  if (f.chartHistoryStatus && f.chartHistoryStatus.state !== 'ready') add('Chart history', f.chartHistoryStatus.message, 'Chart history digest');
  return L;
}

/** Links for the clinician's view (never sent to AI): signed notes and imported note documents */
export function factLinks(f: PreVisitFacts, clientId: string): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  for (const k of f.notes.order) {
    const list = k === 'therapy' ? f.notes.therapy : k === 'med_management' ? f.notes.medManagement : [];
    for (const n of list) out.push({ label: `${n.date} ${n.type}`, href: `/dashboard/ehr/notes?clientId=${encodeURIComponent(clientId)}&openNote=${encodeURIComponent(n.ref)}` });
  }
  for (const d of f.notes.documents) if (d.href) out.push({ label: `${d.date} ${d.label} (imported, not summarized yet)`, href: d.href });
  return out;
}

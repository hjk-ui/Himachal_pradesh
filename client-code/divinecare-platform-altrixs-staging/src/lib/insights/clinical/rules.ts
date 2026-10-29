/**
 * Clinical Insights — THE rules. Pure, unit-tested (tests/clinical-insights.test.ts).
 *
 * This is a transparent rule-based composite for prioritizing chart review. It is NOT a
 * prediction model: it makes no statement about the probability of any outcome, it was not
 * trained on outcomes and it has no measured accuracy. Every tier is the highest rule that fired,
 * and every rule names the recorded signals (values + dates) that made it fire.
 *
 * ── Reliable change (symptom trajectory) ─────────────────────────────────────────────────────
 *   PHQ-9  ≥ 5 points   (Kroenke 2001; McMillan 2010 — 5 points is the reliable / clinically
 *                        significant individual change)
 *   GAD-7  ≥ 4 points   (Toussaint 2020 — minimal clinically important difference 4)
 *   PCL-5  ≥ 10 points  (National Center for PTSD — 5–10 = reliable change; the upper bound is
 *                        used so only change clearly beyond measurement error is flagged)
 *   Baseline = first score in the last 365 days; prior = the score before the latest.
 *   Worsening: latest − baseline ≥ threshold OR latest − prior ≥ threshold.
 *   Improving: baseline − latest ≥ threshold and not worsening vs prior.
 *   Otherwise "no change"; one score = "baseline only". Scores on the same day are one point.
 *   A trajectory whose latest score is older than 90 days is shown but does not set the tier.
 *
 * ── Tiers (highest rule wins) ────────────────────────────────────────────────────────────────
 *   Urgent  U1 C-SSRS positive on the latest screen, within 30 days
 *           U2 Crisis episode within 30 days
 *           U3 Unreviewed high-severity risk alert
 *   High    H1 Reliable worsening (current score) AND missed visits (2+ no-shows / late cancels in
 *              90 days) or no attended visit in 60 days
 *           H2 PHQ-9 safety item flagged within 30 days
 *           H3 PHQ-9 ≥ 20 within 30 days
 *           H4 C-SSRS positive on the latest screen, 31–90 days ago
 *           H5 Risk indicator (chart risk High, positive C-SSRS or crisis in 12 months, open high
 *              alert, PHQ-9 safety flag in 90 days) and no safety plan on file
 *           H6 Crisis in the last 90 days with no follow-up within 7 days
 *           H7 Unreviewed medium-severity risk alert
 *           H8 Chart risk level set to High by the care team
 *           H9 Discharged in the last 90 days with no follow-up documented or scheduled
 *   Watch   W1 One safety or symptom watch signal (reliable worsening, crisis 31–90 days ago,
 *              open low alert, risk-language hit)
 *           W2 Two or more DIFFERENT engagement / treatment / medication / social watch signals.
 *              One soft signal alone is not Watch.
 *   Stable  None of the above. "Stable" with data gaps means "nothing flagged in the data on
 *           file", not "doing well" — the gaps are listed.
 * Info-level and positive signals are shown as chips and care gaps but never raise the tier:
 * no treatment plan, Valant plan not imported, PHQ-9 overdue, authorization ending, coverage
 * ending, unsigned notes, possibly disengaged, improving scores.
 *
 * ── In care / engagement (tuned 2026-10-19 on staging: 3,509 active clients) ────────────────
 *   In care = an attended visit in the last 120 days OR a future appointment. Engagement watch
 *   signals apply only to clients in care: no future appointment (only when the last visit was
 *   within 120 days; watch-level once it is 30+ days old), no visit in 60 days (only when the
 *   last visit was 61–120 days ago), below the recommended visit frequency, 2+ missed visits.
 *   Clients not in care get one info signal, "possibly disengaged / inactive", and an outreach
 *   care-gap list instead of Watch. Population-health worklists should flag a small, actionable
 *   share; a client unseen for months is an outreach or discharge decision, not a watch item.
 *
 * ── Treatment plans ──────────────────────────────────────────────────────────────────────────
 *   A plan imported from Valant counts as a plan on file. A missing plan is a care gap (info).
 *   During the go-live transition (therapy workflow setting; default go-live + 30 days) a Valant
 *   client without a plan shows "Valant plan not imported" instead.
 */
import type {
  ClientFacts,
  Evaluation,
  InstrumentKey,
  ScorePoint,
  Signal,
  SignalCategory,
  SignalKey,
  SignalLevel,
  Tier,
  Trajectory,
} from './types';

// ─── Constants (documented above) ───────────────────────────────────────────

export const LOOKBACK_DAYS = 365;
export const SCORE_CURRENT_DAYS = 90;
export const RELIABLE_CHANGE: Record<InstrumentKey, number> = { phq9: 5, gad7: 4, pcl5: 10 };
export const INSTRUMENT_LABEL: Record<InstrumentKey, string> = { phq9: 'PHQ-9', gad7: 'GAD-7', pcl5: 'PCL-5' };
export const INSTRUMENT_MAX: Record<InstrumentKey, number> = { phq9: 27, gad7: 21, pcl5: 80 };
export const PHQ9_SEVERE = 20;
/** PHQ-9 at or above this with worsening suggests a treatment-intensity review (scanner referral) */
export const PHQ9_MODERATELY_SEVERE = 15;
export const RECENT_DAYS = 30;
export const SAFETY_WINDOW_DAYS = 90;
export const MISSED_VISITS_MIN = 2;
export const MISSED_WINDOW_DAYS = 90;
export const NO_VISIT_DAYS = 60;
/** "In care": an attended visit in the last IN_CARE_DAYS days, or a future appointment */
export const IN_CARE_DAYS = 120;
/** Watch (W2) needs this many different engagement / treatment / medication / social watch signals */
export const WATCH_SOFT_MIN = 2;
/** No future appointment counts as a watch signal once the last visit is this old (or missing) */
export const NO_FUTURE_WATCH_DAYS = 30;
export const PHQ9_OVERDUE_DAYS = 90;
export const CRISIS_FOLLOWUP_DAYS = 7;
/** New charts get this long before a missing treatment plan is flagged (intake window) */
export const PLAN_GRACE_DAYS = 30;
export const PLAN_REVIEW_SOON_DAYS = 14;
export const GOAL_CHIP_DAYS = 90;
export const REFILL_PENDING_DAYS = 3;
export const PORTAL_UNANSWERED_DAYS = 3;
export const AUTH_EXPIRING_DAYS = 14;
export const AUTH_UNITS_LOW = 2;
export const INSURANCE_ENDING_DAYS = 30;

const DAY_MS = 86_400_000;

/** Whole days from a to b (YYYY-MM-DD); positive when b is later */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Reliable change ────────────────────────────────────────────────────────

const SOURCE_RANK: Record<ScorePoint['source'], number> = { assessment: 0, valant: 1, tms: 2 };

/** One point per day (assessment first, then the Valant import, then TMS), ascending, in range. */
export function normalizeScores(points: ScorePoint[], instrument: InstrumentKey, today: string): ScorePoint[] {
  const max = INSTRUMENT_MAX[instrument];
  const byDay = new Map<string, ScorePoint>();
  for (const p of points) {
    if (!Number.isFinite(p.score) || p.score < 0 || p.score > max) continue;
    const age = dayDiff(p.date, today);
    if (age < 0 || age > LOOKBACK_DAYS) continue;
    const cur = byDay.get(p.date);
    if (!cur || SOURCE_RANK[p.source] < SOURCE_RANK[cur.source]) byDay.set(p.date, p);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function trajectory(instrument: InstrumentKey, points: ScorePoint[], today: string): Trajectory | null {
  const list = normalizeScores(points, instrument, today);
  if (!list.length) return null;
  const threshold = RELIABLE_CHANGE[instrument];
  const latest = list[list.length - 1];
  const stale = dayDiff(latest.date, today) > SCORE_CURRENT_DAYS;
  const base = { instrument, label: INSTRUMENT_LABEL[instrument], threshold, scores: list.length, latest, stale };
  if (list.length < 2) {
    return { ...base, prior: null, baseline: null, changeVsBaseline: null, changeVsPrior: null, status: 'baseline_only' };
  }
  const baseline = list[0];
  const prior = list[list.length - 2];
  const cvb = round1(latest.score - baseline.score);
  const cvp = round1(latest.score - prior.score);
  const status = cvb >= threshold || cvp >= threshold ? 'worsening' : -cvb >= threshold ? 'improving' : 'no_change';
  return { ...base, prior, baseline, changeVsBaseline: cvb, changeVsPrior: cvp, status };
}

// ─── Signals ────────────────────────────────────────────────────────────────

export const SIGNAL_META: Record<SignalKey, { category: SignalCategory; title: string }> = {
  cssrs_positive_30d: { category: 'safety', title: 'C-SSRS positive (30 days)' },
  cssrs_positive_90d: { category: 'safety', title: 'C-SSRS positive (31–90 days)' },
  crisis_30d: { category: 'safety', title: 'Crisis episode (30 days)' },
  crisis_90d: { category: 'safety', title: 'Crisis episode (31–90 days)' },
  crisis_no_followup: { category: 'safety', title: 'No follow-up within 7 days of a crisis' },
  alert_open_high: { category: 'safety', title: 'Unreviewed high risk alert' },
  alert_open_medium: { category: 'safety', title: 'Unreviewed medium risk alert' },
  alert_open_low: { category: 'safety', title: 'Unreviewed low risk alert' },
  risk_language_30d: { category: 'safety', title: 'Risk language detected (30 days)' },
  safety_plan_missing: { category: 'safety', title: 'Risk indicator, no safety plan' },
  chart_risk_high: { category: 'safety', title: 'Chart risk High' },
  phq9_item9_30d: { category: 'safety', title: 'PHQ-9 safety item flagged (30 days)' },
  worsening: { category: 'symptoms', title: 'Reliable worsening' },
  improving: { category: 'symptoms', title: 'Reliable improvement' },
  phq9_severe_30d: { category: 'symptoms', title: 'PHQ-9 ≥ 20 (30 days)' },
  phq9_overdue: { category: 'symptoms', title: 'Seen, no PHQ-9 in 90 days' },
  missed_visits_90: { category: 'engagement', title: '2+ missed visits (90 days)' },
  no_visit_60: { category: 'engagement', title: 'No attended visit in 60 days' },
  no_future_appt: { category: 'engagement', title: 'No future appointment' },
  cadence_overdue: { category: 'engagement', title: 'Below recommended visit frequency' },
  not_in_care: { category: 'engagement', title: 'Possibly disengaged / inactive' },
  portal_unanswered: { category: 'engagement', title: 'Portal message unanswered' },
  plan_missing: { category: 'treatment', title: 'No treatment plan (Altrixs or imported)' },
  valant_plan_not_imported: { category: 'treatment', title: 'Valant plan not imported' },
  plan_review_overdue: { category: 'treatment', title: 'Plan review overdue' },
  plan_review_due: { category: 'treatment', title: 'Plan review due soon' },
  goal_regression: { category: 'treatment', title: 'Goal regression on a note' },
  unsigned_notes: { category: 'treatment', title: 'Unsigned notes past deadline' },
  discharge_no_followup: { category: 'treatment', title: 'Discharged, no follow-up' },
  refill_pending: { category: 'medication', title: 'Refill request pending' },
  fill_not_dispensed: { category: 'medication', title: 'Prescription not dispensed' },
  labs_due: { category: 'medication', title: 'Monitoring labs due' },
  sdoh_positive: { category: 'social', title: 'Social need (AHC HRSN)' },
  auth_expiring: { category: 'social', title: 'Authorization ending' },
  insurance_ending: { category: 'social', title: 'Insurance coverage ending' },
};

export const SIGNAL_KEYS = Object.keys(SIGNAL_META) as SignalKey[];

const LEVEL_RANK: Record<SignalLevel, number> = { urgent: 0, high: 1, watch: 2, info: 3, positive: 4, stable: 5 };

function sig(key: SignalKey, level: SignalLevel, label: string, detail: string, date: string | null): Signal {
  return { key, category: SIGNAL_META[key].category, level, label, detail, date };
}

const sdohLabel = (d: string) => d.replace(/_/g, ' ');

/** In care: an attended visit in the last 120 days, or a future appointment scheduled. */
export function isInCare(f: Pick<ClientFacts, 'lastVisit' | 'nextAppointment'>, today: string): boolean {
  if (f.nextAppointment) return true;
  return f.lastVisit != null && dayDiff(f.lastVisit, today) <= IN_CARE_DAYS;
}

/** All signals, trajectories and data gaps for one client on `today` (clinic day YYYY-MM-DD). */
export function clientSignals(f: ClientFacts, today: string): { signals: Signal[]; trajectories: Trajectory[]; dataGaps: string[] } {
  const out: Signal[] = [];
  const gaps: string[] = [];
  const age = (d: string | null) => (d ? dayDiff(d, today) : null);

  // Safety ────────────────────────────────────────────────────────────────
  if (f.cssrs?.positive) {
    const a = age(f.cssrs.date)!;
    if (a <= RECENT_DAYS) out.push(sig('cssrs_positive_30d', 'urgent', 'C-SSRS positive', `Latest C-SSRS positive on ${f.cssrs.date}`, f.cssrs.date));
    else if (a <= SAFETY_WINDOW_DAYS) out.push(sig('cssrs_positive_90d', 'high', 'C-SSRS positive', `Latest C-SSRS positive on ${f.cssrs.date}`, f.cssrs.date));
  }
  if (!f.cssrs) gaps.push('No C-SSRS on file');

  const crises = [...f.crises].sort((a, b) => b.date.localeCompare(a.date));
  const lastCrisis = crises[0];
  if (lastCrisis) {
    const a = age(lastCrisis.date)!;
    if (a <= RECENT_DAYS) out.push(sig('crisis_30d', 'urgent', 'Crisis episode', `Crisis episode on ${lastCrisis.date}`, lastCrisis.date));
    else if (a <= SAFETY_WINDOW_DAYS) out.push(sig('crisis_90d', 'watch', 'Crisis episode', `Crisis episode on ${lastCrisis.date}`, lastCrisis.date));
  }
  const missedFollowUp = crises.find((c) => age(c.date)! <= SAFETY_WINDOW_DAYS && c.followedUp7d === false);
  if (missedFollowUp) {
    out.push(sig('crisis_no_followup', 'high', 'No 7-day crisis follow-up', `No attended visit or completed follow-up within ${CRISIS_FOLLOWUP_DAYS} days of the crisis on ${missedFollowUp.date}`, missedFollowUp.date));
  }

  const bySev = (s: 'HIGH' | 'MEDIUM' | 'LOW') => f.openAlerts.filter((a) => a.severity === s).sort((a, b) => a.date.localeCompare(b.date));
  const alertKeys = { HIGH: 'alert_open_high', MEDIUM: 'alert_open_medium', LOW: 'alert_open_low' } as const;
  const alertLevels = { HIGH: 'urgent', MEDIUM: 'high', LOW: 'watch' } as const;
  for (const s of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    const list = bySev(s);
    if (!list.length) continue;
    out.push(sig(alertKeys[s], alertLevels[s], `${list.length} open ${s.toLowerCase()} alert${list.length === 1 ? '' : 's'}`,
      `${list.length} unreviewed ${s.toLowerCase()}-severity risk alert${list.length === 1 ? '' : 's'}, oldest ${list[0].date} (${[...new Set(list.map((x) => x.type.replace(/_/g, ' ')))].join(', ')})`, list[0].date));
  }
  if (f.riskLanguage.length) {
    const newest = [...f.riskLanguage].sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push(sig('risk_language_30d', 'watch', 'Risk language', `${f.riskLanguage.length} risk-language watch hit${f.riskLanguage.length === 1 ? '' : 's'} in ${RECENT_DAYS} days, latest ${newest.date} (${newest.severity.toLowerCase()})`, newest.date));
  }
  if (f.chartRisk === 'HIGH') out.push(sig('chart_risk_high', 'high', 'Chart risk High', 'Chart risk level set to High on the client record', null));
  if (f.phq9SafetyFlagDate && age(f.phq9SafetyFlagDate)! <= RECENT_DAYS) {
    out.push(sig('phq9_item9_30d', 'high', 'PHQ-9 safety item', `PHQ-9 safety item flagged on ${f.phq9SafetyFlagDate}`, f.phq9SafetyFlagDate));
  }
  const riskIndicator =
    f.chartRisk === 'HIGH' ||
    Boolean(f.cssrs?.positive && age(f.cssrs.date)! <= LOOKBACK_DAYS) ||
    f.crises.length > 0 ||
    f.openAlerts.some((a) => a.severity === 'HIGH') ||
    Boolean(f.phq9SafetyFlagDate && age(f.phq9SafetyFlagDate)! <= SAFETY_WINDOW_DAYS);
  if (riskIndicator && !f.safetyPlan) out.push(sig('safety_plan_missing', 'high', 'No safety plan', 'A risk indicator is on file and no safety plan is linked to this client', null));
  if (!f.safetyPlan && !riskIndicator) gaps.push('No safety plan on file');

  // Symptoms ──────────────────────────────────────────────────────────────
  const trajectories: Trajectory[] = [];
  for (const k of ['phq9', 'gad7', 'pcl5'] as const) {
    const t = trajectory(k, f.scores[k] ?? [], today);
    if (!t) continue;
    trajectories.push(t);
    const vs = t.changeVsBaseline != null && t.changeVsBaseline >= t.threshold
      ? `baseline ${t.baseline!.score} on ${t.baseline!.date}`
      : t.prior ? `prior ${t.prior.score} on ${t.prior.date}` : '';
    if (t.status === 'worsening' && !t.stale) {
      const delta = t.changeVsBaseline != null && t.changeVsBaseline >= t.threshold ? t.changeVsBaseline : t.changeVsPrior!;
      out.push(sig('worsening', 'watch', `${t.label} worsening ${signed(delta)}`, `${t.label} ${t.latest.score} on ${t.latest.date} vs ${vs} (reliable change ≥ ${t.threshold})`, t.latest.date));
    }
    if (t.status === 'improving' && !t.stale) {
      out.push(sig('improving', 'positive', `${t.label} improving ${signed(t.changeVsBaseline!)}`, `${t.label} ${t.latest.score} on ${t.latest.date} vs baseline ${t.baseline!.score} on ${t.baseline!.date} (reliable change ≥ ${t.threshold})`, t.latest.date));
    }
  }
  const phq = trajectories.find((t) => t.instrument === 'phq9');
  if (phq && phq.latest.score >= PHQ9_SEVERE && age(phq.latest.date)! <= RECENT_DAYS) {
    out.push(sig('phq9_severe_30d', 'high', `PHQ-9 ${phq.latest.score}`, `PHQ-9 ${phq.latest.score} (severe, ≥ ${PHQ9_SEVERE}) on ${phq.latest.date}`, phq.latest.date));
  }
  const seenRecently = f.lastVisit != null && age(f.lastVisit)! <= PHQ9_OVERDUE_DAYS;
  if (seenRecently && (!phq || age(phq.latest.date)! > PHQ9_OVERDUE_DAYS)) {
    out.push(sig('phq9_overdue', 'info', 'PHQ-9 overdue', phq ? `Seen ${f.lastVisit}; last PHQ-9 on ${phq.latest.date}` : `Seen ${f.lastVisit}; no PHQ-9 in the last ${LOOKBACK_DAYS} days`, phq?.latest.date ?? null));
  }
  if (!phq) gaps.push(`No PHQ-9 in the last ${LOOKBACK_DAYS} days`);
  if (!trajectories.length) gaps.push('No PHQ-9, GAD-7 or PCL-5 scores — symptom trajectory unknown');

  // Engagement ────────────────────────────────────────────────────────────
  // Engagement watch signals apply only to clients IN CARE (isInCare); everyone else gets one
  // info signal, not_in_care ("possibly disengaged / inactive"), listed for outreach.
  const sinceVisit = age(f.lastVisit);
  const inCare = isInCare(f, today);
  const missed = f.missedVisits.filter((m) => age(m.date)! <= MISSED_WINDOW_DAYS).sort((a, b) => b.date.localeCompare(a.date));
  if (missed.length >= MISSED_VISITS_MIN) {
    const ns = missed.filter((m) => m.status === 'NO_SHOW').length;
    out.push(sig('missed_visits_90', inCare ? 'watch' : 'info', `${missed.length} missed visits`, `${ns} no-show${ns === 1 ? '' : 's'} and ${missed.length - ns} late cancel${missed.length - ns === 1 ? '' : 's'} in ${MISSED_WINDOW_DAYS} days (latest ${missed[0].date})`, missed[0].date));
  }
  if (f.lastVisit == null) gaps.push('No attended visit on file');
  // No visit in 60 days: only for clients who were in care in the prior 120 days
  else if (sinceVisit! > NO_VISIT_DAYS && sinceVisit! <= IN_CARE_DAYS) {
    out.push(sig('no_visit_60', 'watch', `${sinceVisit} days since visit`, `Last attended visit ${f.lastVisit} (${sinceVisit} days ago)`, f.lastVisit));
  }
  // No future appointment: only when the last visit was within 120 days
  if (!f.nextAppointment && f.lastVisit != null && sinceVisit! <= IN_CARE_DAYS) {
    const watch = sinceVisit! >= NO_FUTURE_WATCH_DAYS;
    out.push(sig('no_future_appt', watch ? 'watch' : 'info', 'No future appointment', `Nothing scheduled; last attended visit ${f.lastVisit}`, f.lastVisit));
  }
  if (!inCare) {
    out.push(sig('not_in_care', 'info', 'Possibly disengaged',
      f.lastVisit ? `No attended visit in ${IN_CARE_DAYS} days (last ${f.lastVisit}) and nothing scheduled` : 'No attended visit on file and nothing scheduled', f.lastVisit));
  }
  if (f.cadence) {
    const parts: string[] = [];
    if (f.cadence.therapy.status === 'overdue') parts.push(`therapy (${f.cadence.therapy.label}) ${f.cadence.therapy.daysOverdue} days overdue`);
    if (f.cadence.med.status === 'overdue') parts.push(`medication management (${f.cadence.med.label}) ${f.cadence.med.daysOverdue} days overdue`);
    if (parts.length && inCare) out.push(sig('cadence_overdue', 'watch', 'Below visit frequency', `Recommended frequency not met: ${parts.join('; ')}`, null));
  } else {
    gaps.push('Visit frequency could not be computed');
  }
  if (f.portal.unansweredSince && age(f.portal.unansweredSince)! >= PORTAL_UNANSWERED_DAYS) {
    out.push(sig('portal_unanswered', 'watch', 'Portal message waiting', `Patient portal message waiting for a reply since ${f.portal.unansweredSince}`, f.portal.unansweredSince));
  }

  // Treatment ─────────────────────────────────────────────────────────────
  // A missing plan is a care gap (info), never a tier driver. A plan imported from Valant counts
  // as a plan on file. During the go-live transition a Valant client without one is "Valant plan
  // not imported" (notes may still be signed without a plan until planTransitionUntil).
  if (!f.plan && !f.importedPlan) {
    const inTransition = f.valantClient && f.planTransitionUntil != null && today <= f.planTransitionUntil;
    const inIntake = f.firstSeen != null && age(f.firstSeen)! <= PLAN_GRACE_DAYS;
    if (inTransition) {
      out.push(sig('valant_plan_not_imported', 'info', 'Valant plan not imported', `No Valant plan was imported and none is written in Altrixs yet; notes can be signed without one until ${f.planTransitionUntil} (go-live transition)`, f.planTransitionUntil));
    } else {
      out.push(sig('plan_missing', 'info', 'No treatment plan', inIntake ? `No active treatment plan (chart opened ${f.firstSeen}, intake window)` : 'No active treatment plan on file (Altrixs or imported from Valant)', null));
    }
  } else {
    const due = f.plan?.reviewDue ?? f.importedPlan?.reviewDue ?? null;
    const source = f.plan ? 'Treatment plan' : 'Imported Valant plan';
    if ((due && dayDiff(due, today) > 0) || (!due && f.plan?.status === 'NEEDS_REVIEW')) {
      out.push(sig('plan_review_overdue', 'watch', 'Plan review overdue', due ? `${source} review was due ${due}` : 'Treatment plan marked Needs review', due));
    } else if (due && dayDiff(today, due) <= PLAN_REVIEW_SOON_DAYS) {
      out.push(sig('plan_review_due', 'info', 'Plan review due', `${source} review due ${due}`, due));
    }
    if (!due && f.plan?.status === 'ACTIVE') gaps.push('Active plan has no review date');
  }
  const regress = f.goalChips.filter((g) => g.status === 'Regression' && age(g.date)! <= GOAL_CHIP_DAYS).sort((a, b) => b.date.localeCompare(a.date));
  if (regress.length) {
    out.push(sig('goal_regression', 'watch', 'Goal regression', `${regress.map((g) => `goal ${g.goal}`).join(', ')} rated "Regression" on the latest note (${regress[0].date})`, regress[0].date));
  }
  if (f.unsignedNotes.count > 0) {
    out.push(sig('unsigned_notes', 'info', `${f.unsignedNotes.count} unsigned note${f.unsignedNotes.count === 1 ? '' : 's'}`, `${f.unsignedNotes.count} draft note${f.unsignedNotes.count === 1 ? '' : 's'} past the signing deadline, oldest ${f.unsignedNotes.oldest ?? '—'}`, f.unsignedNotes.oldest));
  }
  if (f.discharge && !f.discharge.followUpDocumented && !f.nextAppointment) {
    out.push(sig('discharge_no_followup', 'high', 'Discharged, no follow-up', `Discharged${f.discharge.date ? ` ${f.discharge.date}` : ''}; no 7-day follow-up or aftercare appointment documented and nothing scheduled`, f.discharge.date));
  }

  // Medication ────────────────────────────────────────────────────────────
  if (f.refillsPending.count > 0) {
    const old = f.refillsPending.oldest && age(f.refillsPending.oldest)! >= REFILL_PENDING_DAYS;
    out.push(sig('refill_pending', old ? 'watch' : 'info', `${f.refillsPending.count} refill request${f.refillsPending.count === 1 ? '' : 's'}`, `${f.refillsPending.count} pending refill request${f.refillsPending.count === 1 ? '' : 's'}, oldest ${f.refillsPending.oldest ?? '—'}`, f.refillsPending.oldest));
  }
  if (f.fillProblems.length) {
    const last = [...f.fillProblems].sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push(sig('fill_not_dispensed', 'watch', 'Rx not dispensed', `${f.fillProblems.length} DrFirst fill event${f.fillProblems.length === 1 ? '' : 's'} "not dispensed" in 90 days, latest ${last.date}`, last.date));
  }
  if (f.labs?.overdue) {
    out.push(sig('labs_due', 'watch', 'Monitoring labs due', `No current monitoring lab order for: ${f.labs.monitoredSets.join(', ')}`, null));
  }

  // Social / coverage ─────────────────────────────────────────────────────
  if (f.sdoh && f.sdoh.domains.length) {
    out.push(sig('sdoh_positive', 'watch', `${f.sdoh.domains.length} social need${f.sdoh.domains.length === 1 ? '' : 's'}`, `AHC HRSN on ${f.sdoh.date} positive for ${f.sdoh.domains.map(sdohLabel).join(', ')}`, f.sdoh.date));
  }
  if (!f.sdoh) gaps.push('No social needs (AHC HRSN) screening in 12 months');
  if (f.auth) {
    const ends = f.auth.endDate ? dayDiff(today, f.auth.endDate) : null;
    const endingSoon = ends != null && ends >= 0 && ends <= AUTH_EXPIRING_DAYS;
    const lowUnits = f.auth.unitsLeft != null && f.auth.unitsLeft <= AUTH_UNITS_LOW;
    if (endingSoon || lowUnits) {
      const parts = [endingSoon ? `ends ${f.auth.endDate}` : null, lowUnits ? `${Math.max(0, f.auth.unitsLeft!)} visits left` : null].filter(Boolean);
      out.push(sig('auth_expiring', 'info', 'Authorization ending', `Prior authorization ${parts.join(', ')}`, f.auth.endDate));
    }
  }
  if (f.insuranceEndsOn) {
    const d = dayDiff(today, f.insuranceEndsOn);
    if (d <= INSURANCE_ENDING_DAYS && d >= -INSURANCE_ENDING_DAYS) {
      out.push(sig('insurance_ending', 'info', d < 0 ? 'Coverage ended' : 'Coverage ending', `Primary insurance ${d < 0 ? 'ended' : 'ends'} ${f.insuranceEndsOn}`, f.insuranceEndsOn));
    }
  }

  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (b.date ?? '').localeCompare(a.date ?? ''));
  return { signals: out, trajectories, dataGaps: gaps };
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

export type TierRule = {
  id: string;
  tier: Exclude<Tier, 'stable'>;
  text: string;
  /** Contributing signal keys when the rule fires, else null */
  test(keys: Set<SignalKey>, signals: Signal[]): SignalKey[] | null;
};

const has = (...k: SignalKey[]) => (keys: Set<SignalKey>) => (k.every((x) => keys.has(x)) ? k : null);

export const TIER_RULES: TierRule[] = [
  { id: 'U1', tier: 'urgent', text: 'C-SSRS positive on the latest screen within 30 days', test: has('cssrs_positive_30d') },
  { id: 'U2', tier: 'urgent', text: 'Crisis episode within 30 days', test: has('crisis_30d') },
  { id: 'U3', tier: 'urgent', text: 'Unreviewed high-severity risk alert', test: has('alert_open_high') },
  {
    id: 'H1', tier: 'high',
    text: 'Reliable worsening (PHQ-9 ≥ 5, GAD-7 ≥ 4 or PCL-5 ≥ 10 points, score within 90 days) plus 2+ missed visits in 90 days or no attended visit in 60 days',
    test: (keys) => {
      if (!keys.has('worsening')) return null;
      const engagement = (['missed_visits_90', 'no_visit_60'] as const).filter((k) => keys.has(k));
      return engagement.length ? ['worsening', ...engagement] : null;
    },
  },
  { id: 'H2', tier: 'high', text: 'PHQ-9 safety item flagged within 30 days', test: has('phq9_item9_30d') },
  { id: 'H3', tier: 'high', text: `PHQ-9 ≥ ${PHQ9_SEVERE} within 30 days`, test: has('phq9_severe_30d') },
  { id: 'H4', tier: 'high', text: 'C-SSRS positive on the latest screen 31–90 days ago', test: has('cssrs_positive_90d') },
  { id: 'H5', tier: 'high', text: 'Risk indicator on file and no safety plan', test: has('safety_plan_missing') },
  { id: 'H6', tier: 'high', text: 'Crisis in the last 90 days without follow-up within 7 days', test: has('crisis_no_followup') },
  { id: 'H7', tier: 'high', text: 'Unreviewed medium-severity risk alert', test: has('alert_open_medium') },
  { id: 'H8', tier: 'high', text: 'Chart risk level set to High', test: has('chart_risk_high') },
  { id: 'H9', tier: 'high', text: 'Discharged in the last 90 days with no follow-up documented or scheduled', test: has('discharge_no_followup') },
  {
    id: 'W1', tier: 'watch', text: 'A safety or symptom watch signal (reliable worsening, crisis 31–90 days ago, open low alert, risk language)',
    test: (_k, signals) => {
      const w = signals.filter((x) => x.level === 'watch' && (x.category === 'safety' || x.category === 'symptoms')).map((x) => x.key);
      return w.length ? [...new Set(w)] : null;
    },
  },
  {
    id: 'W2', tier: 'watch', text: `${WATCH_SOFT_MIN}+ different engagement, treatment, medication or social watch signals (one alone is not enough)`,
    test: (_k, signals) => {
      const w = [...new Set(signals.filter((x) => x.level === 'watch' && x.category !== 'safety' && x.category !== 'symptoms').map((x) => x.key))];
      return w.length >= WATCH_SOFT_MIN ? w : null;
    },
  },
];

const TIER_ORDER: Tier[] = ['urgent', 'high', 'watch', 'stable'];
const RANK_WEIGHT: Record<SignalLevel, number> = { urgent: 1000, high: 100, watch: 10, info: 1, positive: 0, stable: 0 };

/** Tier = the highest rule that fired; `rules` lists every rule that fired at any tier. */
export function tierFor(signals: Signal[]): { tier: Tier; rules: string[]; reasons: SignalKey[] } {
  const keys = new Set(signals.map((s) => s.key));
  const fired = TIER_RULES.map((r) => ({ r, hit: r.test(keys, signals) })).filter((x) => x.hit);
  if (!fired.length) return { tier: 'stable', rules: [], reasons: [] };
  const best = TIER_ORDER.find((t) => fired.some((x) => x.r.tier === t))!;
  const reasons = [...new Set(fired.filter((x) => x.r.tier === best).flatMap((x) => x.hit!))];
  return { tier: best, rules: fired.map((x) => x.r.id), reasons };
}

export function evaluateClient(f: ClientFacts, today: string): Evaluation {
  const { signals, trajectories, dataGaps } = clientSignals(f, today);
  const { tier, rules } = tierFor(signals);
  const rank = signals.reduce((s, x) => s + RANK_WEIGHT[x.level], 0);
  return { tier, rules, signals, trajectories, dataGaps, rank };
}

export function tierRank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

// ─── Suggested next actions (fixed list; the clinician decides) ─────────────

export const NEXT_ACTIONS = {
  schedule_follow_up: 'Schedule a follow-up visit',
  administer_phq9: 'Administer a PHQ-9',
  review_safety_plan: 'Review or complete the safety plan',
  plan_review: 'Review the treatment plan',
  refer_scanner: 'Check program eligibility (Service Eligibility Scanner)',
  care_coordination: 'Care coordination (benefits, refills, labs or social needs)',
} as const;
export type NextActionId = keyof typeof NEXT_ACTIONS;
export const NEXT_ACTION_IDS = Object.keys(NEXT_ACTIONS) as NextActionId[];

const ACTION_FOR: Partial<Record<SignalKey, NextActionId>> = {
  no_future_appt: 'schedule_follow_up',
  no_visit_60: 'schedule_follow_up',
  missed_visits_90: 'schedule_follow_up',
  cadence_overdue: 'schedule_follow_up',
  not_in_care: 'schedule_follow_up',
  crisis_no_followup: 'schedule_follow_up',
  discharge_no_followup: 'schedule_follow_up',
  phq9_overdue: 'administer_phq9',
  safety_plan_missing: 'review_safety_plan',
  cssrs_positive_30d: 'review_safety_plan',
  cssrs_positive_90d: 'review_safety_plan',
  crisis_30d: 'review_safety_plan',
  alert_open_high: 'review_safety_plan',
  alert_open_medium: 'review_safety_plan',
  phq9_item9_30d: 'review_safety_plan',
  risk_language_30d: 'review_safety_plan',
  plan_missing: 'plan_review',
  valant_plan_not_imported: 'plan_review',
  plan_review_overdue: 'plan_review',
  plan_review_due: 'plan_review',
  goal_regression: 'plan_review',
  worsening: 'plan_review',
  refill_pending: 'care_coordination',
  fill_not_dispensed: 'care_coordination',
  labs_due: 'care_coordination',
  sdoh_positive: 'care_coordination',
  auth_expiring: 'care_coordination',
  insurance_ending: 'care_coordination',
};

/** Rule-based suggestions (shown when AI is unavailable, and the set the AI may choose from). */
export function ruleBasedActions(ev: Pick<Evaluation, 'signals' | 'trajectories'>): { id: NextActionId; because: SignalKey[] }[] {
  const by = new Map<NextActionId, SignalKey[]>();
  const add = (id: NextActionId, k: SignalKey) => by.set(id, [...new Set([...(by.get(id) ?? []), k])]);
  for (const s of ev.signals) {
    const a = ACTION_FOR[s.key];
    if (a) add(a, s.key);
  }
  const phq = ev.trajectories.find((t) => t.instrument === 'phq9');
  if (phq && !phq.stale && phq.status === 'worsening' && phq.latest.score >= PHQ9_MODERATELY_SEVERE) add('refer_scanner', 'worsening');
  return NEXT_ACTION_IDS.filter((id) => by.has(id)).map((id) => ({ id, because: by.get(id)! }));
}

/** Population flags from current trajectories (2+ scores, latest within 90 days); same meaning as the signals. */
export function trajectoryFlags(trajectories: Trajectory[]): { tracked: boolean; worsening: boolean; improving: boolean } {
  const current = trajectories.filter((t) => !t.stale && t.status !== 'baseline_only');
  return {
    tracked: current.length > 0,
    worsening: current.some((t) => t.status === 'worsening'),
    improving: current.some((t) => t.status === 'improving'),
  };
}

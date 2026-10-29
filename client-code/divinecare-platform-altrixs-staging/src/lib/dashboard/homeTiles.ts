/**
 * Role-home tiles and insight statements. Pure (browser + server + tests).
 *
 * Every number comes from a server aggregate (GET /api/dashboard/home → homeData.ts). A metric
 * whose source is unavailable is null and its tile is left out; nothing is estimated, sampled or
 * written by a model. Insight statements are plain rules over those same numbers, and each one
 * says what it counted.
 */

export type HomeTileTone = 'purple' | 'red' | 'amber' | 'teal' | 'blue' | 'slate' | 'green';

export type HomeTile = {
  key: string;
  label: string;
  /** null = the source could not be read; the UI shows "—" with the reason in `source` */
  value: number | null;
  sub?: string | null;
  /** Where the tile's list lives (filtered to the same rows); null = no list for this viewer */
  href: string | null;
  /** Plain-language data source, shown on hover */
  source: string;
  tone: HomeTileTone;
};

export type HomeInsight = {
  id: string;
  severity: 'critical' | 'high' | 'routine';
  text: string;
  /** What was counted (shown under the statement) */
  basis: string;
  href: string | null;
};

export type CaseloadMetrics = {
  scope: 'caseload' | 'organization';
  activeClients: number;
  /** Locked Part 2 / protected clients left out of every count */
  hiddenSensitiveClients: number;
  risk: { high: number; moderate: number; low: number; unknown: number };
  /** null when the session-frequency cadence could not be computed */
  therapyOverdue: number | null;
  medOverdue: number | null;
  noVisit30: number;
  noVisit60: number;
  /** No scored PHQ-9 / GAD-7 in 90 days */
  measurementDue: number;
  highNoSafetyPlan: number;
  phq9SevereUnacked: number;
  /** Notes unsigned past the practice signing deadline; null = source failed or not this role */
  unsignedNotes: number | null;
  unsignedDeadlineHours: number;
  /** Leadership (organization view): unsigned more than 7 days past the deadline; null / absent = not shown */
  unsignedOverdue7d?: number | null;
  /** New SUD Referral Radar signals; null = role has no radar access or source failed */
  sudSignals: number | null;
  prescriber: PrescriberMetrics | null;
};

export type PrescriberMetrics = {
  rxRequests: number | null;
  rxNotice: string | null;
  labResultsToReview: number | null;
  labResultsCritical: number | null;
  standingOverdue: number | null;
  standingDueSoon: number | null;
  /** Clients on lithium / clozapine / valproate / carbamazepine / antipsychotics with monitoring labs overdue */
  monitoringOverdue: number | null;
  monitoredClients: number | null;
  /** null = no PDMP query has ever been logged for this practice (feed not live): tile omitted */
  pdmpDue: number | null;
  controlledClients: number | null;
};

export type HomeAccess = {
  population: boolean;
  alerts: boolean;
  inbox: boolean;
  labsPath: string | null;
  sudRadar: boolean;
  /** Role may see clinical risk / measurement data (alerts or EHR access). Peer support may not. */
  clinical: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function populationListHref(access: HomeAccess, key: string, locationId: string | null = null): string | null {
  if (!access.population) return null;
  const qs = new URLSearchParams({ list: key });
  if (locationId) qs.set('location', locationId);
  return `/dashboard/population?${qs.toString()}`;
}

function inboxHref(access: HomeAccess, section: string): string | null {
  return access.inbox ? `/dashboard/inbox?section=${encodeURIComponent(section)}` : null;
}


/** Tiles / findings that disclose clinical risk or measurement data (hidden from non-clinical roles such as peer support) */
export const CLINICAL_KEYS = new Set([
  'risk_high', 'risk_unknown', 'high_no_safety_plan', 'measurement_due', 'sud_signals', 'phq9_severe', 'lab_critical',
  'med_overdue', 'monitoring_overdue', 'rx_requests', 'lab_results', 'standing_labs', 'pdmp_due', 'unsigned_notes',
]);
function frequencyHref(access: HomeAccess): string | null {
  return access.alerts ? '/dashboard/alerts?tab=frequency' : inboxHref(access, 'session_frequency');
}

/** Caseload Health tiles for the signed-in user's scope */
export function buildCaseloadTiles(m: CaseloadMetrics, access: HomeAccess, locationId: string | null = null): HomeTile[] {
  const who = m.scope === 'caseload' ? 'your assigned active clients' : 'active clients in this practice view';
  const hidden = m.hiddenSensitiveClients ? ` ${plural(m.hiddenSensitiveClients, 'protected client')} you cannot open are left out.` : '';
  const pop = (key: string) => populationListHref(access, key, locationId);
  const tiles: HomeTile[] = [
    {
      key: 'active',
      label: m.scope === 'caseload' ? 'Active caseload' : 'Active clients',
      value: m.activeClients,
      sub: m.scope === 'caseload' ? 'Assigned to you' : 'All clinicians',
      href: access.population ? '/dashboard/population' : '/dashboard/clients',
      source: `Count of ${who} (client status Active).${hidden}`,
      tone: 'purple',
    },
    {
      key: 'risk_high',
      label: 'High risk',
      value: m.risk.high,
      sub: `${m.risk.moderate.toLocaleString('en-US')} moderate · ${m.risk.low.toLocaleString('en-US')} low`,
      href: pop('tier:high'),
      source: 'Highest of chart risk level, unreviewed risk alerts and a safety-flagged latest C-SSRS (same rule as the chart banner).',
      tone: 'red',
    },
    {
      key: 'risk_unknown',
      label: 'Not screened',
      value: m.risk.unknown,
      sub: 'No risk screen on file',
      href: pop('tier:unknown'),
      source: 'Active clients with no C-SSRS, risk alert, clinical evaluation or safety plan on file (chart risk left at the default).',
      tone: 'slate',
    },
    {
      key: 'high_no_safety_plan',
      label: 'High risk, no safety plan',
      value: m.highNoSafetyPlan,
      sub: 'Stanley-Brown or evaluation plan missing',
      href: pop('action:high_no_safety_plan'),
      source: 'High-risk tier with no linked Stanley-Brown safety plan and no safety plan section in a finalized clinical evaluation.',
      tone: 'red',
    },
  ];
  if (m.therapyOverdue != null) {
    tiles.push({
      key: 'therapy_overdue',
      label: 'Sessions overdue',
      value: m.therapyOverdue,
      sub: 'Past therapy frequency',
      href: frequencyHref(access),
      source: 'Active clients overdue for individual therapy under the Session Frequency rules.',
      tone: 'amber',
    });
  }
  if (m.prescriber && m.medOverdue != null) {
    tiles.push({
      key: 'med_overdue',
      label: 'Med management overdue',
      value: m.medOverdue,
      sub: 'Past med-management frequency',
      href: frequencyHref(access),
      source: 'Active clients overdue for a medication-management visit under the Session Frequency rules.',
      tone: 'amber',
    });
  }
  tiles.push(
    {
      key: 'no_visit_30',
      label: 'No visit in 30 days',
      value: m.noVisit30,
      sub: 'No contact recorded',
      href: access.population ? '/dashboard/population' : '/dashboard/clients',
      source: 'Active clients with no attended appointment, signed note or billed Valant charge in the last 30 days (or none on record). Population Health lists only the 60-day group; this count is the wider 30-day group.',
      tone: 'slate',
    },
    {
      key: 'no_visit_60',
      label: 'No visit in 60 days',
      value: m.noVisit60,
      sub: `${m.noVisit30.toLocaleString('en-US')} with no visit in 30 days`,
      href: pop('action:no_visit_60') ?? '/dashboard/clients',
      source: 'No attended appointment, signed note or billed Valant charge in the window (or none on record).',
      tone: 'slate',
    },
    {
      key: 'measurement_due',
      label: 'PHQ-9 / GAD-7 due',
      value: m.measurementDue,
      sub: 'None scored in 90 days',
      href: pop('action:not_measured_90'),
      source: 'Active clients with no scored PHQ-9 or GAD-7 recorded in the last 90 days.',
      tone: 'blue',
    }
  );
  if (m.unsignedNotes != null) {
    tiles.push({
      key: 'unsigned_notes',
      label: `Unsigned notes > ${m.unsignedDeadlineHours}h`,
      value: m.unsignedNotes,
      sub: m.scope === 'caseload' ? 'Notes you wrote' : 'All clinicians',
      href: m.scope === 'caseload' ? inboxHref(access, 'unsigned_notes') : '/dashboard/ehr/notes',
      source:
        m.scope === 'caseload'
          ? `Your progress notes still in Draft more than ${m.unsignedDeadlineHours} hours after they were written (Inbox: My unsigned notes).`
          : `Progress notes in Draft more than ${m.unsignedDeadlineHours} hours after they were written, for clients in this view.`,
      tone: 'red',
    });
  }
  if (m.unsignedOverdue7d != null) {
    tiles.push({
      key: 'unsigned_overdue_7d',
      label: 'Notes overdue > 7 days',
      value: m.unsignedOverdue7d,
      sub: 'Escalated to supervisors',
      href: '/dashboard/ehr/notes?tab=escalated',
      source: `Progress notes still in Draft more than 7 days past the ${m.unsignedDeadlineHours}-hour signing deadline, for clients in this view. Each escalates to the author's supervisor (else the clinical director / practice director / admin).`,
      tone: 'red',
    });
  }
  if (m.sudSignals != null) {
    tiles.push({
      key: 'sud_signals',
      label: 'Open SUD signals',
      value: m.sudSignals,
      sub: 'SUD Referral Radar',
      href: access.sudRadar ? '/dashboard/ehr/scanner/sud-radar' : inboxHref(access, 'sud_radar'),
      source: 'New (not yet actioned) SUD Referral Radar signals for clients you can open. Protected records are not counted.',
      tone: 'amber',
    });
  }
  const p = m.prescriber;
  if (p) {
    if (p.rxRequests != null) {
      tiles.push({
        key: 'rx_requests',
        label: 'Refill & RxChange',
        value: p.rxRequests,
        sub: p.rxNotice ? 'DrFirst username missing' : 'Pending in DrFirst',
        href: inboxHref(access, 'rx_requests'),
        source: `Pending DrFirst refill requests routed to your DrFirst username plus pending RxChange requests for your caseload.${p.rxNotice ? ` ${p.rxNotice}` : ''}`,
        tone: 'amber',
      });
    }
    if (p.labResultsToReview != null) {
      tiles.push({
        key: 'lab_results',
        label: 'Lab results to review',
        value: p.labResultsToReview,
        sub: `${(p.labResultsCritical ?? 0).toLocaleString('en-US')} critical`,
        href: inboxHref(access, 'lab_results'),
        source: 'Resulted lab orders you placed that you have not signed off (critical = any HH / LL result).',
        tone: 'red',
      });
    }
    if (p.standingOverdue != null) {
      tiles.push({
        key: 'standing_labs',
        label: 'Standing labs overdue',
        value: p.standingOverdue,
        sub: `${(p.standingDueSoon ?? 0).toLocaleString('en-US')} due in 14 days`,
        href: access.labsPath,
        source: 'Active standing lab orders whose next due date has passed (due soon = within 14 days).',
        tone: 'amber',
      });
    }
    if (p.monitoringOverdue != null) {
      tiles.push({
        key: 'monitoring_overdue',
        label: 'Med monitoring labs overdue',
        value: p.monitoringOverdue,
        sub: `of ${(p.monitoredClients ?? 0).toLocaleString('en-US')} on monitored meds`,
        href: access.labsPath,
        source:
          'Clients with an active lithium, clozapine, valproate, carbamazepine or antipsychotic medication whose monitoring standing order is overdue, or who have no standing order and no lab order in the last 12 months.',
        tone: 'red',
      });
    }
    if (p.pdmpDue != null) {
      tiles.push({
        key: 'pdmp_due',
        label: 'PDMP check due',
        value: p.pdmpDue,
        sub: `of ${(p.controlledClients ?? 0).toLocaleString('en-US')} on controlled Rx`,
        href: '/dashboard/ehr/prescriptions',
        source: 'Clients with an active controlled-substance medication and no PDMP query logged (DrFirst PDMP events or the PDMP check) in the last 90 days.',
        tone: 'amber',
      });
    }
  }
  return access.clinical ? tiles : tiles.filter((t) => !CLINICAL_KEYS.has(t.key));
}

/**
 * Rule-based statements over the same numbers. Only non-zero findings are listed, most severe
 * first; the text states the count and the rule, never a prediction.
 */
export function buildCaseloadInsights(m: CaseloadMetrics, access: HomeAccess, locationId: string | null = null): HomeInsight[] {
  const out: HomeInsight[] = [];
  const pop = (key: string) => populationListHref(access, key, locationId);
  const add = (cond: boolean, i: HomeInsight) => {
    if (cond) out.push(i);
  };
  add(m.highNoSafetyPlan > 0, {
    id: 'high_no_safety_plan',
    severity: 'critical',
    text: `${plural(m.highNoSafetyPlan, 'high-risk client')} ${m.highNoSafetyPlan === 1 ? 'has' : 'have'} no safety plan on file.`,
    basis: 'High-risk tier without a linked Stanley-Brown plan or evaluation safety-plan section.',
    href: pop('action:high_no_safety_plan'),
  });
  add(m.phq9SevereUnacked > 0, {
    id: 'phq9_severe',
    severity: 'critical',
    text: `${plural(m.phq9SevereUnacked, 'client')} scored PHQ-9 ≥ 20 and the MBC alert is not acknowledged.`,
    basis: 'Latest unacknowledged PHQ-9 at or above the MBC threshold.',
    href: pop('action:phq9_severe_unacked'),
  });
  const p = m.prescriber;
  add(Boolean(p?.labResultsCritical), {
    id: 'lab_critical',
    severity: 'critical',
    text: `${plural(p?.labResultsCritical ?? 0, 'lab result')} with a critical value ${p?.labResultsCritical === 1 ? 'is' : 'are'} waiting for your review.`,
    basis: 'Resulted orders you placed with any HH / LL value, not yet signed off.',
    href: inboxHref(access, 'lab_results'),
  });
  add((m.therapyOverdue ?? 0) > 0, {
    id: 'therapy_overdue',
    severity: 'high',
    text: `${plural(m.therapyOverdue ?? 0, 'client')} ${m.therapyOverdue === 1 ? 'is' : 'are'} past their therapy frequency.`,
    basis: 'Session Frequency rules (individual therapy).',
    href: frequencyHref(access),
  });
  add(Boolean(p) && (m.medOverdue ?? 0) > 0, {
    id: 'med_overdue',
    severity: 'high',
    text: `${plural(m.medOverdue ?? 0, 'client')} ${m.medOverdue === 1 ? 'is' : 'are'} overdue for a medication-management visit.`,
    basis: 'Session Frequency rules (medication management).',
    href: frequencyHref(access),
  });
  add((p?.monitoringOverdue ?? 0) > 0, {
    id: 'monitoring_overdue',
    severity: 'high',
    text: `${plural(p?.monitoringOverdue ?? 0, 'client')} on a monitored medication ${p?.monitoringOverdue === 1 ? 'has' : 'have'} monitoring labs overdue.`,
    basis: 'Lithium, clozapine, valproate, carbamazepine or antipsychotic; standing order overdue, or no standing order and no lab order in 12 months.',
    href: access.labsPath,
  });
  add((p?.rxRequests ?? 0) > 0, {
    id: 'rx_requests',
    severity: 'high',
    text: `${plural(p?.rxRequests ?? 0, 'refill or RxChange request')} ${p?.rxRequests === 1 ? 'is' : 'are'} pending in DrFirst.`,
    basis: 'Pending DrFirst refill notifications and RxChange requests.',
    href: inboxHref(access, 'rx_requests'),
  });
  add((m.unsignedNotes ?? 0) > 0, {
    id: 'unsigned_notes',
    severity: 'high',
    text: `${plural(m.unsignedNotes ?? 0, 'note')} ${m.unsignedNotes === 1 ? 'is' : 'are'} still unsigned ${m.unsignedDeadlineHours} hours after being written.`,
    basis: 'Progress notes in Draft past the practice signing deadline.',
    href: m.scope === 'caseload' ? inboxHref(access, 'unsigned_notes') : '/dashboard/ehr/notes',
  });
  add((p?.pdmpDue ?? 0) > 0, {
    id: 'pdmp_due',
    severity: 'high',
    text: `${plural(p?.pdmpDue ?? 0, 'client')} on a controlled substance ${p?.pdmpDue === 1 ? 'has' : 'have'} no PDMP query logged in 90 days.`,
    basis: 'Active controlled-substance medication; PDMP audit log.',
    href: '/dashboard/ehr/prescriptions',
  });
  add((m.sudSignals ?? 0) > 0, {
    id: 'sud_signals',
    severity: 'routine',
    text: `${plural(m.sudSignals ?? 0, 'new SUD Referral Radar signal')} ${m.sudSignals === 1 ? 'needs' : 'need'} review.`,
    basis: 'Signals with status New.',
    href: access.sudRadar ? '/dashboard/ehr/scanner/sud-radar' : inboxHref(access, 'sud_radar'),
  });
  add(m.risk.unknown > 0, {
    id: 'risk_unknown',
    severity: 'routine',
    text: `${plural(m.risk.unknown, 'active client')} ${m.risk.unknown === 1 ? 'has' : 'have'} no risk screen on file.`,
    basis: 'No C-SSRS, risk alert, clinical evaluation or safety plan recorded.',
    href: pop('tier:unknown'),
  });
  add(m.measurementDue > 0 && m.activeClients > 0, {
    id: 'measurement_due',
    severity: 'routine',
    text: `${m.measurementDue.toLocaleString('en-US')} of ${plural(m.activeClients, 'active client')} ${m.measurementDue === 1 ? 'has' : 'have'} no PHQ-9 or GAD-7 in 90 days.`,
    basis: 'Scored PHQ-9 / GAD-7 records in the last 90 days.',
    href: pop('action:not_measured_90'),
  });
  add(m.noVisit60 > 0, {
    id: 'no_visit_60',
    severity: 'routine',
    text: `${plural(m.noVisit60, 'active client')} ${m.noVisit60 === 1 ? 'has' : 'have'} not been seen in 60 days.`,
    basis: 'No attended appointment, signed note or billed charge in 60 days.',
    href: pop('action:no_visit_60'),
  });
  const rank = { critical: 0, high: 1, routine: 2 } as const;
  return out.filter((i) => access.clinical || !CLINICAL_KEYS.has(i.id)).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

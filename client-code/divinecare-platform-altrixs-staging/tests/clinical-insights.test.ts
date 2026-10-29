import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clientSignals,
  evaluateClient,
  ruleBasedActions,
  tierFor,
  TIER_RULES,
  trajectory,
  trajectoryFlags,
  RELIABLE_CHANGE,
} from '../src/lib/insights/clinical/rules';
import {
  buildBreakdown,
  buildTrends,
  careGapTileFilters,
  cellRate,
  CARE_GAP_KEYS,
  detectShift,
  dxGroupOf,
  EMPTY_FILTERS,
  filterRows,
  KPI_SIGNALS,
  MIN_CELL,
  noFutureTileFilters,
  signalTileFilters,
  tierTileFilters,
  tileCounts,
  zeroCoverageBanners,
  type InsightFilters,
  type InsightRow,
  type RowHistory,
} from '../src/lib/insights/clinical/population';
import {
  checkCitedSentence,
  getClientSnapshot,
  getNarrative,
  guardSentences,
  snapshotFacts,
  validateNlFilters,
  type SnapshotDeps,
} from '../src/lib/insights/clinical/ai';
import { joinInsightRows } from '../src/lib/insights/clinical/population';
import type { ClientFacts, ScorePoint, Signal, Tier } from '../src/lib/insights/clinical/types';
import { TIERS } from '../src/lib/insights/clinical/types';

const TODAY = '2026-10-18';

function facts(over: Partial<ClientFacts> = {}): ClientFacts {
  return {
    clientId: 'c1',
    clientStatus: 'ACTIVE',
    chartRisk: 'LOW',
    scores: { phq9: [], gad7: [], pcl5: [] },
    phq9SafetyFlagDate: null,
    cssrs: { positive: false, date: '2026-09-01' },
    crises: [],
    openAlerts: [],
    riskLanguage: [],
    safetyPlan: true,
    missedVisits: [],
    lastVisit: '2026-10-10',
    nextAppointment: '2026-10-24',
    cadence: { therapy: { status: 'on_track', daysOverdue: 0, label: 'Weekly' }, med: { status: 'not_tracked', daysOverdue: 0, label: '' } },
    portal: { patientMessages30d: 0, lastPatientMessage: null, unansweredSince: null },
    plan: { status: 'ACTIVE', reviewDue: '2026-12-30', createdOn: '2026-07-01' },
    importedPlan: null,
    valantClient: false,
    planTransitionUntil: '2026-12-08',
    goalChips: [],
    unsignedNotes: { count: 0, oldest: null },
    refillsPending: { count: 0, oldest: null },
    fillProblems: [],
    labs: null,
    sdoh: { date: '2026-08-01', domains: [] },
    auth: null,
    insuranceEndsOn: null,
    discharge: null,
    firstSeen: '2026-01-05',
    ...over,
  };
}

const phq = (...pairs: [string, number][]): ScorePoint[] => pairs.map(([date, score]) => ({ date, score, source: 'assessment' }));

// ─── Reliable change ────────────────────────────────────────────────────────

test('reliable change: PHQ-9 needs ≥ 5 points, GAD-7 ≥ 4', () => {
  assert.equal(RELIABLE_CHANGE.phq9, 5);
  assert.equal(RELIABLE_CHANGE.gad7, 4);
  assert.equal(trajectory('phq9', phq(['2026-07-01', 10], ['2026-10-01', 14]), TODAY)!.status, 'no_change');
  assert.equal(trajectory('phq9', phq(['2026-07-01', 10], ['2026-10-01', 15]), TODAY)!.status, 'worsening');
  assert.equal(trajectory('phq9', phq(['2026-07-01', 15], ['2026-10-01', 10]), TODAY)!.status, 'improving');
  assert.equal(trajectory('gad7', phq(['2026-07-01', 8], ['2026-10-01', 11]), TODAY)!.status, 'no_change');
  assert.equal(trajectory('gad7', phq(['2026-07-01', 8], ['2026-10-01', 12]), TODAY)!.status, 'worsening');
});

test('reliable change: worsening vs prior counts even when baseline is unchanged; one score = baseline only', () => {
  const t = trajectory('phq9', phq(['2026-06-01', 12], ['2026-08-01', 6], ['2026-10-01', 12]), TODAY)!;
  assert.equal(t.changeVsBaseline, 0);
  assert.equal(t.changeVsPrior, 6);
  assert.equal(t.status, 'worsening');
  assert.equal(trajectory('phq9', phq(['2026-10-01', 20]), TODAY)!.status, 'baseline_only');
  assert.equal(trajectory('phq9', [], TODAY), null);
});

test('reliable change: out-of-range scores dropped, same-day duplicates merged, stale scores do not count', () => {
  const t = trajectory('phq9', [...phq(['2026-07-01', 10], ['2026-10-01', 40]), { date: '2026-07-01', score: 10, source: 'valant' }], TODAY)!;
  assert.equal(t.scores, 1);
  const stale = trajectory('phq9', phq(['2026-01-01', 5], ['2026-05-01', 15]), TODAY)!;
  assert.equal(stale.status, 'worsening');
  assert.equal(stale.stale, true);
  const s = clientSignals(facts({ scores: { phq9: phq(['2026-01-01', 5], ['2026-05-01', 15]), gad7: [], pcl5: [] } }), TODAY);
  assert.ok(!s.signals.some((x) => x.key === 'worsening'), 'stale worsening must not raise a signal');
  assert.deepEqual(trajectoryFlags(s.trajectories), { tracked: false, worsening: false, improving: false });
});

// ─── Tier rules ─────────────────────────────────────────────────────────────

test('tier: nothing flagged = Stable', () => {
  const ev = evaluateClient(facts(), TODAY);
  assert.equal(ev.tier, 'stable');
  assert.deepEqual(ev.rules, []);
});

test('tier: C-SSRS positive within 30 days or a crisis within 30 days = Urgent', () => {
  assert.equal(evaluateClient(facts({ cssrs: { positive: true, date: '2026-10-01' } }), TODAY).tier, 'urgent');
  assert.equal(evaluateClient(facts({ crises: [{ id: 'x', date: '2026-10-15', followedUp7d: null }] }), TODAY).tier, 'urgent');
  assert.equal(evaluateClient(facts({ openAlerts: [{ severity: 'HIGH', type: 'risk_language', source: 'portal', date: '2026-10-17' }] }), TODAY).tier, 'urgent');
  const older = evaluateClient(facts({ cssrs: { positive: true, date: '2026-08-01' } }), TODAY);
  assert.equal(older.tier, 'high');
  assert.ok(older.rules.includes('H4'));
});

test('tier: reliable worsening + missed visits = High; worsening alone = Watch', () => {
  const worse = { scores: { phq9: phq(['2026-07-01', 8], ['2026-10-05', 15]), gad7: [], pcl5: [] } };
  const alone = evaluateClient(facts(worse), TODAY);
  assert.equal(alone.tier, 'watch');
  const missed = evaluateClient(facts({ ...worse, missedVisits: [{ date: '2026-09-20', status: 'NO_SHOW' }, { date: '2026-10-01', status: 'LATE_CANCEL' }] }), TODAY);
  assert.equal(missed.tier, 'high');
  assert.ok(missed.rules.includes('H1'));
  const reasons = tierFor(missed.signals).reasons;
  assert.deepEqual(reasons.sort(), ['missed_visits_90', 'worsening']);
});

test('tier: risk indicator without safety plan = High; info signals never raise the tier', () => {
  assert.equal(evaluateClient(facts({ chartRisk: 'HIGH', safetyPlan: false }), TODAY).rules.includes('H5'), true);
  const info = evaluateClient(facts({ unsignedNotes: { count: 3, oldest: '2026-10-01' }, insuranceEndsOn: '2026-11-01' }), TODAY);
  assert.ok(info.signals.some((s) => s.key === 'unsigned_notes' && s.level === 'info'));
  assert.equal(info.tier, 'stable');
});

test('tier: crisis without 7-day follow-up = High; every signal carries a date or a reason', () => {
  const ev = evaluateClient(facts({ crises: [{ id: 'x', date: '2026-08-20', followedUp7d: false }] }), TODAY);
  assert.equal(ev.tier, 'high');
  assert.ok(ev.rules.includes('H6'));
  for (const s of ev.signals) assert.ok(s.detail.length > 0);
  assert.ok(ev.signals.find((s) => s.key === 'crisis_no_followup')!.detail.includes('2026-08-20'));
});

test('plans: missing plan is an info care gap; an imported Valant plan counts; Valant clients in the transition get "Valant plan not imported"', () => {
  const none = evaluateClient(facts({ plan: null }), TODAY);
  const s = none.signals.find((x) => x.key === 'plan_missing')!;
  assert.equal(s.level, 'info');
  assert.equal(none.tier, 'stable');
  const imported = evaluateClient(facts({ plan: null, importedPlan: { status: 'ACTIVE', reviewDue: null }, valantClient: true }), TODAY);
  assert.ok(!imported.signals.some((x) => x.key === 'plan_missing' || x.key === 'valant_plan_not_imported'));
  const transition = evaluateClient(facts({ plan: null, valantClient: true }), TODAY);
  assert.ok(transition.signals.some((x) => x.key === 'valant_plan_not_imported' && x.level === 'info'));
  assert.ok(!transition.signals.some((x) => x.key === 'plan_missing'));
  const after = evaluateClient(facts({ plan: null, valantClient: true, planTransitionUntil: '2026-10-01' }), TODAY);
  assert.ok(after.signals.some((x) => x.key === 'plan_missing'));
  const overdueImported = evaluateClient(facts({ plan: null, importedPlan: { status: 'ACTIVE', reviewDue: '2026-09-01' }, valantClient: true }), TODAY);
  assert.ok(overdueImported.signals.some((x) => x.key === 'plan_review_overdue' && x.detail.includes('Imported Valant plan')));
});

test('in care: not in care = one info "possibly disengaged" signal, no engagement watch signals, not Watch', () => {
  const gone = evaluateClient(facts({ lastVisit: '2026-04-01', nextAppointment: null, cadence: { therapy: { status: 'overdue', daysOverdue: 150, label: 'Weekly' }, med: { status: 'not_tracked', daysOverdue: 0, label: '' } } }), TODAY);
  const keys = gone.signals.map((x) => x.key);
  assert.ok(keys.includes('not_in_care'));
  for (const k of ['no_future_appt', 'no_visit_60', 'cadence_overdue'] as const) assert.ok(!keys.includes(k), k);
  assert.equal(gone.tier, 'stable');
  const never = evaluateClient(facts({ lastVisit: null, nextAppointment: null }), TODAY);
  assert.ok(never.signals.some((x) => x.key === 'not_in_care'));
  assert.ok(!never.signals.some((x) => x.key === 'no_future_appt'));
  // A future appointment keeps a client in care even after a long gap
  const booked = evaluateClient(facts({ lastVisit: '2026-04-01', nextAppointment: '2026-10-30' }), TODAY);
  assert.ok(!booked.signals.some((x) => x.key === 'not_in_care' || x.key === 'no_visit_60'));
});

test('engagement windows: no visit in 60 days only when the last visit was 61–120 days ago; no future appointment only within 120 days', () => {
  const at = (lastVisit: string) => evaluateClient(facts({ lastVisit, nextAppointment: null }), TODAY).signals.map((x) => x.key);
  assert.ok(at('2026-08-01').includes('no_visit_60')); // 78 days
  assert.ok(at('2026-08-01').includes('no_future_appt'));
  assert.ok(!at('2026-09-01').includes('no_visit_60')); // 47 days
  assert.ok(!at('2026-06-01').includes('no_visit_60')); // 139 days: not in care
  assert.ok(!at('2026-06-01').includes('no_future_appt'));
});

test('Watch needs one safety/symptom watch signal or 2+ different soft watch signals', () => {
  // One soft signal alone is not Watch
  assert.equal(evaluateClient(facts({ auth: { endDate: '2026-10-25', unitsLeft: 5 } }), TODAY).tier, 'stable');
  assert.equal(evaluateClient(facts({ auth: { endDate: '2026-10-25', unitsLeft: 5 } }), TODAY).signals.find((x) => x.key === 'auth_expiring')!.level, 'info');
  assert.equal(evaluateClient(facts({ lastVisit: '2026-09-01', nextAppointment: null }), TODAY).tier, 'stable'); // no_future_appt only
  assert.equal(evaluateClient(facts({ labs: { monitoredSets: ['lithium'], overdue: true } }), TODAY).tier, 'stable');
  // Two different soft signals = Watch (W2)
  const two = evaluateClient(facts({ lastVisit: '2026-08-01', nextAppointment: null }), TODAY);
  assert.equal(two.tier, 'watch');
  assert.ok(two.rules.includes('W2'));
  // One safety/symptom watch signal = Watch (W1)
  const crisis = evaluateClient(facts({ crises: [{ id: 'x', date: '2026-08-15', followedUp7d: true }] }), TODAY);
  assert.equal(crisis.tier, 'watch');
  assert.ok(crisis.rules.includes('W1'));
  const worse = evaluateClient(facts({ scores: { phq9: phq(['2026-07-01', 8], ['2026-10-05', 15]), gad7: [], pcl5: [] } }), TODAY);
  assert.deepEqual(worse.rules, ['W1']);
});

test('tier rules are documented once with unique ids', () => {
  const ids = TIER_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of TIER_RULES) assert.ok(r.text.length > 10);
});

test('data gaps are listed, never treated as zero', () => {
  const ev = evaluateClient(facts({ cssrs: null, lastVisit: null, sdoh: null, cadence: null }), TODAY);
  assert.ok(ev.dataGaps.includes('No C-SSRS on file'));
  assert.ok(ev.dataGaps.includes('No attended visit on file'));
  assert.ok(ev.dataGaps.some((g) => g.startsWith('No PHQ-9')));
  assert.ok(ev.dataGaps.includes('Visit frequency could not be computed'));
});

test('suggested actions come from the fixed list', () => {
  const ev = evaluateClient(facts({ chartRisk: 'HIGH', safetyPlan: false, nextAppointment: null, lastVisit: '2026-08-01' }), TODAY);
  const ids = ruleBasedActions(ev).map((a) => a.id);
  assert.ok(ids.includes('review_safety_plan'));
  assert.ok(ids.includes('schedule_follow_up'));
});

// ─── Population: suppression, shifts, tiles = lists ─────────────────────────

test('0%-coverage banners: one per data source nobody has, none when anyone has it', () => {
  const rows = Array.from({ length: 3 }, (_, i) => row(`b${i}`, 'stable', []));
  const keys = zeroCoverageBanners(rows).map((b) => b.key);
  assert.ok(keys.includes('gad7') && keys.includes('pcl5') && keys.includes('sdoh'));
  assert.ok(!keys.includes('phq9'));
  const none = rows.map((r) => ({ ...r, coverage: { ...r.coverage, phq9: false } }));
  assert.ok(zeroCoverageBanners(none).find((b) => b.key === 'phq9')!.text.startsWith('No PHQ-9 scores in the last 12 months'));
  assert.deepEqual(zeroCoverageBanners([]), []);
});

test('small-n suppression: rates with n < 10 are suppressed', () => {
  assert.equal(MIN_CELL, 10);
  assert.deepEqual(cellRate(3, 9), { num: 0, den: 9, pct: null, suppressed: true });
  assert.equal(cellRate(3, 10).pct, 30);
  const s = detectShift({ num: 5, den: 9 }, { num: 1, den: 40 });
  assert.equal(s.flagged, false);
  assert.equal(s.reason, 'suppressed_small_n');
});

test('shift detection: needs ≥ 5 points and |z| ≥ 1.96', () => {
  assert.equal(detectShift({ num: 30, den: 100 }, { num: 10, den: 100 }).flagged, true);
  assert.equal(detectShift({ num: 12, den: 100 }, { num: 10, den: 100 }).reason, 'below_threshold');
  assert.equal(detectShift({ num: 4, den: 20 }, { num: 2, den: 20 }).reason, 'not_significant');
});

function row(id: string, tier: Tier, signals: Signal['key'][], over: Partial<InsightRow> = {}): InsightRow {
  return {
    id, name: `Client ${id}`, mrn: `MRN-${id}`, clinician: { id: id.length % 2 ? 'u1' : 'u2', name: 'Dr A' }, location: { id: 'bowie', name: 'Bowie' },
    programs: [], payer: 'Medicaid', dxGroup: dxGroupOf('F33.1'), tier, rank: 1, rules: [],
    signals: signals.map((key) => ({ key, category: 'symptoms', level: 'watch', label: key, detail: key, date: null })),
    nextAppointment: signals.includes('no_future_appt') ? null : '2026-10-30', lastVisit: '2026-10-01',
    metrics: { seen90: true, phq9Current: true, tracked: true, worsening: signals.includes('worsening'), improving: false },
    coverage: { phq9: true, gad7: false, pcl5: false, cssrs: true, visit: true, futureAppt: true, plan: true, safetyPlan: true, sdoh: false, cadence: true, portal: false, medication: false },
    recentDischarge: false, scannedAt: `${TODAY}T06:00:00.000Z`,
    ...over,
  };
}

test('tiles = lists: every tile count equals the length of the list it opens', () => {
  const rows: InsightRow[] = [];
  const sigs: Signal['key'][][] = [['worsening', 'missed_visits_90'], ['phq9_overdue'], ['plan_missing', 'no_future_appt'], ['crisis_no_followup'], [], ['labs_due', 'worsening'], ['safety_plan_missing']];
  for (let i = 0; i < 70; i++) rows.push(row(`c${i}`, TIERS[i % 4], sigs[i % sigs.length], i % 5 === 0 ? { location: { id: 'ss', name: 'Silver Spring' } } : {}));
  const filterSets: InsightFilters[] = [
    EMPTY_FILTERS,
    { ...EMPTY_FILTERS, locationId: 'bowie' },
    { ...EMPTY_FILTERS, myCaseload: true, category: 'symptoms' },
    { ...EMPTY_FILTERS, tiers: ['urgent', 'high'], payer: 'Medicaid' },
  ];
  for (const f of filterSets) {
    const t = tileCounts(rows, f, 'u1');
    for (const tier of TIERS) assert.equal(t.tiers[tier], filterRows(rows, tierTileFilters(f, tier), 'u1').length);
    for (const g of CARE_GAP_KEYS) assert.equal(t.careGaps[g], filterRows(rows, careGapTileFilters(f, g), 'u1').length);
    for (const k of KPI_SIGNALS) assert.equal(t.signals[k], filterRows(rows, signalTileFilters(f, k), 'u1').length);
    assert.equal(t.noFutureAppt, filterRows(rows, noFutureTileFilters(f), 'u1').length);
    assert.equal(TIERS.reduce((s, x) => s + t.tiers[x], 0), t.total, 'tier tiles partition the total');
  }
});

test('trends and breakdowns suppress small groups', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`, 'watch', i < 3 ? ['worsening'] : [], i === 0 ? { location: { id: 'balt', name: 'Baltimore' } } : {}));
  const h: RowHistory = { weeks: [{ start: '2026-10-05', attended: 1, missed: 0 }, { start: '2026-10-12', attended: 1, missed: 1 }], months: [{ month: '2026-09', seen: true, measured: true, tracked: true, worsening: false, improving: false }] };
  const histories = new Map(rows.map((r) => [r.id, h]));
  const loc = buildBreakdown(rows, histories, 'location');
  assert.equal(loc.find((b) => b.key === 'balt')!.suppressed, true);
  assert.equal(loc.find((b) => b.key === 'bowie')!.suppressed, false);
  const trends = buildTrends([...histories.values()], '2026-10-19', '2026-10');
  assert.equal(trends.weeks.length, 2);
  assert.equal(trends.weeks[1].noShowRate.pct, 50);
});

test('snapshot join drops clients with no snapshot (counted) and inactive clients without a discharge case', () => {
  const r = row('a', 'high', ['worsening']);
  const { id: _i, name: _n, mrn: _m, clinician: _c, location: _l, scannedAt: _s, ...stored } = r;
  void _i; void _n; void _m; void _c; void _l; void _s;
  const out = joinInsightRows(
    [
      { id: 'a', name: 'Live Name', mrn: 'M1', status: 'ACTIVE', assignedTo: null, location: null },
      { id: 'b', name: 'B', mrn: null, status: 'ACTIVE', assignedTo: null, location: null },
      { id: 'c', name: 'C', mrn: null, status: 'INACTIVE', assignedTo: null, location: null },
    ],
    [
      { clientId: 'a', row: stored, history: { weeks: [], months: [] }, scannedAt: new Date() },
      { clientId: 'c', row: { ...stored, recentDischarge: false }, history: {}, scannedAt: new Date() },
    ]
  );
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].name, 'Live Name');
  assert.equal(out.notScanned, 1);
});

// ─── AI guardrail ───────────────────────────────────────────────────────────

const FACTS = [
  { id: 'fact1', text: 'PHQ-9 latest 18 on 2026-10-02; baseline 11 on 2026-07-01; trajectory worsening' },
  { id: 'fact2', text: 'No future appointment scheduled' },
];

test('guardrail: rejects ungrounded numbers, dates, missing citations and client names', () => {
  assert.equal(checkCitedSentence({ text: 'PHQ-9 rose from 11 to 18 by 2026-10-02.', cites: ['fact1'] }, FACTS, ['Jane Doe']), null);
  assert.equal(checkCitedSentence({ text: 'PHQ-9 rose to 21.', cites: ['fact1'] }, FACTS, []), 'ungrounded_number');
  assert.equal(checkCitedSentence({ text: 'Seen on 2026-09-30.', cites: ['fact1'] }, FACTS, []), 'ungrounded_date');
  assert.equal(checkCitedSentence({ text: 'Scores worsened last week.', cites: ['fact1'] }, FACTS, []), 'unverifiable_date');
  assert.equal(checkCitedSentence({ text: 'Nothing is scheduled.', cites: [] }, FACTS, []), 'no_citation');
  assert.equal(checkCitedSentence({ text: 'Nothing is scheduled.', cites: ['fact9'] }, FACTS, []), 'unknown_citation');
  assert.equal(checkCitedSentence({ text: 'Jane has no appointment.', cites: ['fact2'] }, FACTS, ['Jane Doe']), 'names_client');
  // A number must be in the CITED fact, not just somewhere in the facts
  assert.equal(checkCitedSentence({ text: 'PHQ-9 is 18 and nothing is scheduled.', cites: ['fact2'] }, FACTS, []), 'ungrounded_number');
  const g = guardSentences([{ text: 'PHQ-9 18.', cites: ['fact1'] }, { text: 'GAD-7 is 15.', cites: ['fact1'] }], FACTS, [], 5);
  assert.equal(g.ok, false);
});

function snapDeps(reply: string, over: Partial<SnapshotDeps> = {}): SnapshotDeps & { calls: number } {
  const store = new Map<string, unknown>();
  const d = {
    calls: 0,
    bedrockConfigured: () => true,
    aiConsent: async () => 'signed' as const,
    isProtected: async () => false,
    invokeModel: async () => {
      d.calls += 1;
      return reply;
    },
    modelId: 'test-model',
    audit: async () => {},
    cache: { get: (k: string) => store.get(k) as never, set: (k: string, v: unknown) => void store.set(k, v) },
    ...over,
  };
  return d;
}

test('AI snapshot: grounded output passes and is cached; ungrounded output is withheld entirely', async () => {
  const ok = JSON.stringify({ sentences: [{ text: 'PHQ-9 rose from 11 to 18 (2026-10-02).', cites: ['fact1'] }, { text: 'No follow-up is scheduled.', cites: ['fact2'] }], actions: [{ id: 'schedule_follow_up', cites: ['fact2'] }, { id: 'order_mri', cites: ['fact1'] }] });
  const d = snapDeps(ok);
  const r = await getClientSnapshot(d, { organizationId: 'o', clientId: 'c', facts: FACTS, names: ['Jane Doe'] });
  assert.equal(r.status, 'ok');
  if (r.status === 'ok') {
    assert.deepEqual(r.actions.map((a) => a.id), ['schedule_follow_up']);
    assert.equal(r.droppedActions, 1);
  }
  const again = await getClientSnapshot(d, { organizationId: 'o', clientId: 'c', facts: FACTS, names: [] });
  assert.equal(again.status === 'ok' && again.cached, true);
  assert.equal(d.calls, 1);

  const bad = JSON.stringify({ sentences: [{ text: 'PHQ-9 rose to 18.', cites: ['fact1'] }, { text: 'She was hospitalized 3 times.', cites: ['fact2'] }] });
  const r2 = await getClientSnapshot(snapDeps(bad), { organizationId: 'o', clientId: 'c', facts: FACTS, names: [] });
  assert.equal(r2.status, 'rejected');
});

test('AI snapshot: unavailable without Bedrock, declined consent or for a protected record (no model call)', async () => {
  for (const over of [{ bedrockConfigured: () => false }, { aiConsent: async () => 'declined' as const }, { isProtected: async () => true }]) {
    const d = snapDeps('{}', over);
    const r = await getClientSnapshot(d, { organizationId: 'o', clientId: 'c', facts: FACTS, names: [] });
    assert.equal(r.status, 'unavailable');
    assert.equal(d.calls, 0);
  }
});

test('AI snapshot facts carry no names and are numbered', () => {
  const f = facts({ scores: { phq9: phq(['2026-07-01', 8], ['2026-10-05', 15]), gad7: [], pcl5: [] } });
  const ev = evaluateClient(f, TODAY);
  const sf = snapshotFacts(ev, f, TODAY);
  assert.equal(sf[0].id, 'fact1');
  assert.ok(sf.some((x) => x.text.includes('PHQ-9 latest 15 on 2026-10-05')));
});

test('AI narrative: refuses under 10 clients; NL filter keeps only allowed values', async () => {
  const view = { kpis: { clients: 5, urgentHigh: 0, worsening: cellRate(0, 0), improving: cellRate(0, 0), measurement: cellRate(0, 0), noFutureAppt: 0 }, trends: { weeks: [], months: [], shifts: [] }, breakdowns: { clinician: [], location: [], program: [], payer: [], dxGroup: [] }, coverage: [], signalCounts: {} as never };
  const tiles = tileCounts([], EMPTY_FILTERS, null);
  const r = await getNarrative({ bedrockConfigured: () => true, invokeModel: async () => '{}', modelId: 'm', audit: async () => {}, cache: { get: () => undefined, set: () => {} } }, { scopeKey: 's', view, tiles, asOf: TODAY });
  assert.equal(r.status, 'unavailable');

  const v = validateNlFilters(
    { filters: { tiers: ['urgent', 'critical'], locationId: 'bowie', signal: 'worsening', noFutureAppt: true, payer: 'DROP TABLE' } },
    { clinicians: [], locations: [{ id: 'bowie', name: 'Bowie' }], programs: [], payers: ['Medicaid'], dxGroups: [] }
  );
  assert.deepEqual(v.filters.tiers, ['urgent']);
  assert.equal(v.filters.locationId, 'bowie');
  assert.equal(v.filters.signal, 'worsening');
  assert.equal(v.filters.noFutureAppt, true);
  assert.equal(v.filters.payer, null);
  assert.ok(v.ignored.some((x) => x.includes('critical')));
});

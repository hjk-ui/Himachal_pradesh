import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_RENEWAL_LEAD_DAYS,
  authServiceTypes,
  computeAuthForecast,
  forecastInboxItem,
  lastRenewalDrafted,
  leadTimeConfigFromEnv,
  renewalDraftedMarker,
  renewalLeadTime,
  renewalRequest,
  summarizeForecasts,
  visitMatchesAuth,
  type ForecastAuthInput,
} from '../src/lib/ai/authForecast/forecast';
import {
  buildRenewalPrompt,
  draftRenewal,
  parseProgressChips,
  summarizeGoals,
  templateJustification,
  type RenewalDraftDeps,
  type RenewalFacts,
} from '../src/lib/ai/authForecast/draft';
import { addCalendarDays } from '../src/lib/workflows/dates';

// Synthetic ids and names only; no real patient data.

/** Noon in the clinic (EDT) on 2026-10-17 */
const NOW = new Date('2026-10-17T16:00:00Z');
const TODAY = '2026-10-17';
const d = (day: string) => new Date(`${day}T12:00:00Z`);
const LEAD = { days: 14, source: 'test' };

function auth(over: Partial<ForecastAuthInput> = {}): ForecastAuthInput {
  return {
    id: 'pa-1',
    clientId: 'c-1',
    payer: 'Test Payer',
    authNumber: 'A100',
    cptCodes: ['90837'],
    unitsApproved: 20,
    unitsUsed: 0,
    status: 'APPROVED',
    startDate: d('2026-08-01'),
    endDate: d('2027-01-31'),
    vendor: null,
    notes: null,
    ...over,
  };
}

/** n weekly visits ending `lastDay` */
const weekly = (n: number, lastDay = '2026-10-16') => Array.from({ length: n }, (_, i) => addCalendarDays(lastDay, -7 * i));

const run = (a: ForecastAuthInput, attendedDays: string[] = [], scheduledDays: string[] = [], plan: { reviewDue: string | null; planEnd: string | null } | null = null, lead = LEAD) =>
  computeAuthForecast({ auth: a, visits: { attendedDays, scheduledDays }, plan, lead, now: NOW });

// ─── Pace and projection ───────────────────────────────────────────────────────

test('zero pace and nothing scheduled: no projection, no usage data', () => {
  const f = run(auth());
  assert.equal(f.pacePerWeek, 0);
  assert.equal(f.projectedRunOut, null);
  assert.equal(f.status, 'no_usage');
  assert.equal(f.atRisk, false);
});

test('zero pace but units recorded: on track with no projection', () => {
  const f = run(auth({ unitsUsed: 5 }));
  assert.equal(f.visitsUsed, 5);
  assert.equal(f.usedSource, 'recorded');
  assert.equal(f.projectedRunOut, null);
  assert.equal(f.status, 'on_track');
});

test('weekly pace over 8 weeks: 1/week, run-out = today + remaining weeks', () => {
  const f = run(auth({ unitsApproved: 20, unitsUsed: 0 }), weekly(8));
  assert.equal(f.paceVisits, 8);
  assert.equal(f.paceWindowDays, 56);
  assert.equal(f.pacePerWeek, 1);
  // 11 attended since Aug 1? only the 8 given; used = max(0, 8) = 8, remaining 12 → 84 days
  assert.equal(f.visitsUsed, 8);
  assert.equal(f.usedSource, 'attended');
  assert.equal(f.remaining, 12);
  assert.equal(f.projectedRunOut, addCalendarDays(TODAY, 84));
  assert.equal(f.runOutBasis, 'pace');
  assert.equal(f.status, 'runs_out', 'Jan 9 is before the Jan 31 end');
  assert.equal(f.coverageEnd, f.projectedRunOut);
  assert.equal(f.renewBy, addCalendarDays(f.projectedRunOut!, -14));
});

test('recorded and attended count the same visits: the higher wins, never the sum', () => {
  const f = run(auth({ unitsUsed: 6 }), weekly(4));
  assert.equal(f.visitsUsed, 6);
  assert.equal(f.visitsAttended, 4);
  const g = run(auth({ unitsUsed: 4 }), weekly(4));
  assert.equal(g.usedSource, 'both');
});

test('irregular visits: pace = visits in the window / window weeks; older visits count as used only', () => {
  const days = ['2026-08-03', '2026-08-04', '2026-09-01', '2026-09-30', '2026-10-01', '2026-10-15'];
  const f = run(auth({ unitsApproved: 30 }), days);
  // window = Aug 23..Oct 17 (56 days): Sep 1, Sep 30, Oct 1, Oct 15 = 4 → 0.5/week
  assert.equal(f.paceVisits, 4);
  assert.equal(f.pacePerWeek, 0.5);
  assert.equal(f.visitsUsed, 6);
  assert.equal(f.projectedRunOut, addCalendarDays(TODAY, Math.ceil((24 * 7) / 0.5)));
  assert.equal(f.status, 'on_track', 'run-out after the end date');
});

test('visits before the auth start or duplicate days are not counted', () => {
  const f = run(auth({ startDate: d('2026-10-01') }), ['2026-09-20', '2026-10-02', '2026-10-02', '2026-10-09']);
  assert.equal(f.visitsAttended, 2);
});

test('new auth: pace window is the days since start, at least 7', () => {
  const f = run(auth({ startDate: d('2026-10-14') }), ['2026-10-15']);
  assert.equal(f.paceWindowDays, 7);
  assert.equal(f.pacePerWeek, 1);
  const g = run(auth({ startDate: d('2026-09-19') }), ['2026-09-26', '2026-10-03', '2026-10-10']);
  assert.equal(g.paceWindowDays, 29);
});

test('scheduled visits reach the remaining units first: run-out = the last needed scheduled visit', () => {
  const sched = ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29'];
  const f = run(auth({ unitsApproved: 10, unitsUsed: 7 }), weekly(2), sched);
  assert.equal(f.remaining, 3);
  assert.equal(f.scheduledInWindow, 4);
  assert.equal(f.projectedRunOut, '2026-10-27');
  assert.equal(f.runOutBasis, 'scheduled');
  assert.equal(f.nextScheduled, '2026-10-20');
  assert.equal(f.status, 'runs_out');
});

test('pace earlier than the schedule: pace wins (projection = max of the two)', () => {
  const f = run(auth({ unitsApproved: 20, unitsUsed: 0 }), weekly(8).concat(weekly(8, '2026-10-13')), ['2026-12-01', '2026-12-15']);
  assert.equal(f.pacePerWeek, 2);
  assert.equal(f.remaining, 4);
  assert.equal(f.projectedRunOut, addCalendarDays(TODAY, 14));
  assert.equal(f.runOutBasis, 'pace');
});

test('scheduled visits after the end date are not in the window', () => {
  const f = run(auth({ endDate: d('2026-11-30') }), weekly(2), ['2026-11-20', '2026-12-05']);
  assert.equal(f.scheduledInWindow, 1);
});

test('all units used: runs out today', () => {
  const f = run(auth({ unitsApproved: 8, unitsUsed: 8 }), weekly(3));
  assert.equal(f.remaining, 0);
  assert.equal(f.projectedRunOut, TODAY);
  assert.equal(f.runOutBasis, 'used_up');
  assert.equal(f.status, 'runs_out');
  assert.equal(forecastInboxItem(f)?.priority, 'urgent');
});

// ─── Status thresholds ─────────────────────────────────────────────────────────

test('expired: end date before today wins over every other status', () => {
  const f = run(auth({ endDate: d('2026-10-10'), unitsUsed: 20 }));
  assert.equal(f.status, 'expired');
  assert.equal(f.atRisk, true);
  assert.equal(forecastInboxItem(f)?.priority, 'urgent');
});

test('expiring soon: end within lead time + 7 days (21 at the 14-day default)', () => {
  assert.equal(run(auth({ endDate: d(addCalendarDays(TODAY, 21)), unitsUsed: 1 })).status, 'expiring_soon');
  assert.equal(run(auth({ endDate: d(addCalendarDays(TODAY, 22)), unitsUsed: 1 })).status, 'on_track');
  assert.equal(run(auth({ endDate: d(TODAY), unitsUsed: 1 })).status, 'expiring_soon', 'ends today');
  // A 30-day payer lead time widens the window
  assert.equal(run(auth({ endDate: d(addCalendarDays(TODAY, 30)), unitsUsed: 1 }), [], [], null, { days: 30, source: 't' }).status, 'expiring_soon');
});

test('expiring soon even without usage data', () => {
  assert.equal(run(auth({ endDate: d(addCalendarDays(TODAY, 5)) })).status, 'expiring_soon');
});

test('run-out on the end date exactly is on track', () => {
  const f = run(auth({ unitsApproved: 10, unitsUsed: 8, endDate: d('2026-10-29') }), weekly(2), ['2026-10-20', '2026-10-29']);
  assert.equal(f.projectedRunOut, '2026-10-29');
  assert.equal(f.status, 'expiring_soon', 'no early run-out, but the end is within the lead time');
  const g = run(auth({ unitsApproved: 10, unitsUsed: 8, endDate: d('2026-12-29') }), [], ['2026-12-01', '2026-12-29']);
  assert.equal(g.projectedRunOut, '2026-12-29');
  assert.equal(g.status, 'on_track');
});

test('open-ended auth with a projection runs out', () => {
  const f = run(auth({ endDate: null, unitsApproved: 10 }), weekly(8));
  assert.equal(f.status, 'runs_out');
});

test('no approved count: no projection, no usage data', () => {
  const f = run(auth({ unitsApproved: 0 }), weekly(4));
  assert.equal(f.projectedRunOut, null);
  assert.equal(f.status, 'no_usage');
});

test('renewal due when today is past coverage end − lead time', () => {
  const f = run(auth({ unitsApproved: 10, unitsUsed: 8 }), weekly(8));
  assert.equal(f.renewalDue, true);
  assert.match(f.statusDetail, /Renewal due/);
});

test('treatment plan comparison: coverage ends before the plan review', () => {
  const f = run(auth({ endDate: d('2026-12-31'), unitsUsed: 1 }), [], [], { reviewDue: '2027-01-15', planEnd: null });
  assert.equal(f.coverageEndsBeforePlan, true);
  assert.match(f.statusDetail, /treatment plan review/);
  const g = run(auth({ endDate: d('2026-12-31'), unitsUsed: 1 }), [], [], { reviewDue: '2026-11-15', planEnd: null });
  assert.equal(g.coverageEndsBeforePlan, false);
});

test('summary counts and at-risk set', () => {
  const s = summarizeForecasts([
    run(auth({ endDate: d('2026-10-10') })),
    run(auth({ unitsUsed: 2 })),
    run(auth({ unitsApproved: 4, unitsUsed: 4 })),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.expired, 1);
  assert.equal(s.runs_out, 1);
  assert.equal(s.on_track, 1);
  assert.equal(s.atRisk, 2);
});

// ─── Service matching ──────────────────────────────────────────────────────────

test('service matching: CPT-specific auths count that service; any-service auths count all known visits', () => {
  const therapy = authServiceTypes(['90837']);
  assert.ok(visitMatchesAuth('therapy', therapy));
  assert.ok(!visitMatchesAuth('med_management', therapy));
  const any = authServiceTypes([]);
  assert.equal(any, null);
  assert.ok(visitMatchesAuth('other', any));
  assert.ok(!visitMatchesAuth('unknown', any));
  assert.ok(visitMatchesAuth('unknown', any, { scheduled: true }));
  assert.equal(authServiceTypes(['H2019'])?.size, 0, 'HCPCS-only: no visit matches');
  assert.ok(!visitMatchesAuth('other', authServiceTypes(['H2019'])));
});

// ─── Lead time ─────────────────────────────────────────────────────────────────

test('lead time: default 14, payer rule (PBHS unverified → default), env default and payer overrides', () => {
  assert.equal(renewalLeadTime('Aetna').days, DEFAULT_RENEWAL_LEAD_DAYS);
  const pbhs = renewalLeadTime('Maryland Medicaid PBHS');
  assert.equal(pbhs.days, 14);
  assert.match(pbhs.source, /Carelon/);
  assert.match(renewalLeadTime('Medicaid (MD)').source, /PBHS/);
  const cfg = leadTimeConfigFromEnv({ AUTH_RENEWAL_LEAD_DAYS: '10', AUTH_RENEWAL_LEAD_DAYS_BY_PAYER: '{"bcbs": 21, "bad": -3}' });
  assert.equal(renewalLeadTime('Aetna', cfg).days, 10);
  assert.equal(renewalLeadTime('PBHS', cfg).days, 10, 'unverified rule follows the practice default');
  assert.equal(renewalLeadTime('BCBS Maryland', cfg).days, 21);
  assert.equal(cfg.overrides?.bad, undefined);
  assert.deepEqual(leadTimeConfigFromEnv({ AUTH_RENEWAL_LEAD_DAYS: 'x', AUTH_RENEWAL_LEAD_DAYS_BY_PAYER: '{' }), {});
});

// ─── Renewal request ───────────────────────────────────────────────────────────

test('requested units from plan frequency over the same period length', () => {
  const f = run(auth({ startDate: d('2026-08-01'), endDate: d('2026-10-30'), unitsUsed: 10 }), weekly(8));
  const r = renewalRequest(f, { serviceFrequency: 'Weekly', expectedDuration: null });
  assert.equal(r.frequencySource, 'treatment_plan');
  assert.equal(r.periodStart, '2026-10-31');
  assert.equal(r.periodDays, 91);
  assert.equal(r.units, 13);
  const p = renewalRequest(f, null);
  assert.equal(p.frequencySource, 'pace');
  const e = renewalRequest(run(auth({ endDate: d('2026-10-01') })), { serviceFrequency: '2x/week', expectedDuration: null });
  assert.equal(e.periodStart, TODAY, 'expired auth: request starts today');
  assert.equal(e.visitsPerWeek, 2);
});

test('runs out early: additional units through the current end date', () => {
  const f = run(auth({ unitsApproved: 10, unitsUsed: 8 }), weekly(8));
  const r = renewalRequest(f, { serviceFrequency: 'Weekly', expectedDuration: null });
  assert.ok(r.additionalThroughCurrentEnd && r.additionalThroughCurrentEnd > 0);
});

// ─── Renewal marker ────────────────────────────────────────────────────────────

test('renewal drafted marker is read back from notes', () => {
  assert.equal(lastRenewalDrafted(`Psychotherapy ${renewalDraftedMarker('2026-09-01')} ${renewalDraftedMarker('2026-10-17')}`), '2026-10-17');
  assert.equal(lastRenewalDrafted(null), null);
  assert.equal(run(auth({ notes: renewalDraftedMarker('2026-10-01') })).renewalDraftedAt, '2026-10-01');
});

// ─── Draft ─────────────────────────────────────────────────────────────────────

function facts(): RenewalFacts {
  const f = run(auth({ unitsApproved: 10, unitsUsed: 8 }), weekly(8));
  return {
    forecast: f,
    request: renewalRequest(f, { serviceFrequency: 'Weekly', expectedDuration: null }),
    client: { name: 'Test Client Alpha', dateOfBirth: '1990-01-01', memberId: 'MEM-0001', mrn: 'MRN-1', clientId: 'c-1' },
    diagnoses: ['F41.1 Generalized anxiety disorder'],
    plan: { title: 'Plan A', reviewDue: '2026-12-01', levelOfCare: 'Outpatient' },
    goals: summarizeGoals(
      [{ text: 'Reduce worry', progress: 40 }, { text: 'Improve sleep', progress: 0 }],
      [
        { day: '2026-10-09', body: 'Goal 1: Reduce worry — No change' },
        { day: '2026-10-16', body: 'Active treatment plan: Plan A\nGoal 1: Reduce worry — Progress made — fewer episodes' },
      ]
    ),
    signedNotesInWindow: 8,
  };
}

type AuditEntry = Parameters<RenewalDraftDeps['audit']>[0];
function deps(over: Partial<RenewalDraftDeps> = {}) {
  const audits: AuditEntry[] = [];
  const calls: string[] = [];
  const dep: RenewalDraftDeps = {
    consent: async () => 'signed',
    aiAvailable: true,
    model: 'haiku-test',
    invoke: async (_s, u) => {
      calls.push(u);
      return 'The client has attended weekly sessions and shows progress.';
    },
    audit: async (e) => {
      audits.push(e);
    },
    ...over,
  };
  return { dep, audits, calls };
}

test('progress chips parsed from signed note text; newest note wins', () => {
  assert.deepEqual(parseProgressChips('Goal 2: Sleep — Regression — up at night'), [{ goalIndex: 1, goalText: 'Sleep', status: 'Regression' }]);
  const g = facts().goals;
  assert.deepEqual(g[0].latestChip, { status: 'Progress made', day: '2026-10-16' });
  assert.equal(g[0].progressPct, 40);
  assert.equal(g[1].latestChip, null);
});

test('AI prompt carries computed facts but no identifiers', () => {
  const p = buildRenewalPrompt(facts());
  assert.match(p, /F41\.1/);
  assert.match(p, /Reduce worry/);
  for (const id of ['Test Client Alpha', '1990-01-01', 'MEM-0001', 'MRN-1', 'A100', 'c-1']) assert.ok(!p.includes(id), id);
});

test('AI path: audit AI_ACCESS before the call; packet keeps identifiers and computed numbers', async () => {
  const { dep, audits, calls } = deps();
  const r = await draftRenewal(facts(), dep, TODAY);
  assert.equal(r.justificationSource, 'ai');
  assert.equal(calls.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'AI_ACCESS');
  assert.equal(audits[0].metadata.sentToModel, true);
  assert.match(r.text, /DRAFT FOR STAFF REVIEW/);
  assert.match(r.text, /Test Client Alpha/);
  assert.match(r.text, /Visits remaining: 2/);
  assert.match(r.text, /\[AI draft — review before use\]/);
  assert.equal(r.warning, null);
});

test('consent declined: nothing sent to the model, template only, DENIED audit', async () => {
  const { dep, audits, calls } = deps({ consent: async () => 'declined' });
  const r = await draftRenewal(facts(), dep, TODAY);
  assert.equal(calls.length, 0);
  assert.equal(r.justificationSource, 'template');
  assert.equal(r.fallbackReason, 'consent_declined');
  assert.equal(audits[0].outcome, 'DENIED');
  assert.equal(audits[0].metadata.sentToModel, false);
  assert.match(r.text, /Staff: add clinical rationale/);
});

test('consent missing: AI allowed with a warning', async () => {
  const { dep } = deps({ consent: async () => 'missing' });
  const r = await draftRenewal(facts(), dep, TODAY);
  assert.equal(r.justificationSource, 'ai');
  assert.match(r.warning ?? '', /consent/);
});

test('AI unavailable, failing or empty: template fallback', async () => {
  const off = deps({ aiAvailable: false });
  const a = await draftRenewal(facts(), off.dep, TODAY);
  assert.equal(a.fallbackReason, 'ai_unavailable');
  assert.equal(off.calls.length, 0);
  assert.equal(off.audits.length, 0, 'nothing sent, nothing to audit as AI access');

  const fail = await draftRenewal(facts(), deps({ invoke: async () => { throw new Error('throttled'); } }).dep, TODAY);
  assert.equal(fail.fallbackReason, 'ai_failed');
  assert.equal(fail.justificationSource, 'template');

  const empty = await draftRenewal(facts(), deps({ invoke: async () => '   ' }).dep, TODAY);
  assert.equal(empty.fallbackReason, 'ai_empty');
  assert.match(empty.text, /CLINICAL JUSTIFICATION/);
});

test('template justification states computed facts only', () => {
  const t = templateJustification(facts());
  assert.match(t, /attended 8 visits/);
  assert.match(t, /progress made as of/);
  assert.match(t, /weekly/i);
});

test('inbox item: runs-out title with date; on-track auths stay out', () => {
  const f = run(auth({ unitsApproved: 10, unitsUsed: 8 }), weekly(8));
  assert.match(forecastInboxItem(f)!.title, /projected to run out/);
  assert.equal(forecastInboxItem(run(auth({ unitsUsed: 1 }))), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SESSION_FREQUENCY_RULES,
  appointmentServiceType,
  assembleClientEvidence,
  authorizationNotes,
  buildSessionFrequencyItem,
  cadenceFactsFromEvidence,
  summarizeByClinician,
  computeServiceCadence,
  dayOf,
  redactLockedItem,
  resolveMedRecommendation,
  resolveTherapyRecommendation,
  serviceTypeForCpt,
  sessionFrequencyClientWhere,
  summarizeSessionFrequency,
  type AppointmentRow,
  type AuthInput,
  type ClientCadenceInput,
  type PlanInput,
  type Recommendation,
  type SessionFrequencyItem,
} from '../src/lib/clinical/sessionFrequency';

// Synthetic ids and names only; no real patient data.

/** Noon in the clinic (EDT) on 2026-10-17 */
const NOW = new Date('2026-10-17T16:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const weekly: Recommendation = resolveTherapyRecommendation([], [], NOW);
const rec = (key: 'weekly' | 'biweekly' | 'monthly'): Recommendation => ({
  ...weekly,
  key,
  label: SESSION_FREQUENCY_RULES[key].label,
  source: 'treatment_plan',
});
const therapyAt = (at: Date) => ({ at, serviceType: 'therapy' as const, source: 'appointment' as const });

function cadence(r: Recommendation, lastDaysAgo: number | null, nextInDays?: number) {
  return computeServiceCadence({
    recommendation: r,
    evidence: lastDaysAgo == null ? [] : [therapyAt(daysAgo(lastDaysAgo))],
    scheduled: nextInDays == null ? [] : [{ at: daysAhead(nextInDays), serviceType: 'therapy', appointmentId: 'apt-next' }],
    now: NOW,
  });
}

// ─── Overdue math ──────────────────────────────────────────────────────────────

test('weekly: 7 days due soon, 10 days still within grace, 11 days overdue by 1', () => {
  assert.equal(cadence(rec('weekly'), 6).status, 'on_track');
  assert.equal(cadence(rec('weekly'), 7).status, 'due_soon');
  assert.equal(cadence(rec('weekly'), 10).status, 'due_soon');
  const c = cadence(rec('weekly'), 11);
  assert.equal(c.status, 'overdue');
  assert.equal(c.daysOverdue, 1);
  assert.equal(c.daysSinceLast, 11);
  assert.equal(c.overdueAfter, '2026-10-16');
});

test('every 2 weeks: overdue after 17 days; monthly: overdue after 35 days', () => {
  assert.equal(cadence(rec('biweekly'), 17).status, 'due_soon');
  assert.equal(cadence(rec('biweekly'), 18).status, 'overdue');
  assert.equal(cadence(rec('monthly'), 35).status, 'due_soon');
  assert.equal(cadence(rec('monthly'), 36).status, 'overdue');
});

test('a session booked within the grace window clears the overdue alert', () => {
  assert.equal(cadence(rec('weekly'), 12, 2).status, 'scheduled');
  assert.equal(cadence(rec('weekly'), 12, 3).status, 'scheduled');
  const late = cadence(rec('weekly'), 12, 6);
  assert.equal(late.status, 'overdue');
  assert.equal(late.nextScheduled, dayOf(daysAhead(6)));
  // Due but booked before the overdue date
  assert.equal(cadence(rec('weekly'), 8, 1).status, 'scheduled');
});

test('no attended session: no_sessions, or scheduled when one is booked', () => {
  assert.equal(cadence(rec('weekly'), null).status, 'no_sessions');
  assert.equal(cadence(rec('weekly'), null, 20).status, 'scheduled');
});

test('actual cadence counts unique attended days in the last 8 weeks', () => {
  const c = computeServiceCadence({
    recommendation: rec('weekly'),
    evidence: [therapyAt(daysAgo(3)), therapyAt(daysAgo(3)), therapyAt(daysAgo(10)), therapyAt(daysAgo(70))],
    scheduled: [],
    now: NOW,
  });
  assert.equal(c.sessionsLast8Weeks, 2);
  assert.equal(c.sessionsPerWeek, 0.25);
  assert.equal(c.expectedLast8Weeks, 8);
});

test('days are clinic (New York) days, not UTC days', () => {
  // 10:30 PM EDT on Oct 6 is Oct 7 in UTC
  assert.equal(dayOf(new Date('2026-10-07T02:30:00Z')), '2026-10-06');
});

// ─── Service type separation ───────────────────────────────────────────────────

test('CPT classification: therapy vs med management (incl. telehealth suffixes and add-ons)', () => {
  for (const c of ['90832', '90834', '90837', '90837T', '90834-95', '90837 GT']) assert.equal(serviceTypeForCpt(c), 'therapy', c);
  for (const c of ['99212', '99213', '99214T', '99215', '90833', '90836']) assert.equal(serviceTypeForCpt(c), 'med_management', c);
  assert.equal(serviceTypeForCpt('90791'), 'other');
  assert.equal(serviceTypeForCpt(null), 'unknown');
});

test('appointment service type: claim CPT, then Valant code, then type text', () => {
  assert.equal(appointmentServiceType({ type: 'Individual Therapy' }), 'therapy');
  assert.equal(appointmentServiceType({ type: 'Medication Management' }), 'med_management');
  assert.equal(appointmentServiceType({ type: 'Appointment', notes: 'Valant code: 99214T' }), 'med_management');
  assert.equal(appointmentServiceType({ type: 'Appointment', notes: 'Valant code: 90837T' }), 'therapy');
  // E/M + psychotherapy add-on is med management even though the type says therapy
  assert.equal(appointmentServiceType({ type: 'Individual Therapy', claimCpts: ['99213', '90833'] }), 'med_management');
  assert.equal(appointmentServiceType({ type: 'Telehealth' }), 'unknown');
});

const appt = (over: Partial<AppointmentRow> & { startsAt: Date }): AppointmentRow => ({
  id: `apt-${over.startsAt.getTime()}`,
  type: 'Individual Therapy',
  notes: null,
  status: 'COMPLETED',
  claimCpts: [],
  ...over,
});

test('med-management visits never count toward weekly therapy cadence', () => {
  const built = assembleClientEvidence(
    {
      appointments: [
        appt({ startsAt: daysAgo(2), type: 'Medication Management' }),
        appt({ startsAt: daysAgo(4), type: 'Appointment', notes: 'Valant code: 99214T', status: 'SCHEDULED', claimCpts: ['99214'] }),
        appt({ startsAt: daysAgo(14) }),
      ],
      notes: [],
      charges: [],
    },
    NOW
  );
  const therapy = computeServiceCadence({ recommendation: weekly, ...built, now: NOW });
  assert.equal(therapy.lastAttended, dayOf(daysAgo(14)));
  assert.equal(therapy.status, 'overdue');
  const med = computeServiceCadence({
    recommendation: { ...rec('monthly'), serviceType: 'med_management' },
    ...built,
    now: NOW,
  });
  assert.equal(med.lastAttended, dayOf(daysAgo(2)));
  assert.equal(med.sessionsLast8Weeks, 2);
});

test('attended = checked in / in session / completed; cancelled, late cancel and no-show never count', () => {
  const built = assembleClientEvidence(
    {
      appointments: [
        appt({ startsAt: daysAgo(1), status: 'CANCELLED' }),
        appt({ startsAt: daysAgo(2), status: 'NO_SHOW' }),
        appt({ startsAt: daysAgo(3), status: 'LATE_CANCEL' }),
        appt({ startsAt: daysAgo(5), status: 'CHECKED_IN' }),
      ],
      notes: [],
      charges: [],
    },
    NOW
  );
  const c = computeServiceCadence({ recommendation: weekly, ...built, now: NOW });
  assert.equal(c.lastAttended, dayOf(daysAgo(5)));
});

test('past appointments still SCHEDULED are unconfirmed unless a claim, signed note or Valant charge proves them', () => {
  const built = assembleClientEvidence(
    {
      appointments: [
        appt({ startsAt: daysAgo(3), status: 'SCHEDULED', type: 'Appointment', notes: 'Valant code: 90837' }),
        appt({ startsAt: daysAgo(9), status: 'SCHEDULED', type: 'Appointment', notes: 'Valant code: 90837' }),
        appt({ startsAt: daysAgo(20), status: 'SCHEDULED', claimCpts: ['90834'] }),
        appt({ startsAt: daysAhead(4), status: 'SCHEDULED' }),
      ],
      notes: [],
      charges: [
        // Billed Valant charge on day -9 proves that visit
        { serviceDate: new Date(`${dayOf(daysAgo(9))}T12:00:00Z`), codeBase: '90837', billingId: 'B1', amountCents: 15000 },
        // Charged then reversed on day -3: does not count
        { serviceDate: new Date(`${dayOf(daysAgo(3))}T12:00:00Z`), codeBase: '90837', billingId: 'B2', amountCents: 15000 },
        { serviceDate: new Date(`${dayOf(daysAgo(3))}T12:00:00Z`), codeBase: '90837', billingId: 'B2', amountCents: -15000 },
      ],
    },
    NOW
  );
  assert.equal(built.unconfirmedPastAppointments, 1);
  assert.equal(built.scheduled.length, 1);
  const c = computeServiceCadence({ recommendation: weekly, ...built, now: NOW });
  assert.equal(c.lastAttended, dayOf(daysAgo(9)));
  assert.equal(c.sessionsLast8Weeks, 2);
});

test('signed notes with a therapy CPT count; unknown-type visits are reported, not counted', () => {
  const built = assembleClientEvidence(
    {
      appointments: [appt({ startsAt: daysAgo(6), type: 'Telehealth' }), appt({ startsAt: daysAgo(2), type: 'Telehealth' })],
      notes: [{ cptCode: '90834', dateOfService: new Date(`${dayOf(daysAgo(2))}T00:00:00Z`), createdAt: daysAgo(1) }],
      charges: [],
    },
    NOW
  );
  // Day -2 is covered by the signed note; day -6 has nothing that says what it was
  assert.equal(built.unknownTypeVisits, 1);
  const c = computeServiceCadence({ recommendation: weekly, ...built, now: NOW });
  assert.equal(c.lastAttended, dayOf(daysAgo(2)));
});

// ─── Recommendation source ─────────────────────────────────────────────────────

const plan = (over: Partial<PlanInput>): PlanInput => ({
  id: 'tp1',
  title: 'Depression plan',
  status: 'ACTIVE',
  createdAt: new Date('2026-09-01T12:00:00Z'),
  planType: 'Individual Therapy',
  serviceFrequency: 'Weekly',
  ...over,
});
const auth = (over: Partial<AuthInput>): AuthInput => ({
  id: 'pa1',
  authNumber: 'AUTH-1',
  payer: 'Test Payer',
  status: 'APPROVED',
  cptCodes: ['90834'],
  unitsApproved: 26,
  unitsUsed: 0,
  startDate: new Date('2026-01-01T12:00:00Z'),
  endDate: new Date('2026-12-31T12:00:00Z'),
  ...over,
});

test('treatment plan frequency wins and names the plan and its date', () => {
  const r = resolveTherapyRecommendation([plan({ serviceFrequency: 'Bi-weekly' })], [auth({})], NOW);
  assert.equal(r.source, 'treatment_plan');
  assert.equal(r.key, 'biweekly');
  assert.match(r.sourceDetail, /Every 2 weeks — from treatment plan "Depression plan" dated 2026-09-01/);
});

test('draft/closed plans and plans with no frequency are ignored; psychiatric plans only set med management', () => {
  const plans = [
    plan({ id: 'd', status: 'DRAFT', serviceFrequency: 'Monthly' }),
    plan({ id: 'n', serviceFrequency: '' }),
    plan({ id: 'p', planType: 'Psychiatric Medical', serviceFrequency: 'Monthly' }),
  ];
  const r = resolveTherapyRecommendation(plans, [], NOW);
  assert.equal(r.source, 'default');
  assert.match(r.sourceDetail, /Default: weekly individual therapy \(no plan frequency on file\)/);
  const med = resolveMedRecommendation(plans);
  assert.equal(med.key, 'monthly');
  assert.equal(med.sourceId, 'p');
  assert.equal(resolveMedRecommendation([]).key, null);
});

test('a plan with no plan type still sets therapy frequency and says the type is not set', () => {
  const r = resolveTherapyRecommendation([plan({ planType: '', serviceFrequency: 'Monthly' })], [], NOW);
  assert.equal(r.key, 'monthly');
  assert.match(r.sourceDetail, /plan type not set/);
});

test('"As needed" plan frequency is not tracked for overdue', () => {
  const r = resolveTherapyRecommendation([plan({ serviceFrequency: 'As needed' })], [], NOW);
  assert.equal(r.key, null);
  const c = computeServiceCadence({ recommendation: r, evidence: [therapyAt(daysAgo(90))], scheduled: [], now: NOW });
  assert.equal(c.status, 'not_tracked');
});

test('approved therapy authorization sets frequency; one without CPT codes is explained, not used', () => {
  const r = resolveTherapyRecommendation([], [auth({})], NOW);
  assert.equal(r.source, 'authorization');
  assert.equal(r.key, 'biweekly');
  assert.match(r.sourceDetail, /allows 26 visits 2026-01-01 to 2026-12-31/);

  const valant = auth({ cptCodes: [], authNumber: 'V-9' });
  assert.equal(resolveTherapyRecommendation([], [valant], NOW).source, 'default');
  assert.match(authorizationNotes([valant], NOW)[0], /no CPT codes on file — not used/);
  assert.equal(resolveTherapyRecommendation([], [auth({ status: 'SUBMITTED' })], NOW).source, 'default');
});

// ─── Count == list, buckets, scoping ───────────────────────────────────────────

function item(id: string, lastDaysAgo: number | null, assignedToId: string | null = 'u1', nextInDays?: number): SessionFrequencyItem {
  const input: ClientCadenceInput = {
    clientId: id,
    clientName: `Client ${id}`,
    locked: false,
    assignedToId,
    assignedToName: assignedToId ? 'Clinician One' : null,
    locationId: 'loc1',
    locationName: 'Bowie',
    riskLevel: 'LOW',
    plans: [],
    auths: [],
    evidence: lastDaysAgo == null ? [] : [therapyAt(daysAgo(lastDaysAgo))],
    scheduled: nextInDays == null ? [] : [{ at: daysAhead(nextInDays), serviceType: 'therapy', appointmentId: `n-${id}` }],
    unconfirmedPastAppointments: 0,
    unknownTypeVisits: 0,
    authNotes: [],
  };
  return buildSessionFrequencyItem(input, NOW);
}

test('summary counts are computed from the same items the list filters (count == list)', () => {
  const items = [
    item('a', 20),
    item('b', 14),
    item('c', 12, 'u1', 1), // overdue but booked → scheduled
    item('d', 3),
    item('e', 8),
    item('f', null),
    item('g', 30, null), // no clinician → unassigned
  ];
  const summary = summarizeSessionFrequency(items);
  for (const bucket of ['overdue', 'due_soon', 'scheduled', 'on_track', 'no_sessions', 'not_tracked', 'unassigned'] as const) {
    assert.equal(summary[bucket], items.filter((i) => i.bucket === bucket).length, bucket);
  }
  assert.equal(summary.overdue, 2);
  assert.equal(summary.unassigned, 1);
  assert.equal(summary.total, items.length);
  // Resolved: the overdue client attends, or gets booked inside the grace window
  assert.equal(item('a', 1).bucket, 'on_track');
  assert.equal(item('a', 20, 'u1', 2).bucket, 'scheduled');
});

test('caseload roles are scoped to their own active clients; leadership to org and location', () => {
  const caseload = JSON.stringify(
    sessionFrequencyClientWhere({ organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST' })
  );
  assert.match(caseload, /"assignedToId":"u1"/);
  assert.match(caseload, /"status":"ACTIVE"/);
  assert.match(caseload, /"organizationId":"org1"/);

  const director = JSON.stringify(
    sessionFrequencyClientWhere({ organizationId: 'org1', actorUserId: 'd1', actorRole: 'PRACTICE_DIRECTOR' }, { locationId: 'loc2' })
  );
  assert.doesNotMatch(director, /assignedToId/);
  assert.match(director, /"locationId":"loc2"/);
  assert.match(director, /"status":"ACTIVE"/);

  const one = JSON.stringify(
    sessionFrequencyClientWhere({ organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST' }, { clientId: 'c9' })
  );
  assert.match(one, /"id":"c9"/);
  assert.match(one, /"assignedToId":"u1"/);
});

test('protected records keep their alert status but lose dates and details', () => {
  const locked = { ...item('p', 20), locked: true, clientName: 'Protected Client' };
  const out = redactLockedItem(locked);
  assert.equal(out.bucket, 'overdue');
  assert.equal(out.therapy.lastAttended, null);
  assert.equal(out.therapy.nextScheduled, null);
  assert.equal(out.therapy.daysSinceLast, null);
  assert.deepEqual(out.dataNotes, []);
});

test('banner, alert list and chart card all read the one session-frequency hook (no hard-coded counts)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const clients = read('src/app/dashboard/clients/page.tsx');
  assert.doesNotMatch(clients, /\d+ clients overdue/);
  assert.match(clients, /useSessionFrequency\(/);
  assert.match(clients, /\/dashboard\/alerts\?tab=frequency/);
  assert.match(read('src/app/dashboard/alerts/page.tsx'), /useSessionFrequency\(/);
  assert.match(read('src/app/dashboard/alerts/page.tsx'), /get\('tab'\)/);
  assert.match(read('src/features/caseload/sessionFrequency.tsx'), /\/api\/clinical\/session-frequency/);
});

// ─── Summary (aggregates) vs detail (rows) ─────────────────────────────────────

test('summary path (pre-aggregated facts) gives the same buckets, dates and counts as the row path', () => {
  const fixtures: Array<{ id: string; assigned: string | null; plans: PlanInput[]; rows: Parameters<typeof assembleClientEvidence>[0] }> = [
    { id: 'c1', assigned: 'u1', plans: [], rows: { appointments: [appt({ startsAt: daysAgo(3) })], notes: [], charges: [] } },
    { id: 'c2', assigned: 'u1', plans: [], rows: { appointments: [appt({ startsAt: daysAgo(15) }), appt({ startsAt: daysAgo(2), type: 'Medication Management' })], notes: [], charges: [] } },
    { id: 'c3', assigned: 'u2', plans: [plan({ serviceFrequency: 'Bi-weekly' })], rows: { appointments: [appt({ startsAt: daysAgo(16) }), appt({ startsAt: daysAhead(2), status: 'SCHEDULED' })], notes: [], charges: [] } },
    { id: 'c4', assigned: 'u2', plans: [], rows: { appointments: [appt({ startsAt: daysAgo(40), status: 'SCHEDULED', type: 'Appointment', notes: 'Valant code: 90837T' })], notes: [], charges: [{ serviceDate: new Date(`${dayOf(daysAgo(40))}T12:00:00Z`), codeBase: '90837', billingId: 'B9', amountCents: 9000 }] } },
    { id: 'c5', assigned: null, plans: [], rows: { appointments: [], notes: [{ cptCode: '90834', dateOfService: new Date(`${dayOf(daysAgo(9))}T00:00:00Z`), createdAt: daysAgo(8) }], charges: [] } },
    { id: 'c6', assigned: 'u1', plans: [plan({ planType: 'Psychiatric Medical', serviceFrequency: 'Monthly' })], rows: { appointments: [appt({ startsAt: daysAhead(9), status: 'SCHEDULED' }), appt({ startsAt: daysAgo(1), status: 'NO_SHOW' })], notes: [], charges: [] } },
    { id: 'c7', assigned: 'u1', plans: [plan({ serviceFrequency: 'As needed' })], rows: { appointments: [appt({ startsAt: daysAgo(100) })], notes: [], charges: [] } },
  ];
  const base = (f: (typeof fixtures)[number]) => ({
    clientId: f.id,
    clientName: `Client ${f.id}`,
    locked: false,
    assignedToId: f.assigned,
    assignedToName: f.assigned ? `Clinician ${f.assigned}` : null,
    locationId: null,
    locationName: null,
    riskLevel: 'LOW',
    plans: f.plans,
    auths: [],
    authNotes: [],
  });
  const detail = fixtures.map((f) => {
    const built = assembleClientEvidence(f.rows, NOW);
    return buildSessionFrequencyItem({ ...base(f), ...built }, NOW);
  });
  const summaryItems = fixtures.map((f) => {
    const built = assembleClientEvidence(f.rows, NOW);
    const facts = {
      therapy: cadenceFactsFromEvidence(built.evidence, built.scheduled, 'therapy', NOW),
      med_management: cadenceFactsFromEvidence(built.evidence, built.scheduled, 'med_management', NOW),
    };
    return buildSessionFrequencyItem(
      { ...base(f), evidence: [], scheduled: [], unconfirmedPastAppointments: 0, unknownTypeVisits: 0, facts },
      NOW
    );
  });
  const key = (i: SessionFrequencyItem) => ({
    bucket: i.bucket,
    therapy: { ...i.therapy },
    med: { ...i.medManagement },
  });
  assert.deepEqual(summaryItems.map(key), detail.map(key));
  assert.deepEqual(summarizeSessionFrequency(summaryItems), summarizeSessionFrequency(detail));
  // Per-clinician counts add up to the summary minus unassigned
  const byClin = summarizeByClinician(summaryItems);
  const total = byClin.reduce((n, r) => n + r.total, 0);
  assert.equal(total, summaryItems.length - summarizeSessionFrequency(summaryItems).unassigned);
  assert.deepEqual(byClin, summarizeByClinician(detail));
});

test('the aggregate SQL uses the same CPT/status constants and falls back to rows on failure', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/lib/clinical/sessionFrequencyData.ts'), 'utf8');
  for (const name of ['THERAPY_CPT', 'MED_MANAGEMENT_CPT', 'ATTENDED_APPOINTMENT_STATUSES', 'CLINIC_TIME_ZONE', 'CADENCE_WINDOW_DAYS']) {
    assert.ok(src.includes(`[...${name}]`) || src.includes(name), name);
  }
  assert.match(src, /falling back to row reads/);
  // No per-client queries in the org-wide path
  assert.doesNotMatch(src.slice(src.indexOf('async function loadSessionFrequencySummary')), /for \(const .* of clients\)[\s\S]*await prisma/);
});

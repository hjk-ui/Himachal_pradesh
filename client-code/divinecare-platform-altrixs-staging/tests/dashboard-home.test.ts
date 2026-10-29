import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { practiceDayBounds, practiceTodayBounds } from '../src/lib/dashboard/practiceDay';
import { practiceMonthStart } from '../src/lib/dashboard/practiceMonth';
import { buildScheduleRows, scheduleCounts, type RawScheduleAppointment } from '../src/lib/dashboard/todaySchedule';
import { buildCaseloadInsights, buildCaseloadTiles, type CaseloadMetrics, type HomeAccess } from '../src/lib/dashboard/homeTiles';
import { populationClientWhere } from '../src/lib/reports/populationHealth';
import type { ReportScope } from '../src/lib/reports/outcomesReports';

const ROOT = path.join(__dirname, '..');
const ET = 'America/New_York';
const H = 3_600_000;

// ─── Practice-day window ───────────────────────────────────────────────────────

test('today window is practice midnight to midnight in UTC, across the Nov 1 2026 DST change', () => {
  const oct31 = practiceDayBounds('2026-10-31', ET);
  assert.equal(oct31.start.toISOString(), '2026-10-31T04:00:00.000Z');
  assert.equal(oct31.end.toISOString(), '2026-11-01T04:00:00.000Z');

  // Fall back: Nov 1 is 25 hours long (EDT midnight -> EST midnight)
  const nov1 = practiceDayBounds('2026-11-01', ET);
  assert.equal(nov1.start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(nov1.end.toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(nov1.end.getTime() - nov1.start.getTime(), 25 * H);

  const nov2 = practiceDayBounds('2026-11-02', ET);
  assert.equal(nov2.start.toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(nov2.end.getTime() - nov2.start.getTime(), 24 * H);

  // Spring forward: Mar 8 2026 is 23 hours long
  const mar8 = practiceDayBounds('2026-03-08', ET);
  assert.equal(mar8.end.getTime() - mar8.start.getTime(), 23 * H);
});

test('"today" follows the practice clock, not server UTC or the browser', () => {
  // 10:30 PM EST on Nov 1 is already Nov 2 in UTC
  const late = practiceTodayBounds(ET, new Date('2026-11-02T03:30:00Z'));
  assert.equal(late.ymd, '2026-11-01');
  assert.ok(late.start.getTime() <= Date.parse('2026-11-02T03:30:00Z') && Date.parse('2026-11-02T03:30:00Z') < late.end.getTime());
  // 8 PM EDT Oct 18 = Oct 19 00:00 UTC: still Oct 18 on the practice clock
  assert.equal(practiceTodayBounds(ET, new Date('2026-10-19T00:00:00Z')).ymd, '2026-10-18');
  // A Valant visit at 9:00 AM ET (13:00 UTC) is inside Oct 19; 11 PM ET Oct 18 (03:00 UTC Oct 19) is not
  const oct19 = practiceDayBounds('2026-10-19', ET);
  const inWin = (iso: string) => Date.parse(iso) >= oct19.start.getTime() && Date.parse(iso) < oct19.end.getTime();
  assert.equal(inWin('2026-10-19T13:00:00Z'), true);
  assert.equal(inWin('2026-10-19T03:00:00Z'), false);
  // Another practice zone
  assert.equal(practiceDayBounds('2026-10-19', 'America/Los_Angeles').start.toISOString(), '2026-10-19T07:00:00.000Z');
});

test('MTD starts at practice midnight on the 1st', () => {
  assert.equal(practiceMonthStart(ET, new Date('2026-11-15T12:00:00Z')).toISOString(), '2026-11-01T04:00:00.000Z');
  // 9 PM ET Oct 31 (Nov 1 01:00 UTC) is still October
  assert.equal(practiceMonthStart(ET, new Date('2026-11-01T01:00:00Z')).toISOString(), '2026-10-01T04:00:00.000Z');
});

// ─── Schedule rows ──────────────────────────────────────────────────────────

function appt(id: string, over: Partial<RawScheduleAppointment> = {}): RawScheduleAppointment {
  return {
    id,
    clientId: `c-${id}`,
    clientName: `Client ${id}`,
    sensitiveAlias: null,
    isSensitive: false,
    locked: false,
    clinicianId: 'u1',
    clinicianName: 'Dr One',
    type: 'Psychotherapy',
    startsAt: new Date('2026-10-19T13:00:00Z'),
    endsAt: new Date('2026-10-19T13:53:00Z'),
    status: 'SCHEDULED',
    isVirtual: false,
    locationId: 'loc1',
    locationName: 'Bowie',
    locationInferred: true,
    label: null,
    ...over,
  };
}

test('schedule: cancelled left out, sorted by start, practice times, counts', () => {
  const rows = buildScheduleRows(
    [
      appt('b', { startsAt: new Date('2026-10-19T15:00:00Z'), endsAt: new Date('2026-10-19T16:00:00Z'), status: 'CHECKED_IN', isVirtual: true }),
      appt('a', { status: 'COMPLETED' }),
      appt('x', { status: 'CANCELLED' }),
      appt('c', { startsAt: new Date('2026-10-19T17:00:00Z'), status: 'NO_SHOW' }),
      appt('d', { startsAt: new Date('2026-10-19T18:00:00Z'), status: 'LATE_CANCEL' }),
      appt('e', { startsAt: new Date('2026-10-19T19:00:00Z'), status: 'IN_SESSION' }),
      appt('f', { startsAt: new Date('2026-10-19T20:00:00Z') }),
    ],
    ET
  );
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(rows[0].startTime, '09:00');
  assert.equal(rows[0].endTime, '09:53');
  assert.equal(rows[1].status, 'checked-in');
  assert.equal(rows[1].isVirtual, true);
  assert.deepEqual(scheduleCounts(rows), { total: 6, checkedIn: 1, inSession: 1, completed: 1, noShow: 1, lateCancel: 1, remaining: 2 });
});

test('schedule: protected records show the alias; locked ones hide chart link, visit type and label', () => {
  const label = { id: 'l1', name: 'New', displayName: 'New', color: '#000', textColor: '#fff', meaning: 'new' } as never;
  const [open, locked] = buildScheduleRows(
    [
      appt('p', { isSensitive: true, sensitiveAlias: 'Client P-17', label }),
      appt('q', { isSensitive: true, sensitiveAlias: null, locked: true, type: 'SUD Group', label, startsAt: new Date('2026-10-19T14:00:00Z') }),
    ],
    ET
  );
  assert.equal(open.clientName, 'Client P-17');
  assert.equal(open.clientId, 'c-p');
  assert.ok(open.label);
  assert.equal(locked.clientName, 'Protected record');
  assert.equal(locked.clientId, null);
  assert.equal(locked.type, 'Protected appointment');
  assert.equal(locked.label, null);
});

// ─── Caseload tiles / insights ──────────────────────────────────────────────

const metrics = (over: Partial<CaseloadMetrics> = {}): CaseloadMetrics => ({
  scope: 'caseload',
  activeClients: 40,
  hiddenSensitiveClients: 0,
  risk: { high: 5, moderate: 6, low: 20, unknown: 9 },
  therapyOverdue: 3,
  medOverdue: 2,
  noVisit30: 7,
  noVisit60: 4,
  measurementDue: 12,
  highNoSafetyPlan: 5,
  phq9SevereUnacked: 0,
  unsignedNotes: 2,
  unsignedDeadlineHours: 24,
  sudSignals: 1,
  prescriber: null,
  ...over,
});
const therapistAccess: HomeAccess = { population: true, alerts: true, inbox: true, labsPath: null, sudRadar: true, clinical: true };
const peerAccess: HomeAccess = { population: false, alerts: false, inbox: true, labsPath: null, sudRadar: false, clinical: false };

test('caseload tiles: real counts with their list links; unavailable sources are left out, never 0', () => {
  const tiles = buildCaseloadTiles(metrics(), therapistAccess);
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  assert.equal(by.active.value, 40);
  assert.equal(by.risk_high.value, 5);
  assert.equal(by.risk_high.href, '/dashboard/population?list=tier%3Ahigh');
  assert.equal(by.risk_unknown.value, 9);
  assert.equal(by.high_no_safety_plan.href, '/dashboard/population?list=action%3Ahigh_no_safety_plan');
  assert.equal(by.therapy_overdue.href, '/dashboard/alerts?tab=frequency');
  assert.equal(by.measurement_due.href, '/dashboard/population?list=action%3Anot_measured_90');
  assert.equal(by.unsigned_notes.href, '/dashboard/inbox?section=unsigned_notes');
  assert.equal(by.med_overdue, undefined, 'med-management tile is for prescribers only');
  for (const t of tiles) assert.ok(t.source.length > 20, `${t.key} has a source`);

  const noCadence = buildCaseloadTiles(metrics({ therapyOverdue: null, unsignedNotes: null, sudSignals: null }), therapistAccess);
  for (const k of ['therapy_overdue', 'unsigned_notes', 'sud_signals']) {
    assert.equal(noCadence.some((t) => t.key === k), false, `${k} omitted when its source is unavailable`);
  }
  // Location filter is carried into the list link
  assert.equal(buildCaseloadTiles(metrics({ scope: 'organization' }), therapistAccess, 'loc9').find((t) => t.key === 'risk_high')?.href, '/dashboard/population?list=tier%3Ahigh&location=loc9');
});

test('prescriber tiles: refills, labs, monitoring; PDMP only when the PDMP feed is live', () => {
  const p = {
    rxRequests: 3, rxNotice: null, labResultsToReview: 4, labResultsCritical: 1, standingOverdue: 2, standingDueSoon: 1,
    monitoringOverdue: 2, monitoredClients: 9, pdmpDue: null, controlledClients: 5,
  };
  const access = { ...therapistAccess, labsPath: '/dashboard/ehr/labs' };
  const keys = buildCaseloadTiles(metrics({ prescriber: p }), access).map((t) => t.key);
  for (const k of ['med_overdue', 'rx_requests', 'lab_results', 'standing_labs', 'monitoring_overdue']) assert.ok(keys.includes(k), k);
  assert.equal(keys.includes('pdmp_due'), false);
  assert.ok(buildCaseloadTiles(metrics({ prescriber: { ...p, pdmpDue: 2 } }), access).some((t) => t.key === 'pdmp_due'));
  const insights = buildCaseloadInsights(metrics({ prescriber: p }), access);
  assert.equal(insights[0].severity, 'critical');
  assert.ok(insights.some((i) => i.id === 'lab_critical' && i.href === '/dashboard/inbox?section=lab_results'));
});

test('peer support sees no clinical risk or measurement tiles', () => {
  const keys = buildCaseloadTiles(metrics(), peerAccess).map((t) => t.key);
  for (const k of ['risk_high', 'risk_unknown', 'high_no_safety_plan', 'measurement_due', 'sud_signals', 'unsigned_notes']) {
    assert.equal(keys.includes(k), false, k);
  }
  assert.ok(keys.includes('active') && keys.includes('therapy_overdue') && keys.includes('no_visit_30'));
  assert.equal(buildCaseloadTiles(metrics(), peerAccess).find((t) => t.key === 'therapy_overdue')?.href, '/dashboard/inbox?section=session_frequency');
  const ids = buildCaseloadInsights(metrics(), peerAccess).map((i) => i.id);
  assert.equal(ids.includes('high_no_safety_plan'), false);
});

test('insights are rule statements over non-zero counts only', () => {
  const insights = buildCaseloadInsights(metrics({ phq9SevereUnacked: 0, sudSignals: 0 }), therapistAccess);
  const by = Object.fromEntries(insights.map((i) => [i.id, i]));
  assert.equal(by.high_no_safety_plan.text, '5 high-risk clients have no safety plan on file.');
  assert.equal(by.phq9_severe, undefined);
  assert.equal(by.sud_signals, undefined);
  assert.equal(by.measurement_due.text, '12 of 40 active clients have no PHQ-9 or GAD-7 in 90 days.');
  for (const i of insights) {
    assert.ok(i.basis.length > 0);
    assert.doesNotMatch(i.text, /\bAI\b|predict|likely|may benefit|recommend/i);
  }
  assert.deepEqual(buildCaseloadInsights(metrics({ risk: { high: 0, moderate: 0, low: 0, unknown: 0 }, therapyOverdue: 0, medOverdue: 0, noVisit60: 0, measurementDue: 0, highNoSafetyPlan: 0, unsignedNotes: 0, sudSignals: 0 }), therapistAccess), []);
});

// ─── Scoping ──────────────────────────────────────────────────────────────────

test('caseload roles are scoped to their assigned clients; leadership to the org', () => {
  const scope = (role: string): ReportScope => ({ organizationId: 'org1', userId: 'u7', role, locationId: null, clinicianId: null, lockedClientIds: ['locked1'], facilityTerm: null });
  const therapist = JSON.stringify(populationClientWhere(scope('THERAPIST')));
  assert.match(therapist, /"assignedToId":"u7"/);
  assert.match(therapist, /"notIn":\["locked1"\]/);
  for (const role of ['PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT']) {
    assert.match(JSON.stringify(populationClientWhere(scope(role))), /"assignedToId":"u7"/, role);
  }
  assert.doesNotMatch(JSON.stringify(populationClientWhere(scope('ADMIN'))), /assignedToId/);
});

test('home endpoint: org gate, caseload schedule scope, no location override for caseload roles, audited counts', () => {
  const route = fs.readFileSync(path.join(ROOT, 'src/app/api/dashboard/home/route.ts'), 'utf8');
  assert.match(route, /requireOrgContext\(\)/);
  assert.match(route, /auditPhiAccess\(/);
  assert.match(route, /action: 'LIST'/);
  assert.doesNotMatch(route, /clientId|patientId/);
  const data = fs.readFileSync(path.join(ROOT, 'src/lib/dashboard/homeData.ts'), 'utf8');
  // Same rule as listAppointments: own visits plus care-team clients' visits (primary care: assigned)
  assert.match(data, /if \(caseload\) \{\s*and\.push\(\{\s*OR: \[\s*\{ clinicianId: v\.userId \},\s*\{ client: isMedicalRole\(v\.role\) \? \{ assignedToId: v\.userId \} : careTeamClientWhereForRole\(v\.userId, v\.role, now\) \}/);
  assert.match(data, /isCaseloadScoped\(\{ role: v\.role, userId: v\.userId, organizationId: v\.organizationId \}\)\) return null;/);
  assert.match(data, /status: \{ not: 'CANCELLED' \}/);
  assert.match(data, /practiceTodayBounds\(timeZone, now\)/);
});

// ─── No demo / hard-coded values on the homes ───────────────────────────────

test('dashboard home components carry no demo badges, sample data or hard-coded tile numbers', () => {
  const dir = path.join(ROOT, 'src/features/dashboard/components');
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), path.join(ROOT, 'src/app/dashboard/page.tsx')];
  assert.equal(fs.existsSync(path.join(dir, 'PersonalizeHomeWidgets.tsx')), false);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(src, /demoMode|\bDEMO\b|Math\.random|sampleData|SAMPLE_|DEMO_/, rel);
    assert.doesNotMatch(src, /value="\d+"|value=\{['"`]\d+['"`]\}/, `${rel}: hard-coded tile value`);
    assert.doesNotMatch(src, /value=\{String\(feed\.clients\.length\)\}/, `${rel}: capped list length as a count`);
    assert.doesNotMatch(src, /'assessment-due'/, `${rel}: unscoped module blob`);
    assert.doesNotMatch(src, /stress \?\? \d/, `${rel}: invented default`);
    assert.doesNotMatch(src, /PersonalizeHomeWidgets|personalize\/caseload-insights/, rel);
  }
});

// ─── Amazon Personalize ──────────────────────────────────────────────────────

test('Personalize without a campaign returns available:false and no items', async () => {
  const saved = { a: process.env.AWS_PERSONALIZE_CAMPAIGN_ARN, b: process.env.PERSONALIZE_CAMPAIGN_ARN };
  delete process.env.AWS_PERSONALIZE_CAMPAIGN_ARN;
  delete process.env.PERSONALIZE_CAMPAIGN_ARN;
  try {
    const { getCaseloadInsights } = await import('../src/lib/aws/personalize');
    const r = await getCaseloadInsights({ organizationId: 'org1', actorUserId: 'u1', actorRole: 'THERAPIST' as never });
    assert.equal(r.available, false);
    assert.equal('items' in r, false);
  } finally {
    if (saved.a !== undefined) process.env.AWS_PERSONALIZE_CAMPAIGN_ARN = saved.a;
    if (saved.b !== undefined) process.env.PERSONALIZE_CAMPAIGN_ARN = saved.b;
  }
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/aws/personalize.ts'), 'utf8');
  assert.doesNotMatch(src, /demoMode|buildInsightsFromCaseload|score: 0\.\d/);
});

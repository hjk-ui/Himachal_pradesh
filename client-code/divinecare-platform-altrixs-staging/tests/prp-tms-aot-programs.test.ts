import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  billingSummaryReport,
  enrolledDuring,
  goalsByNeed,
  groupAttendanceReport,
  hubStats,
  irpFromWorkflow,
  irpReviewState,
  monthBounds,
  monthlyProgressReport,
  morsReport,
  parseServiceDate,
  planAttendanceWrites,
  REPORT_COLUMNS,
  toCsv,
  transitionReport,
  type AttendanceRow,
  type EnrollmentRow,
  type IrpSummary,
} from '../src/lib/prp/reports';
import { PRP_BILLING_SOURCES, PRP_UNIT_RULE_CONFIRMED, PRP_UNIT_RULE_LABEL, MORS_LEVELS } from '../src/lib/prp/billingRule';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function enrollment(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1', clientId: 'c1', clientName: 'Alpha Client', displayId: 'PRP-1001', status: 'active',
    startDate: d('2026-09-01'), createdAt: d('2026-09-01'), statusChangedAt: null, dischargedAt: null,
    dischargeReason: null, specialistId: 'u1', specialistName: 'Spec One', diagnosisCode: 'F20.9', ...over,
  };
}
function att(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return { id: Math.random().toString(36).slice(2), enrollmentId: 'e1', clientId: 'c1', groupId: 'g1', serviceDate: d('2026-10-05'), minutes: 60, serviceType: 'group', billable: true, ...over };
}

// ─── Attendance capture ─────────────────────────────────────────────────────

test('group roster submission is idempotent: re-submit updates, untick removes', () => {
  const input = {
    serviceDate: '2026-10-05', serviceType: 'group' as const, groupId: 'g1',
    entries: [
      { enrollmentId: 'e1', present: true },
      { enrollmentId: 'e2', present: false },
      { enrollmentId: 'e3', present: true },
    ],
  };
  const first = planAttendanceWrites(input, []);
  assert.deepEqual(first.creates.map((e) => e.enrollmentId), ['e1', 'e3']);
  assert.equal(first.updates.length, 0);
  assert.equal(first.deletes.length, 0);
  // Same roster again with e1 already saved and e2 saved earlier but now unticked
  const again = planAttendanceWrites(input, [{ id: 'a1', enrollmentId: 'e1' }, { id: 'a2', enrollmentId: 'e2' }]);
  assert.deepEqual(again.creates.map((e) => e.enrollmentId), ['e3']);
  assert.deepEqual(again.updates.map((e) => e.id), ['a1']);
  assert.deepEqual(again.deletes, ['a2']);
});

test('individual / community services always add a row per present entry', () => {
  const plan = planAttendanceWrites(
    { serviceDate: '2026-10-05', serviceType: 'individual', entries: [{ enrollmentId: 'e1', present: true }] },
    [{ id: 'a1', enrollmentId: 'e1' }],
  );
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('service dates must be real calendar dates; months bound in UTC', () => {
  assert.equal(parseServiceDate('2026-02-30'), null);
  assert.equal(parseServiceDate('10/05/2026'), null);
  assert.equal(parseServiceDate('2026-10-05')?.toISOString(), '2026-10-05T00:00:00.000Z');
  const { start, end } = monthBounds('2026-12');
  assert.equal(start.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('recordAttendance validates scope, group, future dates and duplicates before writing', () => {
  const src = read('src/lib/prp/program.ts');
  const block = src.slice(src.indexOf('export async function recordAttendance'), src.indexOf('export async function deleteAttendance'));
  assert.match(block, /cannot be recorded for a future date/);
  assert.match(block, /requireEnrollment\(actor, id\)/);
  assert.match(block, /prisma\.prpGroup\.findFirst\(\{ where: \{ id: input\.groupId, organizationId: actor\.organizationId \}/);
  assert.match(block, /once per submission/);
  assert.match(block, /\$transaction/);
});

// ─── Report aggregation ─────────────────────────────────────────────────────

const ENROLLMENTS = [
  enrollment(),
  enrollment({ id: 'e2', clientId: 'c2', clientName: 'Beta Client', displayId: 'PRP-1002', specialistId: null, specialistName: null }),
  enrollment({ id: 'e3', clientId: 'c3', clientName: 'Gamma Client', status: 'discharged', statusChangedAt: d('2026-10-10'), dischargedAt: d('2026-10-10'), dischargeReason: 'Goals met' }),
  enrollment({ id: 'e4', clientId: 'c4', clientName: 'Delta Future', startDate: d('2026-11-03'), createdAt: d('2026-10-20') }),
];
const ATTENDANCE = [
  att({ serviceDate: d('2026-10-05') }),
  att({ serviceDate: d('2026-10-07'), billable: false }),
  att({ serviceDate: d('2026-10-08'), serviceType: 'individual', groupId: null, minutes: null }),
  att({ enrollmentId: 'e2', clientId: 'c2', serviceDate: d('2026-10-05') }),
  att({ enrollmentId: 'e2', clientId: 'c2', serviceDate: d('2026-09-28'), groupId: 'g2' }),
  att({ enrollmentId: 'e3', clientId: 'c3', serviceDate: d('2026-10-07'), groupId: 'g1' }),
];

test('monthly progress counts encounters per participant from stored rows only', () => {
  const irps = new Map<string, IrpSummary>([
    ['c1', { clientId: 'c1', status: 'final', effectiveDate: d('2026-09-15'), reviewDueDate: d('2027-03-15'), goals: [{ need: 'Housing', targetDate: '2026-10-01' }, { need: 'Occupational', targetDate: '2027-01-01' }], recommendedDomains: [] }],
  ]);
  const rows = monthlyProgressReport({ month: '2026-10', enrollments: ENROLLMENTS, attendance: ATTENDANCE, irps, mors: [{ enrollmentId: 'e1', month: '2026-10', rating: 6 }] });
  // e4 starts in November: not in the October report
  assert.deepEqual(rows.map((r) => r.participant), ['Alpha Client', 'Beta Client', 'Gamma Client']);
  const a = rows.find((r) => r.enrollmentId === 'e1')!;
  assert.equal(a.encounters, 3);
  assert.equal(a.billableEncounters, 2);
  assert.equal(a.groupEncounters, 2);
  assert.equal(a.individualEncounters, 1);
  assert.equal(a.minutes, 120);
  assert.equal(a.lastServiceDate, '2026-10-08');
  assert.equal(a.irpStatus, 'final');
  assert.equal(a.irpGoals, 2);
  assert.equal(a.goalsPastTargetDate, 1);
  assert.equal(a.morsRating, 6);
  const b = rows.find((r) => r.enrollmentId === 'e2')!;
  assert.equal(b.encounters, 1, 'September encounter is not counted in October');
  assert.equal(b.irpStatus, null);
  assert.equal(b.morsRating, null);
});

test('group attendance aggregates by group and month', () => {
  const rows = groupAttendanceReport({ month: '2026-10', groups: [{ id: 'g1', name: 'Coping Skills', active: true }], attendance: ATTENDANCE });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, 'Coping Skills');
  assert.equal(rows[0].sessionsHeld, 2);
  assert.equal(rows[0].attendances, 4);
  assert.equal(rows[0].uniqueParticipants, 3);
  assert.equal(rows[0].avgPerSession, 2);
  assert.deepEqual(rows[0].dates, ['2026-10-05', '2026-10-07']);
});

test('billing summary reports encounters, never units, and carries the unconfirmed rule label', () => {
  const r = billingSummaryReport({ month: '2026-10', enrollments: ENROLLMENTS, attendance: ATTENDANCE });
  assert.equal(r.unitRuleConfirmed, false);
  assert.equal(r.unitRuleLabel, 'H2017 unit rule needs confirmation');
  assert.ok(r.rows.every((x) => x.units === null));
  assert.equal(r.totals.encounters, 5);
  assert.equal(r.totals.billableEncounters, 4);
  const a = r.rows.find((x) => x.enrollmentId === 'e1')!;
  assert.equal(a.nonBillableEncounters, 1);
  assert.equal(a.serviceDays, 3);
  assert.equal(PRP_UNIT_RULE_CONFIRMED, false);
  assert.equal(PRP_UNIT_RULE_LABEL, 'H2017 unit rule needs confirmation');
  assert.ok(PRP_BILLING_SOURCES.every((s) => /^https:\/\/[a-z.]*optum\.com\//.test(s.url)));
});

test('transition report lists status changes in the month and current transitions', () => {
  const rows = transitionReport({
    month: '2026-10',
    enrollments: [...ENROLLMENTS, enrollment({ id: 'e5', clientId: 'c5', clientName: 'Echo Client', status: 'transitioning', statusChangedAt: d('2026-08-01') })],
  });
  assert.deepEqual(rows.map((r) => r.enrollmentId), ['e5', 'e3']);
  assert.equal(rows.find((r) => r.enrollmentId === 'e3')!.dischargeReason, 'Goals met');
});

test('MORS report says "not recorded yet" rather than inventing a rating', () => {
  const r = morsReport({ month: '2026-10', enrollments: ENROLLMENTS, mors: [] });
  assert.equal(r.recorded, 0);
  assert.ok(r.rows.every((x) => x.rating === null && x.level === 'Not recorded yet'));
  assert.equal(MORS_LEVELS.length, 8);
});

test('enrollment window, IRP review state and IRP goal parsing', () => {
  assert.equal(enrolledDuring(enrollment({ dischargedAt: d('2026-09-15') }), '2026-10'), false);
  assert.equal(enrolledDuring(enrollment(), '2026-10'), true);
  const now = d('2026-10-17');
  assert.equal(irpReviewState(null, now), 'none');
  assert.equal(irpReviewState(d('2026-10-01'), now), 'overdue');
  assert.equal(irpReviewState(d('2026-11-01'), now), 'due_30');
  assert.equal(irpReviewState(d('2027-01-01'), now), 'ok');
  const irp = irpFromWorkflow({
    clientId: 'c1',
    irpData: { status: 'draft', nextIRPReviewDate: '2026-12-01', goals: [{ need: 'Housing', longTermGoal: 'x', targetDate: '' }, { need: '', longTermGoal: '', shortTermGoal: '' }] },
    irpEffectiveDate: null,
    irpReviewDueDate: null,
    recommendedDomains: ['Social'],
  });
  assert.equal(irp.status, 'draft');
  assert.equal(irp.goals.length, 1, 'blank goal rows are not counted');
  assert.equal(irp.reviewDueDate?.toISOString().slice(0, 10), '2026-12-01');
  assert.deepEqual(goalsByNeed([irp]), [{ need: 'Housing', goals: 1, finalGoals: 0, participants: 1 }]);
  assert.equal(irpFromWorkflow({ clientId: 'c9', irpData: {}, irpEffectiveDate: null, irpReviewDueDate: null, recommendedDomains: [] }).status, null);
});

test('hub stats are counts of stored rows', () => {
  const s = hubStats({ enrollments: ENROLLMENTS, attendance: ATTENDANCE, referralsAwaiting: 2, irps: new Map(), month: '2026-10', now: d('2026-10-17') });
  assert.equal(s.activeParticipants, 3);
  assert.equal(s.encountersThisMonth, 5);
  assert.equal(s.participantsServedThisMonth, 3);
  assert.equal(s.referralsAwaiting, 2);
  assert.equal(s.activeWithoutFinalIrp, 3);
});

test('CSV export escapes quotes and guards against formula injection', () => {
  const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '=HYPERLINK("x")', b: 'Smith, "Jo"' }], ['Title']);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Title');
  assert.equal(lines[1], 'A,B');
  assert.equal(lines[2], `"'=HYPERLINK(""x"")","Smith, ""Jo"""`);
  for (const cols of Object.values(REPORT_COLUMNS)) assert.ok(cols.length >= 4);
});

// ─── Scoping, gates, audit ──────────────────────────────────────────────────

test('PRP data access is org + caseload scoped and drops protected records', () => {
  const src = read('src/lib/prp/program.ts');
  assert.match(src, /organizationId: actor\.organizationId,\s*OR: \[\{ specialistId: actor\.actorUserId \}, \{ client: clientAccessWhere\(actor\) \}\]/);
  assert.match(src, /lockedSensitiveClientIds\(/);
  for (const m of src.matchAll(/prisma\.(prp(?:Attendance|Group|MorsRating|Enrollment|Referral))\.(findMany|findFirst|count|deleteMany)\(\{\s*where:\s*(\{[^;]*?\}),?\s*(?:orderBy|select|take|include|\}\))/g)) {
    assert.match(m[3], /organizationId|enrollmentScopeWhere/, `unscoped ${m[1]}.${m[2]}`);
  }
  // PrpWorkflow has no organizationId: it is only read for clients already in scope
  assert.match(src, /loadIrps\(clientIds: string\[\]\)/);
});

test('every new PRP route uses the PRP gate and writes an audit entry', () => {
  const routes = ['hub', 'groups', 'groups/[id]', 'attendance', 'attendance/[id]', 'enrollments/[id]', 'mors', 'reports'];
  for (const r of routes) {
    const src = read(`src/app/api/prp/${r}/route.ts`);
    assert.match(src, /prpGate\(/, r);
    if (r !== 'groups') assert.match(src, /auditPhiAccess/, r);
  }
  const writes = { groups: 'PRP_WRITE_ROLES', attendance: 'PRP_WRITE_ROLES', mors: 'PRP_WRITE_ROLES', 'enrollments/[id]': 'PRP_STATUS_ROLES' } as const;
  for (const [r, set] of Object.entries(writes)) assert.match(read(`src/app/api/prp/${r}/route.ts`), new RegExp(`prpGate\\(${set}\\)`), r);
  const reports = read('src/app/api/prp/reports/route.ts');
  assert.match(reports, /action: format === 'csv' \? 'EXPORT' : 'READ'/);
});

test('TMS and Spravato session / PHQ-9 routes are audited', () => {
  for (const f of ['tms/sessions', 'tms/sessions/[id]', 'tms/phq9', 'spravato/sessions', 'spravato/sessions/[id]']) {
    assert.match(read(`src/app/api/${f}/route.ts`), /auditPhiAccess\(/, f);
  }
  assert.match(read('src/app/api/tms/sessions/route.ts'), /motorThresholdPct/);
});

test('AOT: org column scopes participants; court report is role gated, server-loaded and audited', () => {
  const scope = read('src/app/api/aot/_scope.ts');
  assert.match(scope, /participant\.organizationId === organizationId/);
  assert.match(scope, /if \(!participant\.clientId\) return null;/);
  for (const f of ['caseboard', 'participants']) {
    const src = read(`src/app/api/aot/${f}/route.ts`);
    assert.match(src, /listParticipantsInOrg\(gate\.organizationId/, f);
    assert.match(src, /organizationId: gate\.organizationId,/, f);
  }
  const report = read('src/app/api/aot/court-report/route.ts');
  assert.match(report, /AOT_COURT_REPORT_ROLES\.has\(String\(gate\.role\)\)/);
  assert.match(report, /findParticipantInOrg\(parsed\.data\.participantId, gate\.organizationId\)/);
  assert.match(report, /action: 'AI_ACCESS'/);
  assert.match(read('src/app/api/aot/participants/[id]/route.ts'), /action: 'READ'/);
});

// ─── No hard-coded / sample data in program pages ───────────────────────────

test('program pages and APIs carry no hard-coded stats or sample data', () => {
  const prp = read('src/app/dashboard/prp/page.tsx');
  for (const bad of [/const GROUPS/, /const PARTICIPANTS/, /const DOMAINS/, /not available yet/, /value: '0'/, /active: 0, completed: 0/]) {
    assert.ok(!bad.test(prp), `prp hub: ${bad}`);
  }
  assert.match(prp, /\/api\/prp\/hub/);
  for (const f of ['src/app/dashboard/prp/assessment/page.tsx', 'src/app/dashboard/prp/irp/page.tsx', 'src/app/dashboard/prp/enroll/page.tsx', 'src/app/dashboard/prp/prpShared.tsx']) {
    assert.ok(!/DEMO_|PRP_CLIENTS/.test(read(f)), f);
  }
  assert.ok(!/automatically queued/.test(read('src/app/dashboard/prp/enroll/page.tsx')));
  assert.ok(!/capacity/.test(read('src/app/api/prp/specialists/route.ts')));
  assert.ok(!/unitsApproved: Number\(body\.units\) \|\| 60|'H2017'/.test(read('src/app/api/prp/prior-auth/route.ts')));

  const tms = read('src/app/dashboard/ehr/tms-spravato/page.tsx');
  for (const bad of [/durationMin: '37'/, /targetSite: 'Left DLPFC'/, /pulses: '3000'/, /frequencyHz: '10'/, /doseMg: '56'/, /useState\(5\)/, /useState<number\[\]>\(\[0, 0, 0, 0, 0\]\)/]) {
    assert.ok(!bad.test(tms), `tms page: ${bad}`);
  }
  assert.match(tms, /\/dashboard\/ehr\/scanner\?program=tms/);
  assert.match(tms, /\/dashboard\/ehr\/scanner\?program=spravato/);

  const aot = read('src/app/dashboard/aot/page.tsx');
  for (const bad of [/Demo data/, /IN_HOUSE_CLIENTS/, /PARTICIPANTS_INITIAL/, /Continue current order and treatment plan/, /None this reporting period/]) {
    assert.ok(!bad.test(aot), `aot page: ${bad}`);
  }
  const aotApi = read('src/app/api/aot/participants/route.ts');
  for (const bad of [/Respondent Candidate/, /Baltimore City/, /: 30,/, /Severe Mental Illness \(SMI\)'/]) assert.ok(!bad.test(aotApi), `aot participants: ${bad}`);
});

// ─── Migration ──────────────────────────────────────────────────────────────

function modelColumns(schema: string, model: string) {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${model}`);
  const table = m[1].match(/@@map\("([^"]+)"\)/)?.[1];
  const cols = m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]);
  return { table, cols };
}

test('20261018_prp_attendance.sql matches the schema and is idempotent', () => {
  const schema = read('prisma/schema.prisma');
  const sql = read('prisma/migrations/20261018_prp_attendance.sql');
  for (const model of ['PrpGroup', 'PrpAttendance', 'PrpMorsRating']) {
    const { table, cols } = modelColumns(schema, model);
    assert.ok(table, `${model} @@map`);
    const create = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(create, `CREATE TABLE IF NOT EXISTS ${table}`);
    const sqlCols = [...create[1].matchAll(/^\s*"(\w+)"/gm)].map((x) => x[1]);
    // Columns added later by 20261022_prp_standard.sql (ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
    const later = [...read('prisma/migrations/20261022_prp_standard.sql').matchAll(new RegExp(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "(\\w+)"`, 'g'))].map((x) => x[1]);
    assert.deepEqual([...sqlCols, ...later].sort(), [...cols].sort(), table);
  }
  for (const [model, col] of [['PrpEnrollment', 'statusChangedAt'], ['PrpEnrollment', 'dischargedAt'], ['PrpEnrollment', 'dischargeReason'], ['TmsSession', 'motorThresholdPct'], ['AotParticipant', 'organizationId']]) {
    assert.ok(modelColumns(schema, model).cols.includes(col), `${model}.${col} in schema`);
    assert.match(sql, new RegExp(`ALTER TABLE "${model}" ADD COLUMN IF NOT EXISTS "${col}"`));
  }
  assert.ok(!/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql));
  assert.ok(!/\bDROP\b|\bDELETE\b|\bINSERT\b/i.test(sql));
  assert.match(sql, /prp_mors_ratings_enrollmentId_month_key/);
});

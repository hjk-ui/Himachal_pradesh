/**
 * Huddle sheet (src/lib/huddle/*, /dashboard/huddle, /api/huddle) and the prep script's
 * --dates=tomorrow|today option + evening notice hook (scripts/chart-digest-prep.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HUDDLE_NOT_PREPARED,
  HUDDLE_SUMMARY_MAX_WORDS,
  canPickHuddleProvider,
  canViewHuddle,
  clipWords,
  defaultHuddleDate,
  deriveHuddleFlags,
  digestSummaryLine,
  huddleAppointmentWhere,
  huddleCounts,
  huddleDayLabel,
  huddleNoticeEmail,
  huddleNoticeEnabled,
  parseHuddleDate,
  resolveHuddleProvider,
  summarySources,
  visitsByProvider,
  type HuddleFlagInput,
} from '../src/lib/huddle/core';
import { parsePrepArgs, prepWindow } from '../src/lib/ai/chartDigest/prep';
import { emptySections, type ChartDigest, type DigestItem } from '../src/lib/ai/chartDigest/types';
import { canAccessPath, canAccessApiPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TZ = 'America/New_York';
const et = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00-04:00`);
const day = (d: Date) => d.toISOString().slice(0, 10);

// ─── Date default ────────────────────────────────────────────────────────────

test('date: today before 3 PM practice time, tomorrow from 3 PM', () => {
  assert.equal(defaultHuddleDate(et('2026-10-27', '05:00'), TZ), '2026-10-27');
  assert.equal(defaultHuddleDate(et('2026-10-27', '14:59'), TZ), '2026-10-27');
  assert.equal(defaultHuddleDate(et('2026-10-27', '15:00'), TZ), '2026-10-28');
  assert.equal(defaultHuddleDate(et('2026-10-27', '23:30'), TZ), '2026-10-28');
  // 01:00 UTC is still the previous evening on the practice clock
  assert.equal(defaultHuddleDate(new Date('2026-10-28T01:00:00Z'), TZ), '2026-10-28');
});

test('date: ?date= accepts YYYY-MM-DD, today, tomorrow; anything else falls back to the default', () => {
  const now = et('2026-10-27', '10:00');
  assert.equal(parseHuddleDate('2026-11-02', now, TZ), '2026-11-02');
  assert.equal(parseHuddleDate('today', now, TZ), '2026-10-27');
  assert.equal(parseHuddleDate('tomorrow', now, TZ), '2026-10-28');
  assert.equal(parseHuddleDate(null, now, TZ), '2026-10-27');
  assert.equal(parseHuddleDate('next week', now, TZ), '2026-10-27');
  assert.equal(parseHuddleDate('2026-13-45', now, TZ), '2026-10-27');
  assert.equal(huddleDayLabel('2026-10-28', now, TZ), 'tomorrow');
  assert.equal(huddleDayLabel('2026-10-27', now, TZ), 'today');
  assert.equal(huddleDayLabel('2026-10-30', now, TZ), null);
});

// ─── Own-schedule scoping ────────────────────────────────────────────────────

test('scope: providers see only their own schedule; leadership may pick a provider', () => {
  assert.equal(resolveHuddleProvider({ userId: 'u-ther', role: 'THERAPIST' }, 'u-other'), 'u-ther');
  assert.equal(resolveHuddleProvider({ userId: 'u-psy', role: 'PSYCHIATRIST' }, 'u-other'), 'u-psy');
  assert.equal(resolveHuddleProvider({ userId: 'u-pd', role: 'PRACTICE_DIRECTOR' }, 'u-other'), 'u-other');
  assert.equal(resolveHuddleProvider({ userId: 'u-ad', role: 'ADMIN' }, ''), 'u-ad');
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) assert.equal(canPickHuddleProvider(r), true, r);
  for (const r of ['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(canPickHuddleProvider(r), false, r);
    assert.equal(canViewHuddle(r), true, r);
  }
  for (const r of ['FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT', 'OFFICE_MANAGER']) assert.equal(canViewHuddle(r), false, r);
});

test('scope: the query is the provider\'s own visits, caseload-scoped to the viewer, never cancelled', () => {
  const w = huddleAppointmentWhere({ organizationId: 'o1', userId: 'u1', role: 'THERAPIST' }, 'u1', { start: et('2026-10-28', '00:00'), end: et('2026-10-29', '00:00') });
  const and = (w.AND as Record<string, unknown>[]) ?? [];
  assert.ok(and.some((c) => (c as { clinicianId?: string }).clinicianId === 'u1'));
  assert.ok(and.some((c) => 'client' in c), 'clientAccessWhere for the viewer');
  const status = and.find((c) => 'status' in c) as { status: { notIn: string[] } };
  assert.deepEqual(status.status.notIn, ['CANCELLED', 'LATE_CANCEL']);
  const route = read('src/app/api/huddle/route.ts');
  assert.match(route, /resolveHuddleProvider\(\{ userId: gate\.userId, role: String\(gate\.role\) \}/);
  assert.match(route, /canViewHuddle\(gate\.role\)/);
  assert.match(route, /auditPhiAccess\(/);
  assert.doesNotMatch(route.split('metadata:')[2] ?? '', /clientName|mrn/, 'audit metadata: counts only');
  const server = read('src/lib/huddle/server.ts');
  assert.match(server, /huddleAppointmentWhere\(viewer, input\.providerId/);
  assert.match(server, /lockedSensitiveClientIds/);
  assert.match(server, /withoutPart2\(/);
});

test('role access: page, API, sidebar link', () => {
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(canAccessPath(r, '/dashboard/huddle'), true, r);
  }
  for (const r of ['FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT', 'CASE_MANAGER']) assert.equal(canAccessPath(r, '/dashboard/huddle'), false, r);
  assert.equal(canAccessApiPath('THERAPIST', '/api/huddle', 'GET'), true);
  assert.equal(canAccessApiPath('FRONT_DESK', '/api/huddle', 'GET'), false);
  assert.equal(canAccessApiPath('HR', '/api/huddle', 'GET'), false);
  assert.match(read('src/components/layout/navConfig.ts'), /href: '\/dashboard\/huddle', label: 'Huddle sheet'/);
  assert.match(read('src/features/dashboard/components/TodayPanel.tsx'), /<HuddleEntry \/>/);
});

// ─── Summary: from the digest, no AI ─────────────────────────────────────────

const item = (text: string, date: string | null, source: string, part2 = false): DigestItem => ({
  text,
  date,
  kind: null,
  part2,
  cites: [{ source, page: 2, date: date ?? '2026-01-01', quote: 'q' }],
});
const digest = (over: Partial<ChartDigest> = {}): ChartDigest => ({
  ...emptySections(),
  lastRiskAssessment: null,
  safetyPlan: null,
  sources: {
    'doc:d1': { date: '2025-03-01', label: 'Psych Eval', part2: false, pageCount: 3 },
    'note:n1': { date: '2026-10-20', label: 'Progress Note', part2: false, pageCount: 1 },
    'doc:p2': { date: '2026-09-01', label: 'SUD program note', part2: true, pageCount: 1 },
  },
  hasPart2: true,
  ...over,
});

test('summary: one line from the digest (latest dx + latest open item), at most 30 words, cited', () => {
  const d = digest({
    diagnoses: [item('Generalized anxiety disorder', '2024-01-01', 'doc:d1'), item('Major depressive disorder, recurrent, moderate', '2025-03-01', 'doc:d1')],
    openItems: [item('Follow up on sleep log and work stress', '2026-10-20', 'note:n1'), item('Opioid use disorder follow-up', '2026-10-25', 'doc:p2', true)],
  });
  const line = digestSummaryLine({ kind: 'bh', digest: d }, 'therapist')!;
  assert.equal(line.text, 'Dx: Major depressive disorder, recurrent, moderate; Open item: Follow up on sleep log and work stress');
  assert.doesNotMatch(line.text, /Opioid/, 'Part 2 facts never reach the summary');
  assert.ok(line.text.split(' ').length <= HUDDLE_SUMMARY_MAX_WORDS);
  const links = { 'doc:d1': '/api/files/intake-docs/k1', 'note:n1': '/dashboard/ehr/notes?clientId=c1&openNote=n1' };
  const src = summarySources([...line.cites, { source: 'doc:p2', page: 1, date: '2026-09-01', quote: 'x' }], d.sources, links);
  assert.deepEqual(src.map((s) => s.key), ['doc:d1', 'note:n1'], 'Part 2 source dropped');
  assert.equal(src[0].href, '/api/files/intake-docs/k1#page=2');
  assert.equal(src[0].label, 'Psych Eval 2025-03-01');
  // Long text is clipped to 30 words
  const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
  assert.equal(clipWords(long).split(' ').length, HUDDLE_SUMMARY_MAX_WORDS);
  assert.ok(clipWords(long).endsWith('…'));
  // Empty digest → no line (the page says "Summary not prepared yet")
  assert.equal(digestSummaryLine({ kind: 'bh', digest: digest() }, 'therapist'), null);
  assert.equal(HUDDLE_NOT_PREPARED, 'Summary not prepared yet');
});

test('summary: no per-client AI call when a digest exists (source assertions)', () => {
  for (const f of ['src/lib/huddle/core.ts', 'src/lib/huddle/server.ts', 'src/lib/huddle/notice.ts', 'src/app/api/huddle/route.ts']) {
    const s = read(f);
    assert.doesNotMatch(s, /invokeBedrock|bedrockService|buildChartDigest|buildMedicalDigest|getPreVisitBrief|generateForViewer|InvokeModel/, f);
  }
  const server = read('src/lib/huddle/server.ts');
  assert.match(server, /"digestJson"->'digest'/, 'reads the stored digest, never the chunk cache');
  assert.match(server, /HUDDLE_NOT_PREPARED/);
});

// ─── Flags: data only ────────────────────────────────────────────────────────

const AS_OF = et('2026-10-28', '00:00');
const baseInput = (over: Partial<HuddleFlagInput> = {}): HuddleFlagInput => ({
  asOf: AS_OF,
  asOfYmd: '2026-10-28',
  day,
  riskLevel: 'LOW',
  riskAlerts: [],
  latestCssrs: null,
  safetyPlanOnFile: false,
  medications: [],
  lastVisitAt: null,
  labOrders: [],
  measureAssignments: [],
  scoreDays: new Map(),
  treatmentPlan: null,
  consentGaps: [],
  auths: [],
  ...over,
});

test('flags: none when the chart has nothing to flag (never invented)', () => {
  assert.deepEqual(deriveHuddleFlags(baseInput()), []);
  // A high chart risk level alone is not one of the huddle risk signals
  assert.deepEqual(deriveHuddleFlags(baseInput({ riskLevel: 'HIGH' })), []);
  // Gated-off data (null) never produces a flag
  assert.deepEqual(deriveHuddleFlags(baseInput({ labOrders: null, measureAssignments: null, consentGaps: null, auths: null, safetyPlanOnFile: null })), []);
});

test('flags: each one comes from its own chart data', () => {
  const f = deriveHuddleFlags(
    baseInput({
      riskAlerts: [{ id: 'r1', type: 'SUICIDAL_IDEATION', severity: 'HIGH', reviewed: false, createdAt: et('2026-10-20', '10:00') }],
      latestCssrs: { id: 'c1', instrumentName: 'C-SSRS', totalScore: 3, severity: 'moderate', safetyFlagged: true, createdAt: et('2026-10-01', '10:00') },
      safetyPlanOnFile: true,
      medications: [
        { medicationName: 'Sertraline', dosage: '100 mg', startDate: et('2026-10-15', '09:00'), createdAt: et('2026-10-15', '09:00'), active: true },
        { medicationName: 'Bupropion', dosage: '150 mg', startDate: et('2026-05-01', '09:00'), createdAt: et('2026-05-01', '09:00'), active: true },
        { medicationName: 'Lithium', dosage: '300 mg', startDate: et('2026-01-01', '09:00'), createdAt: et('2026-01-01', '09:00'), active: true },
      ],
      lastVisitAt: et('2026-10-10', '10:00'),
      labOrders: [],
      measureAssignments: [{ instrumentId: 'phq-9', schedule: 'interval', everyDays: 30, startDate: et('2026-06-01', '00:00'), endDate: null, status: 'active' }],
      scoreDays: new Map([['phq-9', '2026-08-01']]),
      treatmentPlan: { status: 'ACTIVE', reviewDueAt: et('2026-10-20', '00:00') },
      consentGaps: [{ title: 'Consent to treatment', standard: 'missing' }, { title: 'Telehealth consent', standard: 'expiring' }],
      auths: [{ id: 'a1', payer: 'Carelon', authNumber: 'X', cptCodes: ['90837'], unitsApproved: 12, unitsUsed: 11, status: 'APPROVED', startDate: et('2026-08-01', '00:00'), endDate: et('2027-01-31', '00:00') }],
    })
  );
  const by = Object.fromEntries(f.map((x) => [x.key, x.detail]));
  assert.deepEqual(f.map((x) => x.key), ['risk', 'med_change', 'labs_due', 'measures_due', 'plan_due', 'consent', 'auth']);
  assert.match(by.risk, /1 unreviewed risk alert/);
  assert.match(by.risk, /C-SSRS safety-flagged/);
  assert.match(by.risk, /safety plan on file/);
  assert.match(by.med_change, /^started Sertraline 100 mg 2026-10-15$/, 'only changes since the last visit');
  assert.match(by.labs_due, /LITHIUM for lithium: none on file|for lithium/i);
  assert.equal(by.measures_due, 'PHQ-9');
  assert.match(by.plan_due, /overdue since 2026-10-20/);
  assert.equal(by.consent, '1 missing or expired, 1 expiring');
  assert.match(by.auth, /1 visit left/);
  assert.deepEqual(huddleCounts([{ flags: f }, { flags: [] }]), { visits: 2, flagged: 1, flags: 7 });
});

test('flags: old C-SSRS, reviewed alerts, a far plan review and a healthy auth do not flag', () => {
  const f = deriveHuddleFlags(
    baseInput({
      riskAlerts: [{ id: 'r1', type: 'X', severity: 'HIGH', reviewed: true, createdAt: et('2026-10-20', '10:00') }],
      latestCssrs: { id: 'c1', instrumentName: 'C-SSRS', totalScore: 3, severity: null, safetyFlagged: true, createdAt: et('2026-01-01', '10:00') },
      treatmentPlan: { status: 'ACTIVE', reviewDueAt: et('2027-01-20', '00:00') },
      auths: [{ id: 'a1', payer: 'P', authNumber: null, cptCodes: [], unitsApproved: 20, unitsUsed: 2, status: 'APPROVED', startDate: null, endDate: null }],
    })
  );
  assert.deepEqual(f, []);
});

// ─── Evening notice: no PHI ──────────────────────────────────────────────────

test('notice email: counts and a link only, no PHI in subject or body', () => {
  const m = huddleNoticeEmail({ visits: 7, date: '2026-10-28', baseUrl: 'https://staging.altrixs.com/' });
  assert.equal(m.subject, 'Your summary for tomorrow (7 visits) is ready');
  assert.match(m.text, /https:\/\/staging\.altrixs\.com\/dashboard\/huddle\?date=2026-10-28/);
  assert.equal(huddleNoticeEmail({ visits: 1, date: '2026-10-28', baseUrl: 'x' }).subject, 'Your summary for tomorrow (1 visit) is ready');
  const all = `${m.subject}\n${m.text}\n${m.html}`;
  assert.doesNotMatch(all, /MRN|diagnos|risk|flag|consent|authori|medication|PHQ|C-SSRS|therapy|client name/i);
  // The builder takes no client data at all: only a count, a date and the base URL
  assert.match(read('src/lib/huddle/core.ts'), /export function huddleNoticeEmail\(input: \{ visits: number; date: string; baseUrl: string \}\)/);
  const notice = read('src/lib/huddle/notice.ts');
  assert.doesNotMatch(notice, /clientName|mrn|legalFirstName|name: true|type: true|loadHuddleSheet|deriveHuddleFlags/, 'never reads client details');
  assert.match(notice, /huddleEmailOptOutAt/);
  assert.match(notice, /huddleNoticeEnabled\(env\)/);
  assert.match(notice, /context: HUDDLE_NOTICE_TEMPLATE/, 'integration log template');
  assert.match(notice, /clientId: null/);
});

test('notice: off unless HUDDLE_EMAIL_NOTICE=on; counts per provider skip cancelled visits', () => {
  assert.equal(huddleNoticeEnabled({}), false);
  assert.equal(huddleNoticeEnabled({ HUDDLE_EMAIL_NOTICE: 'off' }), false);
  assert.equal(huddleNoticeEnabled({ HUDDLE_EMAIL_NOTICE: 'on' }), true);
  const c = visitsByProvider([
    { clinicianId: 'u1', status: 'SCHEDULED' },
    { clinicianId: 'u1', status: 'CHECKED_IN' },
    { clinicianId: 'u1', status: 'CANCELLED' },
    { clinicianId: 'u2', status: 'LATE_CANCEL' },
    { clinicianId: null, status: 'SCHEDULED' },
  ]);
  assert.deepEqual([...c.entries()], [['u1', 2]]);
});

test('preference: per-user opt-out column, default on (migration + schema)', () => {
  const sql = read('prisma/migrations/20261027_huddle_email_notice.sql');
  assert.match(sql, /ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "huddleEmailOptOutAt" TIMESTAMP\(3\);/);
  assert.match(read('prisma/schema.prisma'), /huddleEmailOptOutAt\s+DateTime\?/);
  assert.match(read('src/app/api/huddle/preferences/route.ts'), /huddleEmailOptOutAt: body\.emailNotice \? null : new Date\(\)/);
});

// ─── Prep script: --dates ────────────────────────────────────────────────────

test('prep: --dates=tomorrow (default, evening) and --dates=today (morning top-up, today only)', () => {
  assert.equal(parsePrepArgs([]).dates, 'tomorrow');
  const m = parsePrepArgs(['--dates=today', '--days=3']);
  assert.deepEqual([m.dates, m.days], ['today', 1]);
  const now = et('2026-10-27', '05:00');
  assert.deepEqual(prepWindow(now, TZ, 1, 0).dates, ['2026-10-27']);
  assert.equal(prepWindow(now, TZ, 1, 0).from.toISOString(), '2026-10-27T04:00:00.000Z');
  assert.deepEqual(prepWindow(now, TZ, 1).dates, ['2026-10-28']);
  const s = read('scripts/chart-digest-prep.ts');
  assert.match(s, /prepWindow\(new Date\(\), timeZone, args\.days, args\.dates === 'today' \? 0 : 1\)/);
  assert.match(s, /needingPrep\(targets/, 'only missing / stale digests are generated');
  assert.match(s, /if \(args\.dates === 'tomorrow'\) \{\s*const notice = await sendHuddleNotices/);
  assert.doesNotMatch(read('deploy/crontab.staging'), /--dates=/, 'cron is installed by the owner, not here');
});

test('nightly prep script can load the huddle notice: no staff/invite (UI-side imports crash tsx under react-server)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/huddle/notice.ts'), 'utf8');
  assert.doesNotMatch(src, /@\/lib\/staff\/invite/);
  assert.match(src, /from '@\/lib\/app\/baseUrl'/);
});

/**
 * Group Therapy / SUD Group Counseling (src/lib/groups): billing per attendee, privacy of each
 * member's note, 42 CFR Part 2, co-signature, recurrence, the one-time blob migration, report
 * counts and role access.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateGroupReport,
  appointmentStatusForAttendance,
  billableLine,
  findNameMentions,
  groupClaimFindings,
  groupNoteCosignRequired,
  isPart2Group,
  kindChangeProblem,
  memberAttendanceRows,
  notePart2,
  plannedOccurrences,
  privacyWarnings,
  renderGroupNoteBody,
  type BillingGroup,
  type GroupRecurrence,
  type NoteBodyInput,
} from '../src/lib/groups/rules';
import { GROUP_KIND_META, INDIVIDUAL_FIELDS, PART2_REDISCLOSURE_NOTICE, SHARED_FIELDS, defaultBilling } from '../src/lib/groups/types';
import { canSeeMember, canDocumentSession, canManageGroup, canUseGroupKind } from '../src/lib/groups/access';
import { planBlobMigration } from '../src/lib/groups/blobMigration';
import { canAccessPath, CLINIC_NAV_HREFS } from '../src/lib/auth/roleAccess';
import { canUseClinicModule } from '../src/lib/modules/access';
import { sectionsForRole } from '../src/lib/inbox/sections';
import { REPORTS } from '../src/lib/reports/library/registry';
import { canRunReport } from '../src/lib/reports/library/access';

const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const therapy: BillingGroup = { kind: 'psychotherapy', billingCode: '90853', billingMode: 'per_session', minBillableMinutes: null, maxBillableGroupSize: null };
const line = (status: string, minutesAttended: number | null = null, group: BillingGroup = therapy, groupSize: number | null = 6) =>
  billableLine({ group, attendance: { status, minutesAttended }, groupSize, scheduledMinutes: 60 });

// ─── Billing ─────────────────────────────────────────────────────────────────

test('attendance -> billable line only for members who attended; absent / excused / unmarked never bill', () => {
  assert.equal(line('present').billable, true);
  assert.equal(line('present').code, '90853');
  assert.equal(line('present').minutes, 60, 'present with no minutes = scheduled length');
  for (const s of ['absent', 'excused', 'unmarked']) {
    const l = line(s);
    assert.equal(l.billable, false, s);
    assert.equal(l.code, null, s);
    assert.match(l.reasons.join(' '), /never billed/);
  }
  // Late / left early: minutes must be recorded
  assert.equal(line('late').billable, false);
  assert.equal(line('late', 45).billable, true);
  assert.equal(line('left_early', 30).billable, true);
  assert.ok(line('late', 45).warnings.some((w) => /minimum billable minutes/.test(w)));
});

test('billing: minimum minutes, group-size cap, attendance-only and PRP codes block the line', () => {
  const min45 = { ...therapy, minBillableMinutes: 45 };
  assert.equal(line('late', 40, min45).billable, false);
  assert.equal(line('late', 45, min45).billable, true);
  const cap8 = { ...therapy, maxBillableGroupSize: 8 };
  assert.equal(line('present', null, cap8, 8).billable, true);
  assert.equal(line('present', null, cap8, 9).billable, false);
  assert.match(line('present', null, cap8, 9).reasons.join(' '), /over the cap of 8/);
  assert.equal(line('present', null, { ...therapy, billingMode: 'attendance_only' }).billable, false);
  assert.equal(line('present', null, { ...therapy, billingCode: null }).billable, false);
  assert.equal(line('present', null, { ...therapy, billingCode: 'H2016' }).billable, false, 'PRP codes bill from the PRP hub');
  assert.ok(line('present', null, therapy, null).warnings.some((w) => /Group size was not recorded/.test(w)));
  const findings = groupClaimFindings({ group: therapy, attendance: { status: 'absent', minutesAttended: null }, groupSize: 5, scheduledMinutes: 60 });
  assert.ok(findings.some((f) => f.severity === 'error' && f.code === 'GROUP_NOT_BILLABLE'));
});

test('billing defaults: psychotherapy 90853, SUD H0005 (confirm with billing), IOP / PRP / psychoeducation attendance only', () => {
  assert.equal(defaultBilling('psychotherapy', 'therapy').billingCode, '90853');
  assert.equal(defaultBilling('sud', 'sud_counseling').billingCode, 'H0005');
  assert.match(defaultBilling('sud', 'sud_counseling').note, /confirm with billing/);
  const iop = defaultBilling('sud', 'sud_iop');
  assert.equal(iop.billingMode, 'attendance_only');
  assert.equal(iop.billingCode, null);
  assert.match(iop.note, /H0015/);
  const prp = defaultBilling('psychotherapy', 'prp');
  assert.equal(prp.billingMode, 'attendance_only');
  assert.equal(prp.locked, true);
  assert.equal(defaultBilling('psychotherapy', 'psychoeducation').billingCode, null);
});

test('billing reuses the existing claim builder: the group gate lives inside generateClaimFromNote, no parallel billing route', () => {
  const claims = read('src', 'lib', 'billing', 'claims.ts');
  assert.match(claims, /groupNoteBilling\(note\.id\)/);
  assert.match(claims, /if \(group\?\.errors\.length\) return blocked\(group\.errors\)/);
  for (const f of ['store.ts', 'claimGate.ts', 'rules.ts']) {
    assert.doesNotMatch(read('src', 'lib', 'groups', f), /claim\.create\(/, `${f} must not create claims directly`);
  }
  assert.match(read('src', 'lib', 'groups', 'store.ts'), /generateClaimFromNote\(/);
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'app', 'api', 'ehr', 'groups', 'claims')), false);
});

test('appointment status mirrors attendance (absent = no-show, excused = cancelled)', () => {
  assert.equal(appointmentStatusForAttendance('present'), 'COMPLETED');
  assert.equal(appointmentStatusForAttendance('left_early'), 'COMPLETED');
  assert.equal(appointmentStatusForAttendance('absent'), 'NO_SHOW');
  assert.equal(appointmentStatusForAttendance('excused'), 'CANCELLED');
  assert.equal(appointmentStatusForAttendance('unmarked'), 'SCHEDULED');
});

// ─── Privacy ─────────────────────────────────────────────────────────────────

const members = [
  { clientId: 'c1', name: 'Maria Lopez' },
  { clientId: 'c2', name: 'James Carter' },
  { clientId: 'c3', name: 'Will Brown' },
];

test('privacy: other members named in the shared section or in a member note are flagged', () => {
  assert.deepEqual(findNameMentions('Group discussed coping skills.', members), []);
  assert.equal(findNameMentions('maria lopez shared first', members)[0]?.kind, 'full');
  assert.equal(findNameMentions('Carter described a relapse', members)[0]?.name, 'James Carter');
  assert.deepEqual(findNameMentions('Client will practice the skill.', members), [], 'lower-case "will" is not the member Will');
  const w = privacyWarnings({
    shared: { topic: 'Coping', dynamics: 'Maria Lopez dominated the discussion' },
    attendees: [
      { clientId: 'c1', name: 'Maria Lopez', individual: { progress: 'Client engaged' } },
      { clientId: 'c2', name: 'James Carter', individual: { progress: 'Client supported Maria after her share' } },
      { clientId: 'c3', name: 'Will Brown', individual: { progress: 'Client will continue to practice' } },
    ],
  });
  assert.deepEqual(w.find((x) => x.section === 'shared')?.names, ['Maria Lopez']);
  assert.deepEqual(w.find((x) => x.section === 'individual' && x.clientId === 'c2')?.names, ['Maria Lopez']);
  assert.equal(w.some((x) => x.section === 'individual' && x.clientId === 'c1'), false, "a member's own name in their note is fine");
  assert.equal(w.some((x) => x.clientId === 'c3'), false);
});

const bodyInput = (over: Partial<NoteBodyInput> = {}): NoteBodyInput => ({
  kind: 'psychotherapy',
  groupName: 'Anxiety Skills',
  groupTypeLabel: 'Group psychotherapy',
  sessionDate: '2026-10-20',
  startTime: '10:00',
  durationMinutes: 60,
  telehealth: false,
  attendance: { status: 'present', minutesAttended: null },
  groupSize: 6,
  shared: { topic: 'Grounding', interventions: 'CBT', dynamics: 'Cohesive' },
  individual: { participation: 'active', progress: 'Used 5-4-3-2-1 grounding', risk: 'none', goalIds: ['g1'] },
  goals: [{ id: 'g1', text: 'Reduce panic attacks' }],
  facilitatorName: 'Pat Smith',
  facilitatorCredentials: 'LCPC',
  coFacilitatorName: null,
  billingCode: '90853',
  ...over,
});

test("privacy: a member's note body has the shared section, their own section and a group-size count, never the roster", () => {
  const body = renderGroupNoteBody(bodyInput());
  assert.match(body, /Grounding/);
  assert.match(body, /Used 5-4-3-2-1 grounding/);
  assert.match(body, /Reduce panic attacks/);
  assert.match(body, /Members attending: 6/);
  assert.match(body, /Group therapist: Pat Smith, LCPC/);
  for (const m of members) assert.doesNotMatch(body, new RegExp(m.name));
});

test('note templates: SUD group note has its own industry-standard fields; psychotherapy keeps its template', () => {
  const sud = INDIVIDUAL_FIELDS.sud.map((f) => f.key);
  for (const k of ['useSinceLast', 'cravings', 'triggers', 'stageOfChange', 'participation', 'progress', 'asamDimensions', 'udsSource', 'udsResult', 'risk', 'plan']) assert.ok(sud.includes(k), k);
  assert.ok(SHARED_FIELDS.sud.some((f) => f.key === 'curriculum'));
  const psy = INDIVIDUAL_FIELDS.psychotherapy.map((f) => f.key);
  assert.ok(!psy.includes('cravings') && psy.includes('moodAffect'));
  assert.equal(GROUP_KIND_META.sud.signerTitle, 'SUD counselor');
  const sudBody = renderGroupNoteBody(bodyInput({ kind: 'sud', individual: { useSinceLast: 'none_reported', cravings: 3, participation: 'active', progress: 'x', risk: 'none' } }));
  assert.match(sudBody, /SUD counselor: Pat Smith/);
  assert.match(sudBody, /Cravings \(0-10\): 3/);
});

// ─── 42 CFR Part 2 ───────────────────────────────────────────────────────────

test('Part 2: every SUD group note is Part 2; psychotherapy only when the client record is', () => {
  assert.equal(isPart2Group('sud'), true);
  assert.equal(isPart2Group('psychotherapy'), false);
  assert.equal(notePart2('sud', false), true);
  assert.equal(notePart2('psychotherapy', false), false);
  assert.equal(notePart2('psychotherapy', true), true);
  assert.match(renderGroupNoteBody(bodyInput({ kind: 'sud' })), new RegExp(PART2_REDISCLOSURE_NOTICE.replace(/[.]/g, '\\.')));
  assert.doesNotMatch(renderGroupNoteBody(bodyInput()), /42 CFR/);
  // Calendar / reminder wording does not disclose SUD treatment
  assert.doesNotMatch(GROUP_KIND_META.sud.appointmentType, /sud|substance|drug|alcohol/i);
  // The database refuses an SUD group that is not Part 2
  assert.match(read('prisma', 'migrations', '20261019_group_sessions.sql'), /CHECK \("kind" <> 'sud' OR "part2" = TRUE\)/);
  assert.match(read('src', 'lib', 'groups', 'store.ts'), /part2: notePart2\(g\.kind/);
});

test('kind is permanent once the group has notes', () => {
  assert.equal(kindChangeProblem('psychotherapy', 'psychotherapy', true), null);
  assert.equal(kindChangeProblem('psychotherapy', 'sud', false), null);
  assert.match(kindChangeProblem('psychotherapy', 'sud', true) ?? '', /cannot change/);
});

// ─── Co-signature ────────────────────────────────────────────────────────────

test('co-sign: pre-licensed or supervised facilitators need a co-signature; licensed therapists do not', () => {
  assert.equal(groupNoteCosignRequired('THERAPIST', false, true), true, 'pre-licensed (LGPC / LMSW / LGADC)');
  assert.equal(groupNoteCosignRequired('THERAPIST', true, false), true, 'licensure track');
  assert.equal(groupNoteCosignRequired('CASE_MANAGER', false, false), true, 'role always co-signed');
  assert.equal(groupNoteCosignRequired('THERAPIST', false, false), false);
  // Signing goes through the shared workflow (co-sign, attestation, plan gate)
  assert.match(read('src', 'lib', 'groups', 'store.ts'), /updateProgressNoteWorkflow\(\{/);
});

// ─── Recurrence ──────────────────────────────────────────────────────────────

const weekly: GroupRecurrence = {
  recurFrequency: 'weekly',
  recurInterval: 1,
  recurWeekdays: [2, 4],
  recurStartTime: '10:00',
  recurStartDate: '2026-10-20',
  recurEndDate: null,
  defaultDurationMinutes: 90,
};

test('recurrence: weekly Tue / Thu on the practice clock (DST-safe), past and existing occurrences skipped', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const r = plannedOccurrences(weekly, { fromDate: '2026-10-19', count: 6, timeZone: 'America/New_York', now, existingStarts: [] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.occurrences.map((o) => o.date), ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05']);
  assert.equal(r.occurrences[0].start.toISOString(), '2026-10-20T14:00:00.000Z');
  assert.equal(r.occurrences[4].start.toISOString(), '2026-11-03T15:00:00.000Z', '10:00 AM stays 10:00 AM after fall-back');
  assert.equal(r.occurrences[0].end.getTime() - r.occurrences[0].start.getTime(), 90 * 60_000);
  const again = plannedOccurrences(weekly, { fromDate: '2026-10-19', count: 6, timeZone: 'America/New_York', now, existingStarts: r.occurrences.slice(0, 2).map((o) => o.start) });
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.occurrences.length, 4, 'idempotent: existing starts skipped');
  const later = plannedOccurrences(weekly, { fromDate: '2026-10-19', count: 6, timeZone: 'America/New_York', now: new Date('2026-10-23T00:00:00Z'), existingStarts: [] });
  assert.ok(later.ok && later.occurrences.every((o) => o.date >= '2026-10-27'), 'past occurrences are not created');
  const none = plannedOccurrences({ ...weekly, recurFrequency: null }, { fromDate: '2026-10-19', count: 4, timeZone: 'America/New_York', now, existingStarts: [] });
  assert.equal(none.ok, false);
  assert.match(read('src', 'lib', 'groups', 'rules.ts'), /from '@\/lib\/scheduling\/recurrence'/);
});

// ─── Blob migration ──────────────────────────────────────────────────────────

const blob = [
  {
    id: 'gs-1',
    name: 'Anxiety Skills',
    groupType: 'Psychotherapy',
    facilitator: 'Pat Smith',
    location: 'Room A',
    mode: 'In-person',
    startDate: '2026-09-01',
    endDate: null,
    recurrence: { frequency: 'Weekly', days: ['Tuesday'], startTime: '10:00', duration: 60 },
    capacity: 8,
    active: true,
    occurrences: [{ id: 'gs-1-oc-1', date: '2026-09-01', startTime: '10:00', duration: 60, status: 'completed' }],
    members: [
      { id: 'gs-1-c1', clientId: 'c1', membershipStatus: 'Active', membershipStart: '2026-09-01', membershipEnd: null, attendance: 'Present', individualNote: '' },
      { id: 'gs-1-cX', clientId: 'not-in-org', membershipStatus: 'Active', membershipStart: '2026-09-01', membershipEnd: null, attendance: 'Absent', individualNote: '' },
    ],
    note: { status: 'signed', commonText: 'Discussed grounding.', individualized: { 'gs-1-c1': 'Engaged well.' } },
  },
  {
    id: 'gs-2',
    name: 'PRP Social Skills',
    groupType: 'PRP',
    facilitator: 'Unknown Person',
    location: '',
    mode: 'In-person',
    startDate: '2026-09-02',
    recurrence: { frequency: 'Biweekly', days: ['Wednesday'], startTime: '13:00', duration: 90 },
    capacity: 10,
    active: false,
    occurrences: [
      { id: 'o1', date: '2026-09-02', startTime: '13:00', duration: 90, status: 'completed' },
      { id: 'o2', date: '2026-09-16', startTime: '13:00', duration: 90, status: 'upcoming' },
      { id: 'bad', date: 'not a date', startTime: '13:00', duration: 90, status: 'upcoming' },
    ],
    members: [{ id: 'gs-2-c2', clientId: 'c2', membershipStatus: 'Inactive', membershipStart: '2026-09-02', membershipEnd: '2026-09-20', attendance: 'Present', individualNote: 'x' }],
    note: { status: 'draft', commonText: 'Some text', individualized: {} },
  },
  { name: 'no id' },
];

const ctx = (already: string[] = []) => ({
  clientIds: new Set(['c1', 'c2']),
  staffByName: new Map([['pat smith', ['u1']]]),
  alreadyMigrated: new Set(already),
});

test('blob migration (dry-run plan): counts, never fabricates members, facilitators, sessions or signatures', () => {
  const { groups, counts } = planBlobMigration(blob, ctx());
  assert.equal(counts.groupsInBlob, 3);
  assert.equal(counts.groupsPlanned, 2);
  assert.equal(counts.groupsSkippedInvalid, 1);
  assert.equal(counts.membersPlanned, 2);
  assert.equal(counts.membersSkippedUnknownClient, 1);
  assert.equal(counts.sessionsPlanned, 3);
  assert.equal(counts.sessionsSkippedInvalid, 1);
  assert.equal(counts.facilitatorsMatched, 1);
  assert.equal(counts.facilitatorsUnmatched, 1);
  const g1 = groups.find((g) => g.legacyId === 'gs-1')!;
  assert.equal(g1.facilitatorId, 'u1');
  assert.equal(g1.billingCode, '90853');
  assert.deepEqual(g1.recurWeekdays, [2]);
  // One occurrence: attendance + text attached as an unsigned draft; the unknown client is not
  assert.equal(g1.draft?.attendance.length, 1);
  assert.equal(g1.draft?.attendance[0].legacyNoteText, 'Engaged well.');
  assert.equal(counts.draftsAttached, 1);
  const g2 = groups.find((g) => g.legacyId === 'gs-2')!;
  assert.equal(g2.facilitatorId, null, 'free-text facilitator not matched -> null, never guessed');
  assert.equal(g2.groupType, 'prp');
  assert.equal(g2.billingMode, 'attendance_only');
  assert.equal(g2.status, 'archived');
  assert.equal(g2.draft, null, 'two occurrences: ambiguous, attendance and text stay in the blob');
  assert.equal(counts.attendanceMarksNotMigrated, 1);
  assert.equal(counts.noteTextsNotMigrated, 1);
  assert.doesNotMatch(JSON.stringify(groups), /signed|signedAt|cosign/i, 'no signatures are carried over');
});

test('blob migration is idempotent and the script is a dry run unless --apply', () => {
  const again = planBlobMigration(blob, ctx(['gs-1', 'gs-2']));
  assert.equal(again.groups.length, 0);
  assert.equal(again.counts.groupsAlreadyMigrated, 2);
  assert.equal(planBlobMigration(null, ctx()).counts.groupsInBlob, 0);
  const script = read('scripts', 'migrate-group-sessions-blob.ts');
  assert.match(script, /const APPLY = args\.includes\('--apply'\)/);
  assert.match(script, /if \(!APPLY\) return \{ \.\.\.plan\.counts, written \}/);
  assert.match(script, /upsert\(\{\s*where: \{ groupId_clientId/);
  assert.match(script, /upsert\(\{\s*where: \{ groupId_startsAt/);
  assert.doesNotMatch(script, /progressNote\.create|claim\.create|clinicModuleState\.(update|delete)/);
});

// ─── Reports ─────────────────────────────────────────────────────────────────

test('report counts equal the underlying lists', () => {
  const sessions = [
    { id: 's1', groupId: 'g1', status: 'completed', groupSize: 2 },
    { id: 's2', groupId: 'g1', status: 'cancelled', groupSize: null },
    { id: 's3', groupId: 'g1', status: 'scheduled', groupSize: null },
    { id: 's4', groupId: 'g2', status: 'in_progress', groupSize: 1 },
  ];
  const att = [
    { sessionId: 's1', groupId: 'g1', clientId: 'a', status: 'present', hasNote: true, noteSigned: true, claimId: 'cl1' },
    { sessionId: 's1', groupId: 'g1', clientId: 'b', status: 'late', hasNote: true, noteSigned: false, claimId: null },
    { sessionId: 's1', groupId: 'g1', clientId: 'c', status: 'absent', hasNote: false, noteSigned: false, claimId: null },
    { sessionId: 's4', groupId: 'g2', clientId: 'a', status: 'excused', hasNote: false, noteSigned: false, claimId: null },
    { sessionId: 's4', groupId: 'g2', clientId: 'd', status: 'present', hasNote: true, noteSigned: false, claimId: null },
  ];
  const rows = aggregateGroupReport(sessions, att);
  const g1 = rows.find((r) => r.groupId === 'g1')!;
  assert.equal(g1.sessionsHeld, 1, 'scheduled with no marks is not held');
  assert.equal(g1.sessionsCancelled, 1);
  assert.equal(g1.marked, 3);
  assert.equal(g1.attended, 2);
  assert.equal(g1.absent, 1);
  assert.equal(g1.attendanceRate, 66.7);
  assert.equal(g1.averageGroupSize, 2);
  assert.equal(g1.notesUnsigned, 1);
  assert.equal(g1.claimsGenerated, 1);
  const total = (k: 'marked' | 'attended' | 'claimsGenerated' | 'notesUnsigned') => rows.reduce((t, r) => t + r[k], 0);
  assert.equal(total('marked'), att.filter((a) => a.status !== 'unmarked').length);
  assert.equal(total('attended'), att.filter((a) => ['present', 'late', 'left_early'].includes(a.status)).length);
  assert.equal(total('claimsGenerated'), att.filter((a) => a.claimId).length);
  assert.equal(total('notesUnsigned'), att.filter((a) => a.hasNote && !a.noteSigned).length);
  const perMember = memberAttendanceRows(att.filter((a) => a.groupId === 'g1'));
  assert.equal(perMember.reduce((t, r) => t + r.marked, 0), g1.marked);
  const ids = REPORTS.map((r) => r.id);
  assert.ok(ids.includes('group-attendance') && ids.includes('group-utilization'));
  for (const id of ['group-attendance', 'group-utilization']) {
    const r = REPORTS.find((x) => x.id === id)!;
    assert.ok(r.params.some((p) => p.kind === 'select' && p.key === 'kind'), `${id} filters by kind`);
  }
});

// ─── Role access ─────────────────────────────────────────────────────────────

test('role access: two separate areas; SUD (Part 2) excludes PRP, billing, front desk and HR', () => {
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'THERAPIST', 'CLINICIAN', 'CASE_MANAGER', 'PRP_SPECIALIST']) assert.ok(canAccessPath(r, '/dashboard/ehr/group-sessions'), r);
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'THERAPIST', 'CLINICIAN', 'CASE_MANAGER']) assert.ok(canAccessPath(r, '/dashboard/ehr/sud-groups/abc'), r);
  for (const r of ['PRP_SPECIALIST', 'BILLING', 'FRONT_DESK', 'HR', 'PEER_SUPPORT']) assert.equal(canAccessPath(r, '/dashboard/ehr/sud-groups'), false, r);
  for (const r of ['BILLING', 'FRONT_DESK', 'HR']) assert.equal(canAccessPath(r, '/dashboard/ehr/group-sessions'), false, r);
  assert.equal(canUseGroupKind('PRP_SPECIALIST', 'sud'), false);
  assert.equal(canUseGroupKind('PRP_SPECIALIST', 'psychotherapy'), true);
  assert.ok(CLINIC_NAV_HREFS.includes('/dashboard/ehr/sud-groups'));
  // The old org-wide blob can no longer be read or written from the browser
  assert.equal(canUseClinicModule('ADMIN', 'group-sessions'), false);
  assert.equal(canUseClinicModule('THERAPIST', 'group-sessions'), false);
});

test('roster access follows caseload: leadership all, facilitators their group, others only their own clients', () => {
  const group = { facilitatorId: 'fac', coFacilitatorId: 'co' };
  assert.equal(canSeeMember({ role: 'PRACTICE_DIRECTOR', userId: 'x', group, assignedToId: 'other' }), true);
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 'fac', group, assignedToId: 'other' }), true);
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 'co', group, assignedToId: null }), true);
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 't2', group, assignedToId: 't2' }), true);
  assert.equal(canSeeMember({ role: 'THERAPIST', userId: 't2', group, assignedToId: 'other' }), false);
  assert.equal(canSeeMember({ role: 'PSYCHIATRIST', userId: 'md', medicalDirector: true, group, assignedToId: 'other' }), true);
  assert.equal(canManageGroup({ role: 'THERAPIST', userId: 't2', group }), false);
  assert.equal(canManageGroup({ role: 'THERAPIST', userId: 'fac', group }), true);
  assert.equal(canDocumentSession({ role: 'THERAPIST', userId: 'co', session: { facilitatorId: 'fac', coFacilitatorId: null }, group }), true);
  assert.equal(canDocumentSession({ role: 'THERAPIST', userId: 't2', session: group, group }), false);
  // Protected (Part 2 / VIP) records are masked on top of caseload, with no group bypass
  assert.match(read('src', 'lib', 'groups', 'store.ts'), /lockedSensitiveClientIds\(/);
});

test('inbox and report library: unsigned group notes reach the facilitator; group reports stay inside the group roles', () => {
  const keys = (role: string) => sectionsForRole(role).map((s) => s.key);
  assert.ok(keys('THERAPIST').includes('group_notes'));
  assert.ok(keys('CASE_MANAGER').includes('group_notes'));
  assert.ok(!keys('BILLING').includes('group_notes'));
  assert.ok(!keys('FRONT_DESK').includes('group_notes'));
  for (const id of ['group-attendance', 'group-utilization']) {
    const r = REPORTS.find((x) => x.id === id)!;
    assert.ok(canRunReport(r, 'PRACTICE_DIRECTOR'));
    assert.equal(canRunReport(r, 'THERAPIST'), false); // providers do not run practice reports
    assert.equal(canRunReport(r, 'BILLING'), false);
    assert.equal(canRunReport(r, 'FRONT_DESK'), false);
  }
});

test('audit: every group API route writes an audit row', () => {
  const dir = path.join(ROOT, 'src', 'app', 'api', 'ehr', 'groups');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [path.join(d, e.name)] : []));
  const routes = walk(dir);
  assert.ok(routes.length >= 10);
  for (const r of routes) {
    const s = fs.readFileSync(r, 'utf8');
    if (/options[\\/]route\.ts$/.test(r)) continue; // staff names and locations only, no client data
    assert.match(s, /auditPhiAccessGroup\(/, path.relative(ROOT, r));
  }
});

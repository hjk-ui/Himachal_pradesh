/**
 * Intensive programs (IOP / PHP): src/lib/intensive/*, /dashboard/programs/intensive, /api/intensive/*.
 * Weekly hours vs the program minimum, under-minimum flags, authorization units and renewal,
 * discharge follow-up window, step-down rules, billing units and charge drafts, admission readiness,
 * policy defaults ("practice policy — confirm"), role / Part 2 access and the Visit Guide wiring.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  addDays,
  admissionReadiness,
  attendedMinutes,
  authStatus,
  dischargeProblems,
  draftsForDay,
  followUpDueAt,
  followUpExpected,
  followUpStatus,
  isStepDown,
  isStepUp,
  missedDayNeedsFollowUp,
  outcomeSummary,
  pairScores,
  planTimeline,
  programDaysInWeek,
  stepDownOptions,
  suppressedRate,
  unitsFor,
  unitsPerWeek,
  weekCompliance,
  weekStartOf,
  weeklyHours,
  weeklyReviewStatus,
  type DraftContext,
} from '../src/lib/intensive/rules';
import {
  CONFIRM_LABEL,
  defaultActive,
  defaultPolicy,
  defaultServiceCodes,
  defaultUnitRules,
  effectivePolicy,
  parseSchedule,
  parseUnitRules,
  perDiemCodeOf,
  programActivationProblem,
  programIsPart2,
  scheduleMinutes,
  scheduleWarnings,
} from '../src/lib/intensive/policy';
import { CONSENT_KEYS, PROGRAM_TYPE_META, criteriaFor, type ScheduleTemplate } from '../src/lib/intensive/types';
import {
  canGenerateCharges,
  canMakeClinicalDecisions,
  canManagePrograms,
  canReadCharges,
  canSeeEnrollment,
  canSeePart2ProgramList,
  canSeeRollups,
} from '../src/lib/intensive/access';
import { canAccessApiPath, canAccessPath, CLINIC_NAV_HREFS } from '../src/lib/auth/roleAccess';
import { PROTOCOLS, BH_KINDS, PLAN_KINDS } from '../src/lib/visits/protocols';
import { kindForCode, kindForTypeText, resolveVisitKind } from '../src/lib/visits/resolveKind';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const IOP: ScheduleTemplate = {
  days: [1, 3, 4], // Mon / Wed / Thu
  blocks: [
    { key: 'b1', label: 'Group 1', start: '09:00', minutes: 90, sessionType: 'group' },
    { key: 'b2', label: 'Group 2', start: '10:45', minutes: 90, sessionType: 'group' },
  ],
};
// 2026-10-19 is a Monday
const MON = '2026-10-19';

// ─── Days & weekly hours ────────────────────────────────────────────────────

test('weeks run Monday-Sunday; program days come from the schedule template', () => {
  assert.equal(weekStartOf('2026-10-21'), MON);
  assert.equal(weekStartOf('2026-10-25'), MON); // Sunday belongs to the week that started Monday
  assert.equal(weekStartOf(MON), MON);
  assert.deepEqual(programDaysInWeek(IOP, MON), ['2026-10-19', '2026-10-21', '2026-10-22']);
});

test('weekly hours: only attended statuses count; recorded minutes, else the scheduled block', () => {
  assert.equal(attendedMinutes({ status: 'present', minutes: 90 }), 90);
  assert.equal(attendedMinutes({ status: 'late', minutes: 60 }), 60);
  assert.equal(attendedMinutes({ status: 'left_early', minutes: 45 }), 45);
  assert.equal(attendedMinutes({ status: 'present', minutes: null, scheduledMinutes: 90 }), 90);
  assert.equal(attendedMinutes({ status: 'absent', minutes: 90 }), 0);
  assert.equal(attendedMinutes({ status: 'excused', minutes: 90 }), 0);
  const rows = [
    { serviceDate: '2026-10-19', status: 'present', minutes: 90 },
    { serviceDate: '2026-10-19', status: 'present', minutes: 90 },
    { serviceDate: '2026-10-21', status: 'late', minutes: 60 },
    { serviceDate: '2026-10-21', status: 'absent', minutes: null },
    { serviceDate: '2026-10-26', status: 'present', minutes: 90 }, // next week
  ];
  const w = weeklyHours(rows, MON);
  assert.equal(w.minutes, 240);
  assert.equal(w.hours, 4);
  assert.equal(w.daysAttended, 2);
});

test('under-minimum: finished week under the minimum is flagged; met when at/over', () => {
  const base = { weekStart: MON, today: '2026-10-27', minWeeklyHours: 9, schedule: IOP, admissionDate: '2026-10-01', dischargeDate: null };
  assert.equal(weekCompliance({ ...base, attendedMinutes: 540 }).status, 'met');
  const under = weekCompliance({ ...base, attendedMinutes: 480 });
  assert.equal(under.status, 'under');
  assert.equal(under.requiredHours, 9);
  assert.equal(under.hours, 8);
  assert.equal(under.complete, true);
});

test('under-minimum: a week in progress is on track or at risk by the sessions left', () => {
  // Wednesday morning: Mon attended (3 h), Wed + Thu remain (6 h possible) -> 9 reachable
  const mid = { weekStart: MON, today: '2026-10-21', minWeeklyHours: 9, schedule: IOP, admissionDate: '2026-10-01', dischargeDate: null };
  assert.equal(weekCompliance({ ...mid, attendedMinutes: 180 }).status, 'on_track');
  // Thursday with only 3 h so far: 3 h left cannot reach 9
  assert.equal(weekCompliance({ ...mid, today: '2026-10-22', attendedMinutes: 180 }).status, 'at_risk');
});

test('under-minimum: admission mid-week prorates the minimum by eligible program days', () => {
  const c = weekCompliance({ weekStart: MON, today: '2026-10-27', minWeeklyHours: 9, schedule: IOP, admissionDate: '2026-10-21', dischargeDate: null, attendedMinutes: 360 });
  assert.equal(c.eligibleDays, 2);
  assert.equal(c.requiredHours, 6);
  assert.equal(c.status, 'met');
  // Admitted after the week: not applicable
  assert.equal(weekCompliance({ weekStart: MON, today: '2026-10-27', minWeeklyHours: 9, schedule: IOP, admissionDate: '2026-10-26', dischargeDate: null, attendedMinutes: 0 }).status, 'not_applicable');
});

test('PHP minimum (20 h) against a 5-day schedule', () => {
  const php = parseSchedule(null, 'PHP');
  assert.equal(scheduleMinutes(php).perWeek, 5 * 240);
  const c = weekCompliance({ weekStart: MON, today: '2026-10-27', minWeeklyHours: 20, schedule: php, admissionDate: '2026-10-01', dischargeDate: null, attendedMinutes: 16 * 60 });
  assert.equal(c.status, 'under');
  assert.deepEqual(scheduleWarnings(php, 20), []);
  assert.match(scheduleWarnings(IOP, 20)[0], /under the 20-hour weekly minimum/);
});

// ─── Missed day ─────────────────────────────────────────────────────────────

test('missed day: outreach only when the whole day was missed without an excuse', () => {
  assert.equal(missedDayNeedsFollowUp(['absent', 'absent']), true);
  assert.equal(missedDayNeedsFollowUp(['absent', 'present']), false);
  assert.equal(missedDayNeedsFollowUp(['excused', 'excused']), false);
  assert.equal(missedDayNeedsFollowUp(['excused', 'absent']), true);
  assert.equal(missedDayNeedsFollowUp([]), false);
  const due = followUpDueAt('2026-10-21', 24);
  assert.equal(due.toISOString(), '2026-10-22T23:59:59.000Z');
});

// ─── Authorization ──────────────────────────────────────────────────────────

test('auth: units used = max(claim units, draft units for the auth codes); void drafts ignored', () => {
  const auth = { unitsApproved: 20, unitsUsedClaims: 4, cptCodes: ['H0015'], startDate: '2026-10-01', endDate: '2026-12-31' };
  const drafts = [
    { code: 'H0015', units: 1, status: 'draft' },
    { code: 'H0015', units: 1, status: 'held' },
    { code: 'H0015', units: 1, status: 'void' },
    { code: 'H0004', units: 4, status: 'draft' }, // not covered by this auth
  ];
  const a = authStatus(auth, drafts, { today: '2026-10-21', leadDays: 7, unitsPerWeek: 3 });
  assert.equal(a.used, 4);
  assert.equal(a.remaining, 16);
  assert.equal(a.renewalDue, false);
  const many = Array.from({ length: 9 }, () => ({ code: 'H0015', units: 1, status: 'draft' }));
  assert.equal(authStatus(auth, many, { today: '2026-10-21', leadDays: 7, unitsPerWeek: 3 }).used, 9);
});

test('auth: renewal due by end date lead time, by units under one week, expired, exhausted', () => {
  const auth = { unitsApproved: 12, unitsUsedClaims: 0, cptCodes: ['S9480'], startDate: '2026-10-01', endDate: '2026-10-25' };
  const near = authStatus(auth, [], { today: '2026-10-20', leadDays: 7, unitsPerWeek: 3 });
  assert.equal(near.renewalDue, true);
  assert.equal(near.daysLeft, 5);
  assert.match(near.reasons[0], /Ends in 5 days/);
  const low = authStatus({ ...auth, endDate: '2026-12-31', unitsUsedClaims: 10 }, [], { today: '2026-10-20', leadDays: 7, unitsPerWeek: 3 });
  assert.equal(low.remaining, 2);
  assert.equal(low.renewalDue, true);
  const expired = authStatus(auth, [], { today: '2026-10-30', leadDays: 7, unitsPerWeek: 3 });
  assert.equal(expired.expired, true);
  const out = authStatus({ ...auth, endDate: '2026-12-31', unitsUsedClaims: 12 }, [], { today: '2026-10-20', leadDays: 7, unitsPerWeek: 3 });
  assert.equal(out.exhausted, true);
  assert.equal(unitsPerWeek('per_diem', IOP), 3);
  assert.equal(unitsPerWeek('per_service', IOP), 6);
});

// ─── Treatment plan & weekly review ────────────────────────────────────────

test('plan timeline: initial plan due after admission, review interval from signing', () => {
  const none = planTimeline({ admissionDate: '2026-10-01', today: '2026-10-05', initialPlanDays: 7, planReviewDays: 30, plan: null });
  assert.equal(none.initialDue, '2026-10-08');
  assert.equal(none.initialState, 'due');
  assert.equal(planTimeline({ admissionDate: '2026-10-01', today: '2026-10-09', initialPlanDays: 7, planReviewDays: 30, plan: null }).initialState, 'overdue');
  const signed = planTimeline({ admissionDate: '2026-10-01', today: '2026-10-20', initialPlanDays: 7, planReviewDays: 30, plan: { signedOn: '2026-10-06' } });
  assert.equal(signed.initialState, 'done');
  assert.equal(signed.nextReviewDue, '2026-11-05');
  assert.equal(signed.reviewState, 'done');
  assert.equal(planTimeline({ admissionDate: '2026-10-01', today: '2026-11-06', initialPlanDays: 7, planReviewDays: 30, plan: { signedOn: '2026-10-06' } }).reviewState, 'overdue');
});

test('weekly review: PHP requires the psychiatrist / NP review; IOP does not', () => {
  assert.deepEqual(weeklyReviewStatus({ programType: 'PHP', review: null }).missing, ['Weekly team review', 'Psychiatrist / NP weekly review (PHP)']);
  assert.deepEqual(weeklyReviewStatus({ programType: 'PHP', review: { prescriberReviewedAt: null } }).missing, ['Psychiatrist / NP weekly review (PHP)']);
  assert.deepEqual(weeklyReviewStatus({ programType: 'PHP', review: { prescriberReviewedAt: new Date() } }).missing, []);
  assert.deepEqual(weeklyReviewStatus({ programType: 'SUD_IOP', review: { prescriberReviewedAt: null } }).missing, []);
});

// ─── Admission ──────────────────────────────────────────────────────────────

test('admission readiness: criteria, level of care, consents (Part 2 for SUD), PHP psych eval + prescriber', () => {
  const allCriteria = (t: 'MH_IOP' | 'SUD_IOP' | 'PHP') => Object.fromEntries(criteriaFor(t).map((c) => [c.key, true]));
  const base = {
    programType: 'SUD_IOP' as const,
    part2: true,
    clientAgeYears: 34,
    criteria: allCriteria('SUD_IOP'),
    criteriaOverride: null,
    levelOfCare: { locusRecordId: null, asamComplete: true },
    consentsOnFile: new Set<string>([CONSENT_KEYS.treatment]),
    hasAuthorization: false,
    psychEvalDate: null,
    admissionDate: '2026-10-21',
    primaryClinicianId: 'u1',
    prescriberId: null,
    caseManagerId: null,
    usesGroups: true,
  };
  const r = admissionReadiness(base);
  assert.equal(r.canAdmit, false);
  assert.deepEqual(r.blockers, ['42 CFR Part 2 consent signed']);
  const ok = admissionReadiness({ ...base, consentsOnFile: new Set([CONSENT_KEYS.treatment, CONSENT_KEYS.part2]) });
  assert.equal(ok.canAdmit, true, 'missing auth / group consent / case manager are warnings only');
  // PHP: psychiatric evaluation and a prescriber are required
  const php = admissionReadiness({ ...base, programType: 'PHP', part2: false, criteria: allCriteria('PHP'), levelOfCare: { locusRecordId: 'l1', asamComplete: false } });
  assert.ok(php.blockers.includes('Psychiatric evaluation documented (required for PHP)'));
  assert.ok(php.blockers.includes('Psychiatrist / NP assigned (required for PHP)'));
  // Criteria unmet without an override blocks; an override documents the clinical decision
  const partial = { ...base, consentsOnFile: new Set([CONSENT_KEYS.treatment, CONSENT_KEYS.part2]), criteria: {} };
  assert.equal(admissionReadiness(partial).canAdmit, false);
  assert.equal(admissionReadiness({ ...partial, criteriaOverride: 'Step-down from inpatient; IOP indicated' }).canAdmit, true);
  // Minor: minor consent required
  assert.ok(admissionReadiness({ ...base, clientAgeYears: 16 }).blockers.includes('Minor consent to treatment signed'));
  // SUD criteria include withdrawal; MH IOP does not
  assert.ok(criteriaFor('SUD_IOP').some((c) => c.key === 'withdrawal_managed'));
  assert.ok(!criteriaFor('MH_IOP').some((c) => c.key === 'withdrawal_managed'));
});

// ─── Discharge & follow-up ──────────────────────────────────────────────────

test('step-down rules: IOP -> OP, PHP -> IOP / OP; step-up and transfers named', () => {
  assert.deepEqual(stepDownOptions('PHP').slice(0, 2), ['IOP', 'OP']);
  assert.equal(stepDownOptions('MH_IOP')[0], 'OP');
  assert.ok(!stepDownOptions('SUD_IOP').includes('IOP'));
  assert.equal(isStepDown('PHP', 'IOP'), true);
  assert.equal(isStepDown('PHP', 'OP'), true);
  assert.equal(isStepDown('MH_IOP', 'OP'), true);
  assert.equal(isStepDown('MH_IOP', 'PHP'), false);
  assert.equal(isStepUp('MH_IOP', 'PHP'), true);
  assert.equal(isStepUp('PHP', 'inpatient'), true);
  const base = { dischargeDate: '2026-10-21', admissionDate: '2026-09-01', reason: 'step_down', stepDownLevel: 'OP', aftercarePlan: 'Weekly therapy; 988', today: '2026-10-21' };
  assert.deepEqual(dischargeProblems('SUD_IOP', base), []);
  assert.match(dischargeProblems('SUD_IOP', { ...base, stepDownLevel: 'PHP' }).join(';'), /lower level of care/);
  assert.match(dischargeProblems('PHP', { ...base, reason: 'step_up', stepDownLevel: 'IOP' }).join(';'), /higher level/);
  assert.match(dischargeProblems('MH_IOP', { ...base, stepDownLevel: 'IOP' }).join(';'), /Choose the next level of care/);
  assert.match(dischargeProblems('MH_IOP', { ...base, aftercarePlan: ' ' }).join(';'), /Aftercare plan is required/);
  assert.match(dischargeProblems('MH_IOP', { ...base, dischargeDate: '2026-08-01' }).join(';'), /before the admission/);
  assert.match(dischargeProblems('MH_IOP', { ...base, dischargeDate: '2026-10-22' }).join(';'), /future/);
});

test('post-discharge follow-up window (FUH-style, 7 days setting): met / scheduled / missed / outside', () => {
  const b = { dischargeDate: '2026-10-10', windowDays: 7, expected: true };
  assert.equal(followUpStatus({ ...b, followUpDate: '2026-10-15', today: '2026-10-20' }).state, 'met');
  assert.equal(followUpStatus({ ...b, followUpDate: '2026-10-17', today: '2026-10-12' }).state, 'scheduled');
  assert.equal(followUpStatus({ ...b, followUpDate: '2026-10-18', today: '2026-10-20' }).state, 'outside_window');
  assert.equal(followUpStatus({ ...b, followUpDate: '2026-10-10', today: '2026-10-20' }).state, 'outside_window', 'same-day visit does not count');
  assert.equal(followUpStatus({ ...b, followUpDate: null, today: '2026-10-12' }).state, 'open');
  assert.equal(followUpStatus({ ...b, followUpDate: null, today: '2026-10-18' }).state, 'missed');
  assert.equal(followUpStatus({ ...b, followUpDate: null, today: '2026-10-18' }).windowEnd, '2026-10-17');
  assert.equal(followUpExpected('inpatient'), false);
  assert.equal(followUpExpected('OP'), true);
  assert.equal(followUpStatus({ ...b, expected: false, followUpDate: null, today: '2026-10-20' }).state, 'not_expected');
});

// ─── Billing ────────────────────────────────────────────────────────────────

test('billing unit rules: per diem / per session / per 15 min / per hour, minimum minutes, rounding', () => {
  assert.equal(unitsFor({ code: 'H0015', unit: 'per_diem', minMinutes: null, rounding: 'whole' }, 200), 1);
  assert.equal(unitsFor({ code: 'H0015', unit: 'per_diem', minMinutes: 180, rounding: 'whole' }, 170), 0);
  assert.equal(unitsFor({ code: 'H0015', unit: 'per_diem', minMinutes: 180, rounding: 'whole' }, 180), 1);
  assert.equal(unitsFor({ code: '90853', unit: 'per_session', minMinutes: null, rounding: 'midpoint' }, 50), 1);
  const q = { code: 'H0004', unit: 'per_15_min' as const, minMinutes: null, rounding: 'midpoint' as const };
  assert.equal(unitsFor(q, 7), 0);
  assert.equal(unitsFor(q, 8), 1);
  assert.equal(unitsFor(q, 22), 1);
  assert.equal(unitsFor(q, 23), 2);
  assert.equal(unitsFor({ ...q, rounding: 'whole' }, 29), 1);
  assert.equal(unitsFor({ code: 'X0001', unit: 'per_hour', minMinutes: null, rounding: 'midpoint' }, 90), 2);
  assert.equal(unitsFor({ code: 'X0001', unit: 'per_hour', minMinutes: null, rounding: 'whole' }, 90), 1);
});

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  programType: 'SUD_IOP',
  billingMode: 'per_diem',
  perDiemCode: 'H0015',
  serviceCodes: defaultServiceCodes('SUD_IOP'),
  unitRules: [{ code: 'H0015', unit: 'per_diem', minMinutes: 180, rounding: 'whole' }, ...defaultUnitRules('SUD_IOP').slice(1)],
  policyConfirmed: true,
  serviceDate: '2026-10-21',
  admissionDate: '2026-10-01',
  dischargeDate: null,
  psychEvalDate: null,
  auth: { id: 'a1', startDate: '2026-10-01', endDate: '2026-12-31', remaining: 10, approved: 20 },
  ...over,
});
const att = (id: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id, sessionType: 'group' as const, status: 'present', minutes, scheduledMinutes: 90, progressNoteId: 'n' + id, billedByGroupNote: false, ...extra,
});

test('charge drafts (per diem): one line per day, held reasons, nothing outside the admission', () => {
  const ok = draftsForDay(ctx(), [att('1', 90), att('2', 90)]);
  assert.deepEqual(ok.lines, [{ code: 'H0015', units: 1, minutes: 180, sourceKey: 'per_diem', status: 'draft', holdReasons: [] }]);
  assert.equal(draftsForDay(ctx(), [att('1', 90)]).lines.length, 0, 'under the 180-minute minimum set by billing');
  // Minimum not set: drafted but held for billing to confirm
  const unset = draftsForDay(ctx({ unitRules: defaultUnitRules('SUD_IOP') }), [att('1', 90)]);
  assert.deepEqual(unset.lines[0].holdReasons, ['per_diem_minimum_not_set']);
  assert.equal(unset.lines[0].status, 'held');
  // Policy unconfirmed, no auth, auth exhausted / out of dates
  assert.deepEqual(draftsForDay(ctx({ policyConfirmed: false, auth: null }), [att('1', 90), att('2', 90)]).lines[0].holdReasons, ['policy_unconfirmed', 'no_auth']);
  assert.deepEqual(draftsForDay(ctx({ auth: { id: 'a', startDate: '2026-10-01', endDate: '2026-12-31', remaining: 0, approved: 20 } }), [att('1', 90), att('2', 90)]).lines[0].holdReasons, ['auth_exhausted']);
  assert.deepEqual(draftsForDay(ctx({ auth: { id: 'a', startDate: '2026-11-01', endDate: '2026-12-31', remaining: 5, approved: 20 } }), [att('1', 90), att('2', 90)]).lines[0].holdReasons, ['auth_out_of_dates']);
  // Outside the admission: nothing drafted
  assert.equal(draftsForDay(ctx({ dischargeDate: '2026-10-20' }), [att('1', 200)]).lines.length, 0);
  assert.equal(draftsForDay(ctx({ admissionDate: null }), [att('1', 200)]).lines.length, 0);
  // Absences only: nothing
  assert.equal(draftsForDay(ctx(), [att('1', 90, { status: 'absent' })]).lines.length, 0);
  // PHP without a psychiatric evaluation is held
  const php = draftsForDay(ctx({ programType: 'PHP', perDiemCode: 'H0035', unitRules: [{ code: 'H0035', unit: 'per_diem', minMinutes: null, rounding: 'whole' }] }), [att('1', 240)]);
  assert.ok(php.lines[0].holdReasons.includes('php_psych_eval_missing'));
});

test('charge drafts (per service): per session code by session type; group-note billed sessions skipped', () => {
  const c = ctx({ billingMode: 'per_service', programType: 'MH_IOP', serviceCodes: defaultServiceCodes('MH_IOP'), unitRules: defaultUnitRules('MH_IOP') });
  const r = draftsForDay(c, [
    att('g1', 90),
    att('g2', 90, { billedByGroupNote: true }),
    att('i1', 45, { sessionType: 'individual' }),
    att('p1', 30, { sessionType: 'psychiatry' }),
    att('f1', 50, { sessionType: 'family', progressNoteId: null }),
  ]);
  const by = Object.fromEntries(r.lines.map((l) => [l.sourceKey, l]));
  assert.equal(by.g1.code, '90853');
  assert.equal(by.i1.code, '90834');
  assert.equal(by.p1.code, 'UNSET');
  assert.deepEqual(by.p1.holdReasons, ['code_not_set']);
  assert.deepEqual(by.f1.holdReasons, ['note_missing']);
  assert.ok(!by.g2);
  assert.match(r.skipped.find((s) => s.sourceKey === 'g2')!.reason, /group session note/);
});

// ─── Policy defaults ────────────────────────────────────────────────────────

test('policy defaults: IOP adult 9 h, adolescent 6 h, PHP 20 h; blanks are defaults (practice policy — confirm)', () => {
  assert.equal(defaultPolicy('MH_IOP', 'adult').minWeeklyHours, 9);
  assert.equal(defaultPolicy('SUD_IOP', 'adolescent').minWeeklyHours, 6);
  assert.equal(defaultPolicy('PHP', 'adult').minWeeklyHours, 20);
  assert.equal(defaultPolicy('PHP', 'adolescent').minWeeklyHours, 20);
  assert.equal(defaultPolicy('MH_IOP', 'adult').followUpWindowDays, 7);
  const e = effectivePolicy({ programType: 'SUD_IOP', ageGroup: 'adult', minWeeklyHours: null, planReviewDays: 21 });
  assert.deepEqual(e.minWeeklyHours, { value: 9, isDefault: true });
  assert.deepEqual(e.planReviewDays, { value: 21, isDefault: false });
  assert.equal(CONFIRM_LABEL, 'Practice policy — confirm');
});

test('codes: per diem defaults H0015 / S9480 / H0035; unit rules leave the payer minimum unset; no fees', () => {
  assert.equal(PROGRAM_TYPE_META.SUD_IOP.defaultPerDiemCode, 'H0015');
  assert.equal(PROGRAM_TYPE_META.MH_IOP.defaultPerDiemCode, 'S9480');
  assert.equal(PROGRAM_TYPE_META.PHP.defaultPerDiemCode, 'H0035');
  assert.equal(perDiemCodeOf({ programType: 'SUD_IOP', perDiemCode: null }), 'H0015');
  assert.equal(perDiemCodeOf({ programType: 'SUD_IOP', perDiemCode: 'h0015' }), 'H0015');
  for (const t of ['MH_IOP', 'SUD_IOP', 'PHP'] as const) {
    const rules = defaultUnitRules(t);
    assert.equal(rules[0].unit, 'per_diem');
    assert.equal(rules[0].minMinutes, null, `${t}: billable-day minimum is not invented`);
  }
  assert.equal(defaultUnitRules('SUD_IOP').find((r) => r.code === 'H0004')?.unit, 'per_15_min');
  assert.deepEqual(parseUnitRules([{ code: 'h0015', unit: 'per_diem', minMinutes: 0 }, { code: 'bad code', unit: 'x' }], 'SUD_IOP'), [{ code: 'H0015', unit: 'per_diem', minMinutes: null, rounding: 'midpoint' }]);
  const schema = read('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model IntensiveChargeDraft'), schema.indexOf('}', schema.indexOf('model IntensiveChargeDraft')));
  assert.doesNotMatch(model, /rate|amount|fee|cents/i, 'charge drafts store no fee');
});

test('PHP is disabled by default and cannot be turned on without PHP licensure; SUD is Part 2', () => {
  assert.equal(defaultActive('PHP'), false);
  assert.equal(defaultActive('MH_IOP'), true);
  assert.match(programActivationProblem('PHP', true, false) ?? '', /requires PHP licensure/);
  assert.equal(programActivationProblem('PHP', true, true), null);
  assert.equal(programActivationProblem('PHP', false, false), null);
  assert.match(PROGRAM_TYPE_META.PHP.note, /Requires PHP licensure/);
  assert.equal(programIsPart2('SUD_IOP', false), true);
  assert.equal(programIsPart2('MH_IOP', true), false);
  assert.equal(programIsPart2('PHP', true), true);
  assert.equal(programIsPart2('PHP', false), false);
});

// ─── Outcomes ───────────────────────────────────────────────────────────────

test('outcomes: paired first / latest scores; fewer than 10 clients suppressed', () => {
  const adm = new Map([['c1', '2026-09-01'], ['c2', '2026-09-01']]);
  const pairs = pairScores(
    [
      { clientId: 'c1', score: 18, at: '2026-08-25' },
      { clientId: 'c1', score: 9, at: '2026-10-01' },
      { clientId: 'c1', score: 12, at: '2026-09-15' },
      { clientId: 'c2', score: 10, at: '2026-06-01' }, // before the lookback: ignored
      { clientId: 'c2', score: 11, at: '2026-09-10' }, // only one in window: no pair
      { clientId: 'c3', score: 5, at: '2026-09-10' }, // not in the cohort
    ],
    adm,
  );
  assert.deepEqual(pairs, [{ clientId: 'c1', first: 18, latest: 9 }]);
  const small = outcomeSummary(pairs);
  assert.equal(small.suppressed, true);
  assert.equal(small.meanFirst, null);
  const ten = Array.from({ length: 10 }, (_, i) => ({ clientId: `c${i}`, first: 20, latest: i < 6 ? 10 : 22 }));
  const s = outcomeSummary(ten);
  assert.equal(s.suppressed, false);
  assert.equal(s.meanFirst, 20);
  assert.equal(s.improvedPct, 60);
  assert.equal(suppressedRate(3, 9).suppressed, true);
  assert.equal(suppressedRate(3, 9).pct, null);
  assert.equal(suppressedRate(5, 10).pct, 50);
});

// ─── Role access ────────────────────────────────────────────────────────────

test('role access: program hub for the treating team + leadership; charge drafts for billing', () => {
  const allowed = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER'];
  const denied = ['PRP_SPECIALIST', 'PEER_SUPPORT', 'FRONT_DESK', 'OFFICE_MANAGER', 'BILLING', 'HR', 'CRISIS_RESPONDER', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'];
  for (const r of allowed) {
    assert.equal(canAccessPath(r, '/dashboard/programs/intensive'), true, r);
    assert.equal(canAccessApiPath(r, '/api/intensive/hub'), true, r);
  }
  for (const r of denied) {
    assert.equal(canAccessPath(r, '/dashboard/programs/intensive'), false, r);
    assert.equal(canAccessApiPath(r, '/api/intensive/hub'), false, r);
  }
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']) {
    assert.equal(canAccessPath(r, '/dashboard/programs/intensive/billing'), true, r);
    assert.equal(canAccessApiPath(r, '/api/intensive/charges'), true, r);
  }
  // Office Manager removed 2026-10-22 (owner: patient-side billing only)
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'FRONT_DESK', 'OFFICE_MANAGER']) {
    assert.equal(canAccessPath(r, '/dashboard/programs/intensive/billing'), false, r);
    assert.equal(canAccessApiPath(r, '/api/intensive/charges'), false, r);
  }
  assert.equal(canGenerateCharges('BILLING'), true);
  assert.equal(canGenerateCharges('OFFICE_MANAGER'), false);
  assert.equal(canReadCharges('OFFICE_MANAGER'), false);
  assert.equal(canReadCharges('BILLING'), true);
  assert.equal(canManagePrograms('PRACTICE_DIRECTOR'), true);
  assert.equal(canManagePrograms('THERAPIST'), false);
  assert.equal(canMakeClinicalDecisions('THERAPIST'), true);
  assert.equal(canMakeClinicalDecisions('CASE_MANAGER'), false);
  // Providers have no practice rollups; leadership / verified Medical Director do
  assert.equal(canSeeRollups('THERAPIST'), false);
  assert.equal(canSeeRollups('PSYCHIATRIST'), false);
  assert.equal(canSeeRollups('PSYCHIATRIST', true), true);
  assert.equal(canSeeRollups('DIRECTOR'), true);
  assert.ok(CLINIC_NAV_HREFS.includes('/dashboard/programs/intensive'));
  assert.ok(CLINIC_NAV_HREFS.includes('/dashboard/programs/intensive/billing'));
});

test('enrollment scope: team or caseload; Part 2 (SUD) only for SUD program staff or the named prescriber', () => {
  const team = { primaryClinicianId: 'u1', prescriberId: 'u2', caseManagerId: 'u3' };
  const see = (role: string, userId: string, part2: boolean, inCaseload = false) => canSeeEnrollment({ role, userId, part2, team, inCaseload });
  assert.equal(see('THERAPIST', 'u1', false), true, 'primary clinician');
  assert.equal(see('THERAPIST', 'u9', false), false, 'not on team, not in caseload');
  assert.equal(see('THERAPIST', 'u9', false, true), true, 'caseload');
  assert.equal(see('DIRECTOR', 'u9', true), true, 'leadership');
  assert.equal(see('THERAPIST', 'u9', true, true), true, 'SUD-group role in caseload');
  assert.equal(see('PSYCHIATRIST', 'u2', true), true, 'named prescriber on a Part 2 episode');
  assert.equal(see('PSYCHIATRIST', 'u8', true, true), false, 'prescriber not on the Part 2 team, even in caseload');
  assert.equal(see('PSYCHIATRIST', 'u8', false, true), true, 'non-Part 2 caseload');
  assert.equal(see('PRP_SPECIALIST', 'u1', true), false);
  assert.equal(canSeePart2ProgramList('PRP_SPECIALIST'), false);
  assert.equal(canSeePart2ProgramList('NP'), true);
});

// ─── Visit Guide wiring ─────────────────────────────────────────────────────

test('Visit Guide: iop and php kinds, codes, program link, PHP weekly psychiatrist review', () => {
  assert.equal(PROTOCOLS.php.kind, 'php');
  assert.deepEqual(PROTOCOLS.php.cpt, ['H0035']);
  assert.ok(BH_KINDS.has('php') && PLAN_KINDS.has('php'));
  const phpIds = PROTOCOLS.php.steps.map((s) => s.step.id);
  for (const id of ['attendance', 'psych_eval_on_file', 'weekly_review', 'cssrs', 'individual_response']) assert.ok(phpIds.includes(id), id);
  const attendance = PROTOCOLS.iop.steps.find((s) => s.step.id === 'attendance')!.step;
  assert.deepEqual(attendance.action, { kind: 'link', href: '/dashboard/programs/intensive', label: 'Open program roster' });
  assert.equal(kindForCode('H0035', {}), 'php');
  assert.equal(kindForCode('S0201', {}), 'php');
  assert.equal(kindForCode('H0015', {}), 'iop');
  assert.equal(kindForTypeText('PHP Group', {}), 'php');
  assert.equal(kindForTypeText('Partial Hospitalization', {}), 'php');
  assert.equal(resolveVisitKind({ clientProgram: 'php', clinicianRole: 'THERAPIST' }).kind, 'php');
  assert.equal(resolveVisitKind({ clientProgram: 'iop', clinicianRole: 'CASE_MANAGER' }).kind, 'iop');
  assert.equal(resolveVisitKind({ clientProgram: 'php', clinicianRole: 'PSYCHIATRIST' }).kind, 'med_management', 'prescriber visits stay med management');
  const loader = read('src/lib/visits/loader.ts');
  assert.match(loader, /intensiveProgramFor\(org, input\.clientId, now\)/);
  assert.match(loader, /clientProgram: prpEnrollment \? 'prp' : intensiveProgram/);
});

// ─── Routes, migration, nav ─────────────────────────────────────────────────

test('routes gate on the page rule, audit PHI access and never submit claims', () => {
  const dir = path.join(ROOT, 'src/app/api/intensive');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts') files.push(p);
    }
  };
  walk(dir);
  assert.ok(files.length >= 7);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /intensiveGate\(/, f);
    if (!/GET\(\)/.test(src) || /POST|PATCH/.test(src)) assert.match(src, /auditPhiAccess\(/, f);
  }
  const store = read('src/lib/intensive/store.ts');
  assert.doesNotMatch(store, /prisma\.claim\.(create|update)/, 'no claim is created or submitted from the module');
  assert.doesNotMatch(store, /waystar|submitClaim/i);
  assert.match(store, /lockedSensitiveClientIds/);
  assert.match(store, /clientAccessWhere/);
});

test('migration: idempotent tables, Part 2 and draft-status checks', () => {
  const sql = read('prisma/migrations/20261022_intensive_programs.sql');
  for (const t of ['intensive_programs', 'intensive_enrollments', 'intensive_attendance', 'intensive_follow_ups', 'intensive_weekly_reviews', 'intensive_charge_drafts']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`), t);
  }
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.match(sql, /CHECK \("status" IN \('draft', 'held', 'void'\)\)/);
  assert.match(sql, /"programType" <> 'SUD_IOP' OR "part2" = TRUE/);
  assert.match(sql, /duplicate_object/);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

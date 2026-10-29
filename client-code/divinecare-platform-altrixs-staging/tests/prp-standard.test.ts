/**
 * PRP review against the Maryland standard (COMAR 10.63 PRP; Maryland Medicaid PBHS via Carelon):
 * PRP note type, IRP review interval, encounter documentation, monthly minimum and billing model
 * practice settings, discharge / referral rules, authorization summary, Visit Guide protocol.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { NOTE_LABELS, NOTE_PLACEHOLDERS, NOTE_SECTIONS, NOTE_TYPES, isSudNote, normalizeNoteType } from '../src/lib/ehr/noteTemplates';
import {
  computeIrpReviewDue,
  dischargeIssues,
  encounterDocIssues,
  irpFinalizeBlockers,
  isEncounterComplete,
  monthlyMinimumState,
  morsDue,
  PRACTICE_POLICY_CONFIRM,
  PRP_BILLING_MODEL_OPTIONS,
  PRP_BILLING_MODELS,
  prpAuthSummary,
  prpBillingState,
  prpIrpReviewDays,
  prpVisitCodes,
  referralIssues,
  resolveIrpReviewDue,
} from '../src/lib/prp/standard';
import { PRP_BILLING_SOURCES } from '../src/lib/prp/billingRule';
import { billingSummaryReport, hubStats, monthlyProgressReport, type AttendanceRow, type EnrollmentRow } from '../src/lib/prp/reports';
import { PROTOCOLS } from '../src/lib/visits/protocols';
import { assembleGuide, type GuideAssemblyInput } from '../src/lib/visits/guide';
import { resolveVisitKind } from '../src/lib/visits/resolveKind';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

// ─── Note type ──────────────────────────────────────────────────────────────

test('PRP Rehabilitation maps to the PRP note type, not SUD (and is not a Part 2 note by type)', () => {
  assert.equal(normalizeNoteType('PRP Rehabilitation'), 'PRP');
  assert.notEqual(normalizeNoteType('PRP Rehabilitation'), 'SUD');
  assert.equal(normalizeNoteType('PRP Progress Note'), 'PRP');
  assert.equal(isSudNote('PRP Rehabilitation'), false);
  assert.equal(normalizeNoteType('Peer Support Contact'), 'Peer Support');
  assert.equal(isSudNote('Peer Support Contact'), false);
  // Existing SUD aliases unchanged
  assert.equal(normalizeNoteType('Substance Abuse'), 'SUD');
  assert.ok((NOTE_TYPES as readonly string[]).includes('PRP'));
  assert.ok((NOTE_TYPES as readonly string[]).includes('Peer Support'));
  assert.deepEqual([...NOTE_SECTIONS.PRP], ['Service Type & Location', 'IRP Goal Addressed', 'Intervention', 'Participant Response', 'Plan', 'Next Contact']);
  for (const t of ['PRP', 'Peer Support'] as const) {
    assert.ok(NOTE_LABELS[t]);
    for (const h of NOTE_SECTIONS[t]) assert.ok(NOTE_PLACEHOLDERS[t][h], `${t} placeholder for ${h}`);
  }
});

// ─── IRP review interval ────────────────────────────────────────────────────

test('IRP review due comes from the practice setting: adult default 180, under 18 at most 90, capped at 180', () => {
  assert.equal(prpIrpReviewDays(40, null), 180);
  assert.equal(prpIrpReviewDays(40, 120), 120);
  assert.equal(prpIrpReviewDays(40, 365), 180, 'a stored value over 180 never lengthens the interval');
  assert.equal(prpIrpReviewDays(15, null), 90);
  assert.equal(prpIrpReviewDays(15, 60), 60);
  assert.equal(iso(computeIrpReviewDue('2026-01-01', 40, null)), '2026-06-30');
  assert.equal(iso(computeIrpReviewDue('2026-01-01', 16, null)), '2026-04-01');
  assert.equal(iso(computeIrpReviewDue('2026-01-01', null, 120)), '2026-05-01');
  assert.equal(computeIrpReviewDue(null, 40, 180), null);

  const blank = resolveIrpReviewDue({ effectiveDate: '2026-01-01', enteredReviewDate: '', ageYears: 40, practiceDays: 180 });
  assert.ok(blank.ok && blank.computed && iso(blank.reviewDue) === '2026-06-30');
  const within = resolveIrpReviewDue({ effectiveDate: '2026-01-01', enteredReviewDate: '2026-04-15', ageYears: 40, practiceDays: 180 });
  assert.ok(within.ok && !within.computed && iso(within.reviewDue) === '2026-04-15');
  const late = resolveIrpReviewDue({ effectiveDate: '2026-01-01', enteredReviewDate: '2026-05-01', ageYears: 15, practiceDays: 180 });
  assert.equal(late.ok, false);
  const before = resolveIrpReviewDue({ effectiveDate: '2026-01-01', enteredReviewDate: '2025-12-01', ageYears: 40, practiceDays: 180 });
  assert.equal(before.ok, false);
  // Reuses the owner-confirmed plan review rule (commit d14a3e0) instead of a second number
  assert.match(read('src/lib/prp/standard.ts'), /import \{ defaultReviewDays/);
  assert.match(read('src/lib/practice/settings.ts'), /prpIrpReviewDays: int\(30, 180\)\.default\(180\)/);
});

test('IRP finalize needs goals in a rehabilitation need area and participant + staff signatures with dates', () => {
  const base = {
    date: '2026-10-01',
    goals: [{ need: 'Housing', longTermGoal: 'Stable housing', shortTermGoal: '', targetDate: '' }],
    signatures: {
      client: { name: 'A', signature: 'A', date: '2026-10-01' },
      guardian: { name: '', signature: '', date: '' },
      prpCounselor: { name: 'S', signature: 'S', date: '2026-10-01' },
      prpCoordinator: { name: '', signature: '', date: '' },
    },
  };
  assert.deepEqual(irpFinalizeBlockers(base), []);
  assert.ok(irpFinalizeBlockers({ ...base, goals: [{ need: '', longTermGoal: 'x' }] }).some((m) => /need area/.test(m)));
  const noDate = { ...base, signatures: { ...base.signatures, client: { name: 'A', signature: 'A', date: '' } } };
  assert.ok(irpFinalizeBlockers(noDate).includes('Participant signature and date'));
  const noStaff = { ...base, signatures: { ...base.signatures, prpCounselor: { name: '', signature: '', date: '' } } };
  assert.ok(irpFinalizeBlockers(noStaff).includes('PRP staff signature and date'));
  const guardianOnly = { ...base, signatures: { ...base.signatures, client: { name: '', signature: '', date: '' }, guardian: { name: 'G', signature: 'G', date: '2026-10-01' } } };
  assert.deepEqual(irpFinalizeBlockers(guardianOnly, { minor: true }), []);
  assert.ok(irpFinalizeBlockers(guardianOnly, { minor: false }).length > 0);
  // Server enforces the same check
  const wf = read('src/app/api/prp/workflow/route.ts');
  assert.match(wf, /irpFinalizeBlockers\(irpData/);
  assert.match(wf, /resolveIrpReviewDue\(/);
});

// ─── Encounter documentation ────────────────────────────────────────────────

test('encounter documentation completeness: date, minutes, type, onsite/offsite, staff, IRP goal, intervention, response', () => {
  const full = { serviceDate: d('2026-10-05'), minutes: 60, serviceType: 'group', location: 'onsite', recordedById: 'u1', irpGoal: 'Budgeting', intervention: 'Budget worksheet', response: 'Engaged' };
  assert.deepEqual(encounterDocIssues(full), []);
  assert.equal(isEncounterComplete(full), true);
  assert.deepEqual(encounterDocIssues({ serviceDate: d('2026-10-05'), serviceType: 'group', billable: true } as never), [
    'minutes', 'location (onsite / offsite)', 'staff', 'IRP goal addressed', 'intervention', 'participant response',
  ]);
  assert.ok(encounterDocIssues({ ...full, location: 'home' }).includes('location (onsite / offsite)'));
  // Reports count incomplete encounters
  const e: EnrollmentRow = {
    id: 'e1', clientId: 'c1', clientName: 'Alpha', displayId: null, status: 'active', startDate: d('2026-09-01'), createdAt: d('2026-09-01'),
    statusChangedAt: null, dischargedAt: null, dischargeReason: null, specialistId: null, specialistName: null, diagnosisCode: 'F20.9',
  };
  const rows: AttendanceRow[] = [
    { id: 'a1', enrollmentId: 'e1', clientId: 'c1', groupId: null, serviceDate: d('2026-10-05'), serviceType: 'group', billable: true, ...full },
    { id: 'a2', enrollmentId: 'e1', clientId: 'c1', groupId: null, serviceDate: d('2026-10-06'), minutes: null, serviceType: 'individual', billable: true },
  ];
  const progress = monthlyProgressReport({ month: '2026-10', enrollments: [e], attendance: rows, irps: new Map(), mors: [] });
  assert.equal(progress[0].incompleteEncounters, 1);
  const stats = hubStats({ enrollments: [e], attendance: rows, referralsAwaiting: 0, irps: new Map(), month: '2026-10', now: d('2026-10-20'), mors: [] });
  assert.equal(stats.incompleteEncountersThisMonth, 1);
  assert.equal(stats.morsDueThisMonth, 1);
});

// ─── Monthly minimum (practice policy) ──────────────────────────────────────

test('monthly minimum: unset = no flag (labelled practice policy — confirm); set = met / below', () => {
  const unset = monthlyMinimumState(2, null);
  assert.equal(unset.state, 'not_set');
  assert.ok(unset.label.includes(PRACTICE_POLICY_CONFIRM));
  assert.equal(monthlyMinimumState(5, 0).state, 'not_set');
  const below = monthlyMinimumState(2, 4);
  assert.equal(below.state, 'below');
  assert.ok(below.state === 'below' && below.short === 2);
  assert.equal(monthlyMinimumState(4, 4).state, 'met');
  // No payer number is defaulted anywhere: the column is nullable and the migration has no default
  const sql = read('prisma/migrations/20261022_prp_standard.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "prpMonthlyMinContacts" INTEGER;/);
  assert.match(read('prisma/schema.prisma'), /prpMonthlyMinContacts\s+Int\?\n/);
});

// ─── Billing model (practice-confirmed) ─────────────────────────────────────

test('billing model: two options, unconfirmed by default, no codes until confirmed, sources kept', () => {
  assert.deepEqual([...PRP_BILLING_MODELS], ['per_encounter_h2017', 'monthly_case_rate_h2018_h2016']);
  for (const m of PRP_BILLING_MODELS) assert.ok(PRP_BILLING_MODEL_OPTIONS[m].label);
  const none = prpBillingState(null);
  assert.equal(none.confirmed, false);
  assert.equal(none.model, null);
  assert.deepEqual(none.encounterCodes, []);
  assert.ok(none.label.includes(PRACTICE_POLICY_CONFIRM));
  assert.equal(prpBillingState({ prpBillingModel: 'H2017' }).confirmed, false, 'unknown stored value = not confirmed');
  const monthly = prpBillingState({ prpBillingModel: 'monthly_case_rate_h2018_h2016', prpBillingModelConfirmedBy: 'u1', prpBillingModelConfirmedAt: d('2026-10-22') });
  assert.equal(monthly.confirmed, true);
  assert.equal(monthly.confirmedBy, 'u1');
  assert.equal(monthly.confirmedAt, '2026-10-22T00:00:00.000Z');
  assert.deepEqual(monthly.encounterCodes, ['H2016']);
  assert.deepEqual(monthly.monthlyCodes, ['H2018']);
  assert.deepEqual(prpVisitCodes(null), []);
  assert.deepEqual(prpVisitCodes('per_encounter_h2017'), ['H2017']);
  assert.equal(monthly.sources, PRP_BILLING_SOURCES);
  assert.ok(PRP_BILLING_SOURCES.length >= 2);
  // No unit minutes or visit thresholds in the options
  assert.ok(!/\b\d+\s*(minutes|min)\b/i.test(JSON.stringify(PRP_BILLING_MODEL_OPTIONS)));
  // Billing summary carries the setting state and never units
  const r = billingSummaryReport({ month: '2026-10', enrollments: [], attendance: [], billing: none });
  assert.equal(r.billingModel, null);
  // Settings writes are leadership-only and audited
  const route = read('src/app/api/prp/settings/route.ts');
  assert.match(route, /PRP_SETTINGS_ROLES\.has/);
  assert.match(route, /auditPhiAccess\(/);
  assert.match(route, /outcome: 'DENIED'/);
  assert.match(read('prisma/migrations/20261022_prp_standard.sql'), /ADD COLUMN IF NOT EXISTS "prpBillingModel" TEXT;/);
});

// ─── Visit Guide protocol ───────────────────────────────────────────────────

test('Visit Guide prp: PRP note type, note steps name real sections, codes follow the billing setting', () => {
  const p = PROTOCOLS.prp;
  assert.equal(p.noteType, 'PRP');
  assert.deepEqual(p.cpt, [], 'no PRP code asserted by the static protocol');
  const sections = NOTE_SECTIONS.PRP;
  const noteSteps = p.steps.filter((e) => e.step.source === 'note');
  assert.ok(noteSteps.length >= 5);
  for (const { step } of noteSteps) assert.ok(sections.includes(step.noteSection!), step.id);
  const input: GuideAssemblyInput = {
    kind: 'prp', resolvedFrom: 'test', appointmentId: 'a1', clientId: 'c1', viewerAudience: 'program',
    conditions: { telehealth: false }, ageYears: 40,
    brief: { lastVisit: null, lastPlan: null, openFollowUps: [], scores: [], risk: { level: 'low', openAlerts: 0, safetyPlanOnFile: false }, meds: [], changesSinceLastVisit: [], careTeam: [] },
    due: [], autoChecks: {}, marks: [], followUp: { medChange: false, elevatedRisk: false, nextBooked: null },
  };
  const g = assembleGuide(input);
  assert.deepEqual(g.cpt, []);
  assert.ok(g.steps.filter((s) => s.source === 'note').length === noteSteps.length, 'no note step downgraded to manual');
  assert.deepEqual(assembleGuide({ ...input, cpt: prpVisitCodes('monthly_case_rate_h2018_h2016') }).cpt, ['H2016']);
  assert.match(read('src/lib/visits/loader.ts'), /prpVisitCodes\(settings\?\.prpBillingModel/);
  assert.equal(resolveVisitKind({ notes: 'Valant code: H2016', appointmentType: 'Telehealth' } as never).kind, 'prp');
});

// ─── MORS, discharge, referral, authorization ───────────────────────────────

test('MORS is due monthly for open enrollments', () => {
  assert.equal(morsDue('active', null), true);
  assert.equal(morsDue('on_hold', undefined), true);
  assert.equal(morsDue('active', 5), false);
  assert.equal(morsDue('discharged', null), false);
});

test('discharge needs type, reason and aftercare; transitioning needs a transition plan', () => {
  assert.deepEqual(dischargeIssues({ status: 'discharged', dischargeType: 'goals_met', dischargeReason: 'Goals met', aftercarePlan: 'OMHC therapy weekly' }), []);
  assert.deepEqual(dischargeIssues({ status: 'discharged', dischargeType: 'goals_met', dischargeReason: 'Goals met' }), ['Aftercare plan (referrals, appointments, crisis resources)']);
  assert.deepEqual(dischargeIssues({ status: 'discharged', dischargeType: 'deceased', dischargeReason: 'Deceased' }), []);
  assert.ok(dischargeIssues({ status: 'discharged', dischargeReason: 'x', aftercarePlan: 'y' }).includes('Discharge type'));
  assert.deepEqual(dischargeIssues({ status: 'transitioning' }), ['Transition plan']);
  assert.deepEqual(dischargeIssues({ status: 'active' }), []);
  assert.match(read('src/lib/prp/program.ts'), /dischargeIssues\(input\)/);
});

test('referral captures the licensed referrer (credential, license, state, treating) and rated functional impairment', () => {
  const ok = {
    referrerCredential: 'LCSW-C', licenseNumber: 'C12345', referrerLicenseState: 'MD', referrerIsTreating: true,
    prescriberNpi: '1234567890', impairmentJson: { 'Daily Living': '2' }, functionalNarrative: 'Needs support with daily living.',
  };
  assert.deepEqual(referralIssues(ok), []);
  assert.ok(referralIssues({ ...ok, referrerCredential: 'LGPC' }).some((m) => /credential/.test(m)), 'pre-licensed cannot refer');
  assert.ok(referralIssues({ ...ok, licenseNumber: '' }).includes('Referrer license number'));
  assert.ok(referralIssues({ ...ok, referrerIsTreating: false }).length === 1);
  assert.ok(referralIssues({ ...ok, impairmentJson: {} }).includes('At least one rated functional impairment domain'));
  const api = read('src/app/api/prp/referrals/route.ts');
  assert.match(api, /referralIssues\(body\)/);
  assert.match(api, /referrerIsTreating: z\.literal\(true\)/);
});

test('authorization summary: units, dates and renewal state on the hub', () => {
  const now = d('2026-10-20');
  const base = { id: 'p1', authNumber: 'A1', status: 'APPROVED', payer: 'Maryland Medicaid (PBHS)', startDate: d('2026-05-01'), endDate: d('2026-12-31'), unitsApproved: 90, unitsUsed: 30 };
  const active = prpAuthSummary(base, now, 14);
  assert.equal(active.renewal, 'active');
  assert.equal(active.unitsRemaining, 60);
  assert.equal(prpAuthSummary({ ...base, endDate: d('2026-10-30') }, now, 14).renewal, 'renew_now');
  assert.equal(prpAuthSummary({ ...base, endDate: d('2026-10-01') }, now, 14).renewal, 'expired');
  assert.equal(prpAuthSummary({ ...base, status: 'DRAFT', unitsApproved: 0 }, now, 14).renewal, 'pending');
  assert.equal(prpAuthSummary({ ...base, status: 'DRAFT' }, now, 14).unitsRemaining, null);
  const hub = read('src/app/api/prp/hub/route.ts');
  assert.match(hub, /loadPrpAuths\(g\.actor, enrollments, now\)/);
  // prior-auth drafts now use the PRP gate and the caseload scope
  const pa = read('src/app/api/prp/prior-auth/route.ts');
  assert.match(pa, /prpGate\(PRP_STATUS_ROLES\)/);
  assert.match(pa, /clientAccessWhere\(g\.actor\)/);
});

// ─── Migration ──────────────────────────────────────────────────────────────

test('20261022_prp_standard.sql adds every new column idempotently and writes no data', () => {
  const sql = read('prisma/migrations/20261022_prp_standard.sql');
  const cols: [string, string][] = [
    ['PracticeSettings', 'prpBillingModel'], ['PracticeSettings', 'prpBillingModelConfirmedBy'], ['PracticeSettings', 'prpBillingModelConfirmedAt'],
    ['PracticeSettings', 'prpMonthlyMinContacts'], ['PracticeSettings', 'prpPolicyUpdatedBy'], ['PracticeSettings', 'prpPolicyUpdatedAt'],
    ['PrpReferral', 'referrerCredential'], ['PrpReferral', 'referrerLicenseState'], ['PrpReferral', 'referrerIsTreating'],
    ['PrpEnrollment', 'dischargeType'], ['PrpEnrollment', 'transitionPlan'], ['PrpEnrollment', 'aftercarePlan'], ['PrpEnrollment', 'dischargedById'],
    ['prp_attendance', 'location'], ['prp_attendance', 'irpGoal'], ['prp_attendance', 'intervention'], ['prp_attendance', 'response'],
  ];
  for (const [table, col] of cols) assert.match(sql, new RegExp(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}"`), `${table}.${col}`);
  assert.ok(!/\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i.test(sql.replace(/--.*$/gm, '')));
});

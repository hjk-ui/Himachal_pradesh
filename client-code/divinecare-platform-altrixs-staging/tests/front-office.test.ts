import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ELIGIBILITY_WINDOW_DAYS,
  applyMark,
  authorizationVerdict,
  buildItems,
  carelonItem,
  confirmItem,
  consentsItem,
  copayItem,
  demographicsGaps,
  eligibilityVerdict,
  intakeItem,
  itemIdFromStep,
  markProblem,
  nextApptItem,
  payerMatches,
  readinessOf,
  reconcileCopays,
  stepIdFor,
  summarizeDay,
  type FoAuthFact,
  type FoEligibilityFact,
  type FoFacts,
} from '../src/lib/frontOffice/rules';
import { exceptionQueue, rollupByLocation, unsignedByClinician } from '../src/lib/frontOffice/operationsCore';
import { canUseFrontOffice, canViewFrontOfficeOperations } from '../src/lib/frontOffice/access';
import type { FoItemId, FoMark, FoRow } from '../src/lib/frontOffice/types';

const NOW = new Date('2026-10-20T14:00:00Z');
const VISIT = new Date('2026-10-21T14:00:00Z');
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

const check = (over: Partial<FoEligibilityFact> = {}): FoEligibilityFact => ({
  status: 'ELIGIBLE',
  checkedAt: daysBefore(VISIT, 3),
  payerName: 'Aetna',
  awaitingResponse: false,
  priorAuthRequired: false,
  channel: 'waystar',
  ...over,
});

function facts(over: Partial<FoFacts> = {}, appt: Partial<FoFacts['appointment']> = {}, client: Partial<FoFacts['client']> = {}): FoFacts {
  return {
    now: NOW,
    visitDate: '2026-10-21',
    today: '2026-10-20',
    appointment: {
      id: 'a1',
      clientId: 'c1',
      startsAt: VISIT,
      endsAt: new Date(VISIT.getTime() + 3_600_000),
      status: 'SCHEDULED',
      isVirtual: false,
      confirmedAt: null,
      payer: 'Aetna',
      isNewClient: false,
      hasJoinLink: false,
      authorizedProgram: false,
      ...appt,
    },
    client: {
      legalFirstName: 'Ana',
      legalLastName: 'Diaz',
      dateOfBirth: '1990-05-01',
      administrativeSex: 'F',
      addressLine1: '1 Main St',
      city: 'Bowie',
      state: 'MD',
      postalCode: '20715',
      phone: '301-555-0142',
      insurancePayer: 'Aetna',
      insuranceMemberId: 'W123',
      identityVerifyRequired: false,
      smsConsent: true,
      smsOptedOut: false,
      hasEmail: true,
      medicaid: false,
      ...client,
    },
    eligibility: [check()],
    auths: [],
    consents: null,
    intake: { status: 'none', sentAt: null, completedAt: null },
    carelonNeeded: false,
    marks: new Map(),
    phone: '301-555-0142',
    ...over,
  };
}

// ─── Eligibility staleness window ────────────────────────────────────────────

test('eligibility: current inside the window, stale outside it', () => {
  const base = { payer: 'Aetna', medicaid: false, visitAt: VISIT };
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ checkedAt: daysBefore(VISIT, ELIGIBILITY_WINDOW_DAYS) })] }).state, 'current');
  const stale = eligibilityVerdict({ ...base, checks: [check({ checkedAt: daysBefore(VISIT, ELIGIBILITY_WINDOW_DAYS + 1) })] });
  assert.equal(stale.state, 'stale');
  assert.equal(eligibilityVerdict({ ...base, windowDays: 7, checks: [check({ checkedAt: daysBefore(VISIT, 10) })] }).state, 'stale');
});

test('eligibility: Medicaid needs a check in the visit month', () => {
  const visit = new Date('2026-11-02T15:00:00Z');
  const v = eligibilityVerdict({ payer: 'Maryland Medicaid', medicaid: true, visitAt: visit, checks: [check({ payerName: 'Maryland Medicaid', checkedAt: new Date('2026-10-28T15:00:00Z') })] });
  assert.equal(v.state, 'stale');
  assert.equal(eligibilityVerdict({ payer: 'Maryland Medicaid', medicaid: true, visitAt: visit, medicaidSameMonth: false, checks: [check({ payerName: 'Maryland Medicaid', checkedAt: new Date('2026-10-28T15:00:00Z') })] }).state, 'current');
});

test('eligibility: never checked, inactive, failed, awaiting, payer mismatch, self-pay', () => {
  const base = { payer: 'Aetna', medicaid: false, visitAt: VISIT };
  assert.equal(eligibilityVerdict({ ...base, checks: [] }).state, 'none');
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ status: 'INELIGIBLE' })] }).state, 'inactive');
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ status: 'ERROR' })] }).state, 'error');
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ status: 'PENDING', awaitingResponse: true })] }).state, 'awaiting');
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ payerName: 'Cigna' })] }).state, 'payer_mismatch');
  assert.equal(eligibilityVerdict({ ...base, payer: null, checks: [] }).state, 'self_pay');
  assert.equal(eligibilityVerdict({ ...base, payer: 'Self Pay', checks: [] }).state, 'self_pay');
});

test('eligibility: a new 270 out or a failed retry keeps an earlier current answer', () => {
  const base = { payer: 'Aetna', medicaid: false, visitAt: VISIT };
  const older = check({ checkedAt: daysBefore(VISIT, 5) });
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ status: 'PENDING', awaitingResponse: true, checkedAt: daysBefore(VISIT, 1) }), older] }).state, 'current');
  assert.equal(eligibilityVerdict({ ...base, checks: [check({ status: 'ERROR', checkedAt: daysBefore(VISIT, 1) }), older] }).state, 'current');
});

test('eligibility item: inactive coverage is a suggested stop with the run action', () => {
  const it = buildItems(facts({ eligibility: [check({ status: 'INELIGIBLE' })] })).find((x) => x.id === 'eligibility')!;
  assert.equal(it.status, 'needs_action');
  assert.equal(it.stop, true);
  assert.deepEqual(it.action, { kind: 'run_eligibility' });
});

test('eligibility item is absent when the role cannot see eligibility', () => {
  assert.equal(buildItems(facts({ eligibility: undefined })).some((x) => x.id === 'eligibility'), false);
});

test('payer names match loosely but not across payers', () => {
  assert.ok(payerMatches('Aetna', 'aetna better health'));
  assert.ok(!payerMatches('Aetna', 'Cigna'));
  assert.ok(!payerMatches(null, 'Cigna'));
});

// ─── Demographics completeness ───────────────────────────────────────────────

test('demographics: complete insured client has no gaps', () => {
  assert.deepEqual(demographicsGaps(facts().client, 'Aetna', false, NOW), []);
});

test('demographics: missing ZIP, DOB, member ID and phone are reported', () => {
  const gaps = demographicsGaps({ ...facts().client, postalCode: null, dateOfBirth: null, insuranceMemberId: null, phone: null }, 'Aetna', false, NOW);
  assert.ok(gaps.includes('ZIP code'));
  assert.ok(gaps.includes('Date of birth'));
  assert.ok(gaps.includes('Insurance member ID'));
  assert.ok(gaps.some((g) => /^Phone/.test(g)));
});

test('demographics: self-pay does not need insurance fields', () => {
  const gaps = demographicsGaps({ ...facts().client, insurancePayer: null, insuranceMemberId: null }, null, false, NOW);
  assert.deepEqual(gaps, []);
});

test('demographics: invalid phone is a gap', () => {
  const gaps = demographicsGaps({ ...facts().client, phone: '555' }, 'Aetna', false, NOW);
  assert.ok(gaps.some((g) => /10-digit/.test(g)));
});

// ─── Authorization need ──────────────────────────────────────────────────────

const auth = (over: Partial<FoAuthFact> = {}): FoAuthFact => ({
  payer: 'Maryland Medicaid',
  authNumber: 'A1',
  status: 'APPROVED',
  unitsApproved: 90,
  unitsUsed: 10,
  startDate: new Date('2026-07-01'),
  endDate: new Date('2026-12-31'),
  ...over,
});

test('authorization: not needed without a payer request, program rule or auth on file', () => {
  const v = authorizationVerdict({ payer: 'Aetna', visitAt: VISIT, medicaid: false, authorizedProgram: false, priorAuthRequired: false, auths: [] });
  assert.equal(v.needed, false);
});

test('authorization: needed when the 271 says so, missing auth = problem', () => {
  const v = authorizationVerdict({ payer: 'Aetna', visitAt: VISIT, medicaid: false, authorizedProgram: false, priorAuthRequired: true, auths: [] });
  assert.equal(v.needed, true);
  assert.ok(v.needed && v.problem);
});

test('authorization: Medicaid PRP needs one; approved auth with units is done; low units warn', () => {
  const base = { payer: 'Maryland Medicaid', visitAt: VISIT, medicaid: true, authorizedProgram: true, priorAuthRequired: false };
  const ok = authorizationVerdict({ ...base, auths: [auth()] });
  assert.ok(ok.needed && !ok.problem && ok.remaining === 80 && !ok.low);
  const low = authorizationVerdict({ ...base, auths: [auth({ unitsUsed: 88 })] });
  assert.ok(low.needed && !low.problem && low.low);
  const out = authorizationVerdict({ ...base, auths: [auth({ unitsUsed: 90 })] });
  assert.ok(out.needed && out.problem === 'No units left on the authorization');
  const expired = authorizationVerdict({ ...base, auths: [auth({ endDate: new Date('2026-09-30') })] });
  assert.ok(expired.needed && /does not cover/.test(expired.problem ?? ''));
  const none = authorizationVerdict({ ...base, auths: [] });
  assert.ok(none.needed && none.problem === 'No approved authorization on file');
});

test('authorization: an auth on file for the payer means units are tracked', () => {
  const v = authorizationVerdict({ payer: 'Aetna', visitAt: VISIT, medicaid: false, authorizedProgram: false, priorAuthRequired: false, auths: [auth({ payer: 'Aetna' })] });
  assert.equal(v.needed, true);
});

// ─── Consents / intake / Carelon flags ───────────────────────────────────────

test('consents: needed is a suggested stop; expiring is done with a warning; hidden for roles without consents', () => {
  const needed = consentsItem(facts({ consents: { needed: 2, expiring: 0, titles: ['Consent to Treat', 'Telehealth consent'] } }))!;
  assert.equal(needed.status, 'needs_action');
  assert.equal(needed.stop, true);
  assert.match(needed.reason, /Consent to Treat/);
  const exp = consentsItem(facts({ consents: { needed: 0, expiring: 1, titles: [] } }))!;
  assert.equal(exp.status, 'done');
  assert.equal(exp.warning, true);
  assert.equal(consentsItem(facts({ consents: undefined })), null);
});

test('intake: only for new clients; pending / expired / completed', () => {
  assert.equal(intakeItem(facts())!.status, 'not_applicable');
  assert.equal(intakeItem(facts({}, { isNewClient: true }))!.status, 'needs_action');
  assert.equal(intakeItem(facts({ intake: { status: 'pending', sentAt: NOW, completedAt: null } }, { isNewClient: true }))!.status, 'needs_action');
  assert.equal(intakeItem(facts({ intake: { status: 'completed', sentAt: NOW, completedAt: NOW } }, { isNewClient: true }))!.status, 'done');
  // In-person established-client intake (n/a) is hidden from the list
  assert.equal(buildItems(facts()).some((x) => x.id === 'intake'), false);
});

test('carelon: needed for Medicaid without an attestation; n/a otherwise', () => {
  assert.equal(carelonItem(facts({ carelonNeeded: true }, {}, { medicaid: true }))!.status, 'needs_action');
  assert.equal(carelonItem(facts({ carelonNeeded: false }, {}, { medicaid: true }))!.status, 'done');
  assert.equal(carelonItem(facts({ carelonNeeded: false }))!.status, 'not_applicable');
  assert.equal(carelonItem(facts({ carelonNeeded: undefined })), null);
});

// ─── Confirmation, marks, check-out ──────────────────────────────────────────

test('confirm: unconfirmed visit says which channels exist; confirmed is done', () => {
  const c = confirmItem(facts({}, {}, { smsConsent: false, hasEmail: false }));
  assert.equal(c.status, 'needs_action');
  assert.match(c.reason, /no SMS consent/);
  assert.equal(confirmItem(facts({}, { confirmedAt: NOW })).status, 'done');
});

test('marks: done / N/A override with the reason; deferred stays open', () => {
  const base = confirmItem(facts());
  const mark = (status: FoMark['status']): FoMark => ({ status, reason: 'Called, confirmed', byName: 'Jo', at: NOW.toISOString() });
  assert.equal(applyMark(base, mark('done')).status, 'done');
  const na = applyMark(base, { ...mark('not_applicable'), reason: 'Walk-in' });
  assert.equal(na.status, 'not_applicable');
  assert.match(na.reason, /Walk-in/);
  assert.equal(applyMark(base, mark('deferred')).status, 'needs_action');
});

test('mark validation: reason for N/A, note for items that need one, computed items not markable', () => {
  assert.equal(markProblem('confirm', 'done', null), null);
  assert.ok(markProblem('confirm', 'not_applicable', ''));
  assert.ok(markProblem('outreach', 'done', ''));
  assert.equal(markProblem('outreach', 'done', 'Left voicemail'), null);
  assert.ok(markProblem('consents', 'done', 'signed on paper'));
  assert.ok(markProblem('check_in', 'done', null));
});

test('step ids round-trip and never collide with visit guide steps', () => {
  for (const id of ['confirm', 'eligibility', 'outreach'] as FoItemId[]) assert.equal(itemIdFromStep(stepIdFor(id)), id);
  assert.equal(itemIdFromStep('phq9'), null);
  const protocols = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'visits', 'protocols.ts'), 'utf8');
  assert.ok(!/id: 'fo_/.test(protocols));
});

test('next appointment: follow-up requested by the clinician is required and links to booking', () => {
  const it = nextApptItem(facts({ followUpRequested: true, followUpDays: 14 }, { status: 'COMPLETED' }))!;
  assert.equal(it.status, 'needs_action');
  assert.equal(it.level, 'required');
  assert.ok(it.action?.kind === 'link' && it.action.href.includes('after=2026-11-04'));
  assert.equal(nextApptItem(facts({ nextAppointmentAt: new Date('2026-11-04T14:00:00Z') }, { status: 'COMPLETED' }))!.status, 'done');
  assert.equal(nextApptItem(facts()), null);
});

test('missed visit: reschedule + outreach at end of day; readiness uses the end-of-day phase', () => {
  const items = buildItems(facts({}, { status: 'NO_SHOW' }));
  assert.ok(items.some((x) => x.id === 'reschedule' && x.status === 'needs_action'));
  assert.ok(items.some((x) => x.id === 'outreach' && x.status === 'needs_action'));
  assert.equal(readinessOf('NO_SHOW', items), 'attention');
  const handled = buildItems(
    facts(
      {
        nextAppointmentAt: new Date('2026-10-28T14:00:00Z'),
        marks: new Map([['outreach', { status: 'done', reason: 'Called', byName: null, at: NOW.toISOString() }]]),
      },
      { status: 'NO_SHOW' }
    )
  );
  assert.equal(readinessOf('NO_SHOW', handled), 'closed');
});

test('readiness before arrival: prep items only (check-in tasks do not block tomorrow)', () => {
  const items = buildItems(facts({}, { confirmedAt: NOW }));
  assert.equal(readinessOf('SCHEDULED', items), 'ready');
  const unconfirmed = buildItems(facts());
  assert.equal(readinessOf('SCHEDULED', unconfirmed), 'attention');
  const identity = buildItems(facts({}, { confirmedAt: NOW }, { identityVerifyRequired: true }));
  assert.equal(readinessOf('SCHEDULED', identity), 'stop');
});

// ─── Copay + end-of-day reconciliation math ──────────────────────────────────

test('copay item: expected vs posted', () => {
  assert.equal(copayItem(facts({ copay: { expectedCents: 3000, source: 'copay rule', note: null }, collected: { cents: 3000, count: 1 } }, { status: 'CHECKED_IN' }))!.status, 'done');
  const part = copayItem(facts({ copay: { expectedCents: 3000, source: 'copay rule', note: null }, collected: { cents: 1000, count: 1 } }, { status: 'CHECKED_IN' }))!;
  assert.equal(part.status, 'needs_action');
  assert.match(part.reason, /\$10\.00 of \$30\.00/);
  assert.equal(copayItem(facts({ copay: { expectedCents: null, source: null, note: 'No copay rule for this payer' } }))!.status, 'not_applicable');
  assert.equal(copayItem(facts({})), null);
});

const row = (over: Partial<FoRow>): FoRow => ({
  appointmentId: 'a',
  clientId: 'c',
  clientName: 'X',
  locked: false,
  clinicianName: 'Dr A',
  type: 'Therapy',
  date: '2026-10-20',
  startTime: '09:00',
  endTime: '10:00',
  startsAt: '2026-10-20T13:00:00.000Z',
  endsAt: '2026-10-20T14:00:00.000Z',
  status: 'COMPLETED',
  isVirtual: false,
  isNewClient: false,
  payer: 'Aetna',
  locationId: 'bowie',
  locationName: 'Bowie',
  phone: null,
  items: [],
  readiness: 'ready',
  open: { prep: 0, check_in: 0, check_out: 0, end_of_day: 0 },
  copay: null,
  noteSigned: true,
  ...over,
});

test('reconciliation: expected vs posted, missing, marked-not-posted, one payment per client', () => {
  const r = reconcileCopays([
    row({ appointmentId: '1', clientId: 'c1', copay: { expectedCents: 3000, collectedCents: 3000, markedCollected: false } }),
    row({ appointmentId: '2', clientId: 'c2', copay: { expectedCents: 2000, collectedCents: 0, markedCollected: true } }),
    row({ appointmentId: '3', clientId: 'c3', copay: { expectedCents: 4000, collectedCents: 1000, markedCollected: false } }),
    // Two visits the same day for c4: one $50 payment covers both $25 copays, counted once
    row({ appointmentId: '4', clientId: 'c4', copay: { expectedCents: 2500, collectedCents: 5000, markedCollected: false } }),
    row({ appointmentId: '5', clientId: 'c4', copay: { expectedCents: 2500, collectedCents: 5000, markedCollected: false } }),
    // Not a kept visit: ignored
    row({ appointmentId: '6', clientId: 'c5', status: 'NO_SHOW', copay: { expectedCents: 3000, collectedCents: 0, markedCollected: false } }),
    // Kept, no copay rule, but paid a balance: counted as posted, not expected
    row({ appointmentId: '7', clientId: 'c6', copay: { expectedCents: null, collectedCents: 1500, markedCollected: false } }),
  ]);
  assert.equal(r.expectedCount, 5);
  assert.equal(r.expectedCents, 3000 + 2000 + 4000 + 5000);
  assert.equal(r.collectedCount, 3);
  assert.equal(r.collectedCents, 3000 + 0 + 1000 + 5000 + 1500);
  assert.equal(r.missingCount, 2);
  assert.equal(r.missingCents, 2000 + 3000);
  assert.equal(r.markedNotPostedCount, 1);
});

test('day summary: counts, not-closed visits after the grace period, unsigned notes', () => {
  const now = new Date('2026-10-20T20:00:00Z');
  const s = summarizeDay(
    '2026-10-20',
    [
      row({ appointmentId: '1', status: 'SCHEDULED', readiness: 'attention' }),
      row({ appointmentId: '2', status: 'NO_SHOW', readiness: 'attention' }),
      row({ appointmentId: '3', status: 'COMPLETED', noteSigned: false }),
      row({ appointmentId: '4', status: 'CANCELLED', readiness: 'closed' }),
      row({ appointmentId: '5', date: '2026-10-21' }),
    ],
    true,
    now
  );
  assert.equal(s.total, 3);
  assert.equal(s.kept, 1);
  assert.equal(s.noShows, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.notClosed, 1);
  assert.equal(s.unsignedNotes, 1);
  assert.ok(s.reconciliation);
});

// ─── Operations rollup ───────────────────────────────────────────────────────

test('operations: rollup by location and exception queue', () => {
  const eligOpen = { id: 'eligibility' as const, phase: 'prep' as const, label: 'Eligibility verified', level: 'required' as const, status: 'needs_action' as const, reason: 'Never verified', markable: true };
  const copayOpen = { ...eligOpen, id: 'copay' as const, phase: 'check_in' as const, reason: 'Expected $30' };
  const rows = [
    row({ appointmentId: '1', status: 'SCHEDULED', readiness: 'attention', items: [eligOpen] }),
    row({ appointmentId: '2', status: 'SCHEDULED', readiness: 'ready', locationId: 'ss', locationName: 'Silver Spring' }),
    row({ appointmentId: '3', status: 'SCHEDULED', readiness: 'stop', date: '2026-10-21', items: [eligOpen, copayOpen] }),
  ];
  const today = rollupByLocation(rows, '2026-10-20');
  assert.deepEqual(today.map((l) => [l.locationName, l.visits, l.ready, l.attention]), [['Bowie', 1, 0, 1], ['Silver Spring', 1, 1, 0]]);
  const q = exceptionQueue(rows, '2026-10-20');
  assert.equal(q.find((g) => g.key === 'eligibility')?.count, 2);
  // copay is day-of work: tomorrow's open copay is not an exception yet
  assert.equal(q.some((g) => g.key === 'copay'), false);
});

test('operations: unsigned notes past the deadline counted per clinician', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const out = unsignedByClinician(
    [
      { clinicianName: 'Dr A', endsAt: new Date('2026-10-15T15:00:00Z'), signed: false },
      { clinicianName: 'Dr A', endsAt: new Date('2026-10-19T15:00:00Z'), signed: false }, // inside 72h
      { clinicianName: 'Dr B', endsAt: new Date('2026-10-10T15:00:00Z'), signed: false },
      { clinicianName: 'Dr B', endsAt: new Date('2026-10-10T15:00:00Z'), signed: true },
    ],
    72,
    now
  );
  assert.deepEqual(out.map((c) => [c.clinicianName, c.count]), [['Dr A', 1], ['Dr B', 1]]);
});

test('access: front office roles and the operations view', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR']) assert.ok(canUseFrontOffice(r), r);
  for (const r of ['THERAPIST', 'BILLING', 'HR', 'PEER_SUPPORT', 'CLIENT']) assert.ok(!canUseFrontOffice(r), r);
  assert.ok(canViewFrontOfficeOperations('OFFICE_MANAGER'));
  assert.ok(!canViewFrontOfficeOperations('FRONT_DESK'));
});

test('no clinical content: front-office modules never read notes, diagnoses, meds, assessments or risk', () => {
  const dir = path.join(__dirname, '..', 'src', 'lib', 'frontOffice');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/primaryDiagnosis|clientMedication|clinicalAssessment|riskAlert|progressNote\.find|body:\s*true/.test(src), `${f} reads clinical content`);
  }
});

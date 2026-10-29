import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySafetyScreen,
  canAddToWaitlist,
  canEditWaitlistEntry,
  canManageWaitlist,
  canViewWaitlist,
  CLOSE_REASONS,
  deriveStage,
  findDuplicateCandidates,
  intakeAppointmentFor,
  locationFit,
  nextNoResponseCount,
  panelStatusFor,
  runConversion,
  serviceCategory,
  shouldPromptNoResponseClose,
  slotFitsAvailability,
  sortByPriority,
  stageAfterContact,
  statusForStage,
  validateClose,
  type ConversionDeps,
} from '../src/lib/waitlist/standard';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { taskSourcesForRole } from '../src/lib/tasks/manage';

// ── Priority ordering ─────────────────────────────────────────────────────────────────────

test('priority: open first; crisis, urgent, routine; then longest waiting', () => {
  const rows = [
    { id: 'routine-old', urgency: 'ROUTINE', createdAt: '2026-08-01T00:00:00Z', stage: 'NEW' },
    { id: 'urgent-new', urgency: 'URGENT', createdAt: '2026-10-20T00:00:00Z', stage: 'CONTACTED' },
    { id: 'crisis', urgency: 'CRISIS', createdAt: '2026-10-25T00:00:00Z', stage: 'NEW' },
    { id: 'urgent-old', urgency: 'URGENT', createdAt: '2026-09-01T00:00:00Z', stage: 'READY' },
    { id: 'closed-crisis', urgency: 'CRISIS', createdAt: '2026-01-01T00:00:00Z', stage: 'CLOSED' },
    { id: 'routine-new', urgency: 'ROUTINE', createdAt: '2026-10-26T00:00:00Z', stage: 'NEW' },
    { id: 'safety-routine', urgency: 'ROUTINE', createdAt: '2026-10-26T00:00:00Z', stage: 'NEW', safetyScreen: 'yes' },
  ];
  assert.deepEqual(
    sortByPriority(rows).map((r) => r.id),
    ['crisis', 'urgent-old', 'urgent-new', 'safety-routine', 'routine-old', 'routine-new', 'closed-crisis']
  );
});

// ── Safety screen ─────────────────────────────────────────────────────────────────────────

test('safety screen "yes" marks the entry at least URGENT and shows crisis guidance', () => {
  assert.deepEqual(applySafetyScreen('ROUTINE', 'yes'), { urgency: 'URGENT', crisisGuidance: true });
  assert.deepEqual(applySafetyScreen('CRISIS', 'yes'), { urgency: 'CRISIS', crisisGuidance: true });
  assert.deepEqual(applySafetyScreen('URGENT', 'no'), { urgency: 'URGENT', crisisGuidance: false });
  assert.deepEqual(applySafetyScreen('ROUTINE', 'not_asked'), { urgency: 'ROUTINE', crisisGuidance: false });
  assert.deepEqual(applySafetyScreen('ROUTINE', null), { urgency: 'ROUTINE', crisisGuidance: false });
});

// ── Duplicate check ───────────────────────────────────────────────────────────────────────

test('duplicate check: name + DOB, phone or email find an existing client; strong first', () => {
  const clients = [
    { id: 'c-phone', name: 'Someone Else', phone: '(301) 555-0199', dateOfBirth: '1980-01-01' },
    { id: 'c-name-dob', name: 'Ana Lopez', phone: null, dateOfBirth: '1990-04-12' },
    { id: 'c-email', name: 'A. Lopez', email: 'ana@example.test' },
    { id: 'c-other', name: 'Mark Twain', phone: '2025550000', dateOfBirth: '1970-02-02' },
  ];
  const hits = findDuplicateCandidates(
    { firstName: 'Ana', lastName: 'Lopez', dateOfBirth: '1990-04-12', phone: '301-555-0199', email: 'ANA@example.test' },
    clients
  );
  const ids = hits.map((h) => h.clientId);
  assert.ok(ids.includes('c-name-dob'));
  assert.ok(ids.includes('c-phone'));
  assert.ok(ids.includes('c-email'));
  assert.ok(!ids.includes('c-other'));
  assert.equal(hits.find((h) => h.clientId === 'c-name-dob')!.level, 'strong');
  assert.equal(hits.find((h) => h.clientId === 'c-email')!.level, 'strong');
  assert.equal(hits.find((h) => h.clientId === 'c-phone')!.level, 'possible');
  assert.equal(hits[hits.length - 1].level, 'possible');
  // basis names fields only, never the other person's data
  for (const h of hits) assert.doesNotMatch(h.basis, /555|1990|example/);
});

// ── Conversion (logic level) ──────────────────────────────────────────────────────────────

function fakeDeps(over: Partial<ConversionDeps> = {}) {
  const calls: string[] = [];
  const marked: unknown[] = [];
  const deps: ConversionDeps = {
    findDuplicates: async () => {
      calls.push('dup');
      return [];
    },
    verifyClient: async () => true,
    createClient: async () => {
      calls.push('createClient');
      return { ok: true, clientId: 'client-1' };
    },
    book: async (clientId) => {
      calls.push(`book:${clientId}`);
      return { ok: true, appointmentId: 'appt-1' };
    },
    sendIntake: async () => {
      calls.push('intake');
      return { ok: true, token: 'tok' };
    },
    runEligibility: async () => {
      calls.push('elig');
      return { ok: true, status: 'PENDING' };
    },
    markConverted: async (r) => {
      calls.push(`mark:${r.stage}`);
      marked.push(r);
    },
    audit: async (step) => {
      calls.push(`audit:${step}`);
    },
    ...over,
  };
  return { deps, calls, marked };
}

const appt = { clinicianId: 'dr-1', startsAt: '2026-11-03T14:00:00Z', endsAt: '2026-11-03T15:00:00Z', type: 'Initial Assessment', isVirtual: false };

test('conversion: duplicate check, create client, book, intake, eligibility, mark SCHEDULED', async () => {
  const { deps, calls, marked } = fakeDeps();
  const r = await runConversion({ stage: 'READY', convertedClientId: null }, { appointment: appt, sendIntake: true, runEligibility: true }, deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.clientId, 'client-1');
  assert.equal(r.appointmentId, 'appt-1');
  assert.equal(r.stage, 'SCHEDULED');
  assert.deepEqual(calls, ['dup', 'createClient', 'audit:create_client', 'book:client-1', 'audit:book', 'intake', 'elig', 'mark:SCHEDULED']);
  assert.deepEqual(marked[0], { clientId: 'client-1', appointmentId: 'appt-1', stage: 'SCHEDULED', clinicianId: 'dr-1' });
});

test('conversion: possible duplicate stops before any chart is created', async () => {
  const dup = { clientId: 'existing', name: 'Ana Lopez', mrn: '1001', status: 'ACTIVE', level: 'strong' as const, basis: 'name and date of birth' };
  const { deps, calls } = fakeDeps({ findDuplicates: async () => [dup] });
  const r = await runConversion({ stage: 'NEW', convertedClientId: null }, { appointment: appt }, deps);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 409);
  assert.equal(r.code, 'POSSIBLE_DUPLICATE');
  assert.deepEqual(r.duplicates, [dup]);
  assert.ok(!calls.includes('createClient'));
  assert.ok(!calls.some((c) => c.startsWith('book')));
});

test('conversion: link to the existing client instead of creating a duplicate', async () => {
  const { deps, calls } = fakeDeps({ findDuplicates: async () => [{ clientId: 'existing', name: 'x', mrn: null, status: null, level: 'strong', basis: 'email' }] });
  const r = await runConversion({ stage: 'NEW', convertedClientId: null }, { linkClientId: 'existing', appointment: appt }, deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.linked, true);
  assert.equal(r.clientId, 'existing');
  assert.ok(!calls.includes('createClient'));
  assert.ok(calls.includes('book:existing'));
});

test('conversion: staff can confirm a new chart despite possible matches', async () => {
  const { deps, calls } = fakeDeps({ findDuplicates: async () => [{ clientId: 'maybe', name: 'x', mrn: null, status: null, level: 'possible', basis: 'phone' }] });
  const r = await runConversion({ stage: 'NEW', convertedClientId: null }, { createDespiteMatches: true, appointment: null }, deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.stage, 'CONVERTED');
  assert.equal(r.appointmentId, null);
  assert.ok(calls.includes('createClient'));
  assert.ok(calls.includes('mark:CONVERTED'));
});

test('conversion: booking failure keeps the client linked and the entry READY (no second chart on retry)', async () => {
  const { deps, calls } = fakeDeps({ book: async () => ({ ok: false, error: 'Slot taken', status: 409 }) });
  const r = await runConversion({ stage: 'READY', convertedClientId: null }, { appointment: appt }, deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.stage, 'READY');
  assert.equal(r.bookingError, 'Slot taken');
  assert.ok(calls.includes('mark:READY'));
  // Retry reuses the linked client
  const second = fakeDeps();
  const r2 = await runConversion({ stage: 'READY', convertedClientId: 'client-1' }, { appointment: appt }, second.deps);
  assert.equal(r2.ok, true);
  assert.ok(!second.calls.includes('createClient'));
  assert.ok(!second.calls.includes('dup'));
});

test('conversion: closed or already converted entries are refused', async () => {
  const { deps } = fakeDeps();
  assert.equal((await runConversion({ stage: 'CLOSED', convertedClientId: null }, {}, deps)).ok, false);
  const r = await runConversion({ stage: 'SCHEDULED', convertedClientId: 'c' }, {}, deps);
  assert.equal(r.ok === false && r.status, 409);
});

test('conversion: optional intake / eligibility failures do not undo the conversion', async () => {
  const { deps } = fakeDeps({
    sendIntake: async () => ({ ok: false, error: 'No email' }),
    runEligibility: async () => ({ ok: false, error: 'Not configured' }),
  });
  const r = await runConversion({ stage: 'NEW', convertedClientId: null }, { appointment: appt, sendIntake: true, runEligibility: true }, deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.intake, { error: 'No email' });
  assert.deepEqual(r.eligibility, { error: 'Not configured' });
  assert.equal(r.stage, 'SCHEDULED');
});

test('first visit: intake / evaluation type for the service', () => {
  assert.equal(intakeAppointmentFor('Medication Management').type, 'Psychiatric Evaluation');
  assert.equal(intakeAppointmentFor('Therapy').type, 'Initial Assessment');
  assert.equal(intakeAppointmentFor('Primary Care').type, 'Initial Evaluation');
  assert.equal(serviceCategory('CBT'), 'Therapy');
  assert.equal(serviceCategory('Medication Management'), 'Medication Management');
  assert.equal(serviceCategory('PRP'), 'PRP');
});

// ── Close reasons / pipeline ──────────────────────────────────────────────────────────────

test('close reasons: a listed reason is required; closed / converted entries cannot be closed', () => {
  for (const [k] of CLOSE_REASONS) assert.deepEqual(validateClose(k, 'CONTACTED'), { ok: true, reason: k });
  for (const k of ['no_response', 'went_elsewhere', 'not_eligible', 'declined', 'duplicate']) {
    assert.ok(CLOSE_REASONS.some(([r]) => r === k), k);
  }
  assert.equal(validateClose('', 'NEW').ok, false);
  assert.equal(validateClose('bored', 'NEW').ok, false);
  assert.equal(validateClose('declined', 'CLOSED').ok, false);
  assert.equal(validateClose('declined', 'SCHEDULED').ok, false);
});

test('contact log: 3 unanswered attempts prompt closing as no response; reaching resets', () => {
  let n = 0;
  n = nextNoResponseCount(n, 'no_answer');
  n = nextNoResponseCount(n, 'left_voicemail');
  assert.equal(shouldPromptNoResponseClose(n, 'CONTACTED'), false);
  n = nextNoResponseCount(n, 'email_sent');
  assert.equal(n, 3);
  assert.equal(shouldPromptNoResponseClose(n, 'CONTACTED'), true);
  assert.equal(shouldPromptNoResponseClose(n, 'CLOSED'), false);
  assert.equal(nextNoResponseCount(n, 'reached'), 0);
  assert.equal(stageAfterContact('NEW'), 'CONTACTED');
  assert.equal(stageAfterContact('INTAKE_SENT'), 'INTAKE_SENT');
});

test('stage and status stay in step; legacy rows read from status', () => {
  assert.equal(statusForStage('CONTACTED', null), 'WAITING');
  assert.equal(statusForStage('READY', 'dr'), 'MATCHED');
  assert.equal(statusForStage('CONVERTED', null), 'SCHEDULED');
  assert.equal(statusForStage('CLOSED', 'dr'), 'CLOSED');
  assert.equal(deriveStage({ stage: null, status: 'WAITING' }), 'NEW');
  assert.equal(deriveStage({ stage: null, status: 'MATCHED' }), 'READY');
  assert.equal(deriveStage({ stage: null, status: 'SCHEDULED', convertedClientId: null }), 'INTAKE_SENT');
  assert.equal(deriveStage({ stage: null, status: 'SCHEDULED', convertedClientId: 'c' }), 'CONVERTED');
  assert.equal(deriveStage({ stage: 'INTAKE_SENT', status: 'SCHEDULED', convertedClientId: 'c' }), 'CONVERTED');
  assert.equal(deriveStage({ stage: 'CONTACTED', status: 'CLOSED' }), 'CLOSED');
  assert.equal(deriveStage({ stage: 'CONTACTED', status: 'WAITING' }), 'CONTACTED');
});

// ── Matching helpers ──────────────────────────────────────────────────────────────────────

test('matching: availability, payer panels and sites', () => {
  assert.equal(slotFitsAvailability({ day: 'mon', time: '09:00' }, ['mon'], ['morning']), true);
  assert.equal(slotFitsAvailability({ day: 'tue', time: '09:00' }, ['mon'], []), false);
  assert.equal(slotFitsAvailability({ day: 'mon', time: '17:30' }, [], ['morning', 'afternoon']), false);
  assert.equal(slotFitsAvailability({ day: 'sat', time: '13:00' }, [], []), true);
  const panels = [{ payerName: 'CareFirst BCBS', payerRegistryId: 'p1', providerUserIds: ['a'], status: 'approved' }];
  assert.equal(panelStatusFor('a', { name: 'CareFirst BCBS' }, panels), 'yes');
  assert.equal(panelStatusFor('b', { registryId: 'p1' }, panels), 'no');
  assert.equal(panelStatusFor('b', { name: 'Aetna' }, panels), 'unknown');
  assert.equal(panelStatusFor('b', { name: 'Self-pay' }, panels), 'unknown');
  assert.equal(locationFit(['bowie'], ['bowie'], false), 'yes');
  assert.equal(locationFit(['ss'], ['bowie'], false), 'no');
  assert.equal(locationFit(['ss'], ['bowie'], true), 'telehealth');
  assert.equal(locationFit([], ['bowie'], false), 'unknown');
});

// ── Roles ─────────────────────────────────────────────────────────────────────────────────

test('roles: desk / office manager / leadership manage; clinicians read and add their own; HR and billing never', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK']) {
    assert.equal(canManageWaitlist(r), true, r);
    assert.equal(canAccessPath(r, '/dashboard/clients/waitlist'), true, r);
  }
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal(canViewWaitlist(r), true, r);
    assert.equal(canAddToWaitlist(r), true, r);
    assert.equal(canManageWaitlist(r), false, r);
    assert.equal(canAccessPath(r, '/dashboard/clients/waitlist'), true, r);
    // To-Do follow-ups stay with the people who work the list
    assert.equal(taskSourcesForRole(r).intakeAndWaitlist, false, r);
  }
  for (const r of ['HR', 'BILLING', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT']) {
    assert.equal(canViewWaitlist(r), false, r);
    assert.equal(canAddToWaitlist(r), false, r);
    assert.equal(canAccessPath(r, '/dashboard/clients/waitlist'), false, r);
  }
  assert.equal(taskSourcesForRole('FRONT_DESK').intakeAndWaitlist, true);
  // Clinicians edit only open entries they added
  assert.equal(canEditWaitlistEntry('THERAPIST', 'u1', { createdById: 'u1', stage: 'NEW' }), true);
  assert.equal(canEditWaitlistEntry('THERAPIST', 'u1', { createdById: 'u2', stage: 'NEW' }), false);
  assert.equal(canEditWaitlistEntry('THERAPIST', 'u1', { createdById: 'u1', stage: 'SCHEDULED' }), false);
  assert.equal(canEditWaitlistEntry('FRONT_DESK', 'u1', { createdById: 'u2', stage: 'SCHEDULED' }), true);
  assert.equal(canEditWaitlistEntry('HR', 'u1', { createdById: 'u1', stage: 'NEW' }), false);
});

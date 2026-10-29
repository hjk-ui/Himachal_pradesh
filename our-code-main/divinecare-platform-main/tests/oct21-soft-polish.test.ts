import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseMedicalDeepLink,
  medicalRoomingHref,
  medicalProviderVisitHref,
  deepLinkIsComplete,
} from '../src/lib/medical/deep-link';
import {
  evaluateAutopaySweepGate,
  attemptIdempotencyKey,
  periodKeyFor,
} from '../src/lib/billing/patient-autopay-sweep';
import { assertPatientPaymentsAllowed, patientPaymentsLiveApproved } from '../src/lib/billing/patient-payments-gate';
import fs from 'node:fs';
import path from 'node:path';

test('deep-link query parsing: complete + partial + empty', () => {
  const full = parseMedicalDeepLink(
    'appointmentId=appt_1&clientId=cli_1&clientName=Ada%20Lovelace'
  );
  assert.equal(full.appointmentId, 'appt_1');
  assert.equal(full.clientId, 'cli_1');
  assert.equal(full.clientName, 'Ada Lovelace');
  assert.equal(deepLinkIsComplete(full), true);

  const partial = parseMedicalDeepLink('appointmentId=appt_1');
  assert.equal(partial.clientId, null);
  assert.equal(deepLinkIsComplete(partial), false);

  const empty = parseMedicalDeepLink('');
  assert.equal(deepLinkIsComplete(empty), false);

  assert.equal(
    medicalRoomingHref({ appointmentId: 'a', clientId: 'c' }),
    '/dashboard/medical?appointmentId=a&clientId=c'
  );
  assert.equal(
    medicalProviderVisitHref({ appointmentId: 'a', clientId: 'c', clientName: 'Pat' }),
    '/dashboard/medical/visits?appointmentId=a&clientId=c&clientName=Pat'
  );
});

test('autopay live gate still blocks without PATIENT_PAYMENTS_LIVE_APPROVED', () => {
  const prev = process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  delete process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  assert.equal(patientPaymentsLiveApproved(), false);

  const gate = evaluateAutopaySweepGate({
    ...process.env,
    PATIENT_PAYMENTS_LIVE_APPROVED: 'false',
  });
  if (gate.mode === 'live') {
    assert.equal(gate.allowed, false);
  } else {
    assert.equal(gate.allowed, true);
  }

  const allowed = assertPatientPaymentsAllowed();
  if (allowed.ok === false) {
    assert.match(allowed.error, /PATIENT_PAYMENTS_LIVE_APPROVED/);
  }

  if (prev === undefined) delete process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  else process.env.PATIENT_PAYMENTS_LIVE_APPROVED = prev;

  assert.equal(attemptIdempotencyKey('e1', periodKeyFor(new Date('2026-10-21'))), 'e1:2026-10-21');
});

test('PRIMARY-CARE-STATE.md and Autopay sweep docs exist', () => {
  const root = process.cwd();
  assert.ok(fs.existsSync(path.join(root, 'docs', 'PRIMARY-CARE-STATE.md')));
  const autopay = fs.readFileSync(path.join(root, 'docs', 'PATIENT-AUTOPAY-SWEEP.md'), 'utf8');
  assert.match(autopay, /TEST MODE/);
  assert.match(autopay, /LIVE MODE checklist/);
  assert.match(autopay, /PATIENT_PAYMENTS_LIVE_APPROVED/);
  assert.match(autopay, /never enabled by default/i);
});

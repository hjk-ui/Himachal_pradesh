/**
 * Clinician feedback: change the visit type during the visit (src/lib/appointments/visitTypeChange.ts,
 * visitTypeChangeServer.ts, PATCH /api/appointments/[id]/visit-type). Pure rules + source-level
 * checks for the gate, the audit row and billing. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  adjustEndForType,
  billingPlaceForVisit,
  canonicalVisitType,
  defaultMinutesForType,
  noteTypeForVisitType,
  VISIT_ALREADY_BILLED,
  visitTypeChangeBlock,
  visitTypeChoiceError,
  visitTypeOptions,
  visitTypesForRole,
} from '../src/lib/appointments/visitTypeChange';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('allowed types follow the clinician role', () => {
  const therapist = visitTypesForRole('THERAPIST');
  assert.ok(therapist.includes('Individual Therapy'));
  assert.ok(!therapist.includes('Medication Management'), 'therapists do not book med management');
  const np = visitTypesForRole('NP');
  assert.ok(np.includes('Medication Management') && np.includes('Psychiatric Evaluation'));
  assert.ok(visitTypesForRole('PRP_SPECIALIST').includes('PRP Session'));
  assert.ok(!visitTypesForRole('PRP_SPECIALIST').includes('Psychiatric Evaluation'));
  // Unknown / admin: the whole catalog
  assert.ok(visitTypesForRole(null).length >= 10);
});

test('options: current type first, practice-disabled types hidden, practice-defined types added', () => {
  const services = [
    { id: 'group_therapy', title: 'Group Therapy', durationMin: 90, enabled: false },
    { id: 'individual_therapy', title: 'Individual Therapy', durationMin: 53, enabled: true },
    { id: 'custom_1', title: 'Family Session', durationMin: 50, enabled: true },
    { id: 'custom_2', title: 'Retired Visit', durationMin: 30, enabled: false },
  ];
  const opts = visitTypeOptions({ clinicianRole: 'THERAPIST', currentType: 'Crisis Follow-up', services });
  assert.equal(opts[0].type, 'Crisis Follow-up');
  assert.equal(opts[0].current, true);
  assert.ok(!opts.some((o) => o.type === 'Group Therapy'), 'switched off in Scheduling settings');
  assert.equal(opts.find((o) => o.type === 'Individual Therapy')?.durationMin, 53, 'practice length wins');
  assert.ok(opts.some((o) => o.type === 'Family Session'));
  assert.ok(!opts.some((o) => o.type === 'Retired Visit'));
  assert.equal(visitTypeChoiceError('Medication Management', opts), "That visit type isn't offered for this clinician.");
  assert.equal(visitTypeChoiceError('individual therapy', opts), null);
  assert.equal(canonicalVisitType('individual therapy', opts), 'Individual Therapy');
  assert.equal(defaultMinutesForType('Telehealth Check-in'), 15);
});

test('length: moves to the new default only when it does not hit the next appointment', () => {
  const startsAt = new Date('2026-10-24T14:00:00Z');
  const endsAt = new Date('2026-10-24T14:20:00Z');
  const longer = adjustEndForType({ startsAt, endsAt, durationMin: 60, nextStartsAt: null });
  assert.equal(longer.adjusted, true);
  assert.equal(longer.endsAt.toISOString(), '2026-10-24T15:00:00.000Z');

  const blocked = adjustEndForType({
    startsAt,
    endsAt,
    durationMin: 60,
    nextStartsAt: new Date('2026-10-24T14:30:00Z'),
    formatTime: () => '10:30 AM',
  });
  assert.equal(blocked.adjusted, false);
  assert.equal(blocked.collision, true);
  assert.equal(blocked.endsAt.getTime(), endsAt.getTime(), 'booked time kept');
  assert.match(blocked.message ?? '', /Kept the scheduled time.*10:30 AM/);

  // Next visit starts exactly at the new end: touching edges do not collide
  const touching = adjustEndForType({ startsAt, endsAt, durationMin: 60, nextStartsAt: new Date('2026-10-24T15:00:00Z') });
  assert.equal(touching.adjusted, true);

  // Shorter always fits
  const shorter = adjustEndForType({ startsAt, endsAt: new Date('2026-10-24T15:00:00Z'), durationMin: 20, nextStartsAt: new Date('2026-10-24T14:10:00Z') });
  assert.equal(shorter.adjusted, true);
  assert.equal(shorter.endsAt.toISOString(), '2026-10-24T14:20:00.000Z');

  assert.equal(adjustEndForType({ startsAt, endsAt, durationMin: null, nextStartsAt: null }).adjusted, false);
});

test('blocked once billed or signed; billed message is the charge-correction line', () => {
  assert.equal(visitTypeChangeBlock({ status: 'IN_SESSION', notes: [{ workflowStatus: 'DRAFT' }], claimCount: 0 }), null);
  assert.equal(visitTypeChangeBlock({ status: 'COMPLETED', notes: [], claimCount: 0 }), null, 'completed but unsigned / unbilled can still be corrected');
  const billed = visitTypeChangeBlock({ status: 'COMPLETED', notes: [{ workflowStatus: 'DRAFT' }], claimCount: 1 });
  assert.equal(billed?.code, 'BILLED');
  assert.equal(billed?.message, VISIT_ALREADY_BILLED);
  assert.equal(VISIT_ALREADY_BILLED, 'Visit already billed — use a charge correction');
  assert.equal(visitTypeChangeBlock({ status: 'IN_SESSION', notes: [], claimCount: 0, chargeRouted: true })?.code, 'BILLED');
  assert.equal(visitTypeChangeBlock({ status: 'COMPLETED', notes: [{ workflowStatus: 'SIGNED' }], claimCount: 0 })?.code, 'NOTE_SIGNED');
  assert.equal(visitTypeChangeBlock({ status: 'COMPLETED', notes: [{ workflowStatus: 'LOCKED' }], claimCount: 0 })?.code, 'NOTE_SIGNED');
  // A dismissed signed-looking row never blocks
  assert.equal(visitTypeChangeBlock({ status: 'IN_SESSION', notes: [{ workflowStatus: 'SIGNED', dismissed: true }], claimCount: 0 }), null);
  assert.equal(visitTypeChangeBlock({ status: 'CANCELLED', notes: [], claimCount: 0 })?.code, 'STATUS');
});

test('POS / modifier follow in person <-> telehealth', () => {
  assert.deepEqual(billingPlaceForVisit({ isVirtual: false }), { telehealth: false, placeOfService: '11', modifier: null, audioOnly: false });
  assert.equal(billingPlaceForVisit({ isVirtual: false, settings: { posOffice: '22' } }).placeOfService, '22');
  const home = billingPlaceForVisit({ isVirtual: true, patientLocationType: 'home' });
  assert.deepEqual(home, { telehealth: true, placeOfService: '10', modifier: '95', audioOnly: false });
  assert.equal(billingPlaceForVisit({ isVirtual: true, patientLocationType: 'other' }).placeOfService, '02');
  // Unknown location: no guess (billing holds the claim for a POS)
  assert.equal(billingPlaceForVisit({ isVirtual: true }).placeOfService, null);
  // Audio-only: the payer's audio-only modifier, not 95
  assert.equal(billingPlaceForVisit({ isVirtual: true, audioOnly: true, patientLocationType: 'home' }).modifier, null);
});

test('matching note template for the new type (role-aware); none when the type does not decide', () => {
  assert.equal(noteTypeForVisitType('Medication Management', { clinicianRole: 'PSYCHIATRIST' }), 'Psych Med Mgmt');
  assert.equal(noteTypeForVisitType('Individual Therapy', { clinicianRole: 'THERAPIST' }), 'Therapy Progress');
  assert.equal(noteTypeForVisitType('Psychiatric Evaluation', { clinicianRole: 'NP', clientAgeYears: 34 }), 'Adult Psych Intake');
  assert.equal(noteTypeForVisitType('Telehealth', { clinicianRole: 'THERAPIST' }), null);
});

test('server: same gate as editing the appointment, org scope, re-check in the write, no messaging', () => {
  const server = read('src/lib/appointments/visitTypeChangeServer.ts');
  assert.match(server, /import \{ caseloadAllows \} from '@\/lib\/clients\/caseloadAccess'/);
  assert.match(server, /appointmentOrgWhere\(actor\.organizationId\)/);
  assert.match(server, /appt\.clinicianId !== actor\.id && !\(await caseloadAllows\(/);
  assert.match(server, /\$transaction[\s\S]*blockFor\(tx, appt\)/, 'signed / billed re-checked inside the transaction');
  assert.match(server, /workflow: \{ status: 'DRAFT' \}/, 'only unsigned notes get the new POS');
  assert.doesNotMatch(server, /sendSms|sendEmail|sendToUser|pushService|notifications/i, 'no PHI sent anywhere new');
  // The pure helpers are not re-implemented in the route
  const route = read('src/app/api/appointments/[id]/visit-type/route.ts');
  assert.match(route, /canAccessClientAppointments\(gate\.role\)/);
  assert.match(route, /requireOrgContext\(\)/);
});

test('route: HIPAA audit with old -> new type, actor, optional reason; denials audited', () => {
  const route = read('src/app/api/appointments/[id]/visit-type/route.ts');
  assert.match(route, /auditPhiAccess\(\{[\s\S]*change: 'visit_type'[\s\S]*fromType: result\.before\.type[\s\S]*toType: result\.after\.type/);
  assert.match(route, /fromVirtual[\s\S]*toVirtual/);
  assert.match(route, /reason: body\.reason\?\.trim\(\) \|\| null/);
  assert.match(route, /outcome: 'DENIED'/);
});

test('billing: claim at sign comes from the note; in-call coding uses the current appointment type', () => {
  const claims = read('src/lib/billing/claims.ts');
  // generateClaimFromNote: CPT / POS / telehealth from the note, never appointment.type
  const fn = claims.slice(claims.indexOf('export async function generateClaimFromNote'), claims.indexOf('export async function generateClaimFromAppointment'));
  assert.ok(fn.length > 100);
  assert.doesNotMatch(fn, /appointment\??\.type/);
  assert.match(fn, /note\.telehealth/);
  const inCall = read('src/app/api/telehealth/in-call/route.ts');
  assert.match(inCall, /const type = \(apptLocation\?\.type \|\| body\.sessionType \|\| ''\)\.toLowerCase\(\)/);
});

test('UI: editor header control, template offer, telehealth in-call and Visit Guide entry points', () => {
  const page = read('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(page, /<VisitTypeControl[\s\S]*appointmentId=\{editorAppointmentId\}/);
  assert.match(page, /title="Switch the note template too\?"/);
  assert.match(page, /changeNoteType\(pendingVisitNoteType\)/, 'uses the existing note type change (nothing typed is lost)');
  assert.match(page, /onChangeVisitType=\{editorAppointmentId \? openVisitTypeControl : undefined\}/);
  const drawer = read('src/components/telehealth/InCallEhrDrawer.tsx');
  assert.match(drawer, /<VisitTypeControl tone="dark"/);
  const control = read('src/components/visits/VisitTypeControl.tsx');
  assert.match(control, /\/api\/appointments\/\$\{encodeURIComponent\(appointmentId\)\}\/visit-type/);
  assert.doesNotMatch(control, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji');
});

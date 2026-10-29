import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  contrastRatio,
  DARK_TEXT,
  labelCreateSchema,
  labelForMeaning,
  labelTextColor,
  LIGHT_TEXT,
  looksRescheduled,
  pickSuggestedMeaning,
  planValantLabelLoad,
  suggestLabelMeanings,
  toLabelDto,
  VALANT_APPOINTMENT_LABELS,
} from '../src/lib/scheduling/appointmentLabels';
import {
  canManageAppointmentLabels,
  canReadAppointmentLabels,
  canSetAppointmentLabel,
} from '../src/lib/scheduling/appointmentLabelAccess';
import { parseValantAppointmentRow } from '../src/lib/migration/valantAppointments';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── Valant label loader ─────────────────────────────────────────────────────

test('the Valant list is exactly the 12 labels the practice has, all Free', () => {
  assert.deepEqual(
    VALANT_APPOINTMENT_LABELS.map((l) => [l.name, l.displayName]),
    [
      ['Blue', 'Blue (Tele)'],
      ['Brown', 'Brown (Rescheduled)'],
      ['Cyan', 'Cyan'],
      ['Green', 'Green (Re-eval)'],
      ['Lime', 'Lime (Cancelled)'],
      ['Maroon', 'Maroon'],
      ['Orange', 'Orange (In Person)'],
      ['Pink', 'Pink (Issue)'],
      ['Purple', 'Purple (New)'],
      ['Red', 'Red (Not Confirmed)'],
      ['Tan', 'Tan (Testing, no provider needed)'],
      ['Yellow', 'Yellow'],
    ]
  );
  assert.ok(VALANT_APPOINTMENT_LABELS.every((l) => l.availability === 'free'));
});

test('label loader is idempotent: 12 on an empty org, 0 on the second run', () => {
  const store: Array<{ name: string; sortOrder: number }> = [];
  const first = planValantLabelLoad(store);
  assert.equal(first.length, 12);
  assert.ok(first.every((l) => l.source === 'valant'));
  assert.deepEqual(first.map((l) => l.sortOrder), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  store.push(...first);
  assert.equal(planValantLabelLoad(store).length, 0);
  assert.equal(store.length, 12);
});

test('label loader never duplicates a label the practice already made (case-insensitive) and appends after it', () => {
  const plan = planValantLabelLoad([{ name: 'blue', sortOrder: 4 }, { name: 'Intake', sortOrder: 0 }]);
  assert.equal(plan.length, 11);
  assert.ok(!plan.some((l) => l.name === 'Blue'));
  assert.equal(plan[0].sortOrder, 5);
});

test('the loader route and migration do not seed labels on their own', () => {
  const sql = read('prisma/migrations/20261018_appointment_labels.sql');
  assert.doesNotMatch(sql, /\bINSERT\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "AppointmentLabel"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "labelId"/);
  assert.match(sql, /ON DELETE SET NULL/);
  // labelId is in the Prisma Appointment model as a plain optional scalar matching the SQL column
  // (no Prisma relation; the FK lives in SQL), so prisma db push / migrate diff see no drift.
  const schema = read('prisma/schema.prisma');
  const appt = schema.slice(schema.indexOf('model Appointment {'), schema.indexOf('\n}', schema.indexOf('model Appointment {')));
  assert.match(appt, /^\s*labelId\s+String\?\s*$/m);
  assert.doesNotMatch(appt, /fields:\s*\[labelId\]/);
});

// ─── Contrast ───────────────────────────────────────────────────────────────

test('text color is picked automatically and every Valant color meets WCAG AA (4.5:1)', () => {
  for (const l of VALANT_APPOINTMENT_LABELS) {
    const fg = labelTextColor(l.color);
    const other = fg === LIGHT_TEXT ? DARK_TEXT : LIGHT_TEXT;
    assert.ok(contrastRatio(l.color, fg) >= 4.5, `${l.name} ${l.color} on ${fg}`);
    assert.ok(contrastRatio(l.color, fg) >= contrastRatio(l.color, other), `${l.name} picked the better text color`);
  }
  assert.equal(labelTextColor('#000000'), LIGHT_TEXT);
  assert.equal(labelTextColor('#FFFF00'), DARK_TEXT);
  assert.equal(labelTextColor('#7F1D1D'), LIGHT_TEXT); // Maroon
  assert.equal(labelTextColor('#CA8A04'), DARK_TEXT); // Yellow
  assert.equal(Math.round(contrastRatio('#FFFFFF', '#000000')), 21);
});

test('label DTO carries the computed text color and rejects bad input', () => {
  const dto = toLabelDto({
    id: 'l1', name: 'Blue', displayName: 'Blue (Tele)', color: '#2563eb', availability: 'free',
    sortOrder: 0, active: true, source: 'valant', meaning: 'tele',
  });
  assert.equal(dto.color, '#2563EB');
  assert.equal(dto.textColor, LIGHT_TEXT);
  assert.throws(() => labelCreateSchema.parse({ name: 'X', displayName: 'X', color: 'blue' }), /#RRGGBB/);
  assert.throws(() => labelCreateSchema.parse({ name: 'X', displayName: 'X', color: '#000000', availability: 'away' }));
  assert.equal(labelCreateSchema.parse({ name: 'X', displayName: 'X', color: '#abcdef' }).availability, 'free');
});

// ─── Suggestions ────────────────────────────────────────────────────────────

test('suggestion rules: tele, new, rescheduled, cancelled; never "not confirmed" from a guess', () => {
  assert.deepEqual(suggestLabelMeanings({ isVirtual: true, status: 'scheduled' }), ['tele']);
  // Valant convention: Orange (In Person) for kept in-person visits
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'scheduled' }), ['in_person']);
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'no-show' }), []);
  assert.deepEqual(suggestLabelMeanings({ isVirtual: true, status: 'scheduled', isFirstAppointment: true }), ['new', 'tele']);
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'cancelled' }), ['cancelled']);
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'late-cancel', isFirstAppointment: true }), ['cancelled']);
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'cancelled', rescheduled: true }), ['rescheduled', 'cancelled']);
  // Altrixs does not track confirmation yet: null/undefined never suggests Red (Not Confirmed)
  assert.ok(!suggestLabelMeanings({ isVirtual: false, status: 'scheduled', confirmed: null }).includes('not_confirmed'));
  assert.deepEqual(suggestLabelMeanings({ isVirtual: false, status: 'scheduled', confirmed: false }), ['not_confirmed', 'in_person']);
  assert.ok(!suggestLabelMeanings({ isVirtual: false, status: 'completed', confirmed: false }).includes('not_confirmed'));
});

test('only one chip is offered, and none once a matching label is on (unless since cancelled)', () => {
  assert.equal(pickSuggestedMeaning(['tele'], null, false), 'tele');
  assert.equal(pickSuggestedMeaning(['tele'], 'tele', true), null);
  assert.equal(pickSuggestedMeaning(['new', 'tele'], 'tele', true), null);
  assert.equal(pickSuggestedMeaning(['tele'], null, true), null); // practice chose e.g. Cyan on purpose
  assert.equal(pickSuggestedMeaning(['cancelled', 'tele'], 'tele', true), 'cancelled');
  assert.equal(pickSuggestedMeaning(['cancelled'], 'cancelled', true), null);
  assert.equal(pickSuggestedMeaning([], null, false), null);
});

test('suggestions map to the active label with that meaning; Valant RESCHEDULED code counts', () => {
  const labels = [
    { id: 'a', meaning: 'tele', active: false, sortOrder: 0 },
    { id: 'b', meaning: 'tele', active: true, sortOrder: 3 },
    { id: 'c', meaning: 'tele', active: true, sortOrder: 1 },
  ];
  assert.equal(labelForMeaning(labels, 'tele')?.id, 'c');
  assert.equal(labelForMeaning(labels, 'new'), null);
  assert.equal(looksRescheduled({ notes: 'Valant code: RESCHEDULED' }), true);
  assert.equal(looksRescheduled({ rescheduleRequestedAt: new Date() }), true);
  assert.equal(looksRescheduled({ notes: 'Valant code: 99214T' }), false);
});

// ─── Role gates ─────────────────────────────────────────────────────────────

test('label setup follows Scheduling settings roles; applying a label follows appointment edit roles', () => {
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']) {
    assert.equal(canManageAppointmentLabels(r), true, r);
  }
  for (const r of ['FRONT_DESK', 'THERAPIST', 'BILLING', 'CLIENT', '', null]) {
    assert.equal(canManageAppointmentLabels(r), false, String(r));
  }
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER', 'ADMIN', 'THERAPIST']) {
    assert.equal(canSetAppointmentLabel(r), true, r);
    assert.equal(canReadAppointmentLabels(r), true, r);
  }
  for (const r of ['BILLING', 'CLIENT', 'HR']) {
    assert.equal(canSetAppointmentLabel(r), false, r);
  }
});

test('label API routes gate writes by role and write audit entries', () => {
  const base = 'src/app/api/scheduling/appointment-labels';
  const coll = read(`${base}/route.ts`);
  for (const fn of ['POST', 'PUT']) {
    const body = coll.slice(coll.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 600), /canManageAppointmentLabels\(gate\.role\)/, `${fn} gated`);
  }
  assert.match(coll, /writeAuditLog/);
  for (const f of [`${base}/[id]/route.ts`, `${base}/load-valant/route.ts`]) {
    const src = read(f);
    assert.match(src, /canManageAppointmentLabels\(gate\.role\)/, f);
    assert.match(src, /writeAuditLog/, f);
  }
  const setRoute = read('src/app/api/appointments/[id]/label/route.ts');
  assert.match(setRoute, /canSetAppointmentLabel\(gate\.role\)/);
  assert.match(setRoute, /auditPhiAccess/);
  assert.match(setRoute, /resourceType: 'appointment_label'/);
  const suggest = read(`${base}/suggest/route.ts`);
  assert.match(suggest, /clientByIdWhere\(clientId, gate\.organizationId\)/);
  assert.match(suggest, /auditPhiAccess/);
});

test('appointment label writes are org-scoped', () => {
  const server = read('src/lib/scheduling/appointmentLabelsServer.ts');
  assert.match(server, /findFirst\(\{ where: \{ id: labelId, organizationId \} \}\)/);
  const manage = read('src/lib/appointments/manage.ts');
  const fn = manage.slice(manage.indexOf('export async function setAppointmentLabel'));
  assert.match(fn.slice(0, 800), /appointmentOrgWhere\(actor\.organizationId\)/);
  // Caseload: the visit's clinician or the client's care team (same rule as the chart)
  assert.match(fn.slice(0, 900), /caseloadAllows\(\{ organizationId: actor\.organizationId, userId: actor\.id, role: actor\.role \}, existing\.client\)/);
});

// ─── Valant export ──────────────────────────────────────────────────────────

test('Valant appointment export has no color/label column: the parsed row carries none', () => {
  const cells = ['Monday, October 19, 2026', '09:00-10:00 AM', 'Doe, Jane (VP123)', '', '99214T', 'Comments:', 'L.Willis'];
  const r = parseValantAppointmentRow(cells);
  assert.equal(r.ok, true);
  if (r.ok && r.value.kind === 'appointment') {
    assert.equal(r.value.isVirtual, true);
    assert.ok(!('label' in r.value) && !('color' in r.value));
  }
});

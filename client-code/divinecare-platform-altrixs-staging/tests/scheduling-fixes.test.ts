import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeTelehealthPos, resolveTelehealthPos } from '../src/lib/telehealth/pos';
import { parseTelehealthCheckIn, checkInSessionData } from '../src/lib/telehealth/checkIn';
import {
  decideBookingIdentity,
  dobDayRange,
  exactNameMatches,
  newBookingClientFlags,
  normalizePhoneDigits,
} from '../src/lib/scheduling/identity';
import { generateBookingSlots } from '../src/lib/scheduling/slots';
import { fromPracticeWallTime } from '../src/lib/time/practiceTime';
import { sectionsForRole } from '../src/lib/inbox/sections';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. Telehealth place of service ────────────────────────────────────────────

test('POS: normalize strips a "POS " prefix and only allows 02 / 10', () => {
  assert.equal(normalizeTelehealthPos('POS 02'), '02');
  assert.equal(normalizeTelehealthPos('pos-10'), '10');
  assert.equal(normalizeTelehealthPos('2'), '02');
  assert.equal(normalizeTelehealthPos('11'), null);
  assert.equal(normalizeTelehealthPos(''), null);
  assert.equal(normalizeTelehealthPos(undefined), null);
});

test('POS: patient location wins and maps through practice settings', () => {
  const settings = { posTelehealthHome: '10', posTelehealthOther: '02' };
  assert.deepEqual(resolveTelehealthPos({ patientLocationType: 'home', staffPos: '02', settings }), { pos: '10', source: 'patient_location' });
  assert.deepEqual(resolveTelehealthPos({ patientLocationType: 'other', settings }), { pos: '02', source: 'patient_location' });
  // Practice that bills home visits as 02 too
  assert.equal(resolveTelehealthPos({ patientLocationType: 'home', settings: { posTelehealthHome: '02', posTelehealthOther: '02' } }).pos, '02');
});

test('POS: staff entry only when location missing; unknown stays null (never guessed)', () => {
  assert.deepEqual(resolveTelehealthPos({ patientLocationType: null, staffPos: 'POS 10' }), { pos: '10', source: 'staff_entered' });
  assert.deepEqual(resolveTelehealthPos({ patientLocationType: null }), { pos: null, source: 'unknown' });
  assert.deepEqual(resolveTelehealthPos({ patientLocationType: 'garage', staffPos: 'x' }), { pos: null, source: 'unknown' });
});

test('POS: end and in-call routes use the shared helper and never write a "POS " prefixed code', () => {
  for (const rel of ['src/app/api/telehealth/end/route.ts', 'src/app/api/telehealth/in-call/route.ts']) {
    const src = read(rel);
    assert.match(src, /resolveTelehealthPos\(/, `${rel} uses resolveTelehealthPos`);
    assert.doesNotMatch(src, /placeOfService:\s*`POS /, `${rel} has no "POS xx" placeOfService`);
    assert.doesNotMatch(src, /default\('(02|10)'\)/, `${rel} has no defaulted POS`);
  }
});

// ── 2. Telehealth check-in: explicit consent + location ──────────────────────

test('check-in: consent must be explicitly true', () => {
  assert.equal(parseTelehealthCheckIn({ locationType: 'home', locationState: 'MD' }).ok, false);
  const r = parseTelehealthCheckIn({ consentSigned: false, locationType: 'home', locationState: 'MD' });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.field, 'consentSigned');
});

test('check-in: location type and state are required, no Maryland default', () => {
  const noType = parseTelehealthCheckIn({ consentSigned: true, locationState: 'MD' });
  assert.equal(noType.ok, false);
  if (noType.ok === false) assert.equal(noType.field, 'locationType');
  const noState = parseTelehealthCheckIn({ consentSigned: true, locationType: 'other' });
  assert.equal(noState.ok, false);
  if (noState.ok === false) assert.equal(noState.field, 'locationState');
  assert.equal(parseTelehealthCheckIn({ consentSigned: true, locationType: 'home', locationState: 'Maryland' }).ok, false);
});

test('check-in: valid answers are stored as given', () => {
  const r = parseTelehealthCheckIn({ consentSigned: true, locationType: 'other', locationState: 'va' });
  assert.equal(r.ok, true);
  if (r.ok) {
    const data = checkInSessionData(r.value, new Date('2026-10-19T13:00:00Z'));
    assert.equal(data.clientLocationState, 'VA');
    assert.equal(data.patientLocationType, 'other');
    assert.equal(data.clientConsentSigned, true);
  }
});

test('check-in page asks where the patient is and has no Maryland default', () => {
  const src = read('src/app/telehealth/join/[token]/page.tsx');
  assert.doesNotMatch(src, /\|\| 'Maryland'/);
  assert.doesNotMatch(src, /useState\('Maryland'\)/);
  assert.match(src, /Where are you right now\?/);
  assert.match(src, /locationType,/);
});

// ── 3. Online booking: slot validation + identity matching ───────────────────

const TZ = 'America/New_York';
const HOURS = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '13:00' },
  sun: { enabled: false, start: '09:00', end: '13:00' },
};

function slotsFor(day: string, booked: { startsAt: Date; endsAt: Date; clinicianId: string | null }[] = []) {
  return generateBookingSlots({
    from: fromPracticeWallTime(day, '00:00', TZ)!,
    to: fromPracticeWallTime(day, '23:59', TZ)!,
    now: new Date('2026-10-18T12:00:00Z'),
    timeZone: TZ,
    hours: HOURS,
    durationMin: 50,
    bufferMinutes: 10,
    minNoticeDays: 1,
    bookAheadDays: 30,
    booked,
    providerId: 'clin1',
  }).map((s) => s.startsAt);
}

test('booking: only in-hours, free slots are offered (what bookPublicAppointment re-checks under its lock)', () => {
  const nine = fromPracticeWallTime('2026-10-20', '09:00', TZ)!.toISOString();
  const threeAm = fromPracticeWallTime('2026-10-20', '03:00', TZ)!.toISOString();
  const offered = slotsFor('2026-10-20');
  assert.ok(offered.includes(nine));
  assert.ok(!offered.includes(threeAm));
  assert.equal(slotsFor('2026-10-24').length, 0, 'Saturday closed');
  const taken = slotsFor('2026-10-20', [
    { startsAt: new Date(nine), endsAt: new Date(Date.parse(nine) + 50 * 60_000), clinicianId: 'clin1' },
  ]);
  assert.ok(!taken.includes(nine));
});

test('booking: bookPublicAppointment validates slot inside a locked transaction and checks provider org', () => {
  const src = read('src/lib/scheduling/manage.ts');
  assert.match(src, /pg_advisory_xact_lock/);
  assert.match(src, /isOfferedSlot\(/);
  assert.match(src, /Provider not available/);
  assert.doesNotMatch(src, /'zoom' : null/);
  assert.doesNotMatch(src, /OR: \[\{ email: input\.email\.toLowerCase\(\) \}, \{ phone: input\.phone \}\]/);
  const solo = read('src/lib/solo/manage.ts');
  assert.doesNotMatch(solo, /client\.findUnique\(\{ where: \{ email \} \}\)/);
  assert.match(solo, /decideBookingIdentity\(/);
});

type Row = { id: string; organizationId: string; name: string; legalFirstName: string | null; legalLastName: string | null; email: string | null; phone: string | null; dateOfBirth: Date | null };

function fakeDb(rows: Row[]) {
  const matches = (r: Row, where: any): boolean => {
    if (!where) return true;
    if (where.organizationId && r.organizationId !== where.organizationId) return false;
    if (where.email !== undefined && r.email !== where.email) return false;
    if (where.dateOfBirth) {
      if (!r.dateOfBirth) return false;
      if (r.dateOfBirth < where.dateOfBirth.gte || r.dateOfBirth >= where.dateOfBirth.lt) return false;
    }
    if (where.phone?.contains && !(r.phone ?? '').includes(where.phone.contains)) return false;
    return true;
  };
  return {
    client: {
      findMany: async (args: any) => rows.filter((r) => matches(r, args.where)),
      findFirst: async (args: any) => rows.find((r) => matches(r, args.where)) ?? null,
    },
  } as any;
}

const JANE: Row = {
  id: 'c-jane', organizationId: 'org1', name: 'Jane Doe', legalFirstName: 'Jane', legalLastName: 'Doe',
  email: 'jane@example.com', phone: '(410) 555-0100', dateOfBirth: new Date(Date.UTC(1990, 4, 1)),
};

test('identity: exact first + last + DOB in the same org matches', async () => {
  const d = await decideBookingIdentity(fakeDb([JANE]), {
    organizationId: 'org1', firstName: ' jane ', lastName: 'DOE', dob: '1990-05-01', email: 'jane@example.com', phone: '4105550100',
  });
  assert.deepEqual(d, { kind: 'existing', clientId: 'c-jane', flagReason: null });
});

test('identity: same name + DOB but different contact matches and is flagged, never overwritten', async () => {
  const d = await decideBookingIdentity(fakeDb([JANE]), {
    organizationId: 'org1', firstName: 'Jane', lastName: 'Doe', dob: '1990-05-01', email: 'other@example.com', phone: '4105550100',
  });
  assert.deepEqual(d, { kind: 'existing', clientId: 'c-jane', flagReason: 'contact_mismatch' });
});

test('identity: email alone never merges (family member sharing an email)', async () => {
  const d = await decideBookingIdentity(fakeDb([JANE]), {
    organizationId: 'org1', firstName: 'John', lastName: 'Doe', dob: '2012-02-02', email: 'jane@example.com', phone: '4105559999',
  });
  assert.equal(d.kind, 'new');
  if (d.kind === 'new') {
    assert.equal(d.reason, 'possible_duplicate_email');
    assert.equal(d.emailAvailable, false);
    const flags = newBookingClientFlags(d, 'jane@example.com');
    assert.equal(flags.email, null, 'unique email stays on the existing chart');
    assert.equal(flags.unverifiedEmail, 'jane@example.com');
    assert.equal(flags.identityVerifyRequired, true);
  }
});

test('identity: phone alone never merges', async () => {
  const d = await decideBookingIdentity(fakeDb([JANE]), {
    organizationId: 'org1', firstName: 'Jim', lastName: 'Doe', dob: '1960-01-01', email: 'jim@example.com', phone: '+1 410 555 0100',
  });
  assert.deepEqual(d, { kind: 'new', reason: 'possible_duplicate_phone', emailAvailable: true });
});

test('identity: other organizations are never matched', async () => {
  const d = await decideBookingIdentity(fakeDb([JANE]), {
    organizationId: 'org2', firstName: 'Jane', lastName: 'Doe', dob: '1990-05-01', email: 'new@example.com', phone: '3015550000',
  });
  assert.deepEqual(d, { kind: 'new', reason: 'new_online_booking', emailAvailable: true });
});

test('identity: two charts with the same name + DOB are ambiguous -> new flagged chart', async () => {
  const twin = { ...JANE, id: 'c-jane2', email: null, phone: null };
  const d = await decideBookingIdentity(fakeDb([JANE, twin]), {
    organizationId: 'org1', firstName: 'Jane', lastName: 'Doe', dob: '1990-05-01', email: 'x@example.com', phone: '',
  });
  assert.equal(d.kind, 'new');
  if (d.kind === 'new') assert.equal(d.reason, 'possible_duplicate_name_dob');
});

test('identity helpers', () => {
  assert.equal(normalizePhoneDigits('+1 (410) 555-0100'), '4105550100');
  assert.equal(dobDayRange('1990-02-31'), null);
  assert.ok(dobDayRange('1990-05-01T00:00:00Z'));
  assert.equal(exactNameMatches([{ ...JANE, legalFirstName: null, legalLastName: null, name: 'Jane  Q  Doe' }], 'jane', 'doe').length, 1);
});

// ── Inbox: waitlist offers + identity checks reach the front desk only ──────

test('inbox: waitlist_offer and identity_verify for desk / leadership roles, not clinicians, billing or HR', () => {
  const keys = (role: string) => sectionsForRole(role).map((s) => s.key);
  for (const role of ['FRONT_DESK', 'OFFICE_MANAGER', 'PRACTICE_DIRECTOR']) {
    assert.ok(keys(role).includes('waitlist_offer'), role);
    assert.ok(keys(role).includes('identity_verify'), role);
  }
  for (const role of ['THERAPIST', 'BILLING', 'HR', 'PEER_SUPPORT']) {
    assert.ok(!keys(role).includes('waitlist_offer'), role);
    assert.ok(!keys(role).includes('identity_verify'), role);
  }
});

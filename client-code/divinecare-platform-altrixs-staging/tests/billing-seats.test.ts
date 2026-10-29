import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { SEAT_TYPES, seatTypeForRole } from '../src/lib/billing/plans';
import { countSeats, seatTypeForUser } from '../src/lib/billing/seats';

const EXPECTED: Record<string, string | null> = {
  PSYCHIATRIST: 'prescriber',
  NP: 'prescriber',
  PHYSICIAN: 'prescriber',
  MEDICAL_NP: 'prescriber',
  THERAPIST: 'clinician',
  CLINICIAN: 'clinician',
  PRP_SPECIALIST: 'paraprofessional',
  CASE_MANAGER: 'paraprofessional',
  PEER_SUPPORT: 'paraprofessional',
  MEDICAL_ASSISTANT: 'paraprofessional',
  CRISIS_RESPONDER: 'paraprofessional',
  ADMIN: 'support',
  PRACTICE_DIRECTOR: 'support',
  DIRECTOR: 'support',
  OFFICE_MANAGER: 'support',
  FRONT_DESK: 'support',
  BILLING: 'support',
  HR: 'support',
  SUPER_ADMIN: null,
};

function prismaRoles(): string[] {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = schema.match(/enum Role \{([^}]*)\}/);
  assert.ok(block, 'Role enum found');
  return block![1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

test('every StaffRole in the Prisma schema has an explicit seat type', () => {
  const roles = prismaRoles();
  assert.ok(roles.length >= 19);
  for (const role of roles) {
    assert.ok(role in EXPECTED, `Role ${role} has no seat mapping — add it to SEAT_TYPES in plans.ts and to this test`);
    assert.equal(seatTypeForUser({ role }), EXPECTED[role], role);
    if (EXPECTED[role]) assert.equal(seatTypeForRole(role), EXPECTED[role]);
  }
  // The role lists in plans.ts contain only real roles.
  for (const type of Object.values(SEAT_TYPES)) {
    for (const r of type.roles) assert.ok(roles.includes(r), `${type.id} lists unknown role ${r}`);
  }
});

test('multi-role users count once at their highest-cost seat; lower case roles accepted', () => {
  assert.equal(seatTypeForUser({ role: 'PRACTICE_DIRECTOR', roles: ['PRACTICE_DIRECTOR', 'THERAPIST'] }), 'clinician');
  assert.equal(seatTypeForUser({ role: 'THERAPIST', roles: ['NP'] }), 'prescriber');
  assert.equal(seatTypeForUser({ role: 'case_manager' }), 'paraprofessional');
  assert.equal(seatTypeForUser({ role: 'PSYCHIATRIST', roles: ['SUPER_ADMIN'] }), null, 'platform staff never counted');
});

test('countSeats: active only, by type, support free, unmapped reported', () => {
  const users = [
    { role: 'THERAPIST', status: 'ACTIVE' },
    { role: 'THERAPIST', status: 'ACTIVE' },
    { role: 'PSYCHIATRIST', status: 'ACTIVE' },
    { role: 'NP', roles: ['NP', 'PRACTICE_DIRECTOR'], status: 'ACTIVE' },
    { role: 'MEDICAL_NP', status: 'ACTIVE' },
    { role: 'PRP_SPECIALIST', status: 'ACTIVE' },
    { role: 'PEER_SUPPORT', status: 'ACTIVE' },
    { role: 'MEDICAL_ASSISTANT', status: 'ACTIVE' },
    { role: 'FRONT_DESK', status: 'ACTIVE' },
    { role: 'BILLING', status: 'ACTIVE' },
    { role: 'HR', status: 'ACTIVE' },
    { role: 'SOMETHING_NEW', status: 'ACTIVE' },
    { role: 'THERAPIST', status: 'DEACTIVATED' },
    { role: 'PSYCHIATRIST', status: 'INVITED' },
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
  ];
  const c = countSeats(users);
  assert.deepEqual(c.byType, { prescriber: 3, clinician: 2, paraprofessional: 3 });
  assert.equal(c.providers, 5);
  assert.equal(c.seats, 8);
  assert.equal(c.support, 4);
  assert.equal(c.unmapped, 1);
  assert.equal(c.prescribers, 3);
  assert.equal(c.program, 3);
  assert.equal(c.free, 4);
});

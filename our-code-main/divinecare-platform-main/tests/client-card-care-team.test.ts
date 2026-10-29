import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CARE_TEAM_SLOT_LABELS,
  CARE_TEAM_SLOT_ORDER,
  DEFAULT_MAX_CHIPS,
  PCP_NOT_ASSIGNED,
  PCP_TO_CONFIRM,
  SET_AS_PCP,
  UNASSIGNED_LABEL,
  buildCareTeamSummary,
  slotForStaffRole,
} from '../src/lib/clients/careTeamSummary';
import {
  CARE_TEAM_CHANGE_DENIED_CODE,
  CARE_TEAM_CHANGE_DENIED_MESSAGE,
} from '../src/lib/clients/careTeam';
import { caseloadMemberWhere } from '../src/lib/clients/orgScope';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('exact care team copy', () => {
  assert.equal(UNASSIGNED_LABEL, 'Unassigned');
  assert.equal(SET_AS_PCP, 'Set as PCP');
  assert.equal(PCP_TO_CONFIRM, 'PCP: to confirm');
  assert.equal(PCP_NOT_ASSIGNED, 'PCP: not assigned');
  assert.equal(CARE_TEAM_CHANGE_DENIED_CODE, 'CARE_TEAM_CHANGE_DENIED');
  assert.equal(CARE_TEAM_CHANGE_DENIED_MESSAGE, 'Ask the primary clinician or leadership to change the care team');
  assert.equal(DEFAULT_MAX_CHIPS, 4);
});

test('chip slots keep their order and labels', () => {
  assert.deepEqual(
    CARE_TEAM_SLOT_ORDER.map((s) => CARE_TEAM_SLOT_LABELS[s]),
    ['Prescriber', 'Therapist', 'Case manager', 'PRP', 'Peer', 'Primary care', 'Clinician']
  );
  assert.equal(slotForStaffRole('PSYCHIATRIST'), 'prescriber');
  assert.equal(slotForStaffRole('NP'), 'prescriber');
  assert.equal(slotForStaffRole('THERAPIST'), 'therapist');
  assert.equal(slotForStaffRole('PHYSICIAN'), 'primaryCare');
  assert.equal(slotForStaffRole('FRONT_DESK'), 'clinician');
});

test('a card with no team and no assignee shows Unassigned and no invented names', () => {
  const model = buildCareTeamSummary({ treatmentTeam: [], assignedToId: null, assignedToName: null });
  assert.equal(model.primary, null);
  assert.deepEqual(model.chips, []);
  assert.equal(model.moreCount, 0);
  assert.equal(model.pcp.status, 'not_assigned');
  assert.equal(model.pcp.text, PCP_NOT_ASSIGNED);
});

test('a non-clinical assignee is not shown as the primary clinician', () => {
  const model = buildCareTeamSummary({
    treatmentTeam: [],
    assignedToId: 'u-admin',
    assignedToName: 'Import Admin',
    assignedToRole: 'ADMIN',
  });
  assert.equal(model.primary, null);
});

test('the flagged primary member leads and its text is "Name · Slot"', () => {
  const model = buildCareTeamSummary({
    treatmentTeam: [
      { id: 'u1', name: 'Pat Therapist', role: 'Therapist', primary: true },
      { id: 'u2', name: 'Sam Prescriber', role: 'Psychiatrist', primary: false },
    ],
  });
  assert.deepEqual(model.primary, { name: 'Pat Therapist', slot: 'Therapist', text: 'Pat Therapist · Therapist' });
  assert.ok(model.chips.length >= 1);
});

test('caseload scope counts assigned clinician OR a care-team member', () => {
  assert.deepEqual(caseloadMemberWhere('u1'), {
    OR: [{ assignedToId: 'u1' }, { treatmentTeamMembers: { some: { providerId: 'u1' } } }],
  });
});

test('client card renders the care team summary and the Set as PCP action', () => {
  const card = read('src/components/clients/CareTeamSummary.tsx');
  assert.match(card, /buildCareTeamSummary/);
  assert.match(card, /SET_AS_PCP/);
  assert.match(card, /UNASSIGNED_LABEL/);
  assert.match(card, /\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/pcp/);
});

test('care team changes stay behind the primary-clinician / leadership gate', () => {
  const lib = read('src/lib/clients/careTeam.ts');
  assert.match(lib, /export async function canChangeCareTeam/);
  assert.match(lib, /isLeadership\(actor\.role\) \|\| isPrimary/);
  // Chart history uses the same care-team definition.
  assert.match(read('src/lib/chart-digest/access.ts'), /assignedToId === actor\.userId \|\| client\.treatmentTeamMembers\.length > 0/);
});

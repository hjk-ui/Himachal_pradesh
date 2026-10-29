import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupProviders, providerGroupLabel, sortProviders } from '../src/features/appointments/providerGroups';

/** Schedule provider pickers: grouped by role, A-Z within each group. */
const staff = [
  { name: 'zoe Adams', role: 'THERAPIST' },
  { name: 'Rajan Sood', role: 'PSYCHIATRIST' },
  { name: 'Isabella Mate', role: 'NP' },
  { name: 'alexander Albert', role: 'THERAPIST' },
  { name: 'Daniel Safo', role: 'MEDICAL_NP' },
  { name: 'Augustina Agaruwa', role: 'NP' },
  { name: 'Pat Front', role: 'FRONT_DESK' },
];

test('order: psychiatrists, psychiatric NPs, therapists, primary care, then other staff; A-Z ignoring case', () => {
  assert.deepEqual(sortProviders(staff).map((s) => s.name), [
    'Rajan Sood', 'Augustina Agaruwa', 'Isabella Mate', 'alexander Albert', 'zoe Adams', 'Daniel Safo', 'Pat Front',
  ]);
});

test('groups carry their labels and only non-empty groups appear', () => {
  assert.deepEqual(groupProviders(staff).map((g) => [g.label, g.items.length]), [
    ['Psychiatrists', 1], ['Psychiatric NPs', 2], ['Therapists', 2], ['Primary care NPs', 1], ['Other staff', 1],
  ]);
  assert.equal(providerGroupLabel(undefined), 'Other staff');
});

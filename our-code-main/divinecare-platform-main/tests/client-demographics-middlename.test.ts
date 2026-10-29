import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPatient } from '../src/lib/drfirst/mapping';
import { buildSendPatientRequest } from '../src/lib/drfirst/rcopia/xml';

const baseRow = {
  id: 'client-1',
  name: 'Alex Example',
  dateOfBirth: new Date('1990-01-15T00:00:00Z'),
};

test('MiddleName is always present on the mapped patient, even when empty', () => {
  for (const middleInitial of [undefined, null, '', '   ']) {
    const patient = mapPatient({ ...baseRow, middleInitial }, 'org-1');
    assert.ok('middleName' in patient, `middleName key present for ${JSON.stringify(middleInitial)}`);
    assert.equal(patient.middleName, '');
  }
  assert.equal(mapPatient({ ...baseRow, middleInitial: ' Q ' }, 'org-1').middleName, 'Q');
});

test('Rcopia send_patient always emits <MiddleName>, empty when cleared', () => {
  const empty = buildSendPatientRequest(mapPatient({ ...baseRow, middleInitial: '' }, 'org-1'), 'ext-1');
  assert.match(empty, /<MiddleName><\/MiddleName>/);

  const set = buildSendPatientRequest(mapPatient({ ...baseRow, middleInitial: 'Q' }, 'org-1'), 'ext-1');
  assert.match(set, /<MiddleName>Q<\/MiddleName>/);

  // Order stays FirstName, MiddleName, LastName.
  assert.match(empty, /<FirstName>[^<]*<\/FirstName><MiddleName><\/MiddleName><LastName>/);
});

test('clearing the middle name is not the same as omitting it', () => {
  const cleared = buildSendPatientRequest(mapPatient({ ...baseRow, middleInitial: null }, 'org-1'), 'ext-1');
  assert.equal(cleared.includes('<MiddleName'), true);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/** PDUM1 / PDUM4: E-Prescribe never opens Rcopia for a patient it could not send first (no silent patient-search launch). */
const route = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/drfirst/sso/route.ts'), 'utf8');

test('incomplete demographics stop the launch with the missing fields named', () => {
  assert.match(route, /reg\.ok === false && reg\.code === 'DEMOGRAPHICS_INCOMPLETE'\)/);
  assert.match(route, /code: 'DEMOGRAPHICS_INCOMPLETE'/);
  assert.match(route, /then open DrFirst again/);
});

test('any other upload failure also stops the launch; no silent register note', () => {
  assert.match(route, /code: 'UPLOAD_FAILED'/);
  assert.doesNotMatch(route, /registerNote/);
});

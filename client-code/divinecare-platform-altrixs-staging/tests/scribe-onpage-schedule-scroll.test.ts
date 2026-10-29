import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** During a visit the AI Scribe docks in the visit's note instead of opening a separate page. */
test('visit guide scribe step opens the visit note with the scribe docked', () => {
  const helpers = read('src/components/visits/visitGuideHelpers.ts');
  const scribeCase = helpers.slice(helpers.indexOf("case 'scribe':"), helpers.indexOf("case 'scribe':") + 500);
  assert.match(scribeCase, /\/dashboard\/ehr\/notes\?/);
  assert.match(scribeCase, /qs\.set\('scribe', '1'\)/);
  assert.doesNotMatch(scribeCase, /\/dashboard\/scribe\?/);
});

test('telehealth: scribe links during and after a call go to the visit note (scribe=1)', () => {
  const page = read('src/app/dashboard/telehealth/page.tsx');
  assert.match(page, /function sessionScribeHref[\s\S]{0,120}sessionNoteHref\(s\)\}&scribe=1/);
  assert.doesNotMatch(page, /`\/dashboard\/scribe\?clientId/);
  const end = read('src/app/api/telehealth/end/route.ts');
  assert.doesNotMatch(end, /scribeUrl: `\/dashboard\/scribe/);
  assert.equal((end.match(/scribeUrl: `\/dashboard\/ehr\/notes\?[^`]*&scribe=1`/g) || []).length, 2);
});

test('schedule day view: provider header and time grid scroll sideways together', () => {
  const page = read('src/app/dashboard/appointments/page.tsx');
  assert.match(page, /ref=\{dayHeadScrollRef\}\s*onScroll=\{\(\) => syncDayScroll\('head'\)\}/);
  assert.match(page, /ref=\{dayGridScrollRef\}\s*onScroll=\{\(\) => syncDayScroll\('grid'\)\}/);
  assert.match(page, /head\.scrollLeft = grid\.scrollLeft/);
  assert.match(page, /grid\.scrollLeft = head\.scrollLeft/);
  // header pads for the grid's vertical scrollbar so the last columns line up too
  assert.match(page, /grid\.offsetWidth - grid\.clientWidth/);
});

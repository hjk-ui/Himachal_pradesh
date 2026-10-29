import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NEVER_AI_HEADINGS } from '../src/lib/scribe/formats';
import {
  insertWithheld,
  isWithheldHeading,
  withholdDraftSections,
} from '../src/lib/scribe-feedback/withheld';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('Identifying Information is a clinician-only heading', () => {
  assert.ok((NEVER_AI_HEADINGS as readonly string[]).includes('Identifying Information'));
  assert.equal(isWithheldHeading('Identifying Information'), true);
  assert.equal(isWithheldHeading('identifying information'), true);
  assert.equal(isWithheldHeading('Identifying  Information:'), true);
});

test('AI text under Identifying Information never reaches the note on its own', () => {
  const split = withholdDraftSections({
    'Identifying Information': 'Name: Example Person, DOB 01/01/1990',
    Subjective: 'Reports better sleep.',
  });
  assert.equal(split.sections['Identifying Information'], '');
  assert.equal(split.sections.Subjective, 'Reports better sleep.');
  assert.equal(split.withheld.length, 1);
  assert.equal(split.withheld[0].heading, 'Identifying Information');

  // Only an explicit insert places it in the note.
  const after = insertWithheld(split.sections, split.withheld[0]);
  assert.equal(after['Identifying Information'], 'Name: Example Person, DOB 01/01/1990');
});

test('the scribe API prompt forbids invented content for every clinician-only heading', () => {
  const route = read('src/app/api/agents/scribe/route.ts');
  assert.match(route, /NEVER_AI_HEADINGS\.join\(', '\)/);
  assert.match(route, /Never invent content for these clinician-only headings/);
});

test('the scribe page splits the API draft before it fills the note', () => {
  const page = read('src/app/dashboard/scribe/page.tsx');
  assert.match(page, /withholdDraftSections\(applyMseAliases\(apiDraft\.sections\)\)/);
  assert.match(page, /setNoteSections\(\{ \.\.\.note\.sections \}\);\s*setWithheld\(split\.withheld\)/);
});

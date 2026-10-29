import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NO_MED_CHANGES_SENTENCE, SCRIBE_DRAFT_PROMPT_VERSION } from '../src/lib/scribe/formats';
import {
  MAX_RECONNECT_ATTEMPTS,
  NO_AUDIO_MESSAGE,
  NO_AUDIO_SECONDS,
  formatElapsed,
  isNoAudio,
  reconnectMessage,
} from '../src/lib/scribe-feedback/recordingStatus';
import { applyMseAliases, canonicalMseDomain } from '../src/lib/scribe-feedback/mseAliases';
import {
  INSERTED_LABEL,
  INSERT_SUGGESTION_LABEL,
  insertWithheld,
  isWithheldHeading,
  withheldHeader,
  withholdDraftSections,
} from '../src/lib/scribe-feedback/withheld';
import {
  assignMeasuresLabel,
  extractSpokenMeasures,
  normalizeSpokenMeasures,
} from '../src/lib/scribe-feedback/spokenMeasures';
import { buildDraftGroups } from '../src/lib/scribe-feedback/draftGroups';
import {
  applyNoMedChanges,
  hasNoMedChanges,
  showsNoMedChanges,
} from '../src/lib/scribe-feedback/noMedChanges';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('draft prompt version is pinned', () => {
  assert.equal(SCRIBE_DRAFT_PROMPT_VERSION, 'scribe-draft-2026-10-25');
});

test('recording status: mm:ss and exact reconnect copy', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(65), '01:05');
  assert.equal(formatElapsed(3599), '59:59');
  assert.equal(
    reconnectMessage('network dropped', 2),
    'Recording interrupted: network dropped. Reconnecting… (attempt 2 of 6)'
  );
  assert.equal(MAX_RECONNECT_ATTEMPTS, 6);
  // attempt is clamped to 1..6
  assert.match(reconnectMessage('x', 9), /\(attempt 6 of 6\)$/);
  assert.match(reconnectMessage('x', 0), /\(attempt 1 of 6\)$/);
});

test('NO_AUDIO fires at 60 seconds of silence', () => {
  assert.equal(NO_AUDIO_SECONDS, 60);
  assert.equal(isNoAudio(59), false);
  assert.equal(isNoAudio(60), true);
  assert.match(NO_AUDIO_MESSAGE, /60 seconds/);
});

test('RecordingStatusBar copy and controls', () => {
  const src = read('src/components/scribe/RecordingStatusBar.tsx');
  for (const label of ['RECORDING_LABEL', 'PAUSE_LABEL', 'RESUME_LABEL', 'STOP_LABEL', 'reconnectMessage', 'NO_AUDIO_MESSAGE', 'formatElapsed']) {
    assert.ok(src.includes(label), `uses ${label}`);
  }
  const lib = read('src/lib/scribe-feedback/recordingStatus.ts');
  assert.match(lib, /RECORDING_LABEL = 'Recording'/);
  assert.match(lib, /PAUSE_LABEL = 'Pause'/);
  assert.match(lib, /RESUME_LABEL = 'Resume'/);
  assert.match(lib, /STOP_LABEL = 'Stop'/);
});

test('MSE aliases: Thought Content, Insight/Judgment, Orientation → Cognition', () => {
  assert.equal(canonicalMseDomain('Thought Content'), 'Thought Content');
  assert.equal(canonicalMseDomain('thought  content'), 'Thought Content');
  assert.equal(canonicalMseDomain('Insight'), 'Insight/Judgment');
  assert.equal(canonicalMseDomain('Judgment'), 'Insight/Judgment');
  assert.equal(canonicalMseDomain('Insight and Judgment'), 'Insight/Judgment');
  assert.equal(canonicalMseDomain('Insight/Judgment'), 'Insight/Judgment');
  assert.equal(canonicalMseDomain('Orientation'), 'Cognition');
  assert.equal(canonicalMseDomain('Subjective'), null);

  const folded = applyMseAliases({
    Subjective: 'a',
    Orientation: 'Oriented to person.',
    Cognition: 'Attention intact.',
    Insight: 'Fair.',
  });
  assert.deepEqual(Object.keys(folded), ['Subjective', 'Cognition', 'Insight/Judgment']);
  assert.equal(folded.Cognition, 'Oriented to person.\nAttention intact.');
  assert.equal(folded.Subjective, 'a');
});

test('withheld headings are blanked and offered behind Insert suggestion', () => {
  assert.equal(INSERT_SUGGESTION_LABEL, 'Insert suggestion');
  assert.equal(INSERTED_LABEL, 'Inserted');
  assert.equal(isWithheldHeading('Identifying Information'), true);
  assert.equal(isWithheldHeading('Medication plan'), true);
  assert.equal(isWithheldHeading('Risk / safety'), true);
  assert.equal(isWithheldHeading('Assessment'), false);

  const split = withholdDraftSections({
    Assessment: 'Mood improved.',
    Diagnoses: 'F32.1 suggested by AI',
    'Medication plan': 'Increase sertraline',
    Labs: '   ',
  });
  assert.equal(split.sections.Assessment, 'Mood improved.');
  assert.equal(split.sections.Diagnoses, '');
  assert.equal(split.sections['Medication plan'], '');
  assert.equal(split.sections.Labs, '');
  assert.deepEqual(
    split.withheld.map((w) => w.heading),
    ['Diagnoses', 'Medication plan']
  );
  // Blank-only AI text produces no suggestion.
  assert.equal(split.withheld.some((w) => w.heading === 'Labs'), false);

  const inserted = insertWithheld(split.sections, split.withheld[0]);
  assert.equal(inserted.Diagnoses, 'F32.1 suggested by AI');
  // Never overwrites clinician text.
  const typed = insertWithheld({ Diagnoses: 'Typed by clinician' }, split.withheld[0]);
  assert.equal(typed.Diagnoses, 'Typed by clinician\nF32.1 suggested by AI');
});

test('DraftSuggestions header copy', () => {
  assert.equal(withheldHeader(2), 'AI suggestions withheld from the note (2)');
  const groups = buildDraftGroups({
    withheld: [{ id: 'Labs', heading: 'Labs', text: 'CBC' }],
    transcript: 'Nothing about measures here.',
  });
  assert.equal(groups.withheldHeader, 'AI suggestions withheld from the note (1)');
  assert.equal(groups.total, 1);
  const none = buildDraftGroups({ withheld: [], transcript: '' });
  assert.equal(none.withheldHeader, null);
  assert.equal(none.total, 0);
});

test('spoken measures normalize and extract in order of mention', () => {
  assert.equal(normalizeSpokenMeasures('Let us do a GAD seven today'), 'Let us do a GAD-7 today');
  assert.equal(normalizeSpokenMeasures('phq nine and PHQ 2'), 'PHQ-9 and PHQ-2');
  assert.equal(normalizeSpokenMeasures('PCL five'), 'PCL-5');
  // Unknown numbers stay untouched.
  assert.equal(normalizeSpokenMeasures('GAD six'), 'GAD six');

  const found = extractSpokenMeasures(['Clinician: repeat the PHQ nine', 'Clinician: and a GAD seven too, GAD-7 again']);
  assert.deepEqual(found, [
    { key: 'phq-9', name: 'PHQ-9' },
    { key: 'gad-7', name: 'GAD-7' },
  ]);
  assert.deepEqual(extractSpokenMeasures('We talked about sleep.'), []);
});

test('Assign measures label has no invented date', () => {
  assert.equal(assignMeasuresLabel(2, '2026-11-03'), 'Assign these measures (2), due 2026-11-03');
  assert.equal(assignMeasuresLabel(1), 'Assign these measures (1)');
  assert.equal(assignMeasuresLabel(1, '  '), 'Assign these measures (1)');

  const groups = buildDraftGroups({ withheld: [], transcript: 'PHQ nine', assignedKeys: ['phq-9'] });
  assert.equal(groups.measures.length, 0);
});

test('No medication changes checkbox adds and removes the exact sentence', () => {
  assert.equal(
    NO_MED_CHANGES_SENTENCE,
    'No medication changes this visit; continue current medications as prescribed.'
  );
  assert.equal(showsNoMedChanges('PSYCH_MED_MGMT'), true);
  assert.equal(showsNoMedChanges('SOAP'), false);

  const withPlan = applyNoMedChanges({ Assessment: 'x', Plan: 'Follow up in 4 weeks.' }, true);
  assert.equal(withPlan.Plan, `Follow up in 4 weeks.\n${NO_MED_CHANGES_SENTENCE}`);
  assert.equal(hasNoMedChanges(withPlan), true);
  // Idempotent
  assert.deepEqual(applyNoMedChanges(withPlan, true), withPlan);
  assert.equal(applyNoMedChanges(withPlan, false).Plan, 'Follow up in 4 weeks.');

  const medPlan = applyNoMedChanges({ 'Medication plan': '', Plan: 'p' }, true);
  assert.equal(medPlan['Medication plan'], NO_MED_CHANGES_SENTENCE);
  assert.equal(medPlan.Plan, 'p');
});

test('scribe page wires the new components', () => {
  const page = read('src/app/dashboard/scribe/page.tsx');
  assert.match(page, /<RecordingStatusBar/);
  assert.match(page, /<DraftSuggestions/);
  assert.match(page, /NO_MED_CHANGES_LABEL/);
  assert.match(page, /withholdDraftSections\(applyMseAliases\(/);
  assert.match(page, /<VisitSessionTabs/);
  // Reconnect is capped at six attempts and only on an unexpected end.
  assert.match(page, /MAX_RECONNECT_ATTEMPTS/);
});

test('DraftSuggestions shows Insert → Inserted and the measures CTA', () => {
  const src = read('src/components/scribe/DraftSuggestions.tsx');
  assert.match(src, /INSERT_SUGGESTION_LABEL/);
  assert.match(src, /INSERTED_LABEL/);
  assert.match(src, /assignMeasuresLabel/);
  // Assign stays disabled until the clinician picks a due date.
  assert.match(src, /disabled=\{!dueDate/);
});

test('recording gaps migration targets ProgressNote (no ScribeCapture model)', () => {
  const schema = read('prisma/schema.prisma');
  assert.equal(/^model ScribeCapture\b/m.test(schema), false);
  assert.match(schema, /recordingGaps\s+Json\?/);
  const sqlPath = 'prisma/migrations/20261025110000_scribe_recording_gaps/migration.sql';
  assert.ok(existsSync(join(root, sqlPath)));
  assert.match(read(sqlPath), /ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "recordingGaps" JSONB/);
});

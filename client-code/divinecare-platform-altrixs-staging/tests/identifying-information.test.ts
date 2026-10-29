import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOTE_SECTIONS } from '@/lib/ehr/noteTemplates';
import { noteTypeIssues } from '@/lib/notes/standard';
import { formatElementsGate } from '@/lib/notes/formatElements';
import { NEVER_AI_HEADINGS } from '@/lib/scribe/templateFields';
import {
  IDENTIFYING_INFO_HEADING,
  IDENTIFYING_INFO_NOTE_TYPES,
  hasIdentifyingInfo,
  isReEvalNoteType,
  emptyIdentifyingInfo,
  renderIdentifyingInfo,
  parseIdentifyingInfo,
  identifyingNarrative,
  prefillFromChart,
  prefillFromVisit,
  prefillFromPrior,
  mergePrefill,
  changesSincePrior,
  chartDemographicChanges,
  bmiFrom,
  ageOn,
  minorGuardianWarning,
  identifyingInfoIssues,
  identifyingSuggestionsFromTranscript,
  applySuggestion,
  GENDER_FEMALE,
  GENDER_MALE,
  GENDER_NONBINARY,
  PRONOUN_SHE,
  PRONOUN_HE,
  PRONOUN_THEY,
  NOT_HISPANIC,
  type ChartIdentifying,
  type IdentifyingInfo,
} from '@/lib/ehr/identifyingInfo';

const H = IDENTIFYING_INFO_HEADING;
const info = (patch: Partial<IdentifyingInfo>): IdentifyingInfo => ({ ...emptyIdentifyingInfo(), ...patch });
const ctx = (patch: Partial<{ patientName: string | null; dateOfBirth: string | null; noteType: string }> = {}) => ({
  noteType: 'Adult Psych Intake',
  patientName: 'Jordan Lee',
  dateOfBirth: '1990-03-01',
  dateOfService: '2026-10-25',
  ...patch,
});
const chart = (patch: Partial<ChartIdentifying> = {}): ChartIdentifying => ({
  name: 'Jordan Lee',
  preferredName: null,
  namePrefix: null,
  dateOfBirth: '1990-03-01',
  gender: null,
  sexAtBirth: null,
  genderIdentity: null,
  pronouns: null,
  race: [],
  ethnicity: null,
  maritalStatus: null,
  preferredLanguage: null,
  interpreterNeeded: null,
  hasGuardian: null,
  guardianName: null,
  guardianRelationship: null,
  ...patch,
});
const bodyWith = (noteType: string, section: string) =>
  NOTE_SECTIONS[noteType as keyof typeof NOTE_SECTIONS].map((h) => `${h}\n${h === H ? section : ''}`).join('\n');

test('section is present near the top of every intake / evaluation / re-evaluation type', () => {
  for (const t of ['Therapy Intake', 'Substance Abuse Intake', 'Intake', 'Psych Eval', 'Child Psych Initial Intake', 'Child Psych Intake', 'Adult Psych Intake', 'Adult Psych Re-Eval']) {
    assert.ok(IDENTIFYING_INFO_NOTE_TYPES.includes(t), t);
    assert.ok(hasIdentifyingInfo(t), t);
    const sections = NOTE_SECTIONS[t as keyof typeof NOTE_SECTIONS];
    const i = sections.indexOf(H);
    assert.ok(i >= 0 && i <= 1, `${t}: ${H} at index ${i}`);
    if (i === 1) assert.ok(['Header', 'Session'].includes(sections[0]), `${t}: only the visit header precedes it`);
  }
  assert.ok(isReEvalNoteType('Adult Psych Re-Eval'));
  assert.ok(isReEvalNoteType('Child Psych Intake'));
  assert.ok(!isReEvalNoteType('Adult Psych Intake'));
  for (const t of ['SOAP', 'DAP', 'Med Mgmt', 'Crisis', 'Group']) assert.ok(!hasIdentifyingInfo(t), t);
});

test('prefill maps chart demographics, vitals and the appointment; never overwrites entered values', () => {
  const c = chart({ genderIdentity: GENDER_FEMALE, pronouns: PRONOUN_SHE, race: ['2054-5'], ethnicity: NOT_HISPANIC, maritalStatus: 'M', interpreterNeeded: false, hasGuardian: false });
  const fromChart = prefillFromChart(c, { weightLbs: 150, heightInches: 65, recordedAt: '2026-09-01T10:00:00Z' });
  assert.equal(fromChart.values.genderIdentity, GENDER_FEMALE);
  assert.equal(fromChart.values.pronouns, PRONOUN_SHE);
  assert.deepEqual(fromChart.values.race, ['2054-5']);
  assert.equal(fromChart.values.interpreterNeeded, 'no');
  assert.equal(fromChart.values.guardian, 'Self');
  assert.equal(fromChart.values.weightLb, '150');
  assert.equal(fromChart.values.heightFt, '5');
  assert.equal(fromChart.values.heightIn, '5');
  assert.equal(fromChart.sources.genderIdentity, 'chart');
  assert.equal(fromChart.sources.weightLb, 'vitals');
  assert.equal(fromChart.values.chiefComplaint, undefined, 'chief complaint is never prefilled from the chart');

  const visit = prefillFromVisit({ known: true, telehealth: true, audioOnly: false, patientLocationState: 'md' });
  assert.equal(visit.values.modality, 'telehealth_video');
  assert.equal(visit.values.patientLocationState, 'MD');
  assert.equal(prefillFromVisit({ known: true, telehealth: true, audioOnly: true, patientLocationState: null }).values.modality, 'telehealth_audio');
  assert.deepEqual(prefillFromVisit({ known: false, telehealth: false, audioOnly: false, patientLocationState: null }).values, {});

  const merged = mergePrefill(info({ pronouns: PRONOUN_THEY }), { pronouns: 'saved' }, fromChart, visit);
  assert.equal(merged.info.pronouns, PRONOUN_THEY, 'clinician value kept');
  assert.equal(merged.info.genderIdentity, GENDER_FEMALE);
  assert.equal(merged.info.modality, 'telehealth_video');
});

test('re-eval prefills stable fields from the last evaluation and marks what changed', () => {
  const prior = info({ genderIdentity: GENDER_MALE, pronouns: PRONOUN_HE, maritalStatus: 'S', modality: 'in_office', chiefComplaint: 'old', weightLb: '180' });
  const priorText = renderIdentifyingInfo(prior, ctx());
  const parsed = parseIdentifyingInfo(priorText);
  assert.equal(parsed.pronouns, PRONOUN_HE);
  const p = prefillFromPrior(parsed);
  assert.equal(p.values.maritalStatus, 'S');
  assert.equal(p.sources.maritalStatus, 'prior');
  assert.equal(p.values.chiefComplaint, undefined, 'chief complaint is per visit');
  assert.equal(p.values.modality, undefined, 'modality is per visit');
  const now = { ...parsed, maritalStatus: 'M' };
  const changes = changesSincePrior(now, parsed);
  assert.ok(changes.some((c) => c.field === 'maritalStatus'), JSON.stringify(changes));
});

test('narrative uses the chosen pronouns, never his/her, and omits blank fields', () => {
  const she = identifyingNarrative(info({ genderIdentity: GENDER_FEMALE, pronouns: PRONOUN_SHE, modality: 'in_office', companions: [{ name: 'Sam', relationship: 'Mother' }] }), ctx());
  assert.match(she, /36-year-old woman \(she\/her\)/);
  assert.match(she, /accompanied by her mother, Sam/);
  const he = identifyingNarrative(info({ genderIdentity: GENDER_MALE, pronouns: PRONOUN_HE, modality: 'telehealth_video', patientLocationState: 'MD', companions: [{ name: '', relationship: 'Wife' }] }), ctx());
  assert.match(he, /\(he\/him\)/);
  assert.match(he, /via telehealth video \(patient located in Maryland\)/);
  assert.match(he, /accompanied by his wife/);
  const they = identifyingNarrative(info({ genderIdentity: GENDER_NONBINARY, pronouns: PRONOUN_THEY, companions: [{ name: 'Alex', relationship: 'Partner' }] }), ctx());
  assert.match(they, /\(they\/them\)/);
  assert.match(they, /their partner, Alex/);
  for (const s of [she, he, they]) assert.doesNotMatch(s, /his\/her|he\/she|s\/he/i);

  // Blank fields: no clause, no "unknown"; no pronouns -> name, not a guessed pronoun
  const bare = renderIdentifyingInfo(info({ chiefComplaint: 'I cannot sleep' }), ctx({ dateOfBirth: null }));
  assert.doesNotMatch(bare, /unknown|undefined|null|year-old|Race|Ethnicity|Marital|Weight|BMI|accompanied/i);
  assert.match(bare, /^Jordan Lee was seen for an initial psychiatric evaluation\./);
  assert.match(bare, /Chief complaint \(patient's own words\): "I cannot sleep"/);
  const comp = identifyingNarrative(info({ companions: [{ name: '', relationship: 'Mother' }] }), ctx());
  assert.match(comp, /Jordan's mother/);
  assert.equal(renderIdentifyingInfo(emptyIdentifyingInfo(), ctx({ patientName: null, dateOfBirth: null })), '');
});

test('BMI and age', () => {
  assert.equal(bmiFrom('150', '5', '5')?.toFixed(1), '25.0');
  assert.equal(bmiFrom('', '5', '5'), null);
  assert.equal(bmiFrom('150', '', ''), null);
  assert.equal(ageOn('2010-10-26', '2026-10-25'), 15);
  assert.equal(ageOn('2010-10-25', '2026-10-25'), 16);
  assert.match(renderIdentifyingInfo(info({ weightLb: '150', heightFt: '5', heightIn: '5' }), ctx()), /BMI: 25\.0 \(calculated\)/);
});

test('minor with guardian Self or blank warns', () => {
  assert.match(minorGuardianWarning(info({ guardian: 'Self' }), 15) ?? '', /minor/);
  assert.match(minorGuardianWarning(info({}), 15) ?? '', /legal guardian/);
  assert.equal(minorGuardianWarning(info({ guardian: 'Parent' }), 15), null);
  assert.equal(minorGuardianWarning(info({ guardian: 'Self' }), 30), null);
  const minorText = renderIdentifyingInfo(info({ guardian: 'Self', modality: 'in_office', chiefComplaint: 'sad' }), ctx({ dateOfBirth: '2012-01-01', noteType: 'Child Psych Initial Intake' }));
  const ids = identifyingInfoIssues('Child Psych Initial Intake', bodyWith('Child Psych Initial Intake', minorText)).map((i) => i.id);
  assert.deepEqual(ids, ['identifying.guardian']);
});

test('required for sign: chief complaint, modality, minor guardian; warn before the policy date, block on/after', () => {
  const type = 'Adult Psych Intake';
  const blank = bodyWith(type, renderIdentifyingInfo(info({}), ctx()));
  const ids = identifyingInfoIssues(type, blank).map((i) => i.id);
  assert.deepEqual(ids.sort(), ['identifying.chief_complaint', 'identifying.modality']);
  const done = bodyWith(type, renderIdentifyingInfo(info({ modality: 'in_office', chiefComplaint: 'Anxiety at work' }), ctx()));
  assert.deepEqual(identifyingInfoIssues(type, done), []);

  const before = new Date('2026-11-15T15:00:00Z');
  const after = new Date('2026-11-16T15:00:00Z');
  const warnGate = formatElementsGate({}, before);
  const blockGate = formatElementsGate({}, after);
  assert.equal(warnGate.enforceFrom, '2026-11-16');
  const warn = noteTypeIssues({ noteType: type, body: blank, formatElements: warnGate, now: before }).filter((i) => i.id.startsWith('identifying.'));
  assert.equal(warn.length, 2);
  assert.ok(warn.every((i) => i.severity === 'warn'));
  const block = noteTypeIssues({ noteType: type, body: blank, formatElements: blockGate, now: after }).filter((i) => i.id.startsWith('identifying.'));
  assert.equal(block.length, 2);
  assert.ok(block.every((i) => i.severity === 'block'));
  // Chief complaint in Identifying Information satisfies the template's Chief Complaint section
  const doneIssues = noteTypeIssues({ noteType: type, body: done, formatElements: blockGate, now: after });
  assert.ok(!doneIssues.some((i) => i.id.startsWith('identifying.')));
});

test('AI Scribe: suggestions from CLIENT lines / speaker roles only, never written to demographics', () => {
  assert.ok(NEVER_AI_HEADINGS.has(H), 'AI does not draft the section');
  const lines = [
    { id: 'l1', role: 'CLINICIAN', text: 'Hi, what brings you in today?' },
    { id: 'l2', role: 'GUARDIAN', text: 'She has been refusing to go to school for weeks.' },
    { id: 'l3', role: 'CLIENT', text: 'I feel anxious every morning before school.' },
    { id: 'l4', role: 'INTERPRETER', text: 'Translating.' },
  ];
  const s = identifyingSuggestionsFromTranscript(lines);
  assert.deepEqual(s.chiefComplaint, [{ text: 'I feel anxious every morning before school.', cite: 'l3' }]);
  assert.deepEqual(s.accompaniedBy.map((a) => a.relationship), ['Parent / guardian']);
  assert.equal(s.interpreterHeard, true);
  assert.deepEqual(identifyingSuggestionsFromTranscript([{ id: 'x', role: 'GUARDIAN', text: 'He is struggling a lot with anger lately.' }]).chiefComplaint, []);

  const base = info({ pronouns: PRONOUN_SHE });
  const a = applySuggestion(base, { pronouns: 'chart' }, { kind: 'chiefComplaint', text: s.chiefComplaint[0].text });
  const b = applySuggestion(a.info, a.sources, { kind: 'companion', relationship: 'Parent / guardian' });
  assert.equal(b.sources.chiefComplaint, 'ai');
  assert.equal(b.info.pronouns, PRONOUN_SHE, 'demographics untouched');
  const { patch } = chartDemographicChanges(b.info, chart({ pronouns: PRONOUN_SHE }), b.sources);
  assert.deepEqual(patch, {}, 'nothing from AI reaches the chart patch');
  // An AI-sourced demographic field is skipped even if one were set
  const forced = chartDemographicChanges(info({ pronouns: PRONOUN_HE }), chart(), { pronouns: 'ai' });
  assert.equal(forced.patch.pronouns, undefined);
  assert.equal(chartDemographicChanges(info({ pronouns: PRONOUN_HE }), chart(), { pronouns: 'saved' }).patch.pronouns, PRONOUN_HE);
});

test('chart update is explicit, gated and audited (route + editor source)', () => {
  const root = path.resolve(__dirname, '..');
  const route = readFileSync(path.join(root, 'src/app/api/clients/[id]/identifying-info/route.ts'), 'utf8');
  const post = route.slice(route.indexOf('export async function POST'));
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(post, /requireOrgContext\(\)/);
  assert.match(post, /canEditClientProfile\(gate\.role\)/);
  assert.match(post, /clientAccessWhere\(/);
  assert.match(post, /phiGate\(/);
  assert.match(post, /auditPhiAccess\(/);
  assert.ok(post.indexOf('prisma.client.update') < post.indexOf('auditPhiAccess('), 'audited after the write');
  assert.doesNotMatch(get, /prisma\.client\.update|\.update\(/, 'GET never writes');
  assert.match(get, /clientAccessWhere\(/);
  assert.match(get, /auditPhiAccess\(/);

  const editor = readFileSync(path.join(root, 'src/components/notes/IdentifyingInfoEditor.tsx'), 'utf8');
  const posts = editor.match(/method: 'POST'/g) ?? [];
  assert.equal(posts.length, 1, 'one POST');
  const fnStart = editor.indexOf('const updateChart = async');
  assert.ok(fnStart > 0 && editor.indexOf("method: 'POST'") > fnStart, 'the POST lives in updateChart');
  assert.match(editor, /onClick=\{updateChart\}|onClick=\{\(\) => (void )?updateChart\(\)\}/);
  assert.equal((editor.match(/updateChart\(/g) ?? []).length <= 1, true, 'updateChart is not called from an effect');
});

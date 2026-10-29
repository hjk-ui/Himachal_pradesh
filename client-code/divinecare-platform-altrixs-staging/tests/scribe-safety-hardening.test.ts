/**
 * AI Scribe safety hardening (transcript → structured note). One block per numbered item of the
 * review, plus the smaller items: pure logic and source checks (no database, no Bedrock).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { scanTranscriptRisk, clinicianNarrates } from '../src/lib/scribe/risk';
import {
  RISK_ATTESTATION_PREFIX,
  RISK_GATE_CODE,
  parsePersistedFindings,
  persistableFindings,
  riskAssessedInNote,
  riskAttestationText,
  riskFlagsFromFindings,
  transcriptRiskGate,
} from '../src/lib/scribe/riskGate';
import { checkOptionValue, hasNegation, sentencePolarity } from '../src/lib/scribe/polarity';
import { checkDraftSentence, sourceMap, type Source } from '../src/lib/scribe/grounding';
import { NOT_ON_MED_LIST, levenshtein, metaphone, suggestMisheardMeds, type ChartMedication } from '../src/lib/scribe/medications';
import { applyVerdict, entailmentCandidates, parseEntailmentReply, runEntailment, buildEntailmentPrompt, ENTAIL_MAX_CALLS } from '../src/lib/scribe/entailment';
import { minimumNecessaryCheck, removeSentence, appendPsychotherapyNote, properNames } from '../src/lib/scribe/minimumNecessary';
import { lintStigma, rewriteStigma } from '../src/lib/scribe/stigma';
import { sessionClockFromCapture, pauseUpdate } from '../src/lib/scribe/sessionClock';
import { crisisAddOnUnits, interactiveComplexityEvidence, suggestCptForSession } from '../src/lib/scribe/coding';
import { defaultSpeakerMap, participantRole, speakerLabelsInferred, transcriptForModel, type TranscriptLine } from '../src/lib/scribe/diarization';
import { editRatio, sectionCloneWarnings, buildAiProvenance, shingledJaccard } from '../src/lib/notes/aiEvidence';
import { formatElementIssues } from '../src/lib/notes/formatElements';
import { noteTypeIssues } from '../src/lib/notes/standard';
import { NEVER_AI_HEADINGS, formatSpec } from '../src/lib/scribe/templateFields';
import {
  buildDraftSystemPrompt,
  buildSources,
  draftTargetGroups,
  groundDraft,
  looksTruncated,
  mergeRawDrafts,
  parseDraftReply,
  transcriptQualityWarning,
  type ChartFacts,
  type RawDraft,
} from '../src/lib/scribe/draft';
import { DEFAULT_PREFERENCES } from '../src/lib/scribe/settings';
import { verbalInstrument, verbalSeverity } from '../src/lib/scribe/verbalScores';
import { crisisAddOnChecks, languageChecks, cloneChecks, riskChecks, type NoteQualityFacts } from '../src/lib/ai/noteQuality/rules';

const SRC = path.join(__dirname, '..', 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n');

const line = (id: string, role: TranscriptLine['role'], text: string, at = 0): TranscriptLine => ({ id, seq: Number(id.slice(1)), role, speakerLabel: role === 'CLINICIAN' ? 'spk_0' : 'spk_1', startMs: at, endMs: at + 1000, text });
const noChart: ChartFacts = { goals: [], diagnoses: [], lastPlan: null, scores: [] };
const raw = (over: Partial<RawDraft>): RawDraft => ({
  narrative: {},
  options: {},
  mse: {},
  interventions: [],
  planLinks: [],
  homework: [],
  nextAppointment: null,
  followUps: [],
  conditions: [],
  summary: [],
  ...over,
});

// ─── 1. Transcript risk gates signing ───────────────────────────────────────

test('1. risk findings persist without quotes; clinician lines are scanned for dictation / recap / paste', () => {
  const lines = [line('t1', 'CLINICIAN', 'How has your week been?'), line('t2', 'CLIENT', 'Honestly I keep thinking about killing myself.', 65_000)];
  const risk = scanTranscriptRisk(lines);
  const stored = persistableFindings(risk);
  assert.ok(stored.length >= 1);
  assert.equal(stored[0].lineId, 't2');
  assert.ok(!('quote' in stored[0]), 'no quotes stored');
  assert.deepEqual(parsePersistedFindings(JSON.parse(JSON.stringify(stored))), stored);
  // Dictation / recap: the clinician narrates what the client said
  const dictated = [line('t1', 'CLINICIAN', 'Client stated she wants to kill herself.')];
  assert.equal(scanTranscriptRisk(dictated).findings.length, 0, 'conversation: clinician lines are not findings');
  assert.ok(scanTranscriptRisk(dictated, { scanClinician: true }).findings.length >= 1, 'recap: clinician lines are scanned');
  // A screening question is still not a finding
  assert.equal(scanTranscriptRisk([line('t1', 'CLINICIAN', 'Have you had any thoughts of killing yourself?')], { scanClinician: true }).findings.length, 0);
  assert.equal(clinicianNarrates({ mode: 'dictation' }), true);
  assert.equal(clinicianNarrates({ mode: 'in_person', source: 'recap' }), true);
  assert.equal(clinicianNarrates({ mode: 'in_person', engine: 'paste' }), true);
  assert.equal(clinicianNarrates({ mode: 'in_person', source: 'live', engine: 'transcribe_medical_streaming' }), false);
});

test('1. sign gate: blocks until C-SSRS / risk level / safety plan is documented or the attestation is given (any note type)', () => {
  const findings = persistableFindings(scanTranscriptRisk([line('t2', 'CLIENT', 'I keep thinking about killing myself.')]));
  const soap = 'Subjective\nClient discussed stress at work.\n\nAssessment\nAnxious.\n\nPlan\nWeekly therapy.';
  const blocked = transcriptRiskGate({ findings, body: soap });
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.message?.startsWith(`${RISK_GATE_CODE}:`));
  assert.match(blocked.message!, /C-SSRS/);
  for (const body of [
    `${soap}\nC-SSRS screen: negative`,
    `${soap}\nOverall risk level: Low`,
    `${soap}\nRisk assessment: low acute risk; protective factors reviewed.`,
    `${soap}\nSafety plan reviewed and updated with the client.`,
  ]) {
    assert.equal(transcriptRiskGate({ findings, body }).blocked, false, body.split('\n').pop());
  }
  assert.equal(riskAssessedInNote(`${soap}\nC-SSRS: Not assessed`).documented, false, 'an empty value does not count');
  assert.equal(transcriptRiskGate({ findings, body: soap, attestation: 'too short' }).blocked, true);
  const ok = transcriptRiskGate({ findings, body: soap, attestation: 'the client was quoting a song lyric and denied any intent when asked' });
  assert.equal(ok.blocked, false);
  assert.ok(ok.attestation?.startsWith(RISK_ATTESTATION_PREFIX));
  assert.equal(transcriptRiskGate({ findings, body: soap, existingAttestation: riskAttestationText('reviewed with supervisor; statement was historical') }).blocked, false);
  assert.equal(transcriptRiskGate({ findings: [], body: soap }).blocked, false, 'no findings: no gate');
  assert.match(riskFlagsFromFindings(findings)[0], /^AI Scribe transcript risk language: suicide/);
});

test('1. sign path, API and UI carry the gate; quality check gets the flags', () => {
  const store = read('lib/notes/workflow-store.ts');
  assert.match(store, /transcriptRiskGate\(\{ findings: riskFindings, body: currentNote\.body, attestation: input\.riskAttestation/);
  assert.match(store, /SCRIBE_RISK_ATTESTATION/);
  assert.ok(store.indexOf('recordScribeSignEvidence({') < store.indexOf('await purgeScribeForSignedNote'), 'evidence before the purge');
  assert.match(read('app/api/ehr/notes/[id]/workflow/route.ts'), /riskAttestation: body\.riskAttestation \?\? null/);
  assert.match(read('app/api/notes/[id]/route.ts'), /riskAttestation: body\.riskAttestation \?\? null/);
  assert.match(read('app/dashboard/ehr/notes/page.tsx'), /<RiskAttestationField/);
  assert.match(read('lib/ai/noteQuality/load.ts'), /riskFlagsFromFindings\(transcriptFindings\)/);
  assert.match(read('app/api/scribe/captures/[id]/draft/route.ts'), /riskFindings: JSON\.parse\(JSON\.stringify\(persistableFindings\(risk\)\)\)/);
  const facts = { riskFlags: ['AI Scribe transcript risk language: suicide (1 finding)'], transcriptRisk: { findings: 1, attested: true }, note: { body: 'Plan\nWeekly.' } } as unknown as NoteQualityFacts;
  assert.equal(riskChecks(facts)[0].status, 'warn', 'attested: warn, not fail');
  assert.equal(riskChecks({ ...facts, transcriptRisk: { findings: 1, attested: false } })[0].status, 'fail');
});

// ─── 2. Option chips / tri fields ───────────────────────────────────────────

test('2. chips need the client\'s own words with matching polarity', () => {
  const lines = [
    { id: 't1', role: 'CLINICIAN', text: 'Any thoughts of hurting yourself or ending your life this week?' },
    { id: 't2', role: 'CLIENT', text: 'No, none at all.' },
    { id: 't3', role: 'OTHER', text: 'No, she has been fine.' },
    { id: 't4', role: 'CLIENT', text: 'I had a good week at work.' },
    { id: 't5', role: 'CLIENT', text: 'Yes, I have been thinking about ending my life.' },
  ];
  const opt = (fieldId: string, value: string, cites: string[], risk = true) => checkOptionValue({ fieldId, label: fieldId, kind: 'tri', value, cites, lines, risk });
  assert.equal(opt('si', 'Denies', ['t2']).ok, true, 'client denial answering the clinician question');
  assert.equal(opt('si', 'Denies', ['t1']).ok, false, 'clinician question only');
  const other = opt('si', 'Denies', ['t3']);
  assert.equal(other.ok, false);
  assert.equal((other as { reason: string }).reason, 'option_role', 'risk tri: CLIENT only');
  const noNeg = opt('si', 'Denies', ['t4']);
  assert.equal((noNeg as { reason: string }).reason, 'option_polarity', '"Denies" needs a negation');
  assert.equal(opt('si', 'Endorses', ['t5']).ok, true);
  assert.equal(opt('si', 'Endorses', ['t2']).ok, false, 'an affirmation cannot cite a denial');
  // Non-risk chips: any participant voice (guardian for a child intake), never the clinician
  assert.equal(checkOptionValue({ fieldId: 'grade', label: 'Grade', kind: 'single', value: '5th', cites: ['t1'], lines, risk: false }).ok, false);
});

test('2. groundDraft withholds unchecked chips and records them as withheld (no blanket support: 1)', () => {
  const lines = [
    line('t1', 'CLINICIAN', 'Any thoughts of hurting yourself this week?'),
    line('t2', 'CLIENT', 'No, none at all. I used the breathing when I got anxious at work.'),
    line('t3', 'CLINICIAN', 'And any thoughts of hurting someone else?'),
  ];
  const { sources } = buildSources(lines, noChart);
  const g = groundDraft(raw({ options: { si: { value: 'Denies', cites: ['t2'] }, hi: { value: 'Denies', cites: ['t3'] }, selfHarm: { value: 'Endorses', cites: ['t2'] } } }), { format: 'THERAPY_PROGRESS', sources, chart: noChart });
  assert.match(g.body, /Suicidal ideation: Denies/);
  assert.doesNotMatch(g.body, /Homicidal ideation: Denies/, 'cited only the clinician question');
  assert.doesNotMatch(g.body, /Current self-harm: Endorses/, 'polarity mismatch');
  const hi = g.withheld.find((w) => w.target === 'hi');
  assert.equal(hi?.reason, 'option_role');
  assert.equal(g.withheld.find((w) => w.target === 'selfHarm')?.reason, 'option_polarity');
  const src = read('lib/scribe/draft.ts');
  assert.doesNotMatch(src, /status: 'supported', support: 1, target: id/);
});

// ─── 3. Medications ─────────────────────────────────────────────────────────

const meds: ChartMedication[] = [
  { name: 'sertraline', dose: '100 mg', sig: 'take 1 tablet daily', drFirst: true },
  { name: 'trazodone', dose: '50 mg', sig: 'at bedtime', drFirst: false },
];

test('3. med list as chart facts; unlisted + uncited drugs / doses withheld; heard-but-unlisted flagged', () => {
  const { sources, text } = buildSources([line('t1', 'CLIENT', 'The sertraline is helping and I started melatonin 5 mg.')], { ...noChart, medications: meds });
  assert.match(text, /c\d: Active medication: sertraline 100 mg — take 1 tablet daily \(DrFirst list\)/);
  const map = sourceMap(sources);
  const medFact = sources.find((s) => /Active medication: sertraline/.test(s.text))!.id;
  const chk = (t: string, cites: string[]) => checkDraftSentence({ text: t, cites }, map, { medList: meds });
  assert.equal(chk('Client takes sertraline 100 mg daily.', ['t1', medFact]).status, 'supported');
  assert.equal(chk('Client takes lorazepam.', ['t1']).reason, 'ungrounded_medication');
  assert.equal(chk('Client takes sertraline 150 mg.', ['t1', medFact]).reason, 'ungrounded_number');
  const mel = chk('Client started melatonin 5 mg.', ['t1']);
  assert.notEqual(mel.status, 'withheld');
  assert.ok(mel.flags?.some((f) => f.includes(NOT_ON_MED_LIST)));
});

test('3. misheard names get a suggestion (Metaphone / Levenshtein); med sections are clinician-only', () => {
  assert.equal(levenshtein('sertralin', 'sertraline'), 1);
  assert.equal(metaphone('zoloft'), metaphone('zolloft'));
  const s = suggestMisheardMeds([{ id: 't4', text: 'I ran out of my sertralin on Friday and the trazadone too.' }], meds);
  assert.ok(s.some((x) => x.heard.toLowerCase() === 'sertralin' && x.likely === 'sertraline' && x.onMedList));
  assert.ok(s.some((x) => x.likely === 'trazodone'));
  assert.ok(NEVER_AI_HEADINGS.has('Plan - Med Changes') && NEVER_AI_HEADINGS.has('Current Medications'));
  const mm = formatSpec('MED_MGMT');
  assert.ok(mm.kind === 'sections' && !mm.aiHeadings.includes('Current Medications'));
  const { sources } = buildSources([line('t1', 'CLINICIAN', 'We will increase sertraline to 150 mg.')], { ...noChart, medications: meds });
  const g = groundDraft(raw({ narrative: { 'Plan - Med Changes': [{ text: 'Increase sertraline to 150 mg.', cites: ['t1'] }] }, medChanges: [{ text: 'Sertraline increased to 150 mg.', cites: ['t1'] }] }), {
    format: 'PSYCH_MED_MGMT',
    sources,
    chart: { ...noChart, medications: meds },
  });
  assert.equal(g.texts['Plan - Med Changes'], '', 'never inserted');
  assert.equal(g.medSuggestions.length, 2, 'offered as suggestions');
});

// ─── 4. Meaning check: polarity + entailment ────────────────────────────────

test('4. polarity rule: negation vs affirmation against the cited lines', () => {
  assert.equal(hasNegation("I don't sleep"), true);
  assert.equal(sentencePolarity('Client reports suicidal thoughts.', ["No, I'm not suicidal."]).status, 'mismatch');
  assert.equal(sentencePolarity('Client denies nausea.', ['I have nausea every morning.']).status, 'mismatch');
  assert.equal(sentencePolarity('Client denied any suicidal ideation.', ['How has your mood been?']).status, 'unsupported_negation');
  assert.equal(sentencePolarity('Client denied suicidal thoughts.', ['Any thoughts of suicide?']).status, 'mismatch', 'negates what the (question) line states');
  assert.equal(sentencePolarity('Sleep improved on sertraline.', ['Sleep is better on sertraline, no nausea now.']).status, 'ok');
  const map = sourceMap([{ id: 't1', kind: 'transcript', text: "No, I'm not suicidal." }] as Source[]);
  assert.equal(checkDraftSentence({ text: 'Client reported suicidal thoughts.', cites: ['t1'] }, map).reason, 'polarity_mismatch');
});

test('4. entailment: candidates, batching, cap, verdicts; weak in risk / MSE / meds withheld', async () => {
  const items = [
    { text: 'Client reported better sleep.', cites: ['t1'], status: 'supported' as const, support: 1, target: 'interval', heading: 'Interval' },
    { text: 'Client denies SI.', cites: ['t2'], status: 'supported' as const, support: 1, target: 'x', heading: 'Plan' },
    { text: 'Affect was flat.', cites: ['t3'], status: 'supported' as const, support: 1, target: 'mse.Affect', heading: 'Exam' },
    { text: 'Vague claim.', cites: ['t1'], status: 'weak' as const, support: 0.1, target: 'interval', heading: 'Interval' },
  ];
  const c = entailmentCandidates(items, { crossLanguage: false });
  assert.deepEqual(c.map((x) => x.text).sort(), ['Affect was flat.', 'Client denies SI.', 'Vague claim.'].sort());
  assert.equal(entailmentCandidates(items, { crossLanguage: true }).length, 4, 'Spanish / translated: every transcript-cited sentence');
  const sources = sourceMap([
    { id: 't1', kind: 'transcript', text: 'Dormí mejor.' },
    { id: 't2', kind: 'transcript', text: 'No.' },
    { id: 't3', kind: 'transcript', text: 'x' },
  ] as Source[]);
  const { userPrompt, ids } = buildEntailmentPrompt(c, sources);
  assert.match(userPrompt, /SOURCES:\n {2}t2: No\.\nCLAIM: Client denies SI\./);
  const parsed = parseEntailmentReply('{"results":[{"id":"e1","verdict":"no"},{"id":"e2","verdict":"partly"},{"id":"e9","verdict":"yes"}]}', ids);
  assert.equal(parsed.size, 2);
  let calls = 0;
  const many = Array.from({ length: 100 }, (_, i) => ({ key: `k${i}`, text: `c${i}`, cites: ['t1'] }));
  const run = await runEntailment(many, sources, async () => {
    calls++;
    return '{"results":[]}';
  });
  assert.equal(calls, ENTAIL_MAX_CALLS, 'capped');
  assert.equal(run.calls, ENTAIL_MAX_CALLS);
  assert.equal((await runEntailment(many, sources, null)).calls, 0, 'not configured: deterministic rules stand');
  const base = { text: 'x', cites: ['t1'], status: 'supported' as const, support: 1 };
  assert.equal(applyVerdict(base, 'no', false).reason, 'not_entailed');
  assert.equal(applyVerdict(base, 'partly', false).status, 'weak');
  assert.equal(applyVerdict(base, 'partly', true).reason, 'weak_sensitive');
  assert.equal(applyVerdict({ ...base, status: 'weak' }, 'yes', true).status, 'supported');
  assert.equal(applyVerdict({ ...base, status: 'weak' }, undefined, true).reason, 'weak_sensitive', 'deterministic fallback');
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.match(route, /model: 'HAIKU'[^\n]*guard: 'clinical'/);
  assert.ok(route.indexOf("step: 'entailment'") < route.indexOf('runEntailment('), 'audited before PHI goes to Haiku');
});

// ─── 5. Minimum necessary ───────────────────────────────────────────────────

test('5. prompt rules and review flags; "Move to psychotherapy notes" uses the existing store', () => {
  const p = buildDraftSystemPrompt(formatSpec('SOAP'), DEFAULT_PREFERENCES);
  assert.match(p, /no verbatim trauma or sexual detail/i);
  assert.match(p, /by relationship/);
  assert.match(p, /No psychotherapy-note material/);
  const long = minimumNecessaryCheck('Client said "I just do not know what to do anymore because everything at home keeps falling apart around me every day".');
  assert.deepEqual(long.kinds, ['long_quote']);
  assert.deepEqual(minimumNecessaryCheck('Client argued with her sister Maria about money.').kinds, ['third_party_name']);
  assert.deepEqual(minimumNecessaryCheck('Client described being raped in 2019.').kinds, ['sensitive_detail']);
  assert.deepEqual(properNames('Client Jane Doe met with the clinician on Monday.', ['Jane Doe']), []);
  assert.equal(removeSentence('[AI DRAFT]\nOne thing. Two things here. Three.', 'Two things here'), '[AI DRAFT]\nOne thing. Three.');
  assert.match(appendPsychotherapyNote('Earlier', ['Moved text.'], '10/24/2026'), /^Earlier\n\n10\/24\/2026 \(moved from the AI Scribe draft\):\n- Moved text\.$/);
  const review = read('components/scribe/DraftReview.tsx');
  assert.match(review, /Move to psychotherapy notes/);
  assert.match(review, /\/api\/notes\/\$\{encodeURIComponent\(id\)\}\/psychotherapy-notes/);
});

// ─── 6. Time / billing ──────────────────────────────────────────────────────

test('6. capture clock minus pauses; psychotherapy minutes drive the add-on; crisis codes; 90785 restricted', () => {
  const clock = sessionClockFromCapture({ startedAt: '2026-10-20T14:00:00Z', stoppedAt: '2026-10-20T14:55:00Z', pausedSeconds: 300 }, 'America/New_York');
  assert.deepEqual(clock, { date: '2026-10-20', startTime: '10:00', endTime: '10:55', minutes: 50, pausedMinutes: 5 });
  const stoppedWhilePaused = sessionClockFromCapture({ startedAt: '2026-10-20T14:00:00Z', stoppedAt: '2026-10-20T15:10:00Z', pausedAt: '2026-10-20T14:45:00Z' }, 'America/New_York');
  assert.equal(stoppedWhilePaused?.endTime, '10:45');
  const now = new Date('2026-10-20T14:30:00Z');
  assert.deepEqual(pauseUpdate('resume', { pausedAt: new Date('2026-10-20T14:20:00Z'), pausedSeconds: 60 }, now), { pausedAt: null, pausedSeconds: 660 });
  const em = (m: number | null) => suggestCptForSession({ format: 'PSYCH_MED_MGMT', minutes: 40, isPrescriberVisit: true, emCode: '99214', psychotherapyMinutes: m });
  assert.deepEqual([em(20).addOn, em(40).addOn, em(53).addOn, em(10).addOn, em(null).addOn], ['90833', '90836', '90838', null, null]);
  assert.equal(suggestCptForSession({ format: 'PSYCH_MED_MGMT', minutes: 40 }).code, null, 'E/M level never guessed');
  const crisis = (m: number) => suggestCptForSession({ format: 'CRISIS', minutes: m });
  assert.equal(crisis(25).code, null);
  assert.deepEqual([crisis(45).code, crisis(45).addOn], ['90839', null]);
  assert.deepEqual([crisis(80).addOn, crisis(80).addOnUnits], ['90840', 1]);
  assert.equal(crisisAddOnUnits(110), 2);
  assert.equal(interactiveComplexityEvidence([{ id: 't1', role: 'CLINICIAN', text: 'Should we get an interpreter next time?' }]).length, 0, 'clinician lines are not evidence');
  assert.equal(interactiveComplexityEvidence([{ id: 't2', role: 'INTERPRETER', text: 'She says she slept badly.' }]).length, 1, 'interpreter speaker confirmed');
  const f = (cpt: string, minutes: number) => ({ note: { cptCode: cpt, body: '', durationMinutes: minutes }, claims: [] }) as unknown as NoteQualityFacts;
  assert.equal(crisisAddOnChecks(f('90839 90840', 60), '90839', 60)[0].status, 'fail', '+90840 under 75 min');
  assert.equal(crisisAddOnChecks(f('90840', 90), '90840', 90)[0].status, 'fail', '+90840 without 90839');
  assert.equal(crisisAddOnChecks(f('90839 90840', 90), '90839', 90)[0].status, 'pass');
  assert.equal(crisisAddOnChecks(f('90839', 100), '90839', 100)[0].status, 'warn', 'missed unit');
  assert.deepEqual(crisisAddOnChecks(f('90839', 50), '90839', 50), []);
  const noteRoute = read('app/api/scribe/captures/[id]/note/route.ts');
  assert.match(noteRoute, /sessionTimeLines\(clock\)/);
  assert.match(noteRoute, /psychotherapyMinutes: body\.psychotherapyMinutes/);
  assert.match(read('app/api/scribe/captures/[id]/control/route.ts'), /pauseUpdate\('pause'/);
});

// ─── 7. Stigmatizing language ───────────────────────────────────────────────

test('7. stigma lexicon: rewrite in review, warn before signing, rule in the prompt', () => {
  assert.equal(rewriteStigma('Client refused medication and is noncompliant.'), 'Client declined medication and is not following the plan.');
  assert.equal(rewriteStigma('UDS was clean. Dirty urine last month.'), 'UDS was negative. Positive urine last month.');
  assert.equal(rewriteStigma('He suffers from depression.'), 'He has depression.');
  assert.equal(rewriteStigma('Groups for addicts and alcoholics.'), 'Groups for people with a substance use disorder and people with alcohol use disorder.');
  assert.equal(rewriteStigma('A drug abuser.'), 'A person who uses drugs.');
  assert.ok(lintStigma('Possibly malingering; drug-seeking.').every((f) => f.suggestion === null), 'flag only');
  assert.equal(rewriteStigma('Possibly malingering.'), 'Possibly malingering.', 'flag-only terms are not rewritten');
  const lc = languageChecks({ note: { body: 'Client was non-compliant with meds.' } } as unknown as NoteQualityFacts);
  assert.equal(lc[0].status, 'warn');
  assert.match(buildDraftSystemPrompt(formatSpec('DAP'), DEFAULT_PREFERENCES), /person-first, non-judgmental language/);
  const { sources } = buildSources([line('t1', 'CLIENT', 'I refused to take the pills.')], noChart);
  const g = groundDraft(raw({ narrative: { Data: [{ text: 'Client refused to take the pills.', cites: ['t1'] }] } }), { format: 'DAP', sources, chart: noChart });
  assert.equal(g.stigma[0]?.rewrite, 'Client declined to take the pills.');
});

// ─── 8. Attribution and speakers ────────────────────────────────────────────

test('8. attribution prompt; OTHER split by the consent list; inferred labels must be confirmed', () => {
  const p = buildDraftSystemPrompt(formatSpec('THERAPY_PROGRESS'), DEFAULT_PREFERENCES);
  assert.match(p, /"Client reports …"/);
  assert.match(p, /"Per \[mother \/ guardian \/ interpreter\] …"/);
  assert.match(p, /Interpreter lines are the client's statements as interpreted/);
  assert.equal(participantRole([{ role: 'CLIENT' }, { role: 'INTERPRETER' }]), 'INTERPRETER');
  assert.equal(participantRole([{ role: 'CLIENT' }, { role: 'GUARDIAN' }, { role: 'FAMILY' }]), null, 'ambiguous: stays OTHER');
  const segs = [
    { speakerLabel: 'spk_0', startMs: 0, endMs: 1, text: 'How are you? What happened?' },
    { speakerLabel: 'spk_1', startMs: 1, endMs: 2, text: 'I had a long hard week at work and could not sleep at all.' },
    { speakerLabel: 'spk_2', startMs: 2, endMs: 3, text: 'She says yes.' },
  ];
  assert.equal(defaultSpeakerMap(segs, { mode: 'in_person', participants: [{ role: 'CLIENT' }, { role: 'INTERPRETER' }] }).spk_2, 'INTERPRETER');
  assert.equal(defaultSpeakerMap(segs, { mode: 'in_person' }).spk_2, 'OTHER');
  assert.equal(speakerLabelsInferred(['spk_0', 'spk_1']), true);
  assert.equal(speakerLabelsInferred(['attendee:a', 'attendee:b']), false, 'telehealth attendees are exact');
  assert.equal(speakerLabelsInferred(['attendee:a', 'attendee:b', 'attendee:c']), true, 'a third speaker');
  assert.equal(speakerLabelsInferred(['dictation']), false);
  assert.match(transcriptForModel([{ ...line('t1', 'CLIENT', 'x'), role: 'INTERPRETER' }]), /Interpreter \(client, as interpreted\): x/);
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.match(route, /SPEAKERS_UNCONFIRMED/);
  assert.ok(route.indexOf('SPEAKERS_UNCONFIRMED') < route.indexOf('invokeBedrock('), 'refused before anything goes to the model');
  assert.match(read('components/scribe/ScribeDock.tsx'), /Speaker labels are a guess — confirm/);
  assert.match(read('app/dashboard/scribe/page.tsx'), /Speaker labels are a guess — confirm/);
});

// ─── 9. Audit evidence + cloned sections ────────────────────────────────────

test('9. edit ratio and AI provenance at signing; section clone warning > 0.8', () => {
  assert.equal(editRatio('[AI DRAFT — review]\nClient reported poor sleep.', 'Client reported poor sleep.'), 0);
  assert.equal(editRatio('a b c d', 'a b x d'), 0.25);
  assert.equal(editRatio('something', ''), 1);
  const prov = buildAiProvenance({
    captureId: 'cap1',
    draft: { id: 'd1', modelId: 'claude', format: 'SOAP', content: { promptVersion: 'v1', texts: { Subjective: '[AI DRAFT]\nPoor sleep this week.' }, counts: { sentences: 3, withheld: 1, weak: 1, flagged: 0 } } },
    signedBody: 'Subjective\nPoor sleep this week and stress.\n\nPlan\nWeekly.',
    noteType: 'SOAP',
    riskGate: { findings: 0, satisfiedBy: null },
    signedAt: new Date('2026-10-24T12:00:00Z'),
  });
  assert.equal(prov.promptVersion, 'v1');
  assert.equal(prov.sections[0].heading, 'Subjective');
  assert.ok(prov.sections[0].editRatio > 0 && prov.sections[0].editRatio < 1);
  assert.deepEqual(prov.counts, { sentences: 3, withheld: 1, weak: 1, flagged: 0 });
  const text = 'Client reported ongoing conflict with her supervisor at work and difficulty sleeping most nights, practiced breathing and grounding in session.';
  assert.ok(shingledJaccard(text, text) === 1);
  const warn = sectionCloneWarnings({ noteType: 'SOAP', body: `Subjective\n${text}\n\nPlan\nWeekly.`, prior: [{ date: '2026-10-17', noteType: 'SOAP', body: `Subjective\n${text}\n\nPlan\nWeekly.` }] });
  assert.deepEqual(warn.map((w) => [w.heading, w.priorDate]), [['Subjective', '2026-10-17']]);
  const cc = cloneChecks({ note: { noteType: 'SOAP', body: `Subjective\n${text}` }, priorSignedNotes: [{ date: '2026-10-17', noteType: 'SOAP', body: `Subjective\n${text}` }] } as unknown as NoteQualityFacts);
  assert.match(cc[0].detail, /very similar to the note on 2026-10-17/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /aiProvenance\s+Json\?/);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261024_scribe_safety_hardening.sql'), 'utf8');
  for (const col of ['paused_at', 'paused_seconds', 'risk_findings', 'risk_attestation', 'speakers_confirmed_at', 'aiProvenance']) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
});

// ─── 10. Medical necessity, MDM, required elements ──────────────────────────

test('10. functional impact + continued care grounded and placed; MDM checklist for prescribers (no level)', () => {
  const lines = [
    line('t1', 'CLINICIAN', 'How is the anxiety affecting work?'),
    line('t2', 'CLIENT', 'I missed three days of work because of panic attacks.'),
    line('t3', 'CLIENT', 'Panic attacks are still daily.'),
  ];
  const chart = { ...noChart, goals: [{ id: 'g1', text: 'Reduce panic attacks', objectives: [] }] };
  const { sources } = buildSources(lines, chart);
  const g = groundDraft(
    raw({
      functionalImpact: [
        { domain: 'work', text: 'Client missed three days of work because of panic attacks.', cites: ['t2'] },
        { domain: 'home', text: 'Client cannot do chores.', cites: ['t1'] },
      ],
      continuedCare: { text: 'Continued care is needed: panic attacks are still daily and the panic goal is not met.', cites: ['t3', 'c1'] },
    }),
    { format: 'THERAPY_PROGRESS', sources, chart }
  );
  assert.match(g.body, /Functional impact \(work\): Client missed three days of work/);
  assert.doesNotMatch(g.body, /chores/, 'clinician line only: withheld');
  assert.match(g.body, /Continued care: /);
  const noGoal = groundDraft(raw({ continuedCare: { text: 'Continued care is needed for daily panic attacks.', cites: ['t3'] } }), { format: 'THERAPY_PROGRESS', sources, chart });
  assert.doesNotMatch(noGoal.body, /Continued care/, 'needs the plan goal it relates to');
  const pm = groundDraft(raw({ mdm: { problems: [{ text: 'Panic disorder, worsening.', status: 'worsening', cites: ['t3'] }], data: [], rx: [] } }), { format: 'PSYCH_MED_MGMT', sources, chart });
  assert.equal(pm.mdm?.problems[0].problemStatus, 'worsening');
  assert.match(pm.mdm?.note ?? '', /nothing here picks it/);
  assert.match(buildDraftSystemPrompt(formatSpec('PSYCH_MED_MGMT'), DEFAULT_PREFERENCES), /Do not choose an E\/M level/);
  assert.equal(groundDraft(raw({ mdm: { problems: [], data: [], rx: [] } }), { format: 'SOAP', sources, chart }).mdm, null, 'therapy formats: no MDM');
});

test('10. section formats: missing required elements block signing', () => {
  const complete = 'Behavior\nClient reported panic at work.\n\nIntervention\nPracticed paced breathing.\n\nResponse\nEngaged; anxiety decreased.\n\nPlan\nWeekly. Denies SI / HI.';
  assert.deepEqual(formatElementIssues('BIRP', complete), []);
  const missing = formatElementIssues('BIRP', 'Behavior\nClient was anxious.\n\nPlan\nWeekly.');
  assert.deepEqual(missing.map((i) => i.id), ['format.sections', 'format.risk_screen', 'format.functional']);
  assert.match(missing[0].message, /Intervention, Response/);
  assert.deepEqual(formatElementIssues('SOAP', 'Subjective\nAnxious.\n\nAssessment\nAnxious.\n\nPlan\nWeekly. Denies SI/HI.').map((i) => i.id), ['format.functional']);
  const blocking = noteTypeIssues({ noteType: 'DAP', body: 'Data\nAnxious.' });
  assert.ok(blocking.some((i) => i.id === 'format.sections' && i.severity === 'block'));
  assert.deepEqual(formatElementIssues('Therapy Progress', 'x'), [], 'therapist templates use their own required fields');
});

// ─── Smaller items ──────────────────────────────────────────────────────────

test('(a) verbal scores: grounded in the cited line, one-click save as verbal_in_session', () => {
  const { sources } = buildSources([line('t1', 'CLINICIAN', 'Your PHQ-9 today is 14.'), line('t2', 'CLIENT', 'Okay.')], noChart);
  const g = groundDraft(raw({ scores: [{ instrument: 'PHQ-9', score: 14, cites: ['t1'] }, { instrument: 'GAD-7', score: 9, cites: ['t2'] }] }), { format: 'THERAPY_PROGRESS', sources, chart: noChart });
  assert.deepEqual(g.scores.map((s) => [s.instrument, s.score]), [['PHQ-9', 14]]);
  assert.equal(verbalSeverity(verbalInstrument('phq9')!, 14), 'Moderate');
  const route = read('app/api/scribe/captures/[id]/scores/route.ts');
  assert.match(route, /source: VERBAL_SOURCE/);
  assert.match(route, /confirmed: z\.literal\(true\)/);
  assert.match(route, /That score is not in the reviewed draft/);
});

test('(b) "Right client?" before Create draft note; (e) missing consent refused when required', () => {
  const review = read('components/scribe/DraftReview.tsx');
  assert.match(review, /Right client\?/);
  assert.match(review, /clientConfirmed: true/);
  assert.match(read('app/api/scribe/captures/[id]/note/route.ts'), /clientConfirmed: z\.literal\(true\)/);
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.match(route, /consent === 'missing' && consentRequired/);
  assert.ok(route.indexOf("reason: 'ai_consent_missing'") < route.indexOf('invokeBedrock('));
});

test('(c) truncated replies: one retry by section groups; (d) low transcript quality warning', () => {
  assert.equal(looksTruncated('{"narrative":{"Data":[{"text":"x"'), true);
  assert.equal(looksTruncated('{"a":{}}'), false);
  const groups = draftTargetGroups(formatSpec('SOAP'));
  assert.deepEqual(groups, [['Subjective', 'Objective'], ['Assessment', 'Plan']]);
  const onlyPrompt = buildDraftSystemPrompt(formatSpec('SOAP'), DEFAULT_PREFERENCES, { only: groups[1] });
  assert.match(onlyPrompt, /Sections \(use the heading as the narrative key\): Assessment, Plan\./);
  const a = parseDraftReply('{"narrative":{"Subjective":[{"text":"A.","cites":["t1"]}]},"summary":[]}')!;
  const b = parseDraftReply('{"narrative":{"Plan":[{"text":"B.","cites":["t1"]}]},"homework":[{"text":"H.","cites":["t1"]}]}')!;
  const m = mergeRawDrafts([a, b])!;
  assert.deepEqual(Object.keys(m.narrative).sort(), ['Plan', 'Subjective']);
  assert.equal(m.homework.length, 1);
  assert.match(read('app/api/scribe/captures/[id]/draft/route.ts'), /step: 'section_group_retry'/);
  assert.match(transcriptQualityWarning({ sentences: 10, withheld: 2, weak: 2, transcriptWords: 2000, minutes: 50 }) ?? '', /^Low transcript quality — review carefully/);
  assert.match(transcriptQualityWarning({ sentences: 10, withheld: 0, weak: 0, transcriptWords: 150, minutes: 45 }) ?? '', /150 words for 45 minutes/);
  assert.equal(transcriptQualityWarning({ sentences: 10, withheld: 1, weak: 1, transcriptWords: 3000, minutes: 45 }), null);
});

test('(f) Spanish / interpreted sessions run the entailment check for cross-language citations', () => {
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.match(route, /const crossLanguage = language !== 'en-US' \|\| participants\.some\(\(p\) => p\.role === 'INTERPRETER'\)/);
  assert.match(route, /entailmentCandidates\(grounded\.preliminary, \{ crossLanguage/);
});

test('add-on: the dock opens an existing capture in place; telehealth review goes to the visit note', () => {
  const dock = read('components/scribe/ScribeDock.tsx');
  assert.match(dock, /captureId\?: string \| null/);
  assert.match(dock, /Draft the note/);
  assert.match(read('app/dashboard/ehr/notes/page.tsx'), /captureId=\{scribeCaptureId\}/);
  const panel = read('components/scribe/TelehealthScribePanel.tsx');
  assert.doesNotMatch(panel, /\/dashboard\/scribe\?capture=/);
  assert.doesNotMatch(panel, /target="_blank"/);
  assert.match(panel, /\/dashboard\/ehr\/notes\?/);
  assert.match(panel, /scribe: '1', capture: captureId/);
});

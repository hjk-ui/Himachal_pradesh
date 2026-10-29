/**
 * AI Scribe field feedback (psychiatric NP practice session, 2026-10-25): recording that stopped
 * unseen, MSE domains "Not assessed" although stated, history sections not populated, measures to
 * complete not in the note, and a "No medication changes" checkbox. Pure logic + source checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TranscriptLine } from '../src/lib/scribe/diarization';
import {
  buildDraftSystemPrompt,
  buildSources,
  CLINICIAN_ATTESTED_FLAG,
  draftGroupsFor,
  draftTargets,
  groundDraft,
  parseDraftReply,
  splitGroup,
  type ChartFacts,
  type RawDraft,
} from '../src/lib/scribe/draft';
import { checkDraftSentence, sourceMap } from '../src/lib/scribe/grounding';
import { checkOptionValue, isClinicianAttestation, sentencePolarity } from '../src/lib/scribe/polarity';
import { formatSpec, mseDomainsForKey, NEVER_AI_HEADINGS, renderMse, resolveTargetKey } from '../src/lib/scribe/templateFields';
import { entailKey } from '../src/lib/scribe/entailment';
import { applySuggestion, suggestionsFromWithheld } from '../src/lib/scribe/suggestions';
import { measureAssignments, measurePlanFromTranscript, measurePlanSentence, normalizeSpokenInstruments } from '../src/lib/scribe/spokenMeasures';
import { DEFAULT_PREFERENCES } from '../src/lib/scribe/settings';
import { AI_DRAFT_MARKER } from '../src/lib/ai/noteDraftFormats';
import { NO_MED_CHANGES_TEXT, applyNoMedChanges, hasNoMedChanges, medChangesDocumented, medChangesSectionText, stripNoMedChanges } from '../src/lib/ehr/noMedChanges';
import {
  INITIAL_MONITOR,
  MAX_RECONNECT_ATTEMPTS,
  NO_AUDIO_MS,
  alertFor,
  backoffMs,
  formatGap,
  interleaveGaps,
  monitorBanner,
  reduceMonitor,
  sanitizeGaps,
  type MonitorEvent,
  type MonitorState,
} from '../src/lib/scribe/recordingMonitor';

const SRC = path.join(__dirname, '..', 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n');
const line = (id: string, role: TranscriptLine['role'], text: string, at = 0): TranscriptLine => ({ id, seq: Number(id.slice(1)), role, speakerLabel: role === 'CLINICIAN' ? 'spk_0' : 'spk_1', startMs: at, endMs: at + 1000, text });
const noChart: ChartFacts = { goals: [], diagnoses: [], lastPlan: null, scores: [] };
const raw = (over: Partial<RawDraft>): RawDraft => ({ narrative: {}, options: {}, mse: {}, interventions: [], planLinks: [], homework: [], nextAppointment: null, followUps: [], conditions: [], summary: [], ...over });

// ─── 2. MSE: clinician observations ─────────────────────────────────────────

test('MSE: domains the clinician stated populate (aliased keys too); a question alone does not', () => {
  const lines = [
    line('t1', 'CLINICIAN', 'Mental status: insight fair, judgment fair.'),
    line('t2', 'CLINICIAN', 'Thought content without delusions, no obsessions.'),
    line('t3', 'CLINICIAN', 'Do you hear voices or see things other people do not see?'),
    line('t4', 'CLIENT', 'No.'),
    line('t5', 'CLINICIAN', 'Any thoughts that people are out to get you?'),
  ];
  const { sources } = buildSources(lines, noChart);
  // The model wrote "Thought Content", "Perceptions", "Insight/Judgment": an exact match dropped them before
  const parsed = parseDraftReply(
    JSON.stringify({
      mse: {
        'Thought Content': { text: 'Thought content without delusions or obsessions.', cites: ['t2'], basis: 'observed' },
        Perceptions: { text: 'Denies auditory or visual hallucinations.', cites: ['t3', 't4'], basis: 'stated' },
        'Insight/Judgment': { text: 'Insight fair, judgment fair.', cites: ['t1'], basis: 'observed' },
        Behavior: { text: 'Denies paranoia.', cites: ['t5'], basis: 'stated' },
      },
    })
  )!;
  assert.deepEqual(Object.keys(parsed.mse).sort(), ['Behavior', 'Insight', 'Judgment', 'Perception', 'Thought content']);
  assert.deepEqual(mseDomainsForKey('Orientation'), ['Cognition']);
  const perception = entailKey({ text: 'Denies auditory or visual hallucinations.', cites: ['t3', 't4'] });
  const g = groundDraft(parsed, { format: 'PSYCH_MED_MGMT', sources, chart: noChart, verdicts: new Map([[perception, 'yes']]) });
  const exam = g.texts.Exam;
  assert.match(exam, /Insight: Insight fair, judgment fair\. \(observed\)/);
  assert.match(exam, /Judgment: Insight fair/);
  assert.match(exam, /Thought content: Thought content without delusions/);
  assert.match(exam, /Perception: Denies auditory or visual hallucinations/, 'the client\'s "No." answers the question');
  // Only the clinician's question: not a finding (withheld, offered as a suggestion; never "Not assessed")
  assert.doesNotMatch(exam, /Behavior: Denies paranoia/);
  assert.match(exam, /^Behavior:$/m);
  assert.match(exam, /Speech: Not assessed/, 'nothing drafted for speech');
  // Polarity: a question cited with its "no" answer asserts nothing; a question alone still does
  assert.equal(sentencePolarity('Denies suicidal thoughts.', ['Any thoughts of suicide?', 'No.']).status, 'ok');
  assert.equal(sentencePolarity('Denies suicidal thoughts.', ['Any thoughts of suicide?']).status, 'mismatch');
  // Shorthand: "no AH/VH" supports the spelled-out sentence
  const s = checkDraftSentence({ text: 'Denies auditory and visual hallucinations.', cites: ['t1'] }, sourceMap([{ id: 't1', kind: 'transcript', text: 'No AH/VH.' }]));
  assert.equal(s.status, 'supported');
  // The prompt makes the clinician's own lines the primary MSE source
  assert.match(buildDraftSystemPrompt(formatSpec('PSYCH_MED_MGMT'), DEFAULT_PREFERENCES), /mental status exam is the CLINICIAN's observation/);
});

test('risk: a clinician\'s stated finding sets the chip (marked attested); a clinician question never does', () => {
  const lines = [
    { id: 't1', role: 'CLINICIAN', text: 'Any thoughts of hurting yourself or anyone else?' },
    { id: 't2', role: 'CLINICIAN', text: 'Patient denies SI, HI.' },
    { id: 't3', role: 'CLINICIAN', text: 'She endorses passive SI without plan or intent.' },
    { id: 't4', role: 'CLINICIAN', text: "I'm going to ask about suicide now." },
  ];
  const opt = (fieldId: string, value: string, cites: string[]) => checkOptionValue({ fieldId, label: fieldId, kind: 'tri', value, cites, lines, risk: true });
  const si = opt('si', 'Denies', ['t2']);
  assert.equal(si.ok, true);
  assert.equal(si.attested, true);
  assert.equal(opt('hi', 'Denies', ['t2']).ok, true, '"HI" shorthand');
  assert.equal(opt('si', 'Denies', ['t1']).ok, false, 'a question');
  assert.equal(opt('si', 'Denies', ['t4']).ok, false, 'announcing a question');
  assert.equal(opt('si', 'Endorses', ['t3']).ok, true);
  assert.equal(opt('si', 'Endorses', ['t2']).ok, false, 'polarity still checked');
  assert.equal(isClinicianAttestation('Any thoughts of suicide?'), false);
  // In the template: placed with the attested flag
  const tl = [line('t1', 'CLINICIAN', 'Any thoughts of hurting someone?'), line('t2', 'CLINICIAN', 'Patient denies SI.')];
  const { sources } = buildSources(tl, noChart);
  const g = groundDraft(raw({ options: { si: { value: 'Denies', cites: ['t2'] }, hi: { value: 'Denies', cites: ['t1'] } } }), { format: 'THERAPY_PROGRESS', sources, chart: noChart });
  assert.match(g.body, /Suicidal ideation: Denies/);
  assert.ok(g.provenance.find((p) => p.target === 'si')?.flags?.includes(CLINICIAN_ATTESTED_FLAG));
  assert.equal(g.withheld.find((w) => w.target === 'hi')?.reason, 'option_role');
  // The signing gate is unchanged (risk findings still need C-SSRS / risk level / attestation)
  assert.match(read('lib/notes/workflow-store.ts'), /transcriptRiskGate\(/);
});

test('withheld AI items come back as one-click suggestions in their section, not a silent "Not assessed"', () => {
  const lines = [line('t1', 'CLINICIAN', 'How is your insight into all this, do you think?'), line('t2', 'CLIENT', 'I guess I see it more now.')];
  const { sources } = buildSources(lines, noChart);
  const g = groundDraft(raw({ mse: { Insight: { text: 'Insight improving, recognizes need for treatment.', cites: ['t1', 't2'], basis: 'observed' } }, options: { si: { value: 'Denies', cites: ['t1'] } } }), {
    format: 'PSYCH_MED_MGMT',
    sources,
    chart: noChart,
    verdicts: new Map([[entailKey({ text: 'Insight improving, recognizes need for treatment.', cites: ['t1', 't2'] }), 'partly']]),
  });
  assert.match(g.texts.Exam, /^Insight:$/m, 'blank, not "Not assessed"');
  const sug = suggestionsFromWithheld(g.withheld);
  const insight = sug.find((x) => x.domain === 'Insight');
  assert.ok(insight, 'MSE suggestion offered');
  assert.equal(insight!.heading, 'Exam');
  assert.equal(sug.some((x) => x.heading === 'Risk Check' || x.insert.startsWith('Suicidal')), false, 'risk chips are never offered');
  const applied = applySuggestion(g.texts.Exam, insight!);
  assert.match(applied, /^Insight: Insight improving, recognizes need for treatment\.$/m);
  assert.equal(applied.split('\n').length, g.texts.Exam.split('\n').length, 'replaces the line in place');
  assert.match(renderMse({}, []), /Insight: Not assessed/);
  assert.match(read('components/scribe/ScribeDock.tsx'), /<DraftSuggestions content=\{lastDraft\}/);
  assert.match(read('components/scribe/DraftReview.tsx'), /<DraftSuggestions/);
});

// ─── 3. History sections ────────────────────────────────────────────────────

test('history sections: heading variants map onto the intake template; intakes are drafted by section groups', () => {
  const lines = [
    line('t1', 'CLIENT', 'I was hospitalized at Sheppard Pratt for a week after an overdose.'),
    line('t2', 'CLIENT', 'My mom has bipolar and my uncle drank a lot.'),
    line('t3', 'CLIENT', 'I got a DUI from drinking and lost my job because of it.'),
    line('t4', 'CLIENT', 'I take xanax bars I buy on the street since I was nineteen.'),
  ];
  const { sources } = buildSources(lines, noChart);
  const g = groundDraft(
    raw({
      narrative: {
        'Inpatient History': [{ text: 'Client reports a one-week hospitalization at Sheppard Pratt after an overdose.', cites: ['t1'] }],
        'Family History': [{ text: 'Client reports her mother has bipolar disorder and an uncle drank heavily.', cites: ['t2'] }],
        'Substance use consequences': [{ text: 'Client reports a DUI from drinking and job loss.', cites: ['t3'] }],
        'Substance Use History': [{ text: 'Client reports using Xanax bars bought on the street since age 19.', cites: ['t4'] }],
      },
    }),
    { format: 'ADULT_PSYCH_INTAKE', sources, chart: noChart }
  );
  assert.match(g.texts['Inpatient Hx'], /Sheppard Pratt/);
  assert.match(g.texts['Family Hx'], /bipolar/);
  assert.match(g.texts['Substance Use Consequences'], /DUI/);
  assert.match(g.texts['Substance Use Hx'], /Xanax/, 'a drug named in substance history is not a medication sentence');
  assert.equal(resolveTargetKey('Substance Treatment History', ['Substance Treatment Hx']), 'Substance Treatment Hx');
  // Section groups: every target drafted, the rest of the reply only in the first group
  const spec = formatSpec('ADULT_PSYCH_INTAKE');
  const groups = draftGroupsFor(spec);
  assert.ok(groups.length >= 3);
  assert.deepEqual(groups.flatMap((x) => x.only ?? []), draftTargets(spec));
  assert.deepEqual(groups.map((x) => x.extras), groups.map((_, i) => i === 0));
  assert.ok(groups.every((x) => (x.only?.length ?? 0) <= 8));
  const later = buildDraftSystemPrompt(spec, DEFAULT_PREFERENCES, { only: groups[1].only!, extras: false });
  assert.match(later, /This call drafts ONLY the sections listed above/);
  assert.doesNotMatch(later, /mental status exam is the CLINICIAN/);
  const first = buildDraftSystemPrompt(spec, DEFAULT_PREFERENCES, { only: groups[0].only!, extras: true });
  assert.match(first, /Inpatient Hx: psychiatric hospitalizations/);
  assert.match(first, /write everything discussed for each one, completely/);
  assert.equal(splitGroup(groups[1]).length, 2);
  assert.deepEqual(draftGroupsFor(formatSpec('SOAP')), [{ only: null, extras: true }], 'short formats: one call');
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.match(route, /draftGroupsFor\(spec\)/);
  assert.match(route, /splitGroup\(g\)/);
});

// ─── 4. Measures to complete ────────────────────────────────────────────────

test('measures: spoken names map to the catalog, plan sentence is grounded, assignment needs a click', () => {
  assert.match(normalizeSpokenInstruments('the GAD seven and PHQ nine'), /GAD-7.*PHQ-9/);
  const tl = [
    line('t1', 'CLINICIAN', 'Before next session I want you to complete the GAD seven, PHQ nine, DASS 42 and the DSM five cross cutting.'),
    line('t2', 'CLIENT', 'I did the PHQ 9 last time at my doctor.'),
    line('t3', 'CLINICIAN', 'We will also do an MMPI at some point and the DASS.'),
  ];
  const plan = measurePlanFromTranscript(tl);
  const by = Object.fromEntries(plan.map((m) => [m.name, m]));
  assert.equal(by['GAD-7'].instrumentId, 'gad-7');
  assert.equal(by['GAD-7'].status, 'sendable');
  assert.equal(by['PHQ-9'].status, 'sendable');
  assert.deepEqual(by['PHQ-9'].cites, ['t1'], 'the client mentioning a measure is not a plan');
  assert.equal(by['DASS-42'].status, 'in_session', 'in the catalog, not sendable (licensed copy)');
  assert.equal(by['DSM-5 Level 1 Cross-Cutting Symptom Measure'].instrumentId, 'dsm5-cc');
  assert.equal(by.MMPI.status, 'not_available');
  assert.match(by.MMPI.note ?? '', /Not available in Altrixs/);
  assert.equal(by['DASS (version not stated)'].status, 'ambiguous');
  assert.equal(measurePlanSentence(plan.filter((m) => m.cites.includes('t1'))), 'Measures to complete before next session: GAD-7, PHQ-9, DASS-42, DSM-5 Level 1 Cross-Cutting Symptom Measure.');
  // Grounding accepts "GAD-7" against "GAD seven" (was withheld as an ungrounded instrument)
  const c = checkDraftSentence({ text: 'Client to complete the GAD-7 and PHQ-9 before next session.', cites: ['t1'] }, sourceMap([{ id: 't1', kind: 'transcript', text: tl[0].text }]));
  assert.notEqual(c.status, 'withheld');
  const { sources } = buildSources(tl.slice(0, 2), noChart);
  const g = groundDraft(raw({}), { format: 'THERAPY_PROGRESS', sources, chart: noChart });
  assert.match(g.body, /Measures to complete before next session: GAD-7, PHQ-9, DASS-42, DSM-5 Level 1 Cross-Cutting Symptom Measure\./);
  assert.equal(g.measurePlan.length, 4);
  // One click assigns sendable catalog measures only, due on the next visit; nothing is assigned from speech
  const a = measureAssignments(g.measurePlan, { clientId: 'c1', nextAppointmentDate: '2026-11-03' });
  assert.deepEqual(a.map((x) => x.instrumentId), ['gad-7', 'phq-9']);
  assert.ok(a.every((x) => x.schedule === 'once' && x.startDate === '2026-11-03'));
  const route = read('app/api/scribe/captures/[id]/draft/route.ts');
  assert.doesNotMatch(route, /createAssignment|measure-assignments/);
  const ui = read('components/scribe/DraftSuggestions.tsx');
  assert.match(ui, /onClick=\{\(\) => void assign\(\)\}/);
  assert.match(ui, /Assign these measures/);
});

// ─── 5. No medication changes ───────────────────────────────────────────────

test('"No medication changes": clinician checkbox writes the standard line; the AI cannot set it', () => {
  assert.equal(medChangesSectionText({ noMedChanges: true, generated: 'Medication plan:\n- Continue sertraline', comment: 'old text' }), NO_MED_CHANGES_TEXT);
  assert.equal(medChangesSectionText({ noMedChanges: false, generated: '', comment: 'Discussed risks.' }), 'Discussed risks.');
  assert.equal(hasNoMedChanges(NO_MED_CHANGES_TEXT), true);
  assert.equal(stripNoMedChanges(`${NO_MED_CHANGES_TEXT}\n\nPatient prefers to wait.`), 'Patient prefers to wait.');
  assert.equal(medChangesDocumented(NO_MED_CHANGES_TEXT), true, 'satisfies the required-section check');
  const rows = applyNoMedChanges([
    { medId: 'm1', action: 'Increase', newDose: '100 mg', sig: 'daily', reason: 'x' },
    { medId: null, action: 'Start', newDose: '5 mg', sig: '', reason: '' },
  ]);
  assert.deepEqual(rows, [{ medId: 'm1', action: '', newDose: '', sig: '', reason: '' }]);
  // AI: Plan - Med Changes stays clinician-only; a model sentence there is a suggestion, never the checkbox
  assert.ok(NEVER_AI_HEADINGS.has('Plan - Med Changes'));
  const { sources } = buildSources([line('t1', 'CLINICIAN', 'No medication changes today, continue everything.')], noChart);
  const g = groundDraft(raw({ narrative: { 'Plan - Med Changes': [{ text: NO_MED_CHANGES_TEXT, cites: ['t1'] }] } }), { format: 'PSYCH_MED_MGMT', sources, chart: noChart });
  assert.equal(g.texts['Plan - Med Changes'], '');
  assert.equal(hasNoMedChanges(g.texts['Plan - Med Changes']), false);
  assert.equal(hasNoMedChanges(`${AI_DRAFT_MARKER}\n${NO_MED_CHANGES_TEXT}`), false, 'AI-marked text never restores the box');
  const editor = read('components/notes/StructuredNoteEditor.tsx');
  assert.match(editor, /checked=\{noMedChanges\} onChange=\{\(e\) => toggleNoMedChanges\(e\.target\.checked\)\}/);
  assert.match(editor, /\[PMM\.medChanges\]: noMedChanges \? NO_MED_CHANGES_TEXT/);
});

// ─── 1. Recording reliability ───────────────────────────────────────────────

test('recording monitor: unexpected stop → reconnect with backoff → gap recorded; give up; no audio', () => {
  const run = (events: MonitorEvent[], from: MonitorState = INITIAL_MONITOR) => events.reduce(reduceMonitor, from);
  let s = run([{ type: 'start', at: 0 }]);
  assert.equal(s.status, 'live');
  s = run([{ type: 'interrupt', reason: 'network_offline', at: 602_000 }], s);
  assert.equal(s.status, 'reconnecting');
  assert.match(monitorBanner(s)!.text, /Recording interrupted: The network connection was lost\. Reconnecting/);
  s = run([{ type: 'retry_failed', at: 603_000 }, { type: 'reconnected', at: 605_000, replayedMs: 0 }], s);
  assert.equal(s.status, 'live');
  assert.deepEqual(s.gaps, [{ startMs: 602_000, endMs: 605_000, reason: 'network_offline' }]);
  assert.equal(formatGap(s.gaps[0]), 'Recording gap 10:02–10:05 (the network connection was lost)');
  // Replayed audio covers the drop: no gap
  const covered = run([{ type: 'interrupt', reason: 'socket_closed', at: 10_000 }, { type: 'reconnected', at: 14_000, replayedMs: 4_000 }], s);
  assert.equal(covered.gaps.length, 1);
  // Backoff and giving up
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(backoffMs), [1000, 2000, 4000, 8000, 15000, 15000]);
  let r = run([{ type: 'interrupt', reason: 'mic_ended', at: 1_000 }], run([{ type: 'start', at: 0 }]));
  for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) r = reduceMonitor(r, { type: 'retry_failed', at: 2_000 + i });
  assert.equal(r.status, 'interrupted');
  assert.match(monitorBanner(r)!.text, /Recording stopped: The microphone stopped\. Press Resume/);
  // Permission revoked: no auto-retry
  const p = run([{ type: 'start', at: 0 }, { type: 'interrupt', reason: 'permission_revoked', at: 5_000 }]);
  assert.equal(p.status, 'interrupted');
  // Pause is not an interruption
  assert.equal(run([{ type: 'start', at: 0 }, { type: 'pause', at: 1_000 }, { type: 'interrupt', reason: 'socket_closed', at: 2_000 }]).status, 'paused');
  // No audio for a minute
  let a = run([{ type: 'start', at: 0 }, { type: 'audio', level: 0.3, at: 1_000 }, { type: 'tick', at: 1_000 + NO_AUDIO_MS - 1 }]);
  assert.equal(a.noAudio, false);
  a = run([{ type: 'audio', level: 0.001, at: 1_000 + NO_AUDIO_MS }, { type: 'tick', at: 1_000 + NO_AUDIO_MS }], a);
  assert.equal(a.noAudio, true);
  assert.match(monitorBanner(a)!.text, /No audio detected/);
  assert.equal(run([{ type: 'audio', level: 0.2, at: 70_000 }, { type: 'tick', at: 70_000 }], a).noAudio, false);
  // Alerts: sound on interruption, notification only when the tab is hidden
  const live = run([{ type: 'start', at: 0 }]);
  const drop = reduceMonitor(live, { type: 'interrupt', reason: 'socket_closed', at: 1 });
  assert.deepEqual(alertFor(live, drop, false), { sound: true, notify: false });
  assert.deepEqual(alertFor(live, drop, true), { sound: true, notify: true });
  assert.deepEqual(alertFor(drop, drop, true), { sound: false, notify: false });
  // Gaps in the transcript, in time order; stored gaps are sanitized
  const rows = interleaveGaps([{ startMs: 600_000 }, { startMs: 610_000 }], [{ startMs: 602_000, endMs: 605_000, reason: 'socket_closed' }]);
  assert.deepEqual(rows.map((x) => x.kind), ['line', 'gap', 'line']);
  assert.deepEqual(sanitizeGaps([{ startMs: 1, endMs: 2, reason: 'socket_closed' }, { startMs: 5, endMs: 1, reason: 'socket_closed' }, { startMs: 1, endMs: 2, reason: 'x' }, 'bad']), [{ startMs: 1, endMs: 2, reason: 'socket_closed' }]);
  // Wiring: fixed status bar in the dock, reconnect on the same capture, gaps stored on the capture
  assert.match(read('components/scribe/ScribeDock.tsx'), /<RecordingStatusBar/);
  assert.match(read('components/scribe/RecordingStatusBar.tsx'), /fixed inset-x-0 top-0/);
  const hook = read('components/scribe/useTranscribeStream.ts');
  assert.match(hook, /controlCapture\(captureId, 'reconnect'/);
  assert.match(hook, /t\.onended = \(\) => interruptRef\.current\?\.\('mic_ended'\)/);
  const control = read('app/api/scribe/captures/[id]/control/route.ts');
  assert.match(control, /body\.action === 'reconnect'/);
  assert.match(control, /recordingGaps: JSON\.parse\(JSON\.stringify\(gaps\)\)/);
});

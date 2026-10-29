import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { captureGate, validateRecordingConsent, type CaptureGateInput, type RecordingConsentInput } from '../src/lib/scribe/consent';
import { presignTranscribeMedicalUrl, transcribeStreamParams } from '../src/lib/scribe/transcribeUrl';
import { crc32, decodeEventMessage, encodeAudioEvent, encodeEventMessage, parseTranscribeMessage } from '../src/lib/scribe/eventStream';
import { downsample, floatToPcm16 } from '../src/lib/scribe/audio';
import {
  defaultSpeakerMap,
  resolveSpeakerMap,
  segmentsFromChimeResult,
  segmentsFromTranscribeResult,
  transcriptLines,
  type StoredSegment,
} from '../src/lib/scribe/diarization';
import { checkDraftSentence, sourceMap, type Source } from '../src/lib/scribe/grounding';
import { aiFieldCatalog, applyDraft, formatSpec, NOT_ASSESSED, type GroundedDraft } from '../src/lib/scribe/templateFields';
import { restoreValues } from '../src/lib/ehr/therapy/engine';
import { THERAPY_TEMPLATES } from '../src/lib/ehr/therapy/templates';
import { THERAPY_PROGRESS, TS } from '../src/lib/ehr/therapy/sections';
import { AI_DRAFT_MARKER } from '../src/lib/ai/noteDraftFormats';
import { interactiveComplexityEvidence, suggestCptForSession, suggestPos } from '../src/lib/scribe/coding';
import { scanTranscriptRisk } from '../src/lib/scribe/risk';
import { composeSummary, fleschKincaidGrade } from '../src/lib/scribe/clientSummary';
import { isDue, purgeAfter, runRetention, DAY_MS, type RetentionCapture, type RetentionDeps } from '../src/lib/scribe/retention';
import { buildSources, groundDraft, parseDraftReply, planGoalLines } from '../src/lib/scribe/draft';
import { liveCues } from '../src/lib/scribe/cues';
import { normalizeScribeSettings, scribeSettingsPatchSchema } from '../src/lib/scribe/settings';

const SRC = path.join(__dirname, '..', 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

const goodConsent: RecordingConsentInput = {
  method: 'verbal',
  participants: [
    { role: 'CLIENT', consented: true },
    { role: 'GUARDIAN', label: 'Mother', consented: true },
  ],
  allPartiesConfirmed: true,
  scriptRead: true,
};
const gateInput = (o: Partial<CaptureGateInput> = {}): CaptureGateInput => ({
  mode: 'in_person',
  scribeEnabled: true,
  entitled: true,
  aiConsent: 'signed',
  practiceRequiresAiConsent: true,
  recordingConsent: goodConsent,
  transcriptionConfigured: true,
  ...o,
});

// ─── 1. Consent gate ────────────────────────────────────────────────────────

test('consent gate: capture is blocked until every participant agreed (Maryland all-party)', () => {
  assert.equal(captureGate(gateInput()).ok, true);
  const missing = captureGate(gateInput({ recordingConsent: null }));
  assert.equal(missing.ok, false);
  assert.equal((missing as { code: string }).code, 'recording_consent_missing');
  const oneDeclined = captureGate(gateInput({ recordingConsent: { ...goodConsent, participants: [{ role: 'CLIENT', consented: true }, { role: 'FAMILY', consented: false }] } }));
  assert.equal((oneDeclined as { code: string }).code, 'participant_declined');
  assert.equal((captureGate(gateInput({ recordingConsent: { ...goodConsent, allPartiesConfirmed: false } })) as { code: string }).code, 'all_parties_unconfirmed');
  assert.equal((captureGate(gateInput({ recordingConsent: { ...goodConsent, scriptRead: false } })) as { code: string }).code, 'script_not_read');
  assert.equal((captureGate(gateInput({ recordingConsent: { ...goodConsent, participants: [{ role: 'FAMILY', consented: true }] } })) as { code: string }).code, 'client_not_listed');
  // Dictation: only the clinician's attestation
  assert.equal(validateRecordingConsent('dictation', { ...goodConsent, participants: [], clinicianOnly: false }).ok, false);
  assert.equal(validateRecordingConsent('dictation', { ...goodConsent, participants: [], clinicianOnly: true }).ok, true);
  // Not configured: honest refusal, nothing captured
  assert.equal((captureGate(gateInput({ transcriptionConfigured: false })) as { code: string }).code, 'transcription_not_configured');
  assert.equal((captureGate(gateInput({ scribeEnabled: false })) as { code: string }).code, 'scribe_disabled');
});

test('recording consent cannot be turned off by a setting', () => {
  assert.equal(normalizeScribeSettings({}).requireRecordingConsent, true);
  assert.equal(scribeSettingsPatchSchema.safeParse({ requireRecordingConsent: false }).success, false);
  const routes = read('app/api/scribe/captures/route.ts');
  assert.match(routes, /captureGate\(/);
  assert.match(routes, /SCRIBE_CONSENT_ATTESTED/);
});

// ─── 2. AI consent declined ─────────────────────────────────────────────────

test('AI consent declined blocks capture and drafting; missing blocks when the practice requires it', () => {
  const declined = captureGate(gateInput({ aiConsent: 'declined' }));
  assert.equal((declined as { code: string }).code, 'ai_consent_declined');
  assert.equal((captureGate(gateInput({ aiConsent: 'missing' })) as { code: string }).code, 'ai_consent_missing');
  assert.equal(captureGate(gateInput({ aiConsent: 'missing', practiceRequiresAiConsent: false })).ok, true);
  // Declined is re-checked at stream start and before every draft
  assert.match(read('app/api/scribe/captures/[id]/control/route.ts'), /ai_consent_declined/);
  assert.match(read('app/api/scribe/captures/[id]/draft/route.ts'), /=== 'declined'[\s\S]{0,200}CONSENT_DECLINED/);
});

// ─── 3. No browser speech recognition on PHI paths ──────────────────────────

test('no Web Speech API (webkitSpeechRecognition / SpeechRecognition) anywhere in src', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && /\b(webkit)?SpeechRecognition\b/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(SRC, p));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
  // The PHI capture paths use the AWS streaming hook
  assert.match(read('components/notes/useDictation.ts'), /useTranscribeStream/);
  assert.match(read('app/dashboard/scribe/page.tsx'), /useTranscribeStream/);
  assert.match(read('components/scribe/useTranscribeStream.ts'), /encodeAudioEvent/);
});

// ─── 4. Presigned URL ───────────────────────────────────────────────────────

test('presigned Transcribe Medical URL: SigV4 query signing, short expiry, fixed parameters', () => {
  const creds = { region: 'us-east-1', accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret/key+example', sessionToken: 'tok/en+=' };
  const now = new Date('2026-10-19T15:04:05.000Z');
  const url = presignTranscribeMedicalUrl({ creds, kind: 'conversation', now });
  const u = new URL(url);
  assert.equal(u.protocol, 'wss:');
  assert.equal(u.host, 'transcribestreaming.us-east-1.amazonaws.com:8443');
  assert.equal(u.pathname, '/medical-stream-transcription-websocket');
  const q = u.searchParams;
  assert.equal(q.get('specialty'), 'PRIMARYCARE');
  assert.equal(q.get('type'), 'CONVERSATION');
  assert.equal(q.get('show-speaker-label'), 'true');
  assert.equal(q.get('media-encoding'), 'pcm');
  assert.equal(q.get('sample-rate'), '16000');
  assert.equal(q.get('X-Amz-Expires'), '60');
  assert.equal(q.get('X-Amz-Date'), '20261019T150405Z');
  assert.equal(q.get('X-Amz-Credential'), 'ASIAEXAMPLE/20261019/us-east-1/transcribe/aws4_request');
  assert.equal(q.get('X-Amz-Security-Token'), 'tok/en+=');
  assert.match(q.get('X-Amz-Signature') || '', /^[0-9a-f]{64}$/);
  assert.ok(!url.includes('secret'), 'secret key never in the URL');
  // Deterministic; any change of parameters changes the signature
  assert.equal(presignTranscribeMedicalUrl({ creds, kind: 'conversation', now }), url);
  const dict = new URL(presignTranscribeMedicalUrl({ creds, kind: 'dictation', now }));
  assert.equal(dict.searchParams.get('type'), 'DICTATION');
  assert.notEqual(dict.searchParams.get('X-Amz-Signature'), q.get('X-Amz-Signature'));
  assert.equal(transcribeStreamParams('dictation')['show-speaker-label'], undefined);
  // Expiry is capped at 300 s
  assert.equal(new URL(presignTranscribeMedicalUrl({ creds, kind: 'conversation', now, expiresSeconds: 9999 })).searchParams.get('X-Amz-Expires'), '300');
});

test('event-stream codec round-trips audio frames and parses transcript events', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const pcm = floatToPcm16(downsample(new Float32Array(4800).fill(0.25), 48000, 16000));
  assert.equal(pcm.length, 3200);
  const frame = encodeAudioEvent(pcm);
  const dec = decodeEventMessage(frame);
  assert.equal(dec.headers[':event-type'], 'AudioEvent');
  assert.equal(dec.payload.length, pcm.length);
  const body = new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: 'Hi.' }] }] } }));
  const msg = parseTranscribeMessage(encodeEventMessage({ ':message-type': 'event', ':event-type': 'TranscriptEvent', ':content-type': 'application/json' }, body));
  assert.equal(msg?.type, 'transcript');
  const bad = new Uint8Array(frame);
  bad[bad.length - 1] ^= 0xff;
  assert.throws(() => decodeEventMessage(bad), /CRC/);
});

// ─── 5. Diarization ─────────────────────────────────────────────────────────

test('diarization: Transcribe speaker labels, Chime attendees, question heuristic and clinician overrides', () => {
  const segs = segmentsFromTranscribeResult(
    {
      IsPartial: false,
      StartTime: 1,
      Alternatives: [
        {
          Items: [
            { Type: 'pronunciation', Content: 'How', Speaker: '1', StartTime: 1, EndTime: 1.2 },
            { Type: 'pronunciation', Content: 'are', Speaker: '1', StartTime: 1.2, EndTime: 1.4 },
            { Type: 'pronunciation', Content: 'you', Speaker: '1', StartTime: 1.4, EndTime: 1.6 },
            { Type: 'punctuation', Content: '?' },
            { Type: 'pronunciation', Content: 'Tired', Speaker: '0', StartTime: 2, EndTime: 2.5 },
            { Type: 'punctuation', Content: '.' },
          ],
        },
      ],
    },
    60_000,
    'conversation'
  );
  assert.deepEqual(segs.map((s) => [s.speakerLabel, s.text, s.startMs]), [
    ['spk_1', 'How are you?', 61_000],
    ['spk_0', 'Tired.', 62_000],
  ]);
  assert.equal(segmentsFromTranscribeResult({ IsPartial: true, Alternatives: [{ Transcript: 'x' }] }, 0, 'conversation').length, 0);
  // spk_1 asks the questions → Clinician even though spk_0 spoke first
  const map = defaultSpeakerMap(segs, { mode: 'in_person' });
  assert.deepEqual(map, { spk_1: 'CLINICIAN', spk_0: 'CLIENT' });
  const fixed = resolveSpeakerMap(map, { spk_1: 'CLIENT', spk_0: 'CLINICIAN', junk: 'BOSS' });
  assert.deepEqual(fixed, { spk_1: 'CLIENT', spk_0: 'CLINICIAN' });
  const stored: StoredSegment[] = segs.map((s, i) => ({ ...s, seq: i }));
  assert.deepEqual(transcriptLines(stored, fixed).map((l) => [l.id, l.role]), [
    ['t1', 'CLIENT'],
    ['t2', 'CLINICIAN'],
  ]);
  // Telehealth: exact attendee mapping
  const chime = segmentsFromChimeResult(
    {
      isPartial: false,
      startTimeMs: 10_500,
      endTimeMs: 12_000,
      alternatives: [{ items: [{ content: 'Hello', startTimeMs: 10_500, endTimeMs: 11_000, attendee: { attendeeId: 'pat' } }, { content: 'Hi', startTimeMs: 11_100, endTimeMs: 11_500, attendee: { attendeeId: 'doc' } }] }],
    },
    10_000
  );
  assert.deepEqual(defaultSpeakerMap(chime, { mode: 'telehealth', clinicianAttendeeId: 'doc', patientAttendeeId: 'pat' }), { 'attendee:pat': 'CLIENT', 'attendee:doc': 'CLINICIAN' });
  assert.deepEqual(defaultSpeakerMap(chime, { mode: 'telehealth', clinicianAttendeeId: 'doc' }), { 'attendee:pat': 'CLIENT', 'attendee:doc': 'CLINICIAN' });
  assert.equal(chime[0].startMs, 500);
  assert.deepEqual(defaultSpeakerMap([{ speakerLabel: 'dictation', startMs: 0, endMs: 1, text: 'x' }], { mode: 'dictation' }), { dictation: 'CLINICIAN' });
});

// ─── 6. Template field mapping ──────────────────────────────────────────────

test('template mapping fills the Therapy Progress fields, drops invalid options, never fills clinician-only fields, and round-trips into the editor', () => {
  const ids = aiFieldCatalog(THERAPY_PROGRESS).map((f) => f.id);
  for (const never of ['riskLevel', 'patientLocation', 'telehealthConsent', 'overrideReason']) assert.ok(!ids.includes(never), never);
  for (const want of ['interval', 'modalitiesUsed', 'responseText', 'homework', 'nextSession', 'si']) assert.ok(ids.includes(want), want);
  const s = (text: string) => ({ text, cites: ['t1'], status: 'supported' as const, support: 1 });
  const draft: GroundedDraft = {
    narrative: {
      interval: [s('The client reported sleeping four hours a night'), { ...s('Invented fact'), status: 'withheld' as const, support: 0 }],
      responseText: [s('The client completed the thought record in session.')],
      homework: [s('Complete two thought records before next session.')],
    },
    options: {
      modalitiesUsed: { value: ['CBT', 'Psychoeducation', 'Astrology'], cites: ['t2'] },
      nextSession: { value: '1 week', cites: ['t9'] },
      riskLevel: { value: 'Low', cites: ['t3'] },
      engagement: { value: 'Engaged', cites: [] },
    },
    mse: { Mood: { sentence: s('Client described mood as "down"'), basis: 'stated' } },
  };
  const spec = formatSpec('THERAPY_PROGRESS');
  const texts = applyDraft(spec, draft);
  assert.match(texts[TS.interventions], /^\[AI DRAFT/);
  assert.match(texts[TS.interventions], /Interventions used: CBT, Psychoeducation$/m);
  assert.ok(!texts[TS.interventions].includes('Astrology'));
  assert.match(texts[TS.interval], /The client reported sleeping four hours a night\./);
  assert.ok(!texts[TS.interval].includes('Invented fact'));
  assert.ok(!texts[TS.riskCheck].includes('Overall risk level'), 'risk level is never AI-filled');
  assert.ok(!texts[TS.response].includes('Engagement'), 'an option without citations is dropped');
  assert.match(texts[TS.mse], /Mood: Client described mood as "down" \(stated\)/);
  assert.match(texts[TS.mse], new RegExp(`Affect: ${NOT_ASSESSED}`));
  assert.match(texts[TS.planNext], /Next session: 1 week/);
  // The structured editor restores chips from the saved text
  const { values } = restoreValues(THERAPY_TEMPLATES[THERAPY_PROGRESS].sections, texts);
  assert.deepEqual(values.modalitiesUsed, ['CBT', 'Psychoeducation']);
  assert.equal(values.nextSession, '1 week');
  assert.equal(values.homework, 'Complete two thought records before next session.');
  // Section formats: grounded sentences per heading
  const soap = applyDraft(formatSpec('PIRP'), { narrative: { Problem: [s('Low mood.')], Plan: [] }, options: {}, mse: {} });
  assert.equal(soap.Problem, `${AI_DRAFT_MARKER}\nLow mood.`);
  assert.equal(soap.Plan, '');
});

// ─── 7. Grounding ───────────────────────────────────────────────────────────

test('grounding withholds unsupported sentences and flags weak support', () => {
  const sources: Source[] = [
    { id: 't1', kind: 'transcript', text: 'I have only been sleeping about three hours since my sertraline dose went up.' },
    { id: 't2', kind: 'transcript', text: 'We practiced box breathing together.' },
    { id: 'c1', kind: 'chart', text: 'Score: PHQ-9 14 on 2026-10-01' },
  ];
  const map = sourceMap(sources);
  const ok = checkDraftSentence({ text: 'The client reported sleeping about 3 hours since the sertraline dose increase.', cites: ['t1'] }, map);
  assert.equal(ok.status, 'supported');
  const reason = (text: string, cites: string[]) => checkDraftSentence({ text, cites }, map).reason;
  assert.equal(reason('The client reported poor sleep.', []), 'no_citation');
  assert.equal(reason('The client reported poor sleep.', ['t9']), 'unknown_citation');
  assert.equal(reason('The client sleeps 5 hours.', ['t1']), 'ungrounded_number');
  assert.equal(reason('The client takes lorazepam.', ['t1']), 'ungrounded_medication');
  assert.equal(reason('PHQ-9 was 14 on 2026-10-02.', ['c1']), 'ungrounded_date');
  assert.equal(reason('GAD-7 was 14.', ['c1']), 'ungrounded_instrument');
  assert.equal(reason('Diagnosed with F33.1.', ['c1']), 'ungrounded_code');
  assert.equal(reason('Mental status within normal limits.', ['t2']), 'assumed_normal');
  assert.equal(reason('PHQ-9 was 14 on 2026-10-01.', ['c1']), undefined);
  const weak = checkDraftSentence({ text: 'Client expressed profound existential despair regarding employment prospects.', cites: ['t2'] }, map);
  assert.equal(weak.status, 'weak');
});

test('groundDraft: plan links need transcript evidence, risk screens need the client\'s words, nothing invented reaches the note', () => {
  const lines = [
    { id: 't1', seq: 0, role: 'CLINICIAN' as const, speakerLabel: 'spk_0', startMs: 0, endMs: 1000, text: 'Any thoughts of hurting yourself this week?' },
    { id: 't2', seq: 1, role: 'CLIENT' as const, speakerLabel: 'spk_1', startMs: 1000, endMs: 2000, text: 'No, none at all. I used the breathing when I got anxious at work.' },
    { id: 't3', seq: 2, role: 'CLINICIAN' as const, speakerLabel: 'spk_0', startMs: 2000, endMs: 3000, text: 'Let us keep practicing the breathing daily and meet next week.' },
  ];
  const chart = { goals: [{ id: 'g1', text: 'Reduce anxiety at work using coping skills', objectives: [] }], diagnoses: [], lastPlan: null, scores: [] };
  const { sources } = buildSources(lines, chart);
  const raw = parseDraftReply(
    JSON.stringify({
      narrative: { interval: [{ text: 'The client used breathing when anxious at work.', cites: ['t2'] }, { text: 'The client was hospitalized in 2019.', cites: ['t2'] }] },
      options: { si: { value: 'Denies', cites: ['t1'] }, selfHarm: { value: 'Denies', cites: ['t2'] }, nextSession: { value: '1 week', cites: ['t3'] } },
      interventions: [{ modality: 'Mindfulness / relaxation', text: 'Reviewed breathing practice', cites: ['t3'] }],
      planLinks: [{ goal: 'c1', status: 'Progress made', level: 'Moderate', evidence: [{ text: 'Client used breathing when anxious at work.', cites: ['t2'] }] }, { goal: 'c9', status: 'Progress made', evidence: [] }],
      followUps: [{ kind: 'next_visit', text: 'Schedule next week', cites: ['t3'] }],
      summary: [{ text: 'You used breathing at work.', cites: ['t2'] }],
    })
  )!;
  const g = groundDraft(raw, { format: 'THERAPY_PROGRESS', sources, chart });
  assert.ok(!g.body.includes('2019'));
  assert.ok(g.withheld.some((w) => w.reason === 'ungrounded_number'));
  // si cited only the clinician's question → dropped; selfHarm cited the client → kept
  assert.ok(!/Suicidal ideation: Denies/.test(g.body));
  assert.match(g.body, /Current self-harm: Denies/);
  assert.match(g.body, /Interventions used: Mindfulness \/ relaxation/);
  assert.equal(g.planLinks.length, 1);
  assert.equal(g.planLinks[0].goalId, 'g1');
  assert.equal(planGoalLines(g.planLinks), 'Goal 1: Reduce anxiety at work using coping skills — Progress made (Moderate)');
  assert.equal(g.followUps.length, 1);
});

// ─── 8. CPT from duration ───────────────────────────────────────────────────

test('CPT from duration, 90785 only with evidence, POS from the session', () => {
  const cpt = (m: number | null) => suggestCptForSession({ format: 'THERAPY_PROGRESS', minutes: m }).code;
  assert.equal(cpt(10), null);
  assert.equal(cpt(16), '90832');
  assert.equal(cpt(37), '90832');
  assert.equal(cpt(38), '90834');
  assert.equal(cpt(52), '90834');
  assert.equal(cpt(53), '90837');
  assert.equal(suggestCptForSession({ format: 'THERAPY_INTAKE', minutes: 20 }).code, '90791');
  assert.equal(suggestCptForSession({ format: 'SOAP', minutes: 45, sessionType: 'family-with-patient' }).code, '90847');
  // The add-on comes from the clinician's psychotherapy minutes (separate from the E/M), not the visit length
  const em = suggestCptForSession({ format: 'SOAP', minutes: 30, isPrescriberVisit: true, emCode: '99214', psychotherapyMinutes: 20 });
  assert.deepEqual([em.code, em.addOn], ['99214', '90833']);
  assert.equal(suggestCptForSession({ format: 'SOAP', minutes: 30, isPrescriberVisit: true, emCode: '99214' }).addOn, null);
  assert.equal(suggestCptForSession({ format: 'SOAP', minutes: 30, isPrescriberVisit: true }).code, null);
  assert.equal(interactiveComplexityEvidence([{ id: 't1', text: 'We talked about your week.' }]).length, 0);
  assert.equal(interactiveComplexityEvidence([{ id: 't4', text: 'The interpreter will translate for your grandmother.' }]).length, 1);
  assert.equal(interactiveComplexityEvidence([], { interpreterPresent: true }).length, 1);
  assert.equal(suggestPos({ mode: 'in_person', posOffice: '11' }).pos, '11');
  assert.equal(suggestPos({ mode: 'telehealth', patientLocationType: 'home' }).pos, '10');
  assert.equal(suggestPos({ mode: 'telehealth', patientLocationType: null }).pos, null);
  assert.equal(suggestPos({ mode: 'telehealth', patientLocationType: 'other', telehealthModifierDefault: 'GT' }).modifier, 'GT');
});

// ─── 9. Risk ────────────────────────────────────────────────────────────────

test('risk language from the client triggers the C-SSRS prompt with a timestamp; the clinician\'s screening question does not', () => {
  const q = scanTranscriptRisk([{ id: 't1', role: 'CLINICIAN', startMs: 5000, text: 'Have you had any thoughts of killing yourself?' }]);
  assert.equal(q.findings.length, 0);
  assert.equal(q.prompts.length, 0);
  const r = scanTranscriptRisk([
    { id: 't1', role: 'CLINICIAN', startMs: 5000, text: 'How has your week been?' },
    { id: 't2', role: 'CLIENT', startMs: 65_000, text: 'Honestly I keep thinking about killing myself.' },
  ]);
  assert.ok(r.findings.length >= 1);
  assert.equal(r.findings[0].lineId, 't2');
  assert.equal(r.findings[0].at, '01:05');
  assert.ok(r.prompts.some((p) => p.kind === 'cssrs'));
  assert.ok(r.prompts.some((p) => p.kind === 'safety_plan'));
  assert.match(r.reminder988 || '', /988/);
  const cues = liveCues(
    [{ id: 't2', seq: 0, role: 'CLIENT', speakerLabel: 'spk_1', startMs: 65_000, endMs: 66_000, text: 'Honestly I keep thinking about killing myself.' }],
    { measuresDue: [{ instrument: 'PHQ-9', detail: 'none on file' }], goals: [], lastHomework: null }
  );
  assert.ok(cues.some((c) => c.kind === 'risk' && /C-SSRS/.test(c.text)));
  assert.ok(cues.some((c) => c.text.startsWith('PHQ-9 due')));
});

// ─── 10. Client summary and Part 2 ──────────────────────────────────────────

test('client summary excludes Part 2 (SUD) content without consent', () => {
  const s = (text: string, cites: string[] = ['t1']) => ({ text, cites, status: 'supported' as const, support: 1 });
  const lineText = new Map([
    ['t1', 'We worked on sleep.'],
    ['t2', 'I had a couple of drinks on Saturday.'],
  ]);
  const input = {
    sentences: [s('You worked on getting better sleep.'), s('You talked about Saturday.', ['t2']), s('You had a few beers.', ['t1'])],
    homework: [s('Keep a sleep diary.')],
    lineText,
    part2Session: true,
    part2ConsentAllowsPortal: false,
  };
  const out = composeSummary(input);
  assert.equal(out.removedForPart2, 2);
  assert.ok(!/beer|Saturday/.test(out.text));
  assert.match(out.text, /sleep diary/);
  assert.match(out.text, /988/);
  const allowed = composeSummary({ ...input, part2ConsentAllowsPortal: true });
  assert.equal(allowed.removedForPart2, 0);
  assert.match(allowed.text, /beers/);
  const g = fleschKincaidGrade('You worked on sleep. You will keep a diary this week.');
  assert.ok(g !== null && g < 8);
});

// ─── 11. Retention ──────────────────────────────────────────────────────────

test('retention deletes transcripts N days after the note is signed, and waits for unsigned notes', async () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const signed = new Date(now.getTime() - 31 * DAY_MS);
  const base: RetentionCapture = { id: 'a', organizationId: 'o1', progressNoteId: 'n1', noteSignedAt: null, stoppedAt: new Date(now.getTime() - 90 * DAY_MS), updatedAt: now, transcriptPurgeAfter: null, transcriptPurgedAt: null };
  assert.equal(isDue(base, 30, now), false, 'unsigned note: keep');
  assert.equal(isDue({ ...base, noteSignedAt: signed }, 30, now), true);
  assert.equal(isDue({ ...base, noteSignedAt: signed }, 45, now), false);
  assert.equal(purgeAfter({ ...base, noteSignedAt: signed }, 30).getTime(), signed.getTime() + 30 * DAY_MS);
  assert.equal(isDue({ ...base, progressNoteId: null, stoppedAt: new Date(now.getTime() - 31 * DAY_MS) }, 30, now), true, 'never became a note');

  const purged: string[] = [];
  const marked: string[] = [];
  const audits: { captureId: string; segments: number }[] = [];
  const deps: RetentionDeps = {
    candidates: async () => [
      { ...base, id: 'signed-old' },
      { ...base, id: 'signed-recent', progressNoteId: 'n2' },
      { ...base, id: 'unsigned', progressNoteId: 'n3' },
      { ...base, id: 'done', transcriptPurgedAt: now },
    ],
    retentionDays: async () => 30,
    noteSignedAt: async (id) => (id === 'n1' ? signed : id === 'n2' ? new Date(now.getTime() - 5 * DAY_MS) : null),
    markSigned: async (id) => void marked.push(id),
    purge: async (id) => {
      purged.push(id);
      return { segments: 12 };
    },
    audit: async (e) => void audits.push({ captureId: e.captureId, segments: e.segments }),
  };
  const res = await runRetention(deps, now);
  assert.deepEqual(purged, ['signed-old']);
  assert.deepEqual(marked.sort(), ['signed-old', 'signed-recent']);
  assert.deepEqual(res, { checked: 4, purged: 1, segments: 12 });
  assert.deepEqual(audits, [{ captureId: 'signed-old', segments: 12 }]);
  assert.match(read('app/api/cron/notifications/route.ts'), /runScribeRetention/);
});

test('every scribe API route audits and the PHI paths stay on AWS', () => {
  const dir = path.join(SRC, 'app', 'api', 'scribe');
  const routes: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts') routes.push(p);
    }
  };
  walk(dir);
  assert.ok(routes.length >= 10);
  for (const r of routes) assert.match(fs.readFileSync(r, 'utf8'), /auditPhiAccess|writeAuditLog/, path.relative(SRC, r));
  const control = read('app/api/scribe/captures/[id]/control/route.ts');
  for (const a of ['SCRIBE_CAPTURE_START', 'SCRIBE_CAPTURE_STOP', 'SCRIBE_CAPTURE_PAUSE', 'SCRIBE_CONSENT_WITHDRAWN']) assert.ok(control.includes(a), a);
  assert.match(read('app/api/scribe/captures/[id]/summary/route.ts'), /SCRIBE_SUMMARY_SHARE/);
  assert.match(read('app/api/scribe/captures/[id]/citations/route.ts'), /SCRIBE_CITATION_VIEW/);
  assert.match(read('lib/scribe/chimeTranscription.ts'), /EngineTranscribeMedicalSettings/);
  // The audio hook talks only to the presigned AWS URL
  const hook = read('components/scribe/useTranscribeStream.ts');
  assert.ok(!/https?:\/\/(?!.*amazonaws)/.test(hook.replace(/\/\/.*$/gm, '')));
});

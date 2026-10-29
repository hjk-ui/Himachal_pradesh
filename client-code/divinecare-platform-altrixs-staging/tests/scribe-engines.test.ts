import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  presignTranscribeMedicalUrl,
  presignTranscribeUrl,
  scribeVocabularyName,
  transcribeStreamParams,
} from '../src/lib/scribe/transcribeUrl';
import { encodeEventMessage, normalizeTranscribeResult, parseTranscribeMessage } from '../src/lib/scribe/eventStream';
import { segmentsFromTranscribeResult } from '../src/lib/scribe/diarization';
import {
  DEFAULT_SCRIBE_SETTINGS,
  TRANSCRIPTION_ENGINE_NOTES,
  captureEngineFor,
  normalizeScribeSettings,
  scribeSettingsPatchSchema,
  transcriptionEngineOfCapture,
} from '../src/lib/scribe/settings';
import { chimeTranscriptionConfiguration } from '../src/lib/scribe/chimeTranscription';
import { transcriptSourceLabel } from '../src/lib/scribe/paste';
import {
  TRIAL_SCRIBE_LIMIT_CODE,
  TRIAL_SCRIBE_LIMIT_MESSAGE,
  TRIAL_SCRIBE_LIMIT_SECONDS,
  isMeteredCaptureEngine,
  trialScribeAllowance,
} from '../src/lib/scribe/trialCap';
import { TRIAL_AI_SCRIBE_MINUTES, TRIAL_RULE } from '../src/lib/billing/plans';

const SRC = path.join(__dirname, '..', 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const creds = { region: 'us-east-1', accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret/key+example', sessionToken: 'tok/en+=' };
const now = new Date('2026-10-20T15:04:05.000Z');

// ─── Settings ───────────────────────────────────────────────────────────────

test('practice setting: transcription engine defaults to standard; medical is opt-in', () => {
  assert.equal(DEFAULT_SCRIBE_SETTINGS.transcriptionEngine, 'standard');
  assert.equal(normalizeScribeSettings(null).transcriptionEngine, 'standard');
  assert.equal(normalizeScribeSettings({}).transcriptionEngine, 'standard');
  assert.equal(normalizeScribeSettings({ transcriptionEngine: 'medical' }).transcriptionEngine, 'medical');
  assert.equal(normalizeScribeSettings({ transcriptionEngine: 'healthscribe' }).transcriptionEngine, 'standard');
  assert.equal(scribeSettingsPatchSchema.safeParse({ transcriptionEngine: 'medical' }).success, true);
  assert.equal(scribeSettingsPatchSchema.safeParse({ transcriptionEngine: 'other' }).success, false);
  assert.match(TRANSCRIPTION_ENGINE_NOTES.standard, /lower cost/i);
  assert.match(TRANSCRIPTION_ENGINE_NOTES.medical, /higher accuracy/i);
  assert.match(TRANSCRIPTION_ENGINE_NOTES.medical, /higher cost/i);
  // The settings card shows the choice and its note
  const card = read('components/scribe/ScribeSettingsCard.tsx');
  assert.match(card, /TRANSCRIPTION_ENGINE_NOTES\[e\]/);
  assert.match(card, /transcriptionEngine/);
});

test('capture engine is fixed at creation and maps back to the stream engine', () => {
  assert.equal(captureEngineFor('in_person', 'standard'), 'transcribe_streaming');
  assert.equal(captureEngineFor('dictation', 'medical'), 'transcribe_medical_streaming');
  assert.equal(captureEngineFor('telehealth', 'standard'), 'chime_transcribe');
  assert.equal(captureEngineFor('telehealth', 'medical'), 'chime_transcribe_medical');
  for (const e of ['transcribe_streaming', 'chime_transcribe'] as const) assert.equal(transcriptionEngineOfCapture(e), 'standard');
  // Captures made before the setting existed were Transcribe Medical
  for (const e of ['transcribe_medical_streaming', 'chime_transcribe_medical', null] as const) assert.equal(transcriptionEngineOfCapture(e), 'medical');
  assert.equal(transcriptSourceLabel('transcribe_streaming'), 'AWS Transcribe');
  assert.equal(transcriptSourceLabel('chime_transcribe'), 'Chime · AWS Transcribe');
  assert.equal(transcriptSourceLabel('transcribe_medical_streaming'), 'AWS Transcribe Medical');
  assert.match(read('app/api/scribe/captures/route.ts'), /captureEngineFor\(body\.mode, settings\.transcriptionEngine\)/);
  assert.match(read('app/api/scribe/captures/[id]/control/route.ts'), /transcriptionEngineOfCapture\(cap\.engine\)/);
});

// ─── Presigned URLs ─────────────────────────────────────────────────────────

test('standard engine URL: StartStreamTranscriptionWebSocket path and parameters, optional vocabulary', () => {
  const url = presignTranscribeUrl({ creds, kind: 'conversation', now, engine: 'standard', vocabularyName: 'altrixs-behavioral-health' });
  const u = new URL(url);
  assert.equal(u.protocol, 'wss:');
  assert.equal(u.host, 'transcribestreaming.us-east-1.amazonaws.com:8443');
  assert.equal(u.pathname, '/stream-transcription-websocket');
  const q = u.searchParams;
  assert.equal(q.get('language-code'), 'en-US');
  assert.equal(q.get('media-encoding'), 'pcm');
  assert.equal(q.get('sample-rate'), '16000');
  assert.equal(q.get('show-speaker-label'), 'true');
  assert.equal(q.get('vocabulary-name'), 'altrixs-behavioral-health');
  assert.equal(q.get('specialty'), null, 'no medical specialty on the standard engine');
  assert.equal(q.get('type'), null);
  assert.equal(q.get('X-Amz-Credential'), 'ASIAEXAMPLE/20261020/us-east-1/transcribe/aws4_request');
  assert.equal(q.get('X-Amz-SignedHeaders'), 'host');
  assert.match(q.get('X-Amz-Signature') || '', /^[0-9a-f]{64}$/);
  assert.ok(!url.includes('secret'));
  // Vocabulary is part of the signature; without it the parameter is absent
  const plain = new URL(presignTranscribeUrl({ creds, kind: 'conversation', now, engine: 'standard' }));
  assert.equal(plain.searchParams.get('vocabulary-name'), null);
  assert.notEqual(plain.searchParams.get('X-Amz-Signature'), q.get('X-Amz-Signature'));
  // Dictation: one speaker, no speaker labels
  const dict = new URL(presignTranscribeUrl({ creds, kind: 'dictation', now, engine: 'standard' }));
  assert.equal(dict.searchParams.get('show-speaker-label'), null);
  assert.deepEqual(transcribeStreamParams('dictation', 16000, { engine: 'standard' }), {
    'language-code': 'en-US',
    'media-encoding': 'pcm',
    'sample-rate': '16000',
  });
});

test('medical engine URL is unchanged, and the engines sign different requests', () => {
  const med = new URL(presignTranscribeUrl({ creds, kind: 'conversation', now, engine: 'medical', vocabularyName: 'ignored' }));
  assert.equal(med.pathname, '/medical-stream-transcription-websocket');
  assert.equal(med.searchParams.get('specialty'), 'PRIMARYCARE');
  assert.equal(med.searchParams.get('type'), 'CONVERSATION');
  assert.equal(med.searchParams.get('show-speaker-label'), 'true');
  assert.equal(med.searchParams.get('vocabulary-name'), null, 'a standard vocabulary is never sent to Transcribe Medical');
  assert.equal(presignTranscribeMedicalUrl({ creds, kind: 'conversation', now }), presignTranscribeUrl({ creds, kind: 'conversation', now, engine: 'medical' }));
  const std = new URL(presignTranscribeUrl({ creds, kind: 'conversation', now, engine: 'standard' }));
  assert.notEqual(std.searchParams.get('X-Amz-Signature'), med.searchParams.get('X-Amz-Signature'));
});

test('vocabulary name comes from SCRIBE_TRANSCRIBE_VOCABULARY and is validated', () => {
  assert.equal(scribeVocabularyName({ SCRIBE_TRANSCRIBE_VOCABULARY: 'altrixs-behavioral-health' }), 'altrixs-behavioral-health');
  assert.equal(scribeVocabularyName({ SCRIBE_TRANSCRIBE_VOCABULARY: '  altrixs.bh_v2 ' }), 'altrixs.bh_v2');
  assert.equal(scribeVocabularyName({}), undefined);
  assert.equal(scribeVocabularyName({ SCRIBE_TRANSCRIBE_VOCABULARY: 'bad name&x=1' }), undefined);
});

// ─── Chime live transcription ───────────────────────────────────────────────

test('Chime: EngineTranscribeSettings by default (with vocabulary), EngineTranscribeMedicalSettings when chosen', () => {
  assert.deepEqual(chimeTranscriptionConfiguration('standard', 'altrixs-behavioral-health'), {
    EngineTranscribeSettings: { LanguageCode: 'en-US', Region: 'us-east-1', VocabularyName: 'altrixs-behavioral-health' },
  });
  assert.deepEqual(chimeTranscriptionConfiguration('standard', undefined), { EngineTranscribeSettings: { LanguageCode: 'en-US', Region: 'us-east-1' } });
  assert.deepEqual(chimeTranscriptionConfiguration('medical', 'altrixs-behavioral-health'), {
    EngineTranscribeMedicalSettings: { LanguageCode: 'en-US', Specialty: 'PRIMARYCARE', Type: 'CONVERSATION', Region: 'us-east-1' },
  });
});

// ─── Event-stream parsing ───────────────────────────────────────────────────

const frame = (body: unknown) =>
  encodeEventMessage({ ':message-type': 'event', ':event-type': 'TranscriptEvent', ':content-type': 'application/json' }, new TextEncoder().encode(JSON.stringify(body)));

test('parses a standard TranscriptEvent (LanguageCode, Stable, VocabularyFilterMatch)', () => {
  const msg = parseTranscribeMessage(
    frame({
      Transcript: {
        Results: [
          {
            ResultId: 'r1',
            StartTime: 1,
            EndTime: 2.5,
            IsPartial: false,
            ChannelId: 'ch_0',
            LanguageCode: 'en-US',
            Alternatives: [
              {
                Transcript: 'Sertraline helps.',
                Items: [
                  { Type: 'pronunciation', Content: 'Sertraline', Speaker: '0', StartTime: 1, EndTime: 1.8, Confidence: 0.98, Stable: true, VocabularyFilterMatch: false },
                  { Type: 'pronunciation', Content: 'helps', Speaker: '0', StartTime: 1.8, EndTime: 2.5, Confidence: 0.99, Stable: true, VocabularyFilterMatch: false },
                  { Type: 'punctuation', Content: '.', Stable: true },
                ],
              },
            ],
          },
        ],
      },
    })
  );
  assert.equal(msg?.type, 'transcript');
  if (msg?.type !== 'transcript') return;
  const r = msg.results[0];
  assert.equal(r.IsPartial, false);
  assert.equal(r.Alternatives?.[0].Transcript, 'Sertraline helps.');
  assert.deepEqual(Object.keys(r.Alternatives![0].Items![0]).sort(), ['Content', 'EndTime', 'Speaker', 'StartTime', 'Type']);
  const segs = segmentsFromTranscribeResult(r, 0, 'conversation');
  assert.deepEqual(segs.map((s) => [s.speakerLabel, s.text, s.startMs, s.endMs]), [['spk_0', 'Sertraline helps.', 1000, 2500]]);
});

test('parses a medical TranscriptEvent (Entities, spk_ labels) to the same shape', () => {
  const msg = parseTranscribeMessage(
    frame({
      Transcript: {
        Results: [
          {
            ResultId: 'm1',
            StartTime: 3,
            EndTime: 4,
            IsPartial: false,
            ChannelId: 'ch_0',
            Alternatives: [
              {
                Transcript: 'Any side effects?',
                Entities: [{ Category: 'MEDICATION', Content: 'x', Confidence: 0.9 }],
                Items: [
                  { Type: 'pronunciation', Content: 'Any', Speaker: 'spk_1', StartTime: 3, EndTime: 3.2, Confidence: 0.9 },
                  { Type: 'pronunciation', Content: 'side', Speaker: 'spk_1', StartTime: 3.2, EndTime: 3.5, Confidence: 0.9 },
                  { Type: 'pronunciation', Content: 'effects', Speaker: 'spk_1', StartTime: 3.5, EndTime: 4, Confidence: 0.9 },
                  { Type: 'punctuation', Content: '?' },
                ],
              },
            ],
          },
        ],
      },
    })
  );
  assert.equal(msg?.type, 'transcript');
  if (msg?.type !== 'transcript') return;
  const segs = segmentsFromTranscribeResult(msg.results[0], 0, 'conversation');
  assert.deepEqual(segs.map((s) => [s.speakerLabel, s.text]), [['spk_1', 'Any side effects?']], 'speaker label is spk_1, never spk_spk_1');
  // SDK-style nesting, missing IsPartial (final) and a missing Transcript rebuilt from items
  const nested = parseTranscribeMessage(frame({ TranscriptEvent: { Transcript: { Results: [{ Alternatives: [{ Items: [{ Type: 'pronunciation', Content: 'Okay' }, { Type: 'punctuation', Content: '.' }] }] }] } } }));
  assert.equal(nested?.type, 'transcript');
  if (nested?.type === 'transcript') {
    assert.equal(nested.results[0].IsPartial, false);
    assert.equal(nested.results[0].Alternatives?.[0].Transcript, 'Okay.');
  }
  assert.deepEqual(normalizeTranscribeResult(null), { ResultId: undefined, StartTime: undefined, EndTime: undefined, IsPartial: false, ChannelId: undefined, Alternatives: [] });
});

// ─── Trial cap ──────────────────────────────────────────────────────────────

test('trial: AI Scribe live audio is capped at 300 minutes per organization', () => {
  assert.equal(TRIAL_AI_SCRIBE_MINUTES, 300);
  assert.equal(TRIAL_SCRIBE_LIMIT_SECONDS, 300 * 60);
  const trialing = { status: 'trialing', unlimited: false };
  const fresh = trialScribeAllowance(trialing, 0);
  assert.deepEqual(fresh, { limited: true, usedSeconds: 0, limitSeconds: 18000, remainingSeconds: 18000, exhausted: false });
  const nearly = trialScribeAllowance(trialing, 17_940);
  assert.equal(nearly.limited && nearly.remainingSeconds, 60);
  assert.equal(nearly.limited && nearly.exhausted, false);
  const done = trialScribeAllowance(trialing, 18_000);
  assert.equal(done.limited && done.exhausted, true);
  const over = trialScribeAllowance(trialing, 25_000);
  assert.equal(over.limited && over.exhausted, true);
  assert.equal(over.limited && over.remainingSeconds, 0);
  // Paid, comped (MD Behavioral Health) and grandfathered organizations are not capped here
  assert.deepEqual(trialScribeAllowance({ status: 'active', unlimited: false }, 99_999), { limited: false });
  assert.deepEqual(trialScribeAllowance({ status: 'comped', unlimited: true }, 99_999), { limited: false });
  assert.deepEqual(trialScribeAllowance({ status: 'trialing', unlimited: true }, 99_999), { limited: false });
  // Pasted / imported text uses no minutes
  assert.equal(isMeteredCaptureEngine('paste'), false);
  assert.equal(isMeteredCaptureEngine('import'), false);
  assert.equal(isMeteredCaptureEngine('transcribe_streaming'), true);
  assert.match(TRIAL_SCRIBE_LIMIT_MESSAGE, /300 minutes/);
  assert.match(TRIAL_SCRIBE_LIMIT_MESSAGE, /paste/i);
  assert.match(TRIAL_RULE, /300 minutes/);
});

test('trial cap is enforced in the capture and metering path', () => {
  const create = read('app/api/scribe/captures/route.ts');
  assert.match(create, /trialScribeAllowanceFor\(actor\.organizationId\)/);
  assert.match(create, /TRIAL_SCRIBE_LIMIT_CODE/);
  const control = read('app/api/scribe/captures/[id]/control/route.ts');
  assert.match(control, /trialScribeAllowanceFor\(actor\.organizationId, body\.capturedSeconds \?\? 0\)/);
  assert.match(control, /maxSeconds/);
  assert.equal(TRIAL_SCRIBE_LIMIT_CODE, 'trial_scribe_limit');
  const store = read('lib/scribe/store.ts');
  assert.match(store, /notIn: \['paste', 'import'\]/);
  // Browsers stop when the trial minutes run out mid-session
  assert.match(read('components/scribe/useTranscribeStream.ts'), /TRIAL_SCRIBE_LIMIT_MESSAGE/);
  assert.match(read('components/scribe/TelehealthScribePanel.tsx'), /TRIAL_SCRIBE_LIMIT_MESSAGE/);
});

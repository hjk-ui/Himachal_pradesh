import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AI_DRAFT_MARKER, countAiDraftMarkers } from '../src/lib/ai/noteDraftFormats';
import {
  acceptAllSections,
  acceptSection,
  aiReviewComplete,
  aiSectionsPending,
  clearMarkerIfEdited,
  fillDraftInPlace,
  stripAiMarker,
} from '../src/lib/scribe/review';
import {
  defaultQuickParticipants,
  inlineConsentState,
  quickConsentInput,
  recapConsentInput,
  startSessionHref,
} from '../src/lib/scribe/sessionStart';
import { captureGate, validateRecordingConsent } from '../src/lib/scribe/consent';
import { isDue, purgeAfter, runRetention, type RetentionCapture, type RetentionDeps } from '../src/lib/scribe/retention';
import { DEFAULT_SCRIBE_SETTINGS, normalizeScribeSettings, scribeSettingsPatchSchema } from '../src/lib/scribe/settings';
import {
  batchJobInput,
  batchTranscriptToSegments,
  checkUpload,
  transcriptSeconds,
  uploadCaptureEngine,
  uploadObjectKey,
  UPLOAD_MAX_SECONDS,
} from '../src/lib/scribe/upload';
import {
  defaultCaptureLanguage,
  draftLanguageInstruction,
  isSpanishPreference,
  streamEngineForLanguage,
  summaryLanguageFor,
  SUD_TERMS_ES,
} from '../src/lib/scribe/language';
import { transcribeStreamParams } from '../src/lib/scribe/transcribeUrl';
import { chimeTranscriptionConfiguration } from '../src/lib/scribe/chimeTranscription';
import { draftSessionLabel } from '../src/lib/scribe/paste';
import { sourceNumbers } from '../src/lib/scribe/grounding';
import {
  acceptGroupValues,
  groupDraftSources,
  groupFieldValues,
  groupMembers,
  groupRecordingConsentCheck,
  groundGroupSection,
  mergeAiValues,
  parseGroupReply,
  speakerOwner,
  GROUP_NEVER_AI_FIELDS,
} from '../src/lib/scribe/group';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ─── 1. One-click Start session ─────────────────────────────────────────────

test('Start session opens the visit note with the Visit Guide and the docked scribe', () => {
  const href = startSessionHref({ appointmentId: 'a1', clientId: 'c1', date: '2026-10-23', isVirtual: true });
  const u = new URL(href, 'https://x');
  assert.equal(u.pathname, '/dashboard/ehr/notes');
  assert.equal(u.searchParams.get('clientId'), 'c1');
  assert.equal(u.searchParams.get('appointmentId'), 'a1');
  assert.equal(u.searchParams.get('guide'), '1');
  assert.equal(u.searchParams.get('scribe'), '1');
  assert.equal(u.searchParams.get('dos'), '2026-10-23');
  assert.equal(u.searchParams.get('telehealth'), '1');
  assert.match(startSessionHref({ appointmentId: 'a', clientId: 'c', groupSessionId: 'gs1' }), /group-sessions\/sessions\/gs1\?scribe=1$/);
});

test('StartSessionButton is a reusable component; StartVisitButton can show it; notes page docks the scribe', () => {
  const btn = read('src/components/scribe/StartSessionButton.tsx');
  assert.match(btn, /export function StartSessionButton\(\{[\s\S]*appointmentId,[\s\S]*clientId,/);
  assert.match(btn, /startSessionHref/);
  assert.match(btn, /canAccessPath\(role, '\/dashboard\/scribe'\)/);
  const visit = read('src/components/visits/StartVisitButton.tsx');
  assert.match(visit, /withSession/);
  assert.match(visit, /<StartSessionButton/);
  const notes = read('src/app/dashboard/ehr/notes/page.tsx');
  assert.match(notes, /searchParams\.get\('scribe'\) === '1'/);
  assert.match(notes, /<ScribeDock/);
  assert.match(notes, /onFill=\{applyScribeFill\}/);
  assert.match(notes, /fillDraftInPlace\(/);
  assert.match(notes, /<AiReviewBar/);
  // No separate page hop from the editor any more
  assert.doesNotMatch(notes, /Use AI Scribe/);
  const dock = read('src/components/scribe/ScribeDock.tsx');
  assert.match(dock, /Pre-session brief/);
  assert.match(dock, /<details/);
  assert.match(dock, /quickConsentInput\(people\)/);
  assert.match(dock, /defaultScribeFormat\(\{ role, noteType/);
  assert.match(dock, /\/link`/);
  assert.match(dock, /onStop=\{\(\) => void stopAndDraft\(\)\}/);
  // standalone page still there
  assert.ok(fs.existsSync(path.join(ROOT, 'src/app/dashboard/scribe/page.tsx')));
});

test('inline consent: one checkbox per participant produces a valid all-party attestation', () => {
  const people = defaultQuickParticipants();
  assert.equal(validateRecordingConsent('in_person', quickConsentInput(people)).ok, false);
  const ok = quickConsentInput(people.map((p) => ({ ...p, agreed: true })));
  assert.equal(validateRecordingConsent('in_person', ok).ok, true);
  const minor = defaultQuickParticipants({ minor: true });
  assert.ok(minor.some((p) => p.role === 'GUARDIAN'));
  const oneMissing = quickConsentInput([{ role: 'CLIENT', agreed: true }, { role: 'FAMILY', agreed: false }]);
  assert.equal(validateRecordingConsent('in_person', oneMissing).ok, false);
  assert.equal(validateRecordingConsent('dictation', recapConsentInput()).ok, true);
  assert.deepEqual(inlineConsentState({ aiConsent: 'signed', practiceRequiresAiConsent: true, scribeEnabled: true, entitled: true }), { kind: 'ready' });
  assert.equal(inlineConsentState({ aiConsent: 'missing', practiceRequiresAiConsent: true, scribeEnabled: true, entitled: true }).kind, 'ai_missing');
  assert.equal(inlineConsentState({ aiConsent: 'declined', practiceRequiresAiConsent: false, scribeEnabled: true, entitled: true }).kind, 'blocked');
  // Server gate unchanged
  assert.equal(captureGate({ mode: 'in_person', scribeEnabled: true, entitled: true, aiConsent: 'signed', practiceRequiresAiConsent: true, recordingConsent: ok, transcriptionConfigured: true }).ok, true);
});

// ─── Per-section Accept ─────────────────────────────────────────────────────

const M = AI_DRAFT_MARKER;
test('per-section Accept unblocks signing only when every AI section is accepted or edited', () => {
  let texts: Record<string, string> = { Subjective: `${M}\nClient reported poor sleep.`, Objective: `${M}\nAlert.`, Assessment: 'Clinician text', Plan: '' };
  assert.deepEqual(aiSectionsPending(texts, ['Subjective', 'Objective', 'Assessment', 'Plan']), ['Subjective', 'Objective']);
  assert.equal(aiReviewComplete(texts), false);
  texts = acceptSection(texts, 'Subjective');
  assert.equal(texts.Subjective, 'Client reported poor sleep.');
  assert.equal(aiReviewComplete(texts), false);
  assert.equal(countAiDraftMarkers(Object.values(texts).join('\n')), 1);
  // Editing the words counts as review; whitespace-only does not
  assert.ok(clearMarkerIfEdited(texts.Objective, `${texts.Objective} `).includes(M));
  const edited = clearMarkerIfEdited(texts.Objective, `${M}\nAlert and oriented.`);
  assert.equal(edited, 'Alert and oriented.');
  texts = { ...texts, Objective: edited };
  assert.equal(aiReviewComplete(texts), true);
  assert.equal(countAiDraftMarkers(Object.values(texts).join('\n')), 0);
  // Accept all reviewed: only the listed headings
  const many = { A: `${M}\na`, B: `${M}\nb`, C: `${M}\nc` };
  const some = acceptAllSections(many, ['A', 'B']);
  assert.deepEqual(aiSectionsPending(some), ['C']);
  assert.equal(aiReviewComplete(acceptAllSections(many)), true);
  assert.equal(stripAiMarker(`${M}\nx`), 'x');
});

test('the server still refuses to sign while any AI marker remains', () => {
  const wf = read('src/lib/notes/workflow-store.ts');
  assert.match(wf, /countAiDraftMarkers\(currentNote\.body\)/);
  assert.match(wf, /Accept each AI-drafted section before signing/);
});

test('draft fills the note in place: empty / template sections take it, typed text is kept, risk sections untouched', () => {
  const r = fillDraftInPlace({
    current: { Subjective: '', Objective: 'typed by me', Assessment: 'Template default', 'Risk Assessment': 'clinician risk' },
    drafted: { Subjective: `${M}\nS`, Objective: `${M}\nO`, Assessment: `${M}\nA` },
    template: { Assessment: 'Template default' },
    headings: ['Subjective', 'Objective', 'Assessment', 'Risk Assessment'],
  });
  assert.equal(r.texts.Subjective, `${M}\nS`);
  assert.equal(r.texts.Objective, `typed by me\n\n${M}\nO`);
  assert.equal(r.texts.Assessment, `${M}\nA`);
  assert.equal(r.texts['Risk Assessment'], 'clinician risk');
  assert.deepEqual(r.filled, ['Subjective', 'Assessment']);
  assert.deepEqual(r.appended, ['Objective']);
});

// ─── 2. Delete transcript when the note is signed ───────────────────────────

test('delete-on-sign is a practice setting, default ON', () => {
  assert.equal(DEFAULT_SCRIBE_SETTINGS.deleteTranscriptOnSign, true);
  assert.equal(normalizeScribeSettings(null).deleteTranscriptOnSign, true);
  assert.equal(normalizeScribeSettings({ deleteTranscriptOnSign: false }).deleteTranscriptOnSign, false);
  assert.equal(scribeSettingsPatchSchema.safeParse({ deleteTranscriptOnSign: false }).success, true);
  assert.match(read('prisma/schema.prisma'), /deleteTranscriptOnSign\s+Boolean\s+@default\(true\)/);
  assert.match(read('prisma/migrations/20261023_scribe_session_start.sql'), /ADD COLUMN IF NOT EXISTS "delete_transcript_on_sign" BOOLEAN NOT NULL DEFAULT true/);
  assert.match(read('src/components/scribe/ScribeSettingsCard.tsx'), /Delete transcript when the note is signed/);
});

const signedAt = new Date('2026-10-20T15:00:00Z');
const base: RetentionCapture = { id: 'c', organizationId: 'o', progressNoteId: 'n', noteSignedAt: signedAt, stoppedAt: new Date('2026-10-20T14:00:00Z'), updatedAt: signedAt, transcriptPurgeAfter: null, transcriptPurgedAt: null };

test('retention: delete-on-sign purges at signature; day-based retention stays the fallback', () => {
  const justAfter = new Date(signedAt.getTime() + 1000);
  assert.equal(purgeAfter(base, 30, true).getTime(), signedAt.getTime());
  assert.equal(isDue(base, 30, justAfter, true), true);
  assert.equal(isDue(base, 30, justAfter, false), false);
  // Never-signed capture: day-based either way
  const noNote = { ...base, progressNoteId: null, noteSignedAt: null };
  assert.equal(isDue(noNote, 30, justAfter, true), false);
  assert.equal(isDue(noNote, 30, new Date(base.stoppedAt!.getTime() + 31 * 86_400_000), true), true);
  // Linked, unsigned: waits
  assert.equal(isDue({ ...base, noteSignedAt: null }, 30, justAfter, true), false);
});

test('runRetention purges a capture whose note was just signed when delete-on-sign is on', async () => {
  const purged: string[] = [];
  const deps: RetentionDeps = {
    candidates: async () => [{ ...base, noteSignedAt: null }],
    retentionDays: async () => 30,
    deleteOnSign: async () => true,
    noteSignedAt: async () => signedAt,
    markSigned: async () => undefined,
    purge: async (id) => {
      purged.push(id);
      return { segments: 3 };
    },
    audit: async () => undefined,
  };
  const r = await runRetention(deps, new Date(signedAt.getTime() + 60_000));
  assert.equal(r.purged, 1);
  assert.deepEqual(purged, ['c']);
});

test('the sign path purges at once (signPurge wired into updateProgressNoteWorkflow)', () => {
  const wf = read('src/lib/notes/workflow-store.ts');
  assert.match(wf, /import \{ purgeScribeForSignedNote \} from '@\/lib\/scribe\/signPurge'/);
  assert.match(wf, /if \(result\.ok && result\.signed\) \{\s*await purgeScribeForSignedNote/);
  const sp = read('src/lib/scribe/signPurge.ts');
  assert.match(sp, /settings\.deleteTranscriptOnSign/);
  assert.match(sp, /scribeSegment\.deleteMany/);
  assert.match(sp, /scribeDraft\.deleteMany/);
  assert.match(sp, /clientSummary: null/);
  assert.match(sp, /reason: 'note_signed'/);
  assert.match(sp, /purgeGroupIfAllSigned/);
  assert.match(read('src/lib/scribe/retentionJob.ts'), /deleteOnSign: async/);
});

// ─── 3. Upload audio / dictated recap ───────────────────────────────────────

test('upload: types, size and the 2-hour limit', () => {
  assert.equal(checkUpload({ fileName: 'session.M4A', bytes: 1000 }).ok, true);
  assert.equal(checkUpload({ fileName: 'a.mp3', bytes: 10 }).ok, true);
  assert.equal(checkUpload({ fileName: 'a.wav', bytes: 10, durationSeconds: UPLOAD_MAX_SECONDS }).ok, true);
  assert.equal(checkUpload({ fileName: 'a.wav', bytes: 10, durationSeconds: UPLOAD_MAX_SECONDS + 1 }).ok, false);
  assert.equal(checkUpload({ fileName: 'a.ogg', bytes: 10 }).ok, false);
  assert.equal(checkUpload({ fileName: 'a.mp3', bytes: 0 }).ok, false);
  assert.equal(uploadObjectKey('org1', 'cap1', 'm4a'), 'scribe-uploads/org1/cap1.m4a');
});

test('upload: batch job follows the engine setting; Spanish and Medical never mix', () => {
  const common = { jobName: 'j', bucket: 'b', objectKey: 'k.m4a', outputKey: 'o.json', ext: 'm4a' as const, vocabularyName: 'altrixs-behavioral-health' };
  const med = batchJobInput({ ...common, engine: 'medical', language: 'en-US' });
  assert.equal(med.kind, 'medical');
  assert.equal((med.params as { Specialty: string }).Specialty, 'PRIMARYCARE');
  assert.equal(med.params.MediaFormat, 'mp4');
  const std = batchJobInput({ ...common, engine: 'standard', language: 'en-US' });
  assert.equal(std.kind, 'standard');
  assert.equal((std.params as { Settings: { VocabularyName?: string } }).Settings.VocabularyName, 'altrixs-behavioral-health');
  const es = batchJobInput({ ...common, engine: 'medical', language: 'es-US' });
  assert.equal(es.kind, 'standard');
  assert.equal(es.params.LanguageCode, 'es-US');
  assert.equal((es.params as { Settings: { VocabularyName?: string } }).Settings.VocabularyName, undefined);
  assert.equal(uploadCaptureEngine('medical', 'es-US'), 'transcribe_batch');
  assert.equal(uploadCaptureEngine('medical', 'en-US'), 'transcribe_medical_batch');
});

test('upload: batch transcript JSON → speaker turns', () => {
  const segs = batchTranscriptToSegments({
    results: {
      speaker_labels: { segments: [{ speaker_label: 'spk_0', start_time: '0', end_time: '2' }, { speaker_label: 'spk_1', start_time: '2.1', end_time: '5' }] },
      items: [
        { start_time: '0.1', end_time: '0.5', type: 'pronunciation', alternatives: [{ content: 'How' }] },
        { start_time: '0.6', end_time: '1.0', type: 'pronunciation', alternatives: [{ content: 'are' }] },
        { start_time: '1.1', end_time: '1.5', type: 'pronunciation', alternatives: [{ content: 'you' }] },
        { type: 'punctuation', alternatives: [{ content: '?' }] },
        { start_time: '2.2', end_time: '2.6', type: 'pronunciation', alternatives: [{ content: 'Better' }] },
        { start_time: '2.7', end_time: '4.9', type: 'pronunciation', alternatives: [{ content: 'today' }] },
      ],
    },
  });
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { speakerLabel: 'spk_0', startMs: 100, endMs: 1500, text: 'How are you?' });
  assert.equal(segs[1].speakerLabel, 'spk_1');
  assert.equal(segs[1].text, 'Better today');
  assert.equal(transcriptSeconds(segs), 5);
});

test('upload deletes the audio as soon as the transcript exists (and on failure / dismiss)', () => {
  const route = read('src/app/api/scribe/captures/[id]/upload/route.ts');
  const get = route.slice(route.indexOf('export async function GET'));
  const store = get.indexOf('appendSegmentsIfOpen');
  const del = get.indexOf('deleteUploadArtifacts');
  assert.ok(store > 0 && del > store, 'segments stored, then the audio deleted');
  assert.match(get, /audioDeletedAt: new Date\(\)/);
  // A failed job start also deletes the file
  assert.match(route.slice(0, route.indexOf('export async function GET')), /deleteUploadArtifacts/);
  const aws = read('src/lib/scribe/uploadAws.ts');
  assert.match(aws, /DeleteObjectCommand/);
  assert.match(aws, /DeleteTranscriptionJobCommand/);
  assert.match(aws, /DeleteMedicalTranscriptionJobCommand/);
  assert.match(read('src/app/api/scribe/captures/[id]/control/route.ts'), /deleteUploadArtifacts/);
});

test('upload and recap go through the same consent rules; recap is drafted as a recap', () => {
  const create = read('src/app/api/scribe/captures/route.ts');
  assert.match(create, /source: z\.enum\(\['live', 'upload', 'recap'\]\)/);
  assert.match(create, /captureGate\(/);
  assert.match(create, /source === 'recap' && body\.mode !== 'dictation'/);
  assert.match(read('src/app/api/scribe/captures/[id]/upload/route.ts'), /recordingConsentRevoked/);
  assert.match(draftSessionLabel('dictation', 'transcribe_streaming', 'recap'), /recap/);
  assert.match(draftSessionLabel('in_person', 'transcribe_batch', 'upload'), /uploaded recording/);
  assert.match(read('src/app/api/scribe/captures/[id]/control/route.ts'), /RECAP_MAX_SECONDS/);
});

// ─── 4. Spanish ─────────────────────────────────────────────────────────────

test('language is stored on the capture and drives the stream', () => {
  assert.match(read('prisma/schema.prisma'), /language\s+String\s+@default\("en-US"\) @db\.VarChar\(8\)/);
  assert.match(read('src/app/api/scribe/captures/route.ts'), /\n\s+language,\n\s+source,/);
  const es = transcribeStreamParams('conversation', 16000, { engine: 'medical', vocabularyName: 'v', languageCode: 'es-US' });
  assert.equal(es['language-code'], 'es-US');
  assert.equal(es.specialty, undefined);
  assert.equal(es['vocabulary-name'], undefined);
  assert.equal(transcribeStreamParams('conversation', 16000, { engine: 'standard', vocabularyName: 'v' })['vocabulary-name'], 'v');
  assert.equal(streamEngineForLanguage('medical', 'es-US'), 'standard');
  const chime = chimeTranscriptionConfiguration('medical', 'v', 'es-US');
  assert.equal(chime.EngineTranscribeSettings?.LanguageCode, 'es-US');
  assert.equal(chime.EngineTranscribeMedicalSettings, undefined);
});

test('note drafted in English; client summary in Spanish for a Spanish-preferring client', () => {
  assert.equal(draftLanguageInstruction('en-US'), '');
  assert.match(draftLanguageInstruction('es-US'), /in English/);
  assert.equal(summaryLanguageFor('es'), 'es');
  assert.equal(summaryLanguageFor('en'), 'en');
  assert.equal(summaryLanguageFor(null), 'en');
  assert.equal(isSpanishPreference('Spanish'), true);
  assert.equal(defaultCaptureLanguage('es'), 'es-US');
  assert.ok(SUD_TERMS_ES.test('Habló de una recaída con alcohol'));
  const summary = read('src/app/api/scribe/captures/[id]/summary/route.ts');
  assert.match(summary, /summaryLanguageFor\(client\?\.preferredLanguage\)/);
  assert.match(summary, /SUD_TERMS_ES/);
  assert.ok(sourceNumbers('dos semanas').has('2'));
});

// ─── 5. Group sessions ──────────────────────────────────────────────────────

const members = groupMembers(
  [
    { clientId: 'ann', aiConsent: 'signed', part2: false },
    { clientId: 'bob', aiConsent: 'signed', part2: true },
    { clientId: 'cat', aiConsent: 'declined', part2: false },
  ],
  true
);
const speakerMap = { spk_0: 'CLINICIAN', spk_1: 'member:ann', spk_2: 'member:bob', spk_3: 'member:cat' };
const segs = [
  { seq: 0, speakerLabel: 'spk_0', startMs: 0, endMs: 1, text: 'Today we practice coping skills for stress.' },
  { seq: 1, speakerLabel: 'spk_1', startMs: 2, endMs: 3, text: 'I used deep breathing at work this week.' },
  { seq: 2, speakerLabel: 'spk_2', startMs: 4, endMs: 5, text: 'I had a relapse with alcohol on Saturday.' },
  { seq: 3, speakerLabel: 'spk_2', startMs: 6, endMs: 7, text: 'Journaling helped me sleep.' },
  { seq: 4, speakerLabel: 'spk_3', startMs: 8, endMs: 9, text: 'My divorce is final.' },
  { seq: 5, speakerLabel: 'spk_9', startMs: 10, endMs: 11, text: 'Someone unmapped said something.' },
];

test('group: members without AI consent are excluded; unattributed speech is never used', () => {
  assert.deepEqual(members.map((m) => [m.clientId, m.included]), [['ann', true], ['bob', true], ['cat', false]]);
  assert.equal(members[0].alias, 'Member A');
  const src = groupDraftSources({ segments: segs, speakerMap, members, kind: 'psychotherapy' });
  const sharedText = src.shared.map((l) => l.text).join(' ');
  assert.doesNotMatch(sharedText, /divorce/);
  assert.doesNotMatch(sharedText, /unmapped/);
  assert.equal(src.perMember.has('cat'), false);
  assert.equal(src.dropped.unattributed, 1);
  assert.equal(src.dropped.excluded, 1);
  assert.equal(speakerOwner(speakerMap, 'spk_9'), null);
});

test('group: per-member isolation — each member sees only their own lines, numbered for them alone', () => {
  const src = groupDraftSources({ segments: segs, speakerMap, members, kind: 'psychotherapy' });
  const ann = src.perMember.get('ann')!;
  assert.deepEqual(ann.map((l) => l.text), ['I used deep breathing at work this week.']);
  assert.equal(ann[0].id, 't1');
  // A sentence citing a line that is not this member's (t2 does not exist for Ann) is withheld
  const g = groundGroupSection({ response: [{ text: 'The client used deep breathing at work.', cites: ['t1'] }, { text: 'The client said journaling helped sleep.', cites: ['t2'] }] }, ann, { otherNames: ['Bob Smith'], noSud: false });
  assert.equal(g.fields.response[0].status === 'withheld', false);
  assert.equal(g.fields.response[1].status, 'withheld');
  // Naming another member or using an alias withholds the sentence
  const named = groundGroupSection({ response: [{ text: 'The client agreed with Bob about deep breathing at work.', cites: ['t1'] }, { text: 'Member B and the client used deep breathing at work.', cites: ['t1'] }] }, ann, { otherNames: ['Bob Smith'], noSud: false });
  assert.ok(named.fields.response.every((s) => s.status === 'withheld'));
});

test('group: a Part 2 member in a non-SUD group gets nothing SUD-related (own section and shared section)', () => {
  const src = groupDraftSources({ segments: segs, speakerMap, members, kind: 'psychotherapy' });
  assert.deepEqual(src.perMember.get('bob')!.map((l) => l.text), ['Journaling helped me sleep.']);
  assert.doesNotMatch(src.shared.map((l) => l.text).join(' '), /relapse|alcohol/);
  const g = groundGroupSection({ progress: [{ text: 'The client reported journaling helped sleep and less alcohol.', cites: ['t1'] }] }, src.perMember.get('bob')!, { otherNames: [], noSud: true });
  assert.equal(g.fields.progress[0].status, 'withheld');
  // In a SUD group the member's SUD content is the point of the note
  const sud = groupDraftSources({ segments: segs, speakerMap, members, kind: 'sud' });
  assert.equal(sud.perMember.get('bob')!.length, 2);
});

test('group: recording consent is all-party; AI values fill only empty fields, never risk, and carry the marker', () => {
  assert.equal(groupRecordingConsentCheck([{ clientId: 'ann', agreed: true }, { clientId: null, agreed: false }]).ok, false);
  assert.equal(groupRecordingConsentCheck([{ clientId: 'ann', agreed: true }, { clientId: null, agreed: true }]).ok, true);
  const parsed = parseGroupReply(JSON.stringify({ fields: { response: [{ text: 'x', cites: ['t1'] }], risk: [{ text: 'low', cites: ['t1'] }] } }), 'fields', ['response', 'progress', 'risk']);
  assert.ok(parsed && !('risk' in parsed));
  assert.ok(GROUP_NEVER_AI_FIELDS.has('risk'));
  const values = groupFieldValues({ response: [{ text: 'Used breathing', cites: ['t1'], status: 'supported', support: 1 }], topic: [{ text: 'Coping skills.', cites: ['t1'], status: 'supported', support: 1 }] });
  assert.equal(values.response, `${M}\nUsed breathing.`);
  assert.equal(values.topic, 'Coping skills');
  const merged = mergeAiValues({ response: 'mine', risk: 'low' }, { response: 'AI', progress: `${M}\np`, risk: 'high' });
  assert.equal(merged.response, 'mine');
  assert.equal(merged.risk, 'low');
  assert.equal(merged.progress, `${M}\np`);
  assert.equal(acceptGroupValues(merged).progress, 'p');
});

test('group scribe is wired into SessionRunner and the group draft route isolates members', () => {
  const runner = read('src/features/groups/SessionRunner.tsx');
  assert.match(runner, /<GroupScribePanel/);
  assert.match(runner, /mergeAiValues\(cur\[clientId\], values\)/);
  const route = read('src/app/api/scribe/group-captures/[id]/draft/route.ts');
  assert.match(route, /sources\.perMember\.get\(m\.clientId\)/);
  assert.match(route, /if \(!m\.included/);
  assert.match(route, /THIS MEMBER'S LINES/);
  assert.match(read('src/lib/scribe/signPurge.ts'), /purgeGroupIfAllSigned/);
  const sql = read('prisma/migrations/20261023_scribe_session_start.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "scribe_group_captures"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "scribe_group_segments"/);
});

test('no browser speech service is introduced by the new capture paths', () => {
  for (const f of ['src/components/scribe/ScribeDock.tsx', 'src/components/scribe/GroupScribePanel.tsx', 'src/components/scribe/audioUpload.ts', 'src/components/scribe/AudioUploadPanel.tsx']) {
    assert.doesNotMatch(read(f), /webkitSpeechRecognition|SpeechRecognition/);
  }
});

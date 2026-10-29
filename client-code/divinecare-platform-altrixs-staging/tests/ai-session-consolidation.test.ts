/**
 * AI Session Notes folded into AI Scribe ("Paste or import"): one grounded AI documentation workflow,
 * no ungrounded drafting path, no signing from AI output.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  PASTE_MAX_CHARS,
  draftSessionLabel,
  isPasteEngine,
  parsePastedText,
  pasteCaptureGate,
  segmentsFromImportedLines,
  speakerPrefix,
  type PasteGateInput,
} from '../src/lib/scribe/paste';
import { captureGate } from '../src/lib/scribe/consent';
import { defaultSpeakerMap, transcriptLines, capturedMinutes } from '../src/lib/scribe/diarization';
import { groundSectionReply, sectionSources } from '../src/lib/scribe/sectionDraft';
import { AI_DRAFT_MARKER } from '../src/lib/ai/noteDraftFormats';
import { LEGACY_ROUTE_REDIRECTS, legacyRedirectUrl } from '../src/components/layout/navRedirects';
import { NAV_SECTIONS } from '../src/components/layout/navConfig';
import { CLINIC_NAV_HREFS, canAccessPath } from '../src/lib/auth/roleAccess';

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(SRC, p));
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const ALL_SRC = walk(SRC).map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));

test('paste: speaker prefixes (Clinician: / Client: / T: / C: / Mother:) become segments with roles; continuation lines join the turn', () => {
  const text = [
    'Clinician: How has your sleep been since last week?',
    'Client: Better. I slept about six hours most nights.',
    'It still takes me a while to fall asleep.',
    'T: Did you try the breathing exercise?',
    'C: Twice. It helped on Tuesday.',
    'Mother: She seemed calmer at dinner.',
  ].join('\n');
  const r = parsePastedText(text, { kind: 'transcript', parseSpeakers: true });
  assert.equal(r.labeledTurns, 5);
  assert.deepEqual(
    r.segments.map((s) => s.speakerLabel),
    ['paste:clinician', 'paste:client', 'paste:clinician', 'paste:client', 'paste:other']
  );
  assert.equal(r.segments[1].text, 'Better. I slept about six hours most nights. It still takes me a while to fall asleep.');
  assert.deepEqual(r.segments.map((s) => s.seq), [1, 2, 3, 4, 5]);
  // No timestamps: the time-based CPT hint is never inferred from pasted text
  assert.ok(r.segments.every((s) => s.startMs === 0 && s.endMs === 0));
  const map = defaultSpeakerMap(r.segments, { mode: 'in_person' });
  assert.equal(map['paste:clinician'], 'CLINICIAN');
  assert.equal(map['paste:client'], 'CLIENT');
  assert.equal(map['paste:other'], 'OTHER');
  const lines = transcriptLines(r.segments, map);
  assert.deepEqual(lines.map((l) => l.id), ['t1', 't2', 't3', 't4', 't5']);
  assert.equal(capturedMinutes(lines), null);

  assert.equal(speakerPrefix('Note: she was late'), null, 'unknown prefixes are text, not speakers');
  assert.equal(speakerPrefix('[Therapist]: hello')?.label, 'paste:clinician');
  assert.equal(speakerPrefix('Speaker 1: hi')?.label, 'spk_1');
});

test('paste: unparsed transcript stays Unknown; a summary is one speaker (the clinician), cited sentence by sentence; text is capped', () => {
  const plain = parsePastedText('Clinician: hi there, how are you\nClient: ok', { kind: 'transcript', parseSpeakers: false });
  assert.ok(plain.segments.every((s) => s.speakerLabel === 'paste:unlabeled'));
  assert.equal(defaultSpeakerMap(plain.segments, { mode: 'in_person' })['paste:unlabeled'], 'UNKNOWN');

  const summary = parsePastedText('Client reported better sleep. She practiced breathing daily.\n\nPlan: continue CBT.', { kind: 'summary', parseSpeakers: true });
  assert.equal(summary.segments.length, 3);
  assert.ok(summary.segments.every((s) => s.speakerLabel === 'dictation'));
  assert.equal(defaultSpeakerMap(summary.segments, { mode: 'dictation' }).dictation, 'CLINICIAN');

  const long = parsePastedText('Client: ' + 'word '.repeat(8000), { kind: 'transcript', parseSpeakers: true });
  assert.equal(long.truncated, true);
  assert.ok(long.segments.reduce((n, s) => n + s.text.length, 0) <= PASTE_MAX_CHARS);
  assert.ok(long.segments.every((s) => s.text.length <= 600), 'long turns are split so citations stay specific');
});

test('import: telehealth batch transcript speaker turns become spk_N segments (question heuristic picks the clinician)', () => {
  const r = segmentsFromImportedLines(['Speaker 0: How was your week?', 'Speaker 1: Hard. I could not sleep.', 'Speaker 0: What kept you up?', 'Speaker 1: Worrying about work.']);
  assert.deepEqual(r.segments.map((s) => s.speakerLabel), ['spk_0', 'spk_1', 'spk_0', 'spk_1']);
  const map = defaultSpeakerMap(r.segments, { mode: 'telehealth' });
  assert.equal(map.spk_0, 'CLINICIAN');
  assert.equal(map.spk_1, 'CLIENT');
  assert.ok(isPasteEngine('import') && isPasteEngine('paste') && !isPasteEngine('transcribe_medical_streaming'));
});

const gateBase: PasteGateInput = { engine: 'paste', scribeEnabled: true, entitled: true, aiConsent: 'signed', practiceRequiresAiConsent: true, chars: 500 };

test('paste / import: AI consent declined blocks; missing blocks when the practice requires it', () => {
  assert.deepEqual(pasteCaptureGate(gateBase), { ok: true });
  const declined = pasteCaptureGate({ ...gateBase, aiConsent: 'declined' });
  assert.equal(declined.ok, false);
  assert.equal(declined.ok === false && declined.code, 'ai_consent_declined');
  assert.equal(pasteCaptureGate({ ...gateBase, engine: 'import', aiConsent: 'declined' }).ok, false);
  const missing = pasteCaptureGate({ ...gateBase, aiConsent: 'missing' });
  assert.equal(missing.ok === false && missing.code, 'ai_consent_missing');
  assert.equal(pasteCaptureGate({ ...gateBase, aiConsent: 'missing', practiceRequiresAiConsent: false }).ok, true);
  assert.equal(pasteCaptureGate({ ...gateBase, scribeEnabled: false }).ok, false);
  assert.equal(pasteCaptureGate({ ...gateBase, chars: 10 }).ok, false);
  assert.equal(pasteCaptureGate({ ...gateBase, chars: PASTE_MAX_CHARS + 1 }).ok, false);
});

test('paste mode does not require recording consent (live capture still does); import honors a revoked recording consent', () => {
  // Live capture without a recording-consent attestation is blocked …
  const live = captureGate({ mode: 'in_person', scribeEnabled: true, entitled: true, aiConsent: 'signed', practiceRequiresAiConsent: true, recordingConsent: null, transcriptionConfigured: true });
  assert.equal(live.ok, false);
  // … paste needs none (the gate has no recording-consent input at all), and no transcription service
  assert.deepEqual(pasteCaptureGate(gateBase), { ok: true });
  assert.deepEqual(pasteCaptureGate({ ...gateBase, recordingConsentRevoked: true }), { ok: true });
  const revoked = pasteCaptureGate({ ...gateBase, engine: 'import', recordingConsentRevoked: true });
  assert.equal(revoked.ok === false && revoked.code, 'recording_consent_revoked');

  const route = read('app/api/scribe/captures/import/route.ts');
  assert.match(route, /pasteCaptureGate\(/);
  assert.doesNotMatch(route, /captureGate\(|validateRecordingConsent/);
  assert.match(route, /aiConsentFor\(/);
  // Gate runs before the telehealth transcript is read
  assert.ok(route.indexOf('pasteCaptureGate(') < route.indexOf('loadSessionTranscript(session)'));
  // Engine, no audio, and the same retention path as live captures (status stopped → retention job)
  assert.match(route, /engine: body\.source/);
  assert.match(route, /status: 'stopped'/);
  assert.match(route, /stoppedAt: now/);
  assert.match(route, /auditPhiAccess/);
  // The scribe page offers the mode and routes it through the shared draft step
  const page = read('app/dashboard/scribe/page.tsx');
  assert.match(page, /id: 'paste', label: 'Paste or import'/);
  assert.match(page, /PasteImportPanel/);
  assert.match(page, /\/api\/scribe\/captures\/\$\{encodeURIComponent\(capture\.id\)\}\/draft/);
  assert.match(read('app/api/scribe/captures/[id]/draft/route.ts'), /draftSessionLabel\(cap\.mode, cap\.engine[,)]/);
  assert.match(draftSessionLabel('dictation', 'paste'), /not a verbatim transcript/);
  assert.equal(draftSessionLabel('in_person', 'transcribe_medical_streaming'), 'in person session');
});

test('/dashboard/ehr/session-ai redirects to AI Scribe paste mode, keeping query params, with a notice', () => {
  assert.deepEqual(LEGACY_ROUTE_REDIRECTS['/dashboard/ehr/session-ai'], { to: '/dashboard/scribe', params: { mode: 'paste', from: 'session-ai' } });
  assert.equal(legacyRedirectUrl('/dashboard/ehr/session-ai'), '/dashboard/scribe?mode=paste&from=session-ai');
  assert.equal(
    legacyRedirectUrl('/dashboard/ehr/session-ai', { clientId: 'c1', appointmentId: 'a1', mode: 'x' }),
    '/dashboard/scribe?clientId=c1&appointmentId=a1&mode=paste&from=session-ai'
  );
  const page = read('app/dashboard/ehr/session-ai/page.tsx');
  assert.match(page, /legacyRedirectUrl\('\/dashboard\/ehr\/session-ai'/);
  assert.doesNotMatch(page, /use client|requestAiDraft|SmartPhraseTextarea/);
  assert.ok(page.split('\n').length < 30, 'the old 680-line page is gone');
  const scribe = read('app/dashboard/scribe/page.tsx');
  assert.match(scribe, /qs\.get\('from'\) === 'session-ai'/);
  assert.match(scribe, /AI Session Notes is now part of AI Scribe/);
  assert.match(scribe, /qs\.get\('mode'\) === 'paste'/);
  // Roles that used the old page can use the scribe
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN'] as const) {
    if (canAccessPath(role, '/dashboard/ehr/session-ai')) assert.equal(canAccessPath(role, '/dashboard/scribe'), true, role);
  }
  // AI-drafted note counts are kept, shown on the scribe page
  assert.match(scribe, /\/api\/ehr\/session-ai\/stats/);
  assert.match(read('app/api/ehr/session-ai/stats/route.ts'), /canAccessPath\(gate\.role, '\/dashboard\/scribe'\)/);
});

test('nav has no "AI Session Notes"; searching "session notes" still finds AI Scribe', () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  assert.ok(!items.some((i) => i.label === 'AI Session Notes' || i.href.startsWith('/dashboard/ehr/session-ai')));
  assert.ok(!(CLINIC_NAV_HREFS as readonly string[]).includes('/dashboard/ehr/session-ai'));
  const scribe = items.find((i) => i.href === '/dashboard/scribe');
  assert.ok(scribe);
  assert.ok(`${scribe!.label} ${scribe!.keywords ?? ''}`.toLowerCase().includes('session notes'));
  assert.equal(items.filter((i) => /\bAI\b.*\b(scribe|notes?)\b/i.test(i.label)).length, 1, 'one AI documentation entry point');
});

test('no ungrounded AI drafting path remains (source check)', () => {
  assert.equal(exists('app/api/agents/scribe/route.ts'), false);
  assert.equal(exists('lib/ai/scribeClient.ts'), false);
  for (const { file, text } of ALL_SRC) {
    assert.doesNotMatch(text, /\/api\/agents\/scribe\b/, file);
    assert.doesNotMatch(text, /\brequestAiDraft\b|@\/lib\/ai\/scribeClient|buildScribeSystemPrompt|finalizeDraftSections/, file);
  }
  // Every AI note-drafting route grounds its output
  for (const f of ['app/api/scribe/captures/[id]/draft/route.ts', 'app/api/scribe/section-draft/route.ts']) {
    const t = read(f);
    assert.match(t, /groundDraft\(|groundSectionReply\(/, f);
    assert.match(t, /auditPhiAccess/, f);
  }
  // The editors' "Draft from dictation (AI)" uses the grounded section draft
  for (const f of ['components/notes/StructuredNoteEditor.tsx', 'components/notes/TherapyNoteEditor.tsx']) {
    assert.match(read(f), /requestGroundedSectionDraft\(/, f);
  }
  // Notes' "AI Draft Note" goes to the scribe instead of a chip-based generator
  const notes = read('app/dashboard/ehr/notes/page.tsx');
  assert.match(notes, /\/dashboard\/scribe\?mode=paste/);
  assert.doesNotMatch(notes, /buildScribeInput|AI Session Note Generator|handleGenerateNote/);
});

test('section draft: sentences that cite nothing or add facts are withheld; kept text carries the AI DRAFT marker', () => {
  const sources = sectionSources('- sleeping 5 h, mood low since school started\n- taking sertraline daily, mild nausea first week');
  assert.deepEqual(sources.map((s) => s.id), ['t1', 't2']);
  const reply = JSON.stringify({
    sentences: [
      { text: 'Client reported sleeping 5 hours with low mood since school started.', cites: ['t1'] },
      { text: 'Client takes sertraline daily with mild nausea in the first week.', cites: ['t2'] },
      { text: 'Client also started lorazepam.', cites: ['t2'] },
      { text: 'Client denies suicidal ideation.', cites: [] },
    ],
  });
  const r = groundSectionReply(reply, sources)!;
  assert.equal(r.sentences.length, 2);
  assert.deepEqual(r.withheld.map((w) => w.reason), ['ungrounded_medication', 'no_citation']);
  assert.ok(r.text.startsWith(AI_DRAFT_MARKER));
  assert.doesNotMatch(r.text, /lorazepam|suicidal/);
  assert.equal(groundSectionReply('not json', sources), null);
});

test('no direct sign-and-lock from AI output: signing happens only in Notes', () => {
  assert.equal(exists('lib/ai/NoteSignPanel.tsx'), false);
  for (const { file, text } of ALL_SRC) {
    assert.doesNotMatch(text, /\bsaveSignAndLock\b/, file);
    if (/^(app\/dashboard\/scribe|app\/dashboard\/ehr\/session-ai|components\/scribe|app\/api\/scribe|lib\/scribe)\//.test(file)) {
      // No status change toward Signed / Locked on a progress note (reads of signed notes are fine)
      assert.doesNotMatch(text, /updateProgressNoteStatus|progressNoteWorkflow\.(?:create|update|upsert)|'Signed'|'Locked'|signedAt: new Date/, file);
    }
  }
  // The scribe creates an unsigned draft note and sends the clinician to Notes to sign
  assert.match(read('app/dashboard/scribe/page.tsx'), /sign in Notes/);
});

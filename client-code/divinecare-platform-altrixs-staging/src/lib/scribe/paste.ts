/**
 * AI Scribe "Paste or import" capture: text in, transcript segments out. Pure, browser-safe.
 *
 * Two sources, no audio (so no recording-consent attestation; the client's AI consent still applies):
 *   paste   a transcript the clinician pastes, or their own session summary (max PASTE_MAX_CHARS)
 *   import  a completed telehealth batch transcript (Transcribe Medical, src/lib/ai/sessionTranscript.ts)
 *
 * Segments are what the grounded draft cites (t1, t2 …), so long turns and summary paragraphs are
 * split into sentence-sized pieces: a citation then points at the words that support a sentence,
 * not at a whole page. There are no timestamps (startMs = endMs = 0): the time-based CPT hint is
 * left to the clinician, never inferred from pasted text.
 *
 * Speaker labels (mapped to roles in diarization.defaultSpeakerMap):
 *   paste:clinician / paste:client / paste:other   from a recognized prefix ("Clinician:", "T:", "Client:", "C:", "Mother:")
 *   paste:unlabeled                                transcript text with no prefix (the clinician sets the role)
 *   dictation                                      the clinician's own summary (one speaker)
 *   spk_0, spk_1 …                                 imported Transcribe speaker turns ("Speaker 0: …")
 */
import type { RawSegment } from './diarization';

export const PASTE_MAX_CHARS = 30_000;
export const PASTE_MIN_CHARS = 40;
/** Longest piece of text one segment (one citation target) holds */
export const SEGMENT_MAX_CHARS = 600;
export const PASTE_ENGINES = ['paste', 'import'] as const;
export type PasteEngine = (typeof PASTE_ENGINES)[number];
export const PASTE_KINDS = ['transcript', 'summary'] as const;
export type PasteKind = (typeof PASTE_KINDS)[number];

export function isPasteEngine(engine: string | null | undefined): engine is PasteEngine {
  return engine === 'paste' || engine === 'import';
}

const CLINICIAN = ['clinician', 'therapist', 'counselor', 'counsellor', 'provider', 'doctor', 'dr', 'psychiatrist', 'np', 'nurse practitioner', 'interviewer', 'me', 't', 'th'];
const CLIENT = ['client', 'patient', 'pt', 'c', 'cl', 'p'];
const OTHER = ['mother', 'mom', 'father', 'dad', 'parent', 'guardian', 'family', 'spouse', 'partner', 'interpreter', 'other', 'sibling', 'caregiver', 'grandmother', 'grandfather'];

/** Line prefix such as "Clinician:", "T -", "[Client]:", "Speaker 1:" (case-insensitive); null when the line has none. */
export function speakerPrefix(line: string): { label: string; rest: string } | null {
  const m = line.match(/^\s*\[?\s*([A-Za-z][A-Za-z .'-]{0,24}?|speaker\s*\d{1,2}|spk_\d{1,2})\s*\]?\s*(?::|\s-\s|\s–\s)\s*(.*)$/i);
  if (!m) return null;
  const who = m[1].trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  const rest = m[2] ?? '';
  const spk = who.match(/^(?:speaker\s*|spk_)(\d{1,2})$/);
  if (spk) return { label: `spk_${Number(spk[1])}`, rest };
  if (CLINICIAN.includes(who)) return { label: 'paste:clinician', rest };
  if (CLIENT.includes(who)) return { label: 'paste:client', rest };
  if (OTHER.includes(who)) return { label: 'paste:other', rest };
  return null;
}

/** Split text into sentence-sized pieces of at most `max` characters (never mid-word unless a word is longer). */
export function splitSentences(text: string, max = SEGMENT_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out: string[] = [];
  let cur = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const pieces = sentence.length <= max ? [sentence] : (sentence.match(new RegExp(`.{1,${max}}(?:\\s|$)`, 'g')) ?? [sentence]).map((p) => p.trim());
    for (const p of pieces) {
      if (!p) continue;
      if (cur && cur.length + 1 + p.length > max) {
        out.push(cur);
        cur = p;
      } else cur = cur ? `${cur} ${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export type PasteParseResult = {
  segments: (RawSegment & { seq: number })[];
  /** Turns that started with a recognized speaker prefix */
  labeledTurns: number;
  truncated: boolean;
};

/**
 * Pasted text → segments. `parseSpeakers` (transcript only) reads "Clinician:" / "Client:" / "T:" / "C:"
 * prefixes; a line without a prefix continues the previous speaker's turn. A summary is one speaker
 * (the clinician), split into sentences.
 */
export function parsePastedText(text: string, opts: { kind: PasteKind; parseSpeakers: boolean }): PasteParseResult {
  const truncated = text.length > PASTE_MAX_CHARS;
  const input = text.slice(0, PASTE_MAX_CHARS).replace(/\r\n?/g, '\n');
  const turns: { label: string; text: string }[] = [];
  let labeledTurns = 0;
  if (opts.kind === 'summary') {
    for (const para of input.split(/\n\s*\n/)) if (para.trim()) turns.push({ label: 'dictation', text: para });
  } else {
    let cur: { label: string; text: string } | null = null;
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) {
        if (!opts.parseSpeakers && cur) {
          turns.push(cur);
          cur = null;
        }
        continue;
      }
      const prefix = opts.parseSpeakers ? speakerPrefix(line) : null;
      if (prefix) {
        if (cur) turns.push(cur);
        labeledTurns++;
        cur = { label: prefix.label, text: prefix.rest };
      } else if (cur) {
        cur.text = `${cur.text} ${line}`;
      } else {
        cur = { label: 'paste:unlabeled', text: line };
      }
    }
    if (cur) turns.push(cur);
  }
  const segments: (RawSegment & { seq: number })[] = [];
  for (const t of turns) {
    // A summary is cited sentence by sentence; a transcript turn stays whole unless it is long
    const pieces =
      opts.kind === 'summary'
        ? t.text
            .replace(/\s+/g, ' ')
            .trim()
            .split(/(?<=[.!?])\s+/)
            .flatMap((s) => splitSentences(s))
        : splitSentences(t.text);
    for (const piece of pieces) {
      segments.push({ seq: segments.length + 1, speakerLabel: t.label, startMs: 0, endMs: 0, text: piece });
    }
  }
  return { segments, labeledTurns, truncated };
}

/**
 * Imported telehealth transcript lines ("Speaker 0: …", or plain sentences when Transcribe returned
 * no speaker labels) → segments. Speaker turns keep spk_N (the question heuristic picks the
 * clinician); unlabeled text stays Unknown until the clinician sets the role.
 */
export function segmentsFromImportedLines(lines: string[]): PasteParseResult {
  const joined = lines.join('\n');
  return parsePastedText(joined, { kind: 'transcript', parseSpeakers: true });
}

export type PasteGateInput = {
  engine: PasteEngine;
  scribeEnabled: boolean;
  entitled: boolean;
  aiConsent: 'signed' | 'missing' | 'declined';
  practiceRequiresAiConsent: boolean;
  /** Import only: the client revoked the session recording / transcription consent */
  recordingConsentRevoked?: boolean;
  /** Characters of text after trimming */
  chars: number;
};

/**
 * Every reason a paste / import capture may not be created. No recording-consent attestation:
 * nothing is recorded here (the text already exists). The client's AI consent applies exactly as
 * for live capture (declined always blocks; missing blocks when the practice requires it).
 */
export function pasteCaptureGate(input: PasteGateInput): { ok: true } | { ok: false; code: string; message: string } {
  if (!input.entitled) return { ok: false, code: 'not_entitled', message: "AI Scribe is not included in this practice's plan." };
  if (!input.scribeEnabled) return { ok: false, code: 'scribe_disabled', message: 'AI Scribe is turned off in practice settings.' };
  if (input.aiConsent === 'declined') {
    return { ok: false, code: 'ai_consent_declined', message: 'This client declined AI use. Nothing is sent to AI; document the session yourself.' };
  }
  if (input.aiConsent === 'missing' && input.practiceRequiresAiConsent) {
    return { ok: false, code: 'ai_consent_missing', message: "No AI consent is on file for this client and the practice requires it. Record the client's AI Note Drafting consent first." };
  }
  if (input.engine === 'import' && input.recordingConsentRevoked) {
    return { ok: false, code: 'recording_consent_revoked', message: 'This client revoked consent to session recording and transcription, so the session transcript is not used. Document the session yourself.' };
  }
  if (input.chars < PASTE_MIN_CHARS) return { ok: false, code: 'too_short', message: `Enter at least ${PASTE_MIN_CHARS} characters of session text. Nothing was saved.` };
  if (input.chars > PASTE_MAX_CHARS) return { ok: false, code: 'too_long', message: `The text is longer than ${PASTE_MAX_CHARS.toLocaleString('en-US')} characters. Shorten it; nothing was saved.` };
  return { ok: true };
}

/** "Session:" line of the draft prompt; tells the model when the source is pasted text, not a live capture. */
export function draftSessionLabel(mode: string, engine: string | null | undefined, source?: string | null, language?: string | null): string {
  const base = draftSessionLabelBase(mode, engine, source);
  return language === 'es-US' ? `${base} (spoken in Spanish; write the note in English)` : base;
}

function draftSessionLabelBase(mode: string, engine: string | null | undefined, source?: string | null): string {
  if (source === 'recap') {
    return "clinician's dictated recap after the session (one speaker, the clinician's own account; not a verbatim transcript of the session). Draft the note as a recap-based note: attribute statements as reported by the clinician";
  }
  if (source === 'upload') return 'in person session (uploaded recording, Amazon Transcribe batch transcript with speaker labels)';
  const setting = `${mode.replace('_', ' ')} session`;
  if (engine === 'paste') {
    return mode === 'dictation'
      ? "clinician's own session summary (pasted text; one speaker, not a verbatim transcript)"
      : `${setting} (pasted transcript; speaker roles from the clinician's labels)`;
  }
  if (engine === 'import') return `${setting} (imported Transcribe Medical batch transcript)`;
  return setting;
}

/** Words a source label shows in the transcript pane header. */
export function transcriptSourceLabel(engine: string | null | undefined): string {
  if (engine === 'transcribe_batch') return 'Uploaded recording · AWS Transcribe';
  if (engine === 'transcribe_medical_batch') return 'Uploaded recording · AWS Transcribe Medical';
  if (engine === 'paste') return 'Pasted text';
  if (engine === 'import') return 'Imported telehealth transcript (Transcribe Medical)';
  if (engine === 'chime_transcribe_medical') return 'Chime · AWS Transcribe Medical';
  if (engine === 'chime_transcribe') return 'Chime · AWS Transcribe';
  if (engine === 'transcribe_streaming') return 'AWS Transcribe';
  return 'AWS Transcribe Medical';
}

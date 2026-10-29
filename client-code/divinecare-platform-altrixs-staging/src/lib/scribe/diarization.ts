/**
 * Speaker diarization → Clinician / Client / Other, and transcript lines for the UI and the model.
 * Pure, browser-safe.
 *
 * Raw speaker labels, by capture path:
 *   spk_0, spk_1 …        Transcribe Medical streaming speaker labels (in-person, one microphone)
 *   attendee:<id>         Chime live transcription: the meeting attendee who spoke (telehealth)
 *   ch_0, ch_1            channel identification (ch_0 = this device's microphone)
 *   dictation             clinician dictation, or the clinician's pasted session summary (one speaker)
 *   paste:clinician|client|other|unlabeled   pasted transcript with (or without) a speaker prefix (paste.ts)
 * Telehealth labels are exact (the attendee is known). Speaker labels from one microphone are a
 * guess: the default puts the speaker who asks the most questions as the clinician; the clinician
 * corrects any label in the transcript pane (overrides win and are stored on the session).
 */
import type { TranscribeResult } from './eventStream';

/** OTHER is split by the capture's consent participant list (guardian / family / interpreter / other). */
export const SPEAKER_ROLES = ['CLINICIAN', 'CLIENT', 'GUARDIAN', 'FAMILY', 'INTERPRETER', 'OTHER', 'UNKNOWN'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];
export const SPEAKER_LABEL: Record<SpeakerRole, string> = {
  CLINICIAN: 'Clinician',
  CLIENT: 'Client',
  GUARDIAN: 'Guardian',
  FAMILY: 'Family',
  INTERPRETER: 'Interpreter',
  OTHER: 'Other',
  UNKNOWN: 'Unknown',
};
/** How the model sees each speaker: interpreter turns are the client's statements as interpreted. */
export const MODEL_SPEAKER_LABEL: Record<SpeakerRole, string> = { ...SPEAKER_LABEL, INTERPRETER: 'Interpreter (client, as interpreted)' };

export type RawSegment = { speakerLabel: string; startMs: number; endMs: number; text: string };
export type StoredSegment = RawSegment & { seq: number };

const joinWords = (words: string[]) => words.join(' ').replace(/\s+([.,?!;:])/g, '$1').replace(/\s+/g, ' ').trim();

/**
 * Final Transcribe result → segments, split wherever the speaker changes. `offsetMs` is where this
 * stream started on the session clock (a resumed stream restarts its own clock at 0).
 */
export function segmentsFromTranscribeResult(result: TranscribeResult, offsetMs: number, kind: 'conversation' | 'dictation'): RawSegment[] {
  if (result.IsPartial) return [];
  const alt = result.Alternatives?.[0];
  const items = alt?.Items ?? [];
  const toMs = (s: number | undefined) => Math.max(0, Math.round((s ?? 0) * 1000) + offsetMs);
  const fallbackLabel = kind === 'dictation' ? 'dictation' : result.ChannelId ? `ch_${result.ChannelId.replace(/^ch_/, '')}` : 'spk_?';
  if (!items.length) {
    const text = (alt?.Transcript || '').trim();
    return text ? [{ speakerLabel: fallbackLabel, startMs: toMs(result.StartTime), endMs: toMs(result.EndTime), text }] : [];
  }
  const out: RawSegment[] = [];
  let cur: { label: string; start: number; end: number; words: string[] } | null = null;
  for (const it of items) {
    const word = (it.Content || '').trim();
    if (!word) continue;
    if (it.Type === 'punctuation') {
      cur?.words.push(word);
      continue;
    }
    const label = kind === 'dictation' ? 'dictation' : it.Speaker != null ? `spk_${it.Speaker}` : fallbackLabel;
    if (!cur || cur.label !== label) {
      if (cur) out.push({ speakerLabel: cur.label, startMs: toMs(cur.start), endMs: toMs(cur.end), text: joinWords(cur.words) });
      cur = { label, start: it.StartTime ?? result.StartTime ?? 0, end: it.EndTime ?? it.StartTime ?? 0, words: [] };
    }
    cur.words.push(word);
    cur.end = it.EndTime ?? cur.end;
  }
  if (cur) out.push({ speakerLabel: cur.label, startMs: toMs(cur.start), endMs: toMs(cur.end), text: joinWords(cur.words) });
  return out.filter((s) => s.text);
}

/** Chime live-transcription result (amazon-chime-sdk-js TranscriptResult, structurally). */
export type ChimeResultLike = {
  isPartial: boolean;
  startTimeMs: number;
  endTimeMs: number;
  alternatives: { transcript?: string; items?: { type?: string; content?: string; startTimeMs?: number; endTimeMs?: number; attendee?: { attendeeId?: string } }[] }[];
};

/** Final Chime transcript result → segments split by attendee. `sessionStartMs` = epoch ms when capture started. */
export function segmentsFromChimeResult(result: ChimeResultLike, sessionStartMs: number): RawSegment[] {
  if (result.isPartial) return [];
  const items = result.alternatives?.[0]?.items ?? [];
  const rel = (ms: number | undefined) => Math.max(0, Math.round((ms ?? result.startTimeMs) - sessionStartMs));
  const out: RawSegment[] = [];
  let cur: { label: string; start: number; end: number; words: string[] } | null = null;
  for (const it of items) {
    const word = (it.content || '').trim();
    if (!word) continue;
    if (it.type === 'punctuation') {
      cur?.words.push(word);
      continue;
    }
    const label = it.attendee?.attendeeId ? `attendee:${it.attendee.attendeeId}` : 'attendee:unknown';
    if (!cur || cur.label !== label) {
      if (cur) out.push({ speakerLabel: cur.label, startMs: rel(cur.start), endMs: rel(cur.end), text: joinWords(cur.words) });
      cur = { label, start: it.startTimeMs ?? result.startTimeMs, end: it.endTimeMs ?? result.endTimeMs, words: [] };
    }
    cur.words.push(word);
    cur.end = it.endTimeMs ?? cur.end;
  }
  if (cur) out.push({ speakerLabel: cur.label, startMs: rel(cur.start), endMs: rel(cur.end), text: joinWords(cur.words) });
  if (!out.length) {
    const text = (result.alternatives?.[0]?.transcript || '').trim();
    if (text) out.push({ speakerLabel: 'attendee:unknown', startMs: rel(result.startTimeMs), endMs: rel(result.endTimeMs), text });
  }
  return out.filter((s) => s.text);
}

export type SpeakerMapContext = {
  mode: 'in_person' | 'telehealth' | 'dictation';
  clinicianAttendeeId?: string | null;
  patientAttendeeId?: string | null;
  /** Recording-consent participants ({ role }): a third speaker takes the one non-client role listed */
  participants?: { role?: string | null }[] | null;
};

/** Default role per raw label (before the clinician's corrections). */
export function defaultSpeakerMap(segments: RawSegment[], ctx: SpeakerMapContext): Record<string, SpeakerRole> {
  const labels = [...new Set(segments.map((s) => s.speakerLabel))];
  const map: Record<string, SpeakerRole> = {};
  const spk: string[] = [];
  for (const l of labels) {
    if (l === 'dictation') map[l] = 'CLINICIAN';
    else if (l.startsWith('attendee:')) {
      const id = l.slice('attendee:'.length);
      map[l] = ctx.clinicianAttendeeId && id === ctx.clinicianAttendeeId ? 'CLINICIAN' : ctx.patientAttendeeId && id === ctx.patientAttendeeId ? 'CLIENT' : id === 'unknown' ? 'UNKNOWN' : 'OTHER';
    } else if (l === 'ch_0') map[l] = 'CLINICIAN';
    else if (l === 'ch_1') map[l] = 'CLIENT';
    else if (l === 'paste:clinician') map[l] = 'CLINICIAN';
    else if (l === 'paste:client') map[l] = 'CLIENT';
    else if (l === 'paste:other') map[l] = 'OTHER';
    else if (/^spk_\d+$/.test(l)) spk.push(l);
    else map[l] = 'UNKNOWN';
  }
  // Telehealth without the patient's attendee id: a single other attendee is the client
  if (!ctx.patientAttendeeId) {
    const others = labels.filter((l) => map[l] === 'OTHER' && l.startsWith('attendee:'));
    if (others.length === 1) map[others[0]] = 'CLIENT';
  }
  if (spk.length) {
    const stats = new Map(spk.map((l) => [l, { q: 0, words: 0 }]));
    for (const s of segments) {
      const st = stats.get(s.speakerLabel);
      if (!st) continue;
      st.q += (s.text.match(/\?/g) || []).length;
      st.words += s.text.split(/\s+/).filter(Boolean).length;
    }
    const byLabel = (a: string, b: string) => Number(a.slice(4)) - Number(b.slice(4));
    const sorted = [...spk].sort(byLabel);
    const asker = [...sorted].sort((a, b) => stats.get(b)!.q - stats.get(a)!.q)[0];
    const clinician = stats.get(asker)!.q > 0 ? asker : sorted[0];
    const rest = sorted.filter((l) => l !== clinician);
    const client = [...rest].sort((a, b) => stats.get(b)!.words - stats.get(a)!.words)[0];
    for (const l of sorted) map[l] = l === clinician ? 'CLINICIAN' : l === client ? 'CLIENT' : 'OTHER';
  }
  // OTHER → the participant role from the consent list, when exactly one non-client role was listed
  const third = participantRole(ctx.participants);
  if (third) for (const l of Object.keys(map)) if (map[l] === 'OTHER') map[l] = third;
  return map;
}

const PARTICIPANT_SPEAKER: Record<string, SpeakerRole> = { GUARDIAN: 'GUARDIAN', FAMILY: 'FAMILY', INTERPRETER: 'INTERPRETER' };

/** The single non-client participant role on the consent list (GUARDIAN / FAMILY / INTERPRETER), else null. */
export function participantRole(participants: { role?: string | null }[] | null | undefined): SpeakerRole | null {
  const roles = [...new Set((participants ?? []).map((p) => String(p?.role ?? '').toUpperCase()).filter((r) => r && r !== 'CLIENT' && r !== 'CLINICIAN'))];
  return roles.length === 1 ? PARTICIPANT_SPEAKER[roles[0]] ?? null : null;
}

/**
 * Speaker labels are a guess: one-microphone diarization (spk_*), unlabeled pasted text, or a
 * third speaker. The clinician confirms the roles before drafting (the draft route refuses until then).
 */
export function speakerLabelsInferred(labels: string[]): boolean {
  const distinct = [...new Set(labels.filter((l) => l !== 'dictation'))];
  if (distinct.some((l) => /^spk_/.test(l) || l === 'paste:unlabeled')) return true;
  return distinct.length >= 3;
}

/** Clinician corrections win; unknown roles in overrides are ignored. */
export function resolveSpeakerMap(defaults: Record<string, SpeakerRole>, overrides: unknown): Record<string, SpeakerRole> {
  const out = { ...defaults };
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if ((SPEAKER_ROLES as readonly unknown[]).includes(v)) out[k] = v as SpeakerRole;
    }
  }
  return out;
}

export type TranscriptLine = { id: string; seq: number; role: SpeakerRole; speakerLabel: string; startMs: number; endMs: number; text: string };

export function transcriptLines(segments: StoredSegment[], map: Record<string, SpeakerRole>): TranscriptLine[] {
  return [...segments]
    .sort((a, b) => a.seq - b.seq)
    .map((s, i) => ({ id: `t${i + 1}`, seq: s.seq, role: map[s.speakerLabel] ?? 'UNKNOWN', speakerLabel: s.speakerLabel, startMs: s.startMs, endMs: s.endMs, text: s.text }));
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "t3 [01:12] Client: …" — what the model sees and must cite by id. */
export function transcriptForModel(lines: TranscriptLine[]): string {
  return lines.map((l) => `${l.id} [${formatTimestamp(l.startMs)}] ${MODEL_SPEAKER_LABEL[l.role]}: ${l.text}`).join('\n');
}

/** Span of the capture in whole minutes (first start → last end), for the time-based CPT hint. */
export function capturedMinutes(lines: Pick<TranscriptLine, 'startMs' | 'endMs'>[]): number | null {
  if (!lines.length) return null;
  const start = Math.min(...lines.map((l) => l.startMs));
  const end = Math.max(...lines.map((l) => l.endMs));
  return end > start ? Math.floor((end - start) / 60000) : null;
}

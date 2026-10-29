/**
 * AI Scribe "Upload audio": a recording of a session made on another device (m4a, mp3 or wav, up
 * to 2 hours) is transcribed by Amazon Transcribe BATCH (standard or Medical, per the practice
 * engine setting; Spanish always standard) and the audio file is deleted as soon as the transcript
 * exists. Pure, browser-safe (the AWS calls are in uploadAws.ts).
 *
 * Flow:
 *   1. POST /api/scribe/captures {source:'upload', consent}  attestation that every person heard on
 *      the recording agreed to it being recorded (Maryland all-party consent), as for live capture
 *   2. POST /api/scribe/captures/[id]/upload {action:'presign'}  a presigned S3 PUT URL (15 minutes,
 *      SSE-KMS, private bucket SCRIBE_UPLOAD_BUCKET); the browser uploads the file straight to S3
 *   3. POST … {action:'transcribe'}  StartTranscriptionJob / StartMedicalTranscriptionJob with
 *      speaker labels; output JSON to the same bucket under scribe-transcripts/
 *   4. GET  … (poll)  when the job is COMPLETED the server reads the JSON, stores transcript turns as
 *      scribe_segments, then DELETES the audio object, the output JSON and the Transcribe job.
 *      A FAILED job deletes the audio too. The capture then drafts like any other.
 * The bucket also carries an S3 lifecycle rule (1 day) as a safety net for abandoned uploads.
 */
import type { RawSegment } from './diarization';

export const UPLOAD_MAX_SECONDS = 2 * 60 * 60;
/** 2 hours of 16-bit 48 kHz stereo WAV is ~1.4 GB; compressed m4a / mp3 are far smaller. */
export const UPLOAD_MAX_BYTES = 1_500 * 1024 * 1024;
export const UPLOAD_URL_EXPIRES_S = 15 * 60;

export const UPLOAD_FORMATS = {
  m4a: { mediaFormat: 'mp4', contentTypes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'] },
  mp3: { mediaFormat: 'mp3', contentTypes: ['audio/mpeg', 'audio/mp3'] },
  wav: { mediaFormat: 'wav', contentTypes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
} as const;
export type UploadExt = keyof typeof UPLOAD_FORMATS;
export const UPLOAD_ACCEPT = '.m4a,.mp3,.wav,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav';

/** Extension from the file name (content types differ between browsers). */
export function uploadExtension(fileName: string): UploadExt | null {
  const ext = fileName.trim().toLowerCase().split('.').pop() ?? '';
  return ext === 'm4a' || ext === 'mp3' || ext === 'wav' ? ext : null;
}

/** Content type sent with the PUT (part of the presigned signature). */
export function uploadContentType(ext: UploadExt): string {
  return UPLOAD_FORMATS[ext].contentTypes[0];
}

export type UploadCheck = { ok: true; ext: UploadExt } | { ok: false; code: string; message: string };

export function checkUpload(input: { fileName: string; bytes: number; durationSeconds?: number | null }): UploadCheck {
  const ext = uploadExtension(input.fileName);
  if (!ext) return { ok: false, code: 'upload_type', message: 'Upload an m4a, mp3 or wav audio file.' };
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) return { ok: false, code: 'upload_empty', message: 'The file is empty.' };
  if (input.bytes > UPLOAD_MAX_BYTES) return { ok: false, code: 'upload_too_large', message: 'The file is larger than 1.5 GB. Use a compressed format (m4a or mp3).' };
  if (input.durationSeconds != null && input.durationSeconds > UPLOAD_MAX_SECONDS) {
    return { ok: false, code: 'upload_too_long', message: 'The recording is longer than 2 hours. Upload a recording of one session (2 hours or less).' };
  }
  return { ok: true, ext };
}

/** S3 keys: never the client name, only ids. */
export function uploadObjectKey(organizationId: string, captureId: string, ext: UploadExt): string {
  return `scribe-uploads/${organizationId}/${captureId}.${ext}`;
}
export function transcriptOutputKey(organizationId: string, captureId: string): string {
  return `scribe-transcripts/${organizationId}/${captureId}.json`;
}
/** Transcribe job names: [0-9a-zA-Z._-]{1,200}, unique per account + Region. */
export function batchJobName(captureId: string, now = new Date()): string {
  return `altrixs-scribe-${captureId}-${now.getTime()}`.replace(/[^0-9A-Za-z._-]/g, '-').slice(0, 200);
}

/** Bucket for uploads (private, SSE-KMS, 1-day lifecycle); unset → upload is not configured. */
export function scribeUploadBucket(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.SCRIBE_UPLOAD_BUCKET || '').trim();
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v) ? v : null;
}
export function scribeUploadKmsKey(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.SCRIBE_UPLOAD_KMS_KEY_ID || '').trim();
  return v || null;
}

export type BatchEngine = 'standard' | 'medical';

/** StartTranscriptionJob / StartMedicalTranscriptionJob input (pure; exported for tests). */
export function batchJobInput(input: {
  engine: BatchEngine;
  language: 'en-US' | 'es-US';
  jobName: string;
  bucket: string;
  objectKey: string;
  outputKey: string;
  ext: UploadExt;
  vocabularyName?: string;
  kmsKeyId?: string | null;
}) {
  const media = { MediaFileUri: `s3://${input.bucket}/${input.objectKey}` };
  const mediaFormat = UPLOAD_FORMATS[input.ext].mediaFormat;
  const medical = input.engine === 'medical' && input.language === 'en-US';
  if (medical) {
    return {
      kind: 'medical' as const,
      params: {
        MedicalTranscriptionJobName: input.jobName,
        LanguageCode: 'en-US' as const,
        MediaFormat: mediaFormat,
        Media: media,
        Specialty: 'PRIMARYCARE' as const,
        Type: 'CONVERSATION' as const,
        OutputBucketName: input.bucket,
        OutputKey: input.outputKey,
        ...(input.kmsKeyId ? { OutputEncryptionKMSKeyId: input.kmsKeyId } : {}),
        Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 6 },
      },
    };
  }
  return {
    kind: 'standard' as const,
    params: {
      TranscriptionJobName: input.jobName,
      LanguageCode: input.language,
      MediaFormat: mediaFormat,
      Media: media,
      OutputBucketName: input.bucket,
      OutputKey: input.outputKey,
      ...(input.kmsKeyId ? { OutputEncryptionKMSKeyId: input.kmsKeyId } : {}),
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 6,
        ...(input.vocabularyName && input.language === 'en-US' ? { VocabularyName: input.vocabularyName } : {}),
      },
    },
  };
}

/** Engine recorded on scribe_captures.engine for an upload. */
export function uploadCaptureEngine(engine: BatchEngine, language: 'en-US' | 'es-US'): 'transcribe_batch' | 'transcribe_medical_batch' {
  return engine === 'medical' && language === 'en-US' ? 'transcribe_medical_batch' : 'transcribe_batch';
}

type BatchItem = {
  start_time?: string;
  end_time?: string;
  type?: string;
  speaker_label?: string;
  alternatives?: { content?: string }[];
};
export type BatchTranscriptJson = {
  results?: {
    transcripts?: { transcript?: string }[];
    speaker_labels?: { segments?: { speaker_label?: string; start_time?: string; end_time?: string; items?: { start_time?: string; speaker_label?: string }[] }[] };
    items?: BatchItem[];
  };
};

const PAUSE_SPLIT_MS = 2_000;
const MAX_TURN_CHARS = 600;

/**
 * Transcribe batch JSON → transcript turns (speaker spk_N, session-clock ms). A new turn starts when
 * the speaker changes, after a pause of 2 s or when a turn passes 600 characters (each turn is one
 * citation target). Without speaker labels everything is one speaker (spk_0).
 */
export function batchTranscriptToSegments(json: BatchTranscriptJson): RawSegment[] {
  const r = json.results;
  const items = r?.items ?? [];
  const spans = (r?.speaker_labels?.segments ?? []).map((s) => ({ label: s.speaker_label || 'spk_0', start: Number(s.start_time), end: Number(s.end_time) }));
  const speakerAt = (t: number, own?: string) => {
    if (own) return own;
    const hit = spans.find((s) => s.start <= t && t <= s.end);
    return hit?.label ?? 'spk_0';
  };
  const out: RawSegment[] = [];
  let cur: { label: string; start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.words.join(' ').replace(/\s+([.,?!;:])/g, '$1').replace(/\s+/g, ' ').trim();
    if (text) out.push({ speakerLabel: /^spk_\d+$/.test(cur.label) ? cur.label : `spk_${cur.label.replace(/\D/g, '') || '0'}`, startMs: Math.round(cur.start * 1000), endMs: Math.round(cur.end * 1000), text });
    cur = null;
  };
  for (const it of items) {
    const word = it.alternatives?.[0]?.content ?? '';
    if (!word) continue;
    if (it.type === 'punctuation' || it.start_time == null) {
      if (cur) cur.words.push(word);
      continue;
    }
    const start = Number(it.start_time);
    const end = Number(it.end_time ?? it.start_time);
    const label = speakerAt(start, it.speaker_label);
    const c: { label: string; start: number; end: number; words: string[] } | null = cur;
    const split = !c || c.label !== label || (start - c.end) * 1000 > PAUSE_SPLIT_MS || c.words.join(' ').length > MAX_TURN_CHARS;
    if (split) {
      flush();
      cur = { label, start, end, words: [word] };
    } else if (c) {
      c.words.push(word);
      c.end = end;
    }
  }
  flush();
  if (!out.length) {
    const full = (r?.transcripts ?? []).map((t) => t.transcript || '').join(' ').trim();
    if (full) out.push({ speakerLabel: 'spk_0', startMs: 0, endMs: 0, text: full.slice(0, 4000) });
  }
  return out;
}

/** Recording length in seconds from the turns (metering and the 2-hour check). */
export function transcriptSeconds(segments: RawSegment[]): number {
  return segments.length ? Math.ceil(Math.max(...segments.map((s) => s.endMs)) / 1000) : 0;
}

/** Upload attestation (shown with the per-participant checkboxes). */
export const UPLOAD_ATTESTATION =
  'Everyone who can be heard on this recording agreed to the session being recorded (Maryland all-party consent). The file is deleted as soon as it is transcribed.';

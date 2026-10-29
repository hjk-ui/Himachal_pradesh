/**
 * Reads a completed Transcribe Medical transcript for a telehealth session.
 * Only a real transcript is ever returned; any other state is reported as-is
 * (never replaced by a session summary or canned text).
 */
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { awsRegion, hasAwsRoleOrKeys } from '@/lib/aws/credentials';

export type SessionTranscriptResult =
  | { ok: true; lines: string[] }
  | { ok: false; status: 'NOT_AVAILABLE' | 'IN_PROGRESS' | 'ERROR'; message: string };

let s3: S3Client | null = null;

/** s3://bucket/key or https://bucket.s3[.region].amazonaws.com/key or https://s3[.region].amazonaws.com/bucket/key */
export function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const trimmed = uri.trim();
  const s3Match = trimmed.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (s3Match) return { bucket: s3Match[1], key: s3Match[2] };
  try {
    const url = new URL(trimmed);
    if (!url.hostname.endsWith('amazonaws.com')) return null;
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const virtual = url.hostname.match(/^(.+)\.s3[.-]/);
    if (virtual) return path ? { bucket: virtual[1], key: path } : null;
    const [bucket, ...rest] = path.split('/');
    return bucket && rest.length ? { bucket, key: rest.join('/') } : null;
  } catch {
    return null;
  }
}

type TranscribeItem = {
  start_time?: string;
  type?: string;
  alternatives?: { content?: string }[];
};
type TranscribeJson = {
  results?: {
    transcripts?: { transcript?: string }[];
    speaker_labels?: {
      segments?: { speaker_label?: string; start_time?: string; end_time?: string }[];
    };
    items?: TranscribeItem[];
  };
};

/** Speaker-turn lines when Transcribe returned speaker labels, otherwise the full transcript. */
export function transcribeJsonToLines(json: TranscribeJson): string[] {
  const results = json.results;
  const full = (results?.transcripts || []).map((t) => t.transcript || '').join(' ').trim();
  const segments = results?.speaker_labels?.segments || [];
  const items = results?.items || [];
  if (segments.length && items.length) {
    const lines: string[] = [];
    let prevSpeaker = '';
    let current: string[] = [];
    const flush = () => {
      const text = current.join(' ').replace(/\s+([.,?!])/g, '$1').trim();
      if (text) lines.push(`${prevSpeaker}: ${text}`);
      current = [];
    };
    for (const item of items) {
      const word = item.alternatives?.[0]?.content || '';
      if (!word) continue;
      if (item.type === 'punctuation' || !item.start_time) {
        current.push(word);
        continue;
      }
      const t = Number(item.start_time);
      const seg = segments.find((s) => Number(s.start_time) <= t && t <= Number(s.end_time));
      const speaker = seg?.speaker_label ? `Speaker ${seg.speaker_label.replace(/^spk_/, '')}` : prevSpeaker || 'Speaker';
      if (speaker !== prevSpeaker) {
        flush();
        prevSpeaker = speaker;
      }
      current.push(word);
    }
    flush();
    if (lines.length) return lines;
  }
  return full ? full.split(/(?<=[.!?])\s+/).filter(Boolean) : [];
}

export async function loadSessionTranscript(session: {
  transcriptionStatus: string | null;
  transcriptUri: string | null;
}): Promise<SessionTranscriptResult> {
  const status = (session.transcriptionStatus || '').toUpperCase();
  if (status !== 'COMPLETED' || !session.transcriptUri) {
    if (status === 'IN_PROGRESS') {
      return { ok: false, status: 'IN_PROGRESS', message: 'Transcription is still in progress for this session.' };
    }
    return {
      ok: false,
      status: 'NOT_AVAILABLE',
      message: 'No completed Transcribe Medical transcript exists for this session.',
    };
  }
  const loc = parseS3Uri(session.transcriptUri);
  if (!loc || !hasAwsRoleOrKeys()) {
    return {
      ok: false,
      status: 'ERROR',
      message: 'The transcript location is not readable from this server.',
    };
  }
  try {
    s3 ??= new S3Client({ region: awsRegion(), ...awsClientConfig() });
    const res = await s3.send(new GetObjectCommand({ Bucket: loc.bucket, Key: loc.key }));
    const text = (await res.Body?.transformToString('utf-8')) || '';
    const lines = transcribeJsonToLines(JSON.parse(text) as TranscribeJson);
    if (!lines.length) {
      return { ok: false, status: 'NOT_AVAILABLE', message: 'The transcript for this session is empty.' };
    }
    return { ok: true, lines };
  } catch (err) {
    console.error('[telehealth:transcript] read failed:', err instanceof Error ? err.name : 'unknown error');
    return { ok: false, status: 'ERROR', message: 'Could not read the transcript for this session.' };
  }
}

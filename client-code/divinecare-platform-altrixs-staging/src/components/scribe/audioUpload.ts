'use client';

/**
 * Browser side of "Upload audio" (src/lib/scribe/upload.ts): presign → PUT the file straight to S3
 * (never through our server) → start the Transcribe batch job → poll until the transcript exists.
 * The server deletes the audio file as soon as the transcript is stored.
 */
import type { TranscriptLine } from '@/lib/scribe/diarization';
import type { CaptureView } from './types';

export type UploadProgress = 'reading' | 'uploading' | 'transcribing' | 'done';

/** Duration from the file's metadata (null when the browser cannot read it). */
export function audioDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      const done = (v: number | null) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => done(null);
      a.src = url;
      setTimeout(() => done(null), 8000);
    } catch {
      resolve(null);
    }
  });
}

async function json<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export async function uploadAndTranscribe(
  captureId: string,
  file: File,
  onProgress: (p: UploadProgress) => void,
  opts: { pollMs?: number; timeoutMs?: number } = {}
): Promise<{ capture: CaptureView; lines: TranscriptLine[] }> {
  const base = `/api/scribe/captures/${encodeURIComponent(captureId)}/upload`;
  onProgress('reading');
  const durationSeconds = await audioDurationSeconds(file);
  const pre = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'presign', fileName: file.name, bytes: file.size, durationSeconds }),
  });
  const p = await json<{ upload?: { url: string; headers: Record<string, string> } }>(pre);
  if (!pre.ok || !p.upload) throw new Error(p.error || 'The upload could not be prepared.');
  onProgress('uploading');
  const put = await fetch(p.upload.url, { method: 'PUT', headers: p.upload.headers, body: file }).catch(() => null);
  if (!put?.ok) throw new Error('The file could not be uploaded to secure storage. Nothing was transcribed.');
  const start = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'transcribe' }) });
  const s = await json<object>(start);
  if (!start.ok) throw new Error(s.error || 'Transcription could not start.');
  onProgress('transcribing');
  const until = Date.now() + (opts.timeoutMs ?? 45 * 60_000);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 5000));
    const res = await fetch(base, { cache: 'no-store' });
    const d = await json<{ status?: string; capture?: CaptureView; lines?: TranscriptLine[] }>(res);
    if (!res.ok) throw new Error(d.error || 'Transcription failed.');
    if (d.status === 'COMPLETED' && d.capture) {
      onProgress('done');
      return { capture: d.capture, lines: d.lines ?? [] };
    }
  }
  throw new Error('Transcription is taking longer than expected. Reopen this capture later from AI Scribe.');
}

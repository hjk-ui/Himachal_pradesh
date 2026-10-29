'use client';

/**
 * "Upload audio" on the AI Scribe page: attestation that everyone heard on the recording agreed
 * (one checkbox per person), then the file (m4a / mp3 / wav, up to 2 hours) goes straight to S3,
 * Amazon Transcribe batch transcribes it, and the server deletes the file as soon as the transcript
 * exists. The capture then drafts like any other.
 */
import { useState } from 'react';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { PARTICIPANT_LABELS, PARTICIPANT_ROLES, type ParticipantRole } from '@/lib/scribe/consent';
import { defaultQuickParticipants, quickConsentInput, type QuickParticipant } from '@/lib/scribe/sessionStart';
import { UPLOAD_ACCEPT, UPLOAD_ATTESTATION } from '@/lib/scribe/upload';
import type { ScribeFormat } from '@/lib/scribe/settings';
import type { ScribeLanguage } from '@/lib/scribe/language';
import type { TranscriptLine } from '@/lib/scribe/diarization';
import { uploadAndTranscribe, type UploadProgress } from './audioUpload';
import type { CaptureView } from './types';

export function AudioUploadPanel({
  clientId,
  clientName,
  format,
  part2,
  language,
  appointmentId,
  minor,
  configured,
  onTranscribed,
}: {
  clientId: string;
  clientName: string;
  format: ScribeFormat;
  part2: boolean;
  language: ScribeLanguage;
  appointmentId: string | null;
  minor?: boolean;
  configured: boolean;
  onTranscribed: (capture: CaptureView, lines: TranscriptLine[]) => void;
}) {
  const [people, setPeople] = useState<QuickParticipant[]>(defaultQuickParticipants({ minor }));
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = people.length > 0 && people.every((p) => p.agreed);
  const setPerson = (i: number, patch: Partial<QuickParticipant>) => setPeople((l) => l.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const go = async () => {
    if (!file) return;
    setError(null);
    setStep('reading');
    try {
      const res = await fetch('/api/scribe/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, mode: 'in_person', source: 'upload', language, appointmentId, noteFormat: format, part2, consent: quickConsentInput(people) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The upload could not start');
      const out = await uploadAndTranscribe(data.capture.id, file, setStep);
      onTranscribed(out.capture, out.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed. Nothing was transcribed.');
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-700">{UPLOAD_ATTESTATION}</p>
      {people.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={p.agreed} onChange={(e) => setPerson(i, { agreed: e.target.checked })} />
            {p.role === 'CLIENT' ? clientName : p.label || PARTICIPANT_LABELS[p.role]} agreed to the recording
          </label>
          {i > 0 ? (
            <>
              <select value={p.role} onChange={(e) => setPerson(i, { role: e.target.value as ParticipantRole })} className="rounded border border-slate-200 px-1 py-0.5 text-xs" aria-label="Role">
                {PARTICIPANT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {PARTICIPANT_LABELS[r]}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Remove person" onClick={() => setPeople((l) => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600">
                <Trash2 size={13} aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setPeople((l) => [...l, { role: 'FAMILY', agreed: false }])} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
        <Plus size={12} aria-hidden /> Person
      </button>
      <input type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Audio file (m4a, mp3 or wav, up to 2 hours)" className="block text-sm" />
      {!configured ? <p className="text-sm text-amber-800">Audio upload is not configured on this server (AWS bucket). Nothing can be uploaded.</p> : null}
      {error ? <p className="text-sm text-amber-800">{error}</p> : null}
      <button
        type="button"
        disabled={!configured || !file || !all || Boolean(step)}
        onClick={() => void go()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-40"
      >
        {step ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
        {step === 'uploading' ? 'Uploading…' : step === 'transcribing' ? 'Transcribing… (the file is deleted when done)' : step ? 'Preparing…' : 'Upload and transcribe'}
      </button>
    </div>
  );
}

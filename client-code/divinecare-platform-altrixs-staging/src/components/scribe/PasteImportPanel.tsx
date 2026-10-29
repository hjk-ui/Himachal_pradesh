'use client';

/**
 * AI Scribe "Paste or import" capture: a pasted transcript / the clinician's own session summary, or
 * a completed telehealth batch transcript. The text becomes a capture with transcript lines that go
 * through the same grounded draft and review as live capture. No audio, so no recording-consent
 * attestation; the client's AI consent is checked on the server.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, FileInput, Loader2 } from 'lucide-react';
import { PASTE_MAX_CHARS, PASTE_MIN_CHARS, parsePastedText, type PasteKind } from '@/lib/scribe/paste';
import type { CaptureMode } from '@/lib/scribe/consent';
import type { ScribeFormat } from '@/lib/scribe/settings';
import type { TranscriptLine } from '@/lib/scribe/diarization';
import type { CaptureView } from './types';

type Source = 'paste' | 'import';

export function PasteImportPanel({
  clientId,
  format,
  part2,
  appointmentId,
  onCreated,
}: {
  clientId: string;
  format: ScribeFormat;
  part2: boolean;
  appointmentId: string | null;
  onCreated: (capture: CaptureView, lines: TranscriptLine[]) => void;
}) {
  const [source, setSource] = useState<Source>('paste');
  const [kind, setKind] = useState<PasteKind>('transcript');
  const [setting, setSetting] = useState<Exclude<CaptureMode, 'dictation'>>('in_person');
  const [parseSpeakers, setParseSpeakers] = useState(true);
  const [text, setText] = useState('');
  const [sessions, setSessions] = useState<{ id: string; at: string }[] | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'import' || !clientId) return;
    let cancelled = false;
    setSessions(null);
    fetch(`/api/scribe/captures/import?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d?.sessions) ? d.sessions : [];
        setSessions(list);
        setSessionId(list[0]?.id ?? '');
      })
      .catch(() => !cancelled && setSessions([]));
    return () => {
      cancelled = true;
    };
  }, [source, clientId]);

  const preview = useMemo(
    () => (text.trim() ? parsePastedText(text.trim(), { kind, parseSpeakers: kind === 'transcript' && parseSpeakers }) : null),
    [text, kind, parseSpeakers]
  );
  const chars = text.trim().length;
  const tooShort = chars < PASTE_MIN_CHARS;
  const tooLong = text.length > PASTE_MAX_CHARS;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload =
        source === 'paste'
          ? { source, clientId, kind, text: text.trim(), parseSpeakers, setting, appointmentId, noteFormat: format, part2 }
          : { source, clientId, telehealthSessionId: sessionId, noteFormat: format, part2 };
      const res = await fetch('/api/scribe/captures/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The text could not be loaded. Nothing was saved.');
      setText('');
      onCreated(data.capture, data.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The text could not be loaded. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  const tab = (id: Source, label: string, Icon: typeof FileInput) => (
    <button
      type="button"
      onClick={() => setSource(id)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${source === id ? 'bg-[#5C2D91] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap gap-2">
        {tab('paste', 'Paste text', ClipboardPaste)}
        {tab('import', 'Import telehealth transcript', FileInput)}
      </div>
      <p className="text-xs text-slate-500">
        No audio is recorded, so no recording consent is needed. The client&apos;s AI consent still applies. The text is stored with the capture and deleted on the same schedule as live transcripts. Every drafted sentence cites a line of it.
      </p>

      {source === 'paste' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={kind === 'transcript'} onChange={() => setKind('transcript')} /> Session transcript
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={kind === 'summary'} onChange={() => setKind('summary')} /> My own session summary
            </label>
          </div>
          {kind === 'transcript' && (
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                Session was
                <select value={setting} onChange={(e) => setSetting(e.target.value as 'in_person' | 'telehealth')} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                  <option value="in_person">In person</option>
                  <option value="telehealth">Telehealth</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={parseSpeakers} onChange={(e) => setParseSpeakers(e.target.checked)} /> Read speaker labels (Clinician:, Client:, T:, C:)
              </label>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            aria-label="Session text"
            placeholder={kind === 'transcript' ? 'Clinician: How has your sleep been this week?\nClient: Better. I slept about six hours most nights.' : 'Client reported improved sleep this week and practiced the breathing exercise daily…'}
            className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {preview
                ? `${preview.segments.length} line${preview.segments.length === 1 ? '' : 's'}${kind === 'transcript' && parseSpeakers ? ` · ${preview.labeledTurns} labeled turn${preview.labeledTurns === 1 ? '' : 's'}` : ''}`
                : 'Nothing pasted yet'}
            </span>
            <span className={tooLong ? 'font-semibold text-rose-700' : ''}>
              {text.length.toLocaleString('en-US')} / {PASTE_MAX_CHARS.toLocaleString('en-US')} characters
            </span>
          </div>
          <button
            type="button"
            disabled={busy || !clientId || tooShort || tooLong}
            onClick={() => void submit()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5C2D91] py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardPaste size={16} />} Load text for drafting
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions === null ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Looking for completed telehealth transcripts…
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-600">No completed Transcribe Medical transcript exists for this client&apos;s telehealth sessions. Paste the text instead.</p>
          ) : (
            <label className="block text-xs font-semibold text-slate-600">
              Telehealth session
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.at).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={busy || !sessionId}
            onClick={() => void submit()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5C2D91] py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileInput size={16} />} Import transcript
          </button>
        </div>
      )}
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

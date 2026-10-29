'use client';

/**
 * AI Scribe docked in the note editor ("Start session"). Everything for the visit in one panel:
 *  - the pre-session brief, collapsed at the top
 *  - the format, pre-selected from the open note's type (the Visit Guide picked it)
 *  - consent inline: the AI Note Drafting status, and one checkbox per participant for the
 *    recording attestation (Maryland all-party consent; the server validates it as before)
 *  - language (English / Spanish) and the capture source: Record session · Upload audio · Dictate a recap
 *  - one click to record; Stop drafts the note and fills the sections in place (grounded, each AI
 *    section marked until the clinician accepts it; risk / diagnosis sections are never written)
 * The capture is linked to the note once the editor has saved it (delete-on-sign follows the note).
 * ?capture=<id> on the notes page opens an existing capture (e.g. the telehealth recording made in
 * the call): the dock shows its transcript and drafts in place; it never starts a new recording.
 * Inferred speaker labels (one microphone / a third speaker) are confirmed here before drafting.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, ChevronDown, Loader2, Mic, Plus, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { RecordingBar } from './RecordingBar';
import { RecordingStatusBar } from './RecordingStatusBar';
import { PreSessionPanel } from './PreSessionPanel';
import { AiConsentInline } from './AiConsentInline';
import { DismissScribe } from './DismissScribe';
import { TranscriptPane } from './TranscriptPane';
import { useTranscribeStream, controlCapture } from './useTranscribeStream';
import { uploadAndTranscribe, type UploadProgress } from './audioUpload';
import type { CaptureView, DraftContent, DraftView, ScribeContextResponse } from './types';
import { DraftSuggestions } from './DraftSuggestions';
import type { DraftSuggestion } from '@/lib/scribe/suggestions';
import { SCRIBE_FORMAT_LABELS, type ScribeFormat } from '@/lib/scribe/settings';
import { defaultScribeFormat } from '@/lib/scribe/formatCatalog';
import { composeBody, formatSpec } from '@/lib/scribe/templateFields';
import { RECORDING_CONSENT_SCRIPT, PARTICIPANT_LABELS, PARTICIPANT_ROLES, type ParticipantRole } from '@/lib/scribe/consent';
import { SCRIBE_LANGUAGES, SCRIBE_LANGUAGE_LABELS, type ScribeLanguage } from '@/lib/scribe/language';
import {
  DOCK_SOURCES,
  DOCK_SOURCE_LABELS,
  RECAP_MAX_SECONDS,
  defaultQuickParticipants,
  inlineConsentState,
  quickConsentInput,
  recapConsentInput,
  type DockSource,
  type QuickParticipant,
} from '@/lib/scribe/sessionStart';
import { UPLOAD_ACCEPT, UPLOAD_ATTESTATION } from '@/lib/scribe/upload';
import { defaultSpeakerMap, resolveSpeakerMap, transcriptLines, type SpeakerRole, type StoredSegment, type TranscriptLine } from '@/lib/scribe/diarization';
import { transcriptSourceLabel } from '@/lib/scribe/paste';
import type { DismissReason } from '@/lib/scribe/dismiss';

export type ScribeFill = {
  /** Draft note body in the note type's own section layout (heading line, text) */
  body: string;
  format: ScribeFormat;
  captureId: string;
  part2: boolean;
  withheld: number;
  minutes: number | null;
  /** Transcript lines (speaker roles) for the Identifying Information suggestions (chief complaint quote, who came along) */
  lines?: TranscriptLine[];
};

/** review = a transcript exists (opened capture, or speaker labels to confirm): draft in place, no recording */
type Phase = 'ready' | 'capturing' | 'uploading' | 'drafting' | 'review' | 'filled';

export function ScribeDock({
  clientId,
  clientName,
  appointmentId,
  noteType,
  noteId,
  telehealth,
  onFill,
  onInsertSuggestion,
  onClose,
  captureId,
}: {
  clientId: string;
  clientName: string;
  appointmentId: string | null;
  /** The editor's note type (format follows it) */
  noteType: string;
  /** Saved note id (after the first autosave) — the capture is linked to it */
  noteId: string | null;
  telehealth: boolean;
  onFill: (fill: ScribeFill) => void;
  /** Insert a withheld AI suggestion the clinician accepted into its section */
  onInsertSuggestion?: (s: DraftSuggestion) => void;
  onClose: () => void;
  /** Existing capture to open (notes page ?capture=): shown and drafted in place, never re-recorded */
  captureId?: string | null;
}) {
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [ctx, setCtx] = useState<ScribeContextResponse | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [source, setSource] = useState<DockSource>('live');
  const [language, setLanguage] = useState<ScribeLanguage>('en-US');
  const [people, setPeople] = useState<QuickParticipant[]>(defaultQuickParticipants());
  const [capture, setCapture] = useState<CaptureView | null>(null);
  const [segments, setSegments] = useState<StoredSegment[]>([]);
  const [serverLines, setServerLines] = useState<TranscriptLine[] | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadProgress | null>(null);
  const [linked, setLinked] = useState(false);
  /** The draft route refused: speaker labels are a guess and must be confirmed first */
  const [needSpeakers, setNeedSpeakers] = useState(false);
  const [speakersOk, setSpeakersOk] = useState(false);
  /** Drafting from the review step (opened capture / speaker confirm): no recording bar */
  const [reviewing, setReviewing] = useState(false);
  /** Last draft: withheld suggestions and the measures plan stay offered after the fill */
  const [lastDraft, setLastDraft] = useState<DraftContent | null>(null);

  const kind = source === 'recap' ? 'dictation' : 'conversation';
  const stream = useTranscribeStream({ captureId: capture?.id ?? null, kind, persist: true, onSegments: (s) => setSegments((prev) => [...prev, ...s]) });

  const loadContext = useCallback(async () => {
    setCtxError(null);
    try {
      const res = await fetch(`/api/scribe/context?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load AI Scribe for this client');
      setCtx(data);
      if (data.language === 'es-US') setLanguage('es-US');
      if (data.context?.minor) setPeople(defaultQuickParticipants({ minor: true }));
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : 'Could not load AI Scribe for this client');
    }
  }, [clientId]);
  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  // Open an existing capture (telehealth recording made in the call): show it, draft in place
  useEffect(() => {
    if (!captureId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/scribe/captures/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'The AI Scribe capture could not be opened');
        if (cancelled) return;
        const cap = data.capture as CaptureView;
        if (cap.clientId !== clientId) throw new Error('That AI Scribe capture belongs to a different client.');
        const capLines = (data.lines ?? []) as TranscriptLine[];
        setCapture(cap);
        setServerLines(capLines);
        setSegments([]);
        if (cap.progressNoteId && noteId && cap.progressNoteId === noteId) setLinked(true);
        if (capLines.length >= 2) {
          setReviewing(true);
          setNeedSpeakers(Boolean(data.speakersInferred));
          setPhase('review');
        }
        else setInfo('This capture has no transcript yet. Nothing was drafted.');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The AI Scribe capture could not be opened');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId, clientId]);

  // Format follows the note open in the editor (Visit Guide note type), then the clinician / practice defaults
  const format = useMemo(
    () =>
      defaultScribeFormat({ role, noteType, preferred: ctx?.preferences.defaultFormat ?? null, practiceDefault: ctx?.settings.defaultFormat ?? null }).format,
    [role, noteType, ctx]
  );
  const spec = formatSpec(format);
  const unsupported = spec.kind === 'plan' || /^(group|no-show)$/i.test(noteType);

  // Link the capture to the note once the editor saved it
  useEffect(() => {
    if (!capture || !noteId || linked || phase !== 'filled') return;
    let cancelled = false;
    void fetch(`/api/scribe/captures/${encodeURIComponent(capture.id)}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId }) })
      .then((r) => {
        if (!cancelled && r.ok) setLinked(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [capture, noteId, linked, phase]);

  const consent = ctx
    ? inlineConsentState({
        aiConsent: ctx.consent.ai,
        practiceRequiresAiConsent: ctx.consent.practiceRequiresAiConsent,
        recordingRevoked: source !== 'recap' && Boolean(ctx.consent.recordingRevoked),
        scribeEnabled: ctx.settings.enabled,
        entitled: ctx.configured.entitled,
      })
    : null;
  const allAgreed = people.length > 0 && people.every((p) => p.agreed);
  const liveOnTelehealth = source === 'live' && telehealth;

  const createCapture = async (): Promise<CaptureView> => {
    const res = await fetch('/api/scribe/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        mode: source === 'recap' ? 'dictation' : 'in_person',
        source,
        language,
        appointmentId,
        noteFormat: format,
        part2: Boolean(ctx?.part2),
        consent: source === 'recap' ? recapConsentInput() : quickConsentInput(people),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Capture could not start');
    return data.capture as CaptureView;
  };

  const draftAndFill = async (cap: CaptureView, opts: { speakersConfirmed?: boolean } = {}) => {
    setPhase('drafting');
    setError(null);
    try {
      const res = await fetch(`/api/scribe/captures/${encodeURIComponent(cap.id)}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, ...(opts.speakersConfirmed ? { speakersConfirmed: true } : {}) }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'SPEAKERS_UNCONFIRMED') {
        // Speaker labels are a guess: confirm (and correct) them, then draft
        const fresh = await fetch(`/api/scribe/captures/${encodeURIComponent(cap.id)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
        if (fresh?.lines) setServerLines(fresh.lines);
        setSegments([]);
        setCapture(cap);
        setNeedSpeakers(true);
        setSpeakersOk(false);
        setReviewing(true);
        setPhase('review');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'AI drafting failed. Nothing was generated.');
      setNeedSpeakers(false);
      const draft = data.draft as DraftView;
      setLastDraft(draft.content);
      setServerLines(data.lines);
      setSegments([]);
      onFill({
        body: composeBody(formatSpec(draft.format), draft.content.texts),
        format: draft.format,
        captureId: cap.id,
        part2: cap.part2,
        withheld: draft.content.withheld.length,
        minutes: draft.content.coding.minutes,
        lines: Array.isArray(data.lines) ? (data.lines as TranscriptLine[]) : undefined,
      });
      setInfo(
        `Draft placed in the note: ${draft.content.provenance.length} grounded item(s)${draft.content.withheld.length ? `, ${draft.content.withheld.length} withheld (not supported by the transcript)` : ''}. Review each AI section and Accept it; risk, diagnosis and medication-change sections are yours.${
          draft.content.qualityWarning ? ` ${draft.content.qualityWarning}` : ''
        }${(draft.content.stigma?.length ?? 0) + (draft.content.minimumNecessary?.length ?? 0) ? ` ${(draft.content.stigma?.length ?? 0) + (draft.content.minimumNecessary?.length ?? 0)} sentence(s) to check for wording or minimum necessary (stigmatizing terms, long quotes, names, sensitive detail).` : ''}${
          draft.content.risk.findings.length ? ' Risk language was heard: document the C-SSRS / risk level / safety plan (or the risk attestation) before signing.' : ''
        }`
      );
      setPhase('filled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI drafting failed. Nothing was generated.');
      setPhase(serverLines?.length || cap.source === 'upload' || captureId ? 'review' : 'capturing');
    }
  };

  /** Correct a speaker's role (stored on the capture; the transcript comes back relabeled) */
  const relabel = async (speakerLabel: string, role: SpeakerRole) => {
    if (!capture) return;
    const res = await fetch(`/api/scribe/captures/${encodeURIComponent(capture.id)}/segments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speakerLabel, role }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (data?.lines) setServerLines(data.lines);
    }
  };

  const record = async () => {
    setError(null);
    try {
      const cap = await createCapture();
      setCapture(cap);
      setSegments([]);
      setServerLines(null);
      setPhase('capturing');
      await stream.start(cap.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture could not start');
    }
  };

  const stopAndDraft = async () => {
    if (!capture) return;
    await stream.stop();
    await stream.flush();
    await draftAndFill(capture);
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setPhase('uploading');
    try {
      const cap = await createCapture();
      setCapture(cap);
      const res = await uploadAndTranscribe(cap.id, file, setUploadStep);
      setCapture(res.capture);
      setServerLines(res.lines);
      await draftAndFill(res.capture);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed. Nothing was transcribed.');
      setPhase('ready');
    } finally {
      setUploadStep(null);
    }
  };

  const dismiss = async (reason?: DismissReason) => {
    if (!capture) return;
    const unreported = stream.discard();
    const res = await controlCapture(capture.id, 'dismiss', unreported, { reason });
    if (!res.success) {
      setError(res.error || 'The capture could not be dismissed. Try again.');
      return;
    }
    setCapture(null);
    setSegments([]);
    setServerLines(null);
    setPhase('ready');
    setInfo('AI Scribe dismissed: nothing from the recording was kept.');
  };

  const withdraw = async () => {
    if (!capture || !window.confirm('A participant withdrew consent. Stop now and delete everything captured?')) return;
    await stream.stop();
    await controlCapture(capture.id, 'withdraw');
    setCapture(null);
    setSegments([]);
    setServerLines(null);
    setPhase('ready');
    setError('Consent withdrawn: capture stopped and the transcript was deleted. Document the session yourself.');
  };

  const lines = useMemo(() => {
    if (serverLines && !segments.length) return serverLines;
    const defaults = defaultSpeakerMap(segments, { mode: source === 'recap' ? 'dictation' : 'in_person' });
    return transcriptLines(segments, resolveSpeakerMap(defaults, null));
  }, [segments, serverLines, source]);

  const setPerson = (i: number, patch: Partial<QuickParticipant>) => setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const busy = phase === 'drafting' || phase === 'uploading';
  const canStart = Boolean(ctx) && consent?.kind === 'ready' && !unsupported && (source === 'recap' || allAgreed);

  return (
    <section aria-label="AI Scribe" className="rounded-xl border border-[#DDD6FE] bg-[#FBFAFF] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#4A2475]">
          <Bot size={16} aria-hidden /> AI Scribe
          <span className="font-normal text-slate-500">· {SCRIBE_FORMAT_LABELS[format]}</span>
        </h3>
        {phase === 'ready' || phase === 'filled' ? (
          <button type="button" onClick={onClose} aria-label="Close AI Scribe" className="text-slate-500 hover:text-slate-700">
            <X size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      <details className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-slate-700">
          <ChevronDown size={14} aria-hidden /> Pre-session brief
        </summary>
        <div className="mt-2">
          <PreSessionPanel clientId={clientId} data={ctx} />
        </div>
      </details>

      {ctxError ? <p className="mt-2 text-sm text-rose-700">{ctxError}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {info ? <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{info}</p> : null}
      {unsupported ? <p className="mt-2 text-sm text-slate-600">AI Scribe does not draft this note type. Write it yourself or change the note type.</p> : null}

      {phase === 'ready' && ctx && !unsupported ? (
        <div className="mt-3 space-y-3">
          {consent?.kind === 'ai_missing' ? (
            <AiConsentInline clientId={clientId} clientName={clientName} onRecorded={() => void loadContext()} />
          ) : consent?.kind === 'blocked' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{consent.reason}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Capture">
            {DOCK_SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${source === s ? 'border-[#5C2D91] bg-[#5C2D91] text-white' : 'border-slate-200 bg-white text-slate-700'}`}
              >
                {DOCK_SOURCE_LABELS[s]}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value as ScribeLanguage)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" aria-label="Session language">
                {SCRIBE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {SCRIBE_LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {language === 'es-US' ? <p className="text-xs text-slate-500">The note is drafted in English; the client summary follows the client&apos;s preferred language.</p> : null}

          {liveOnTelehealth ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              Telehealth visit: start <strong>AI Scribe</strong> inside the video call (everyone in the call sees it), then review the draft from AI Scribe. You can also upload a recording or dictate a recap here.
            </p>
          ) : source === 'recap' ? (
            <p className="text-xs text-slate-600">Only your voice: summarize the session in your own words (up to {RECAP_MAX_SECONDS / 60} minutes). The note is drafted from your recap.</p>
          ) : consent?.kind === 'ready' ? (
            <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">{source === 'upload' ? 'Everyone heard on the recording agreed' : 'Recording consent (read the script, tick each person who agreed)'}</legend>
              {source === 'live' ? (
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold">Consent script</summary>
                  <p className="mt-1">{RECORDING_CONSENT_SCRIPT}</p>
                </details>
              ) : (
                <p className="text-xs text-slate-600">{UPLOAD_ATTESTATION}</p>
              )}
              {people.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4" checked={p.agreed} onChange={(e) => setPerson(i, { agreed: e.target.checked })} />
                    <span>{p.role === 'CLIENT' ? clientName : p.label || PARTICIPANT_LABELS[p.role]} agreed</span>
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
              <button type="button" onClick={() => setPeople((l) => [...l, { role: 'FAMILY', agreed: false }])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91]">
                <Plus size={12} aria-hidden /> Person
              </button>
            </fieldset>
          ) : null}

          {source === 'upload' && consent?.kind === 'ready' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Audio file (m4a, mp3 or wav, up to 2 hours)" />
              {ctx.configured.upload === false ? <span className="text-xs text-amber-800">Audio upload is not configured on this server.</span> : null}
            </div>
          ) : null}

          {!liveOnTelehealth ? (
            <button
              type="button"
              disabled={!canStart || busy || (source === 'upload' && (!file || ctx.configured.upload === false)) || (source !== 'upload' && !ctx.configured.streaming)}
              onClick={() => void (source === 'upload' ? upload() : record())}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5C2D91] py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {source === 'upload' ? <Upload size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
              {source === 'upload' ? 'Upload and draft' : source === 'recap' ? 'Start recap' : 'Record'}
            </button>
          ) : null}
          {source !== 'upload' && !ctx.configured.streaming ? <p className="text-xs text-amber-800">AWS Transcribe is not configured on this server, so recording is unavailable. Nothing will be captured.</p> : null}
        </div>
      ) : null}

      {phase === 'uploading' ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          {uploadStep === 'uploading' ? 'Uploading to secure storage…' : uploadStep === 'transcribing' ? 'Transcribing (the audio file is deleted as soon as the transcript exists)…' : 'Preparing…'}
        </p>
      ) : null}

      {phase === 'capturing' && capture && capture.source !== 'upload' ? (
        <RecordingStatusBar
          state={stream.state}
          elapsedSeconds={stream.elapsed}
          monitor={stream.monitor}
          onPause={() => void stream.pause()}
          onResume={() => void stream.resume()}
          onStop={() => void stopAndDraft()}
        />
      ) : null}
      {(phase === 'capturing' || (phase === 'drafting' && !reviewing)) && capture ? (
        <div className="mt-3 space-y-2">
          {capture.source !== 'upload' ? (
            <RecordingBar
              state={stream.state}
              level={stream.level}
              elapsedSeconds={stream.elapsed}
              engineLabel={`${transcriptSourceLabel(capture.engine).replace(/^AWS /, '')} · ${SCRIBE_LANGUAGE_LABELS[(capture.language as ScribeLanguage) ?? 'en-US'] ?? 'English'}`}
              onPause={() => void stream.pause()}
              onResume={() => void stream.resume()}
              onStop={() => void stopAndDraft()}
              onWithdraw={() => void withdraw()}
              onDismiss={(reason) => dismiss(reason)}
            />
          ) : (
            <div className="flex justify-end">
              <DismissScribe onConfirm={(reason) => dismiss(reason)} />
            </div>
          )}
          {stream.error || stream.saveError ? <p className="text-sm text-amber-800">{stream.error || stream.saveError}</p> : null}
          {phase === 'drafting' ? (
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Drafting the note from the transcript…
            </p>
          ) : (
            <button type="button" disabled={lines.length < 2} onClick={() => void stopAndDraft()} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              <Bot size={15} aria-hidden /> Stop &amp; draft the note
            </button>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">Transcript ({lines.length} lines)</summary>
            <TranscriptPane lines={lines} partial={stream.partial} editable={false} engine={capture.engine} gaps={stream.gaps.length ? stream.gaps : capture.recordingGaps} />
          </details>
        </div>
      ) : null}

      {phase === 'review' && capture ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-700">
            {capture.mode === 'telehealth' ? 'Transcript from the video visit' : 'Transcript'} ({lines.length} lines). Draft the note here: it fills this note&apos;s sections with the same rules (grounded, each AI section marked until you accept it).
          </p>
          {needSpeakers ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Speaker labels are a guess — confirm</p>
              <p className="text-xs">One microphone (or a third speaker) means the clinician / client labels were inferred. Check each speaker below and correct it; risk screens use only what the client said.</p>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" className="h-4 w-4" checked={speakersOk} onChange={(e) => setSpeakersOk(e.target.checked)} /> I checked the speaker labels
              </label>
            </div>
          ) : null}
          <TranscriptPane lines={lines} editable={needSpeakers} follow={false} engine={capture.engine} gaps={stream.gaps.length ? stream.gaps : capture.recordingGaps} onRelabel={(l, r) => void relabel(l, r)} />
          <button
            type="button"
            disabled={lines.length < 2 || (needSpeakers && !speakersOk) || unsupported}
            onClick={() => void draftAndFill(capture, { speakersConfirmed: needSpeakers && speakersOk })}
            className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            <Bot size={15} aria-hidden /> Draft the note
          </button>
        </div>
      ) : null}

      {phase === 'drafting' && reviewing ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Drafting the note from the transcript…
        </p>
      ) : null}

      {phase === 'filled' && lastDraft ? (
        <div className="mt-3">
          <DraftSuggestions content={lastDraft} clientId={clientId} onInsert={onInsertSuggestion} />
        </div>
      ) : null}
      {phase === 'filled' ? (
        <p className="mt-2 text-xs text-slate-500">
          {linked ? 'Linked to this note.' : 'Linking to this note when it saves.'}{' '}
          {ctx?.settings.deleteTranscriptOnSign ? 'The transcript is deleted when you sign the note.' : `The transcript is deleted ${ctx?.settings.transcriptRetentionDays ?? 30} days after you sign.`}
        </p>
      ) : null}
    </section>
  );
}

'use client';

/**
 * AI Scribe. In-person sessions and dictation stream the microphone to AWS Transcribe (standard or Medical, per the practice setting)
 * (presigned WebSocket, under the practice BAA); telehealth sessions are captured inside the call
 * (Chime live transcription with Amazon Transcribe) and reviewed here (?capture=<id>).
 * The browser Web Speech API is never used: in Chrome it sends audio to Google (no BAA).
 *
 * Flow: client + mode + format → pre-session panel → recording consent attestation (Maryland
 * all-party consent) → capture with a visible Recording bar, pause / resume / stop, live transcript
 * and optional cues → grounded AI draft → review (citations, plan linkage, coding, follow-ups,
 * client summary) → "Create draft note" (unsigned) → sign in Notes.
 *
 * Paste or import (?mode=paste): a pasted transcript / the clinician's own summary, or a completed
 * telehealth batch transcript, becomes a capture (engine "paste" / "import") and goes through the
 * same grounded draft and review. No audio, so no recording-consent attestation; AI consent applies.
 * This replaces the retired AI Session Notes page (/dashboard/ehr/session-ai redirects here).
 * Nothing is signed from this page: notes are signed only in Notes, with attestation.
 *
 * Also: "Upload audio" (a recording made elsewhere; Transcribe batch, file deleted once transcribed),
 * "Dictate a recap" (the clinician's own post-session recap, drafted as a recap-based note) and the
 * session language (English / Spanish; the note is always drafted in English). The fastest path is
 * "Start session" on an appointment, which docks this scribe inside the note editor (ScribeDock).
 *
 * Note format: every note template the EHR uses (formatCatalog.ts). The default follows the visit
 * (the appointment's Visit Guide note type, or ?noteType= from an open note), then the clinician's
 * default, then the role's usual template; the picker lists the role's templates first and the rest
 * under "More templates". While capturing, "Template cues" lists the template's sections and the
 * Visit Guide's in-session steps (display only). "Dismiss scribe" stops and discards the capture
 * (during the session, or after it until a draft note exists): nothing from it is kept.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, ClipboardPaste, Info, Loader2, Mic, NotebookPen, Settings, Stethoscope, Upload, Video } from 'lucide-react';
import { AudioUploadPanel } from '@/components/scribe/AudioUploadPanel';
import { SCRIBE_LANGUAGES, SCRIBE_LANGUAGE_LABELS, type ScribeLanguage } from '@/lib/scribe/language';
import { useClients } from '@/features/clients/hooks/useClients';
import { ConsentGate } from '@/components/scribe/ConsentGate';
import { RecordingBar } from '@/components/scribe/RecordingBar';
import { RecordingStatusBar } from '@/components/scribe/RecordingStatusBar';
import { TranscriptPane } from '@/components/scribe/TranscriptPane';
import { LiveCues, PreSessionPanel } from '@/components/scribe/PreSessionPanel';
import { VisitGuidePanel } from '@/components/visits/VisitGuidePanel';
import { DraftReview } from '@/components/scribe/DraftReview';
import { ScribeSettingsCard } from '@/components/scribe/ScribeSettingsCard';
import { useTranscribeStream, controlCapture } from '@/components/scribe/useTranscribeStream';
import type { CaptureView, DraftView, ScribeContextResponse } from '@/components/scribe/types';
import { SCRIBE_FORMAT_LABELS, type ScribeFormat } from '@/lib/scribe/settings';
import { defaultScribeFormat, formatsForRole } from '@/lib/scribe/formatCatalog';
import { DISMISSED_NOTICE, canDismiss, type DismissReason } from '@/lib/scribe/dismiss';
import { DismissScribe } from '@/components/scribe/DismissScribe';
import { TemplateCuesPanel } from '@/components/scribe/TemplateCuesPanel';
import { loadVisitGuide } from '@/components/visits/useVisitGuide';
import type { VisitGuide } from '@/lib/visits/types';
import { useAuth } from '@/features/auth';
import { defaultSpeakerMap, resolveSpeakerMap, speakerLabelsInferred, transcriptLines, type SpeakerRole, type StoredSegment, type TranscriptLine } from '@/lib/scribe/diarization';
import { liveCues } from '@/lib/scribe/cues';
import type { CaptureMode, RecordingConsentInput } from '@/lib/scribe/consent';
import { AiConsentInline } from '@/components/scribe/AiConsentInline';
import { PasteImportPanel } from '@/components/scribe/PasteImportPanel';
import { isPasteEngine, transcriptSourceLabel } from '@/lib/scribe/paste';
import { PageHeader } from '@/components/ui';

type Phase = 'setup' | 'consent' | 'capture' | 'review';
/** Capture modes plus "paste" (paste or import text; no audio), "upload" (audio file) and "recap" (dictated recap) */
type UiMode = CaptureMode | 'paste' | 'upload' | 'recap';

/** Note format picker: the role's templates first, the rest under "More templates". */
function FormatSelect({ value, onChange, role, className }: { value: ScribeFormat; onChange: (f: ScribeFormat) => void; role: string; className: string }) {
  const { primary, more } = formatsForRole(role);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ScribeFormat)} className={className} aria-label="Note format">
      <optgroup label="Your templates">
        {primary.map((f) => (
          <option key={f} value={f}>
            {SCRIBE_FORMAT_LABELS[f]}
          </option>
        ))}
      </optgroup>
      <optgroup label="More templates">
        {more.map((f) => (
          <option key={f} value={f}>
            {SCRIBE_FORMAT_LABELS[f]}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

const MODES: { id: UiMode; label: string; Icon: typeof Mic; hint: string }[] = [
  { id: 'in_person', label: 'In-person session', Icon: Stethoscope, hint: 'Ambient capture from this device’s microphone' },
  { id: 'dictation', label: 'Dictation', Icon: Mic, hint: 'Your own summary after the session' },
  { id: 'telehealth', label: 'Telehealth', Icon: Video, hint: 'Captured inside the video visit; review here' },
  { id: 'upload', label: 'Upload audio', Icon: Upload, hint: 'm4a, mp3 or wav up to 2 hours; deleted once transcribed' },
  { id: 'recap', label: 'Dictate a recap', Icon: NotebookPen, hint: 'After the session: your short spoken recap' },
  { id: 'paste', label: 'Paste or import', Icon: ClipboardPaste, hint: 'A transcript, your own summary, or a telehealth transcript' },
];

export default function ScribePage() {
  const { clients, loading: clientsLoading } = useClients();
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [phase, setPhase] = useState<Phase>('setup');
  const [clientId, setClientId] = useState('');
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [mode, setMode] = useState<UiMode>('in_person');
  const [notice, setNotice] = useState<string | null>(null);
  const [aiStats, setAiStats] = useState<{ total: number; draft: number; signed: number } | null>(null);
  const [format, setFormatState] = useState<ScribeFormat>('THERAPY_PROGRESS');
  /** The clinician picked a format: stop following the visit / defaults */
  const [formatPicked, setFormatPicked] = useState(false);
  const setFormat = (f: ScribeFormat) => {
    setFormatPicked(true);
    setFormatState(f);
  };
  /** ?noteType= (scribe opened from a note of that type) */
  const [presetNoteType, setPresetNoteType] = useState<string | null>(null);
  const [guide, setGuide] = useState<VisitGuide | null>(null);
  const [part2, setPart2] = useState(false);
  const [ctx, setCtx] = useState<ScribeContextResponse | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureView | null>(null);
  const [segments, setSegments] = useState<StoredSegment[]>([]);
  const [overrides, setOverrides] = useState<Record<string, SpeakerRole>>({});
  const [serverLines, setServerLines] = useState<TranscriptLine[] | null>(null);
  const [cuesOn, setCuesOn] = useState(true);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<DraftView | null>(null);
  /** Review header "Right client?" (name + DOB from the server) */
  const [draftClient, setDraftClient] = useState<{ name: string; dateOfBirth: string | null } | null>(null);
  /** Inferred speaker labels confirmed by the clinician (the draft route refuses until then) */
  const [speakersOk, setSpeakersOk] = useState(false);
  const [summary, setSummary] = useState<{ text: string; status: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [language, setLanguage] = useState<ScribeLanguage>('en-US');

  const stream = useTranscribeStream({
    captureId: capture?.id ?? null,
    kind: mode === 'dictation' || mode === 'recap' ? 'dictation' : 'conversation',
    persist: true,
    onSegments: (s) => setSegments((prev) => [...prev, ...s]),
  });

  const loadContext = useCallback(async (id: string) => {
    setCtx(null);
    setCtxError(null);
    try {
      const res = await fetch(`/api/scribe/context?clientId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the chart context');
      setCtx(data);
      setPart2(Boolean(data.part2));
      setCuesOn(data.preferences.liveCues ?? data.settings.liveCuesDefault);
      setLanguage(data.language === 'es-US' ? 'es-US' : 'en-US');
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : 'Could not load the chart context');
    }
  }, []);

  const openCapture = useCallback(
    async (id: string) => {
      setBusy('open');
      try {
        const res = await fetch(`/api/scribe/captures/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Capture not found');
        setCapture(data.capture);
        setClientId(data.capture.clientId);
        setMode(isPasteEngine(data.capture.engine) ? 'paste' : data.capture.source === 'recap' ? 'recap' : data.capture.source === 'upload' ? 'upload' : data.capture.mode);
        if (data.capture.noteFormat) {
          setFormatPicked(true);
          setFormatState(data.capture.noteFormat);
        }
        setServerLines(data.lines);
        setDraft(data.draft);
        setDraftClient(data.client ?? null);
        setSpeakersOk(!data.speakersInferred);
        setSummary(data.clientSummary);
        setPhase(data.draft ? 'review' : 'capture');
        void loadContext(data.capture.clientId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open the capture');
      } finally {
        setBusy(null);
      }
    },
    [loadContext]
  );

  // Presets: ?clientId=&appointmentId= (from an appointment), ?capture= (review a telehealth capture)
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('clientId')) setClientId(qs.get('clientId')!);
    if (qs.get('appointmentId')) setAppointmentId(qs.get('appointmentId'));
    if (qs.get('mode') === 'paste') setMode('paste');
    if (qs.get('noteType')) setPresetNoteType(qs.get('noteType'));
    if (qs.get('from') === 'session-ai') setNotice('AI Session Notes is now part of AI Scribe: use "Paste or import" below.');
    const cap = qs.get('capture');
    if (cap) void openCapture(cap);
  }, [openCapture]);
  // AI-drafted notes in the chart (counts only, caseload-scoped), kept from the retired AI Session Notes page
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ehr/session-ai/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.success) setAiStats(d.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [capture?.progressNoteId]);
  useEffect(() => {
    if (!clientId && clients.length) setClientId(clients[0].id);
  }, [clients, clientId]);
  useEffect(() => {
    if (clientId && phase === 'setup') void loadContext(clientId);
  }, [clientId, phase, loadContext]);

  // Visit Guide of the linked appointment: default format + in-session cues (no appointment: none)
  const guideAppointmentId = appointmentId ?? capture?.appointmentId ?? null;
  useEffect(() => {
    if (!clientId || !guideAppointmentId) {
      setGuide(null);
      return;
    }
    let cancelled = false;
    loadVisitGuide({ clientId, appointmentId: guideAppointmentId })
      .then((g) => {
        if (!cancelled) setGuide(g);
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, guideAppointmentId]);
  // Default format: visit, open note type, clinician default, practice default (role's), role
  useEffect(() => {
    if (formatPicked || !ctx) return;
    setFormatState(
      defaultScribeFormat({
        role,
        visit: guide ? { noteType: guide.noteType, audience: guide.audience } : null,
        noteType: presetNoteType,
        preferred: ctx.preferences.defaultFormat,
        practiceDefault: ctx.settings.defaultFormat,
      }).format
    );
  }, [formatPicked, ctx, guide, presetNoteType, role]);

  const lines: TranscriptLine[] = useMemo(() => {
    if (serverLines && !segments.length) return serverLines;
    const defaults = defaultSpeakerMap(segments, { mode: mode === 'paste' || mode === 'upload' ? 'in_person' : mode === 'recap' ? 'dictation' : mode });
    return transcriptLines(segments, resolveSpeakerMap(defaults, overrides));
  }, [segments, overrides, serverLines, mode]);

  const cues = useMemo(
    () => (cuesOn && ctx ? liveCues(lines, { measuresDue: ctx.context.measuresDue, goals: ctx.context.goals, lastHomework: ctx.context.lastPlan }) : []),
    [cuesOn, ctx, lines]
  );

  const captureMode: CaptureMode = mode === 'paste' || mode === 'upload' ? 'in_person' : mode === 'recap' ? 'dictation' : mode;
  /** Text already exists (pasted, imported or an uploaded recording): no live recording bar */
  const pasted = isPasteEngine(capture?.engine) || capture?.source === 'upload';

  /** Paste / import created a capture: review speaker roles, then draft (no recording, no consent gate) */
  const loadedText = (cap: CaptureView, textLines: TranscriptLine[]) => {
    setCapture(cap);
    setSegments([]);
    setServerLines(textLines);
    setDraft(null);
    setSummary(null);
    setError(null);
    setPhase('capture');
  };

  const confirmConsent = async (consent: RecordingConsentInput) => {
    setBusy('consent');
    setError(null);
    try {
      const res = await fetch('/api/scribe/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, mode: captureMode, source: mode === 'recap' ? 'recap' : 'live', language, appointmentId, noteFormat: format, part2, liveCues: cuesOn, consent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Capture could not start');
      setCapture(data.capture);
      setSegments([]);
      setServerLines(null);
      setPhase('capture');
      await stream.start(data.capture.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture could not start');
    } finally {
      setBusy(null);
    }
  };

  const relabel = async (speakerLabel: string, role: SpeakerRole) => {
    setOverrides((prev) => ({ ...prev, [speakerLabel]: role }));
    if (!capture) return;
    const res = await fetch(`/api/scribe/captures/${encodeURIComponent(capture.id)}/segments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speakerLabel, role }),
    }).catch(() => null);
    if (res?.ok && !segments.length) {
      const data = await res.json();
      setServerLines(data.lines);
    }
  };

  const withdraw = async () => {
    if (!capture || !window.confirm('A participant withdrew consent. Stop now and delete everything captured in this session?')) return;
    await stream.stop();
    await controlCapture(capture.id, 'withdraw');
    setSegments([]);
    setServerLines([]);
    setDraft(null);
    setCapture(null);
    setPhase('setup');
    setError('Consent withdrawn: capture stopped and the transcript was deleted. Document the session yourself.');
  };

  /** "Dismiss scribe": stop now, discard everything captured (the server deletes it), back to the plain note */
  const dismiss = async (reason?: DismissReason) => {
    if (!capture) return;
    const unreported = stream.discard();
    const res = await controlCapture(capture.id, 'dismiss', unreported, { reason });
    if (!res.success) {
      setError(res.error || 'The capture could not be dismissed. Try again.');
      return;
    }
    setSegments([]);
    setServerLines([]);
    setDraft(null);
    setSummary(null);
    setCapture(null);
    setPhase('setup');
    setError(null);
    setNotice(DISMISSED_NOTICE);
  };

  const generate = async () => {
    if (!capture) return;
    if (stream.state === 'live' || stream.state === 'paused' || stream.state === 'reconnecting') await stream.stop();
    await stream.flush();
    setBusy('draft');
    setError(null);
    try {
      const res = await fetch(`/api/scribe/captures/${encodeURIComponent(capture.id)}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, ...(speakersOk ? { speakersConfirmed: true } : {}) }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'SPEAKERS_UNCONFIRMED') {
        setSpeakersOk(false);
        setPhase('capture');
        throw new Error(data.error);
      }
      if (!res.ok) throw new Error(data.error || 'AI drafting failed. Nothing was generated.');
      setDraft(data.draft);
      if (data.client) setDraftClient(data.client);
      setServerLines(data.lines);
      setSegments([]);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI drafting failed. Nothing was generated.');
    } finally {
      setBusy(null);
    }
  };

  const cite = (cites: string[]) => setHighlight(new Set(cites.filter((c) => /^t\d+$/.test(c))));
  /** One-microphone diarization / unlabeled paste / a third speaker: labels are a guess */
  const speakersInferred = speakerLabelsInferred(lines.map((l) => l.speakerLabel));
  const configured = ctx?.configured;
  const blocked = !ctx
    ? null
    : !configured?.entitled
      ? 'AI Scribe is not included in this practice’s plan.'
      : !ctx.settings.enabled
        ? 'AI Scribe is turned off in practice settings.'
        : ctx.consent.ai === 'declined'
          ? 'This client declined AI use. Nothing can be captured or drafted; document the session yourself.'
          : ctx.consent.ai === 'missing' && ctx.consent.practiceRequiresAiConsent
            ? 'No AI consent is on file and the practice requires it. Record it in Consents first.'
            : mode === 'telehealth' || mode === 'paste' || mode === 'upload'
              ? null
              : !configured?.streaming
                ? 'AWS Transcribe is not configured on this server, so live capture is unavailable. Nothing will be captured.'
                : null;
  const client = clients.find((c) => c.id === clientId);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <PageHeader
        title="AI Scribe"
        description="Audio goes only to Amazon Transcribe under the practice BAA and is never stored. AI drafts cite the transcript; you review and edit here, and sign in Notes."
        actions={<>
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
          <Settings size={14} /> Settings
        </button>
        </>}
      >
        {aiStats && (
            <p className="mt-1 text-xs text-slate-500">
              AI-drafted notes in your charts: {aiStats.total.toLocaleString('en-US')} · {aiStats.draft.toLocaleString('en-US')} awaiting signature · {aiStats.signed.toLocaleString('en-US')} signed
            </p>
          )}
      </PageHeader>
      {showSettings && <ScribeSettingsCard onChanged={() => clientId && void loadContext(clientId)} />}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-600/20 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <Info size={16} className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {phase === 'setup' && (
        <div className="space-y-4">
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
            <label className="text-xs font-semibold text-slate-600">
              Client
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={clientsLoading} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Note format
              <FormatSelect value={format} onChange={setFormat} role={role} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              {guide && !formatPicked ? <span className="mt-1 block text-[11px] font-normal text-slate-500">From the visit: {guide.label}</span> : null}
            </label>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs font-semibold text-slate-600">Capture</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={`rounded-xl border-2 p-3 text-left ${mode === m.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <m.Icon size={15} /> {m.label}
                    </p>
                    <p className="text-xs text-slate-500">{m.hint}</p>
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={part2} onChange={(e) => setPart2(e.target.checked)} disabled={Boolean(ctx?.part2)} />
              SUD session (42 CFR Part 2){ctx?.part2 ? ': chart is Part 2' : ''}
            </label>
            {mode !== 'paste' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={cuesOn} onChange={(e) => setCuesOn(e.target.checked)} /> In-session cues
              </label>
            )}
            {mode !== 'paste' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Session language
                <select value={language} onChange={(e) => setLanguage(e.target.value as ScribeLanguage)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" aria-label="Session language">
                  {SCRIBE_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {SCRIBE_LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
                {language === 'es-US' ? <span className="text-xs text-slate-500">Note drafted in English</span> : null}
              </label>
            )}
          </div>
          {ctxError && <p className="text-sm text-rose-700">{ctxError}</p>}
          {clientId && <PreSessionPanel clientId={clientId} data={ctx} />}
          {clientId ? <VisitGuidePanel compact collapsible={false} clientId={clientId} appointmentId={appointmentId} /> : null}
          {ctx && !ctx.configured.bedrock && (
            <p className="text-sm text-amber-800">AWS Bedrock is not configured on this server: capture works, but AI drafting will not run (nothing canned is shown).</p>
          )}
          {clientId && ctx && ctx.consent.ai === 'missing' && ctx.consent.practiceRequiresAiConsent ? (
            <AiConsentInline clientId={clientId} clientName={client?.name || 'this client'} onRecorded={() => void loadContext(clientId)} />
          ) : blocked ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {blocked}{' '}
              <Link
                href={`/dashboard/ehr/notes${clientId ? `?clientId=${encodeURIComponent(clientId)}${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}&guide=1` : ''}` : ''}`}
                className="font-semibold underline"
              >
                Write the note manually
              </Link>
            </div>
          ) : mode === 'upload' ? (
            clientId && ctx ? (
              <AudioUploadPanel
                clientId={clientId}
                clientName={client?.name || 'Client'}
                format={format}
                part2={part2}
                language={language}
                appointmentId={appointmentId}
                minor={ctx.context.minor}
                configured={Boolean(ctx.configured.upload)}
                onTranscribed={loadedText}
              />
            ) : null
          ) : mode === 'paste' ? (
            clientId && ctx ? (
              <PasteImportPanel clientId={clientId} format={format} part2={part2} appointmentId={appointmentId} onCreated={loadedText} />
            ) : null
          ) : mode === 'telehealth' ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              Telehealth capture runs inside the video visit: open the visit from Telehealth, start <strong>AI Scribe</strong> in the call after recording consent, and review the draft here when you end the capture.{' '}
              <Link href="/dashboard/telehealth" className="font-semibold text-blue-600 underline">
                Go to Telehealth
              </Link>
            </div>
          ) : (
            <button
              type="button"
              disabled={!clientId || !ctx}
              onClick={() => setPhase('consent')}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-40"
            >
              <Mic size={18} /> {mode === 'recap' ? 'Start recap' : mode === 'dictation' ? 'Start dictation' : 'Start session capture'}
            </button>
          )}
        </div>
      )}

      {phase === 'consent' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {client?.name} · {SCRIBE_FORMAT_LABELS[format]}
          </p>
          <ConsentGate mode={captureMode} busy={busy === 'consent'} onConfirm={(c) => void confirmConsent(c)} />
          <button type="button" onClick={() => setPhase('setup')} className="text-sm font-semibold text-slate-500 underline">
            Back
          </button>
        </div>
      )}

      {phase === 'capture' && capture && capture.mode !== 'telehealth' && !pasted ? (
        <RecordingStatusBar state={stream.state} elapsedSeconds={stream.elapsed} monitor={stream.monitor} onPause={() => void stream.pause()} onResume={() => void stream.resume()} onStop={() => void stream.stop()} />
      ) : null}
      {phase === 'capture' && capture && (
        <div className="space-y-3">
          {capture.mode !== 'telehealth' && !pasted && (
            <RecordingBar
              state={stream.state}
              level={stream.level}
              elapsedSeconds={stream.elapsed}
              engineLabel={`${transcriptSourceLabel(capture.engine).replace(/^AWS /, '')} · ${mode === 'recap' ? 'recap' : mode === 'dictation' ? 'dictation' : 'conversation'}${capture.language === 'es-US' ? ' · Spanish' : ''}`}
              onPause={() => void stream.pause()}
              onResume={() => void stream.resume()}
              onStop={() => void stream.stop()}
              onWithdraw={() => void withdraw()}
              onDismiss={(reason) => dismiss(reason)}
            />
          )}
          {(capture.mode === 'telehealth' || pasted) && canDismiss(capture) && (
            <div className="flex justify-end">
              <DismissScribe onConfirm={(reason) => dismiss(reason)} />
            </div>
          )}
          {(stream.error || stream.saveError) && <p className="text-sm text-amber-800">{stream.error || stream.saveError}</p>}
          {cuesOn && !pasted && <LiveCues cues={cues} onJump={(id) => setHighlight(new Set([id]))} />}
          {pasted && (
            <p className="text-sm text-slate-600">Check the speaker roles (Clinician / Client) before drafting: the draft cites these lines, and risk screens use only what the client said.</p>
          )}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-2">
              {speakersInferred ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={speakersOk} onChange={(e) => setSpeakersOk(e.target.checked)} />
                  <span>
                    <strong>Speaker labels are a guess — confirm.</strong> Check (and correct) who is the clinician, the client and anyone else before drafting; risk screens use only what the client said.
                  </span>
                </label>
              ) : null}
              <TranscriptPane lines={lines} partial={stream.partial} highlight={highlight} editable engine={capture.engine} onRelabel={(l, r) => void relabel(l, r)} />
            </div>
            <div className="lg:sticky lg:top-4 lg:self-start">
              <TemplateCuesPanel format={format} guideSteps={guide?.steps ?? null} guideLabel={guide?.label ?? null} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FormatSelect value={format} onChange={setFormat} role={role} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <button
              type="button"
              disabled={busy === 'draft' || lines.length < 2 || (speakersInferred && !speakersOk)}
              onClick={() => void generate()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy === 'draft' ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />} {pasted ? 'Draft from this text' : 'End capture & draft'}
            </button>
            <span className="text-xs text-slate-500">
              {pasted
                ? `${capture.source === 'upload' ? 'Recording uploaded and transcribed (audio file deleted)' : capture.engine === 'import' ? 'Telehealth transcript imported' : 'Text pasted'} ${new Date(capture.consent.attestedAt).toLocaleTimeString()} by ${capture.consent.attestedBy || 'you'}${capture.source === 'upload' ? '' : ' · no recording'}`
                : `Consent attested ${new Date(capture.consent.attestedAt).toLocaleTimeString()} by ${capture.consent.attestedBy || 'you'}`}
              {capture.part2 ? ' · 42 CFR Part 2 session' : ''}
            </span>
          </div>
        </div>
      )}

      {phase === 'review' && capture && draft && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <DraftReview captureId={capture.id} clientId={capture.clientId ?? null} draft={draft} client={draftClient} settings={ctx?.settings ?? null} initialNoteId={capture.progressNoteId} initialSummary={summary} onCite={cite} onNoteCreated={(noteId) => setCapture((c) => (c ? { ...c, progressNoteId: noteId, status: 'note_created' } : c))} />
          <div className="lg:sticky lg:top-4 lg:self-start">
            <TranscriptPane lines={lines} highlight={highlight} editable={false} follow={false} engine={capture.engine} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <FormatSelect value={format} onChange={setFormat} role={role} className="max-w-full rounded-lg border border-slate-200 px-2 py-1 text-xs" />
              <button type="button" disabled={busy === 'draft'} onClick={() => void generate()} className="text-xs font-semibold text-blue-600 underline">
                {busy === 'draft' ? 'Drafting…' : `Redraft as ${SCRIBE_FORMAT_LABELS[format]}`}
              </button>
            </div>
            {canDismiss(capture) && (
              <div className="mt-3">
                <DismissScribe onConfirm={(reason) => dismiss(reason)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

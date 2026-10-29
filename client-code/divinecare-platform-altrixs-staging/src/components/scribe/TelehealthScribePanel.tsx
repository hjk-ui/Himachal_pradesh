'use client';

/**
 * In-call AI Scribe (staff view of a Chime telehealth visit). After the recording-consent
 * attestation, the server starts Chime live transcription with Amazon Transcribe (standard or
 * Medical, per the practice setting); the
 * transcript arrives over the meeting data channel attributed to each attendee (exact
 * Clinician / Client roles) and is saved to the capture. The patient's window shows a
 * "This visit is being transcribed" banner from the same Chime status events.
 * "Dismiss scribe" stops Chime transcription and discards the capture (nothing is kept). The note
 * format follows the appointment's Visit Guide note type when there is one.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bot, X } from 'lucide-react';
import { ConsentGate } from './ConsentGate';
import { RecordingBar, type BarState } from './RecordingBar';
import { TranscriptPane } from './TranscriptPane';
import { controlCapture, useChimeTranscript, type SeqSegment } from './useTranscribeStream';
import { defaultSpeakerMap, resolveSpeakerMap, transcriptLines, type SpeakerRole } from '@/lib/scribe/diarization';
import type { RecordingConsentInput } from '@/lib/scribe/consent';
import { TRIAL_SCRIBE_LIMIT_MESSAGE } from '@/lib/scribe/trialCap';
import { transcriptSourceLabel } from '@/lib/scribe/paste';
import { formatForNoteType } from '@/lib/scribe/formatCatalog';
import { DISMISSED_NOTICE, type DismissReason } from '@/lib/scribe/dismiss';
import { loadVisitGuide } from '@/components/visits/useVisitGuide';

type ControllerLike = Parameters<typeof useChimeTranscript>[0]['controller'];

export function TelehealthScribePanel({
  sessionId,
  clientId,
  appointmentId,
  clinicianAttendeeId,
  patientAttendeeId,
  getController,
}: {
  sessionId: string;
  clientId: string;
  appointmentId?: string | null;
  clinicianAttendeeId?: string | null;
  patientAttendeeId?: string | null;
  getController: () => ControllerLike;
}) {
  const [open, setOpen] = useState(false);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [state, setState] = useState<BarState>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [activeSince, setActiveSince] = useState<number | null>(null);
  const [activeMs, setActiveMs] = useState(0);
  const [segments, setSegments] = useState<SeqSegment[]>([]);
  const [overrides, setOverrides] = useState<Record<string, SpeakerRole>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  /** Epoch ms when the free-trial minutes run out for this stretch of capture (null = no cap) */
  const [limitAt, setLimitAt] = useState<number | null>(null);
  const controller = captureId ? getController() : null;
  const chime = useChimeTranscript({ captureId, controller, startedAtMs: startedAt, enabled: state === 'live' || state === 'paused', onSegments: (s) => setSegments((p) => [...p, ...s]) });
  const lines = useMemo(
    () => transcriptLines(segments, resolveSpeakerMap(defaultSpeakerMap(segments, { mode: 'telehealth', clinicianAttendeeId, patientAttendeeId }), overrides)),
    [segments, overrides, clinicianAttendeeId, patientAttendeeId]
  );

  const seconds = () => (activeMs + (activeSince ? Date.now() - activeSince : 0)) / 1000;
  const [notice, setNotice] = useState<string | null>(null);
  /** "Dismiss scribe": stop Chime transcription, drop unsent turns, delete what was stored */
  const dismiss = async (reason?: DismissReason) => {
    if (!captureId) return;
    chime.discard();
    const metered = activeSince ? (Date.now() - activeSince) / 1000 : 0;
    const res = await controlCapture(captureId, 'dismiss', metered, { reason });
    if (!res.success) {
      setError(res.error || 'The capture could not be dismissed. Try again.');
      return;
    }
    setSegments([]);
    setCaptureId(null);
    setState('idle');
    setActiveSince(null);
    setActiveMs(0);
    setStartedAt(null);
    setLimitAt(null);
    setError(null);
    setNotice(DISMISSED_NOTICE);
  };

  const act = async (action: 'start' | 'resume' | 'pause' | 'stop' | 'withdraw', id = captureId) => {
    if (!id) return;
    setError(null);
    const metered = action === 'pause' || action === 'stop' || action === 'withdraw' ? (activeSince ? (Date.now() - activeSince) / 1000 : 0) : undefined;
    const res = await controlCapture(id, action, metered);
    if (!res.success) {
      setError(res.error || 'Live transcription failed. Nothing was captured.');
      if (action === 'start') setState('error');
      return;
    }
    if (action === 'start' || action === 'resume') {
      const max = res.stream?.maxSeconds;
      setLimitAt(typeof max === 'number' ? Date.now() + max * 1000 : null);
      setStartedAt((s) => s ?? Date.now());
      setActiveSince(Date.now());
      setState('live');
    } else {
      setLimitAt(null);
      if (activeSince) setActiveMs((m) => m + (Date.now() - activeSince));
      setActiveSince(null);
      setState(action === 'pause' ? 'paused' : 'stopped');
      void chime.flush();
    }
  };

  // Free trial: pause live transcription when the organization's trial minutes run out
  useEffect(() => {
    if (limitAt === null || state !== 'live') return;
    const t = setTimeout(() => {
      void act('pause').then(() => setError(TRIAL_SCRIBE_LIMIT_MESSAGE));
    }, Math.max(0, limitAt - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitAt, state]);

  const consent = async (c: RecordingConsentInput) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Note format from the visit (Psych Med Mgmt for a medication visit, …); else the server default
      const visit = appointmentId ? await loadVisitGuide({ clientId, appointmentId }).catch(() => null) : null;
      const noteFormat = visit ? formatForNoteType(visit.noteType, { medical: visit.audience === 'medical' }) : null;
      const res = await fetch('/api/scribe/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, mode: 'telehealth', telehealthSessionId: sessionId, appointmentId: appointmentId ?? null, consent: c, ...(noteFormat ? { noteFormat } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Capture could not start');
      setCaptureId(data.capture.id);
      setEngine(data.capture.engine ?? null);
      await act('start', data.capture.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture could not start');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`absolute right-4 top-4 z-30 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg ${state === 'live' ? 'bg-red-600 text-white' : 'bg-white/90 text-slate-800'}`}
      >
        {state === 'live' ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : <Bot size={13} />} AI Scribe{state === 'live' ? ': Recording' : ''}
      </button>
    );
  }
  return (
    <div className="absolute right-4 top-4 z-30 flex max-h-[80vh] w-[380px] max-w-[92vw] flex-col gap-2 overflow-y-auto rounded-2xl bg-white p-3 text-slate-900 shadow-2xl">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Bot size={15} /> AI Scribe
        </p>
        <button type="button" aria-label="Minimize" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:text-slate-700">
          <X size={15} />
        </button>
      </div>
      {!captureId ? (
        <ConsentGate mode="telehealth" busy={busy} onConfirm={(c) => void consent(c)} />
      ) : (
        <>
          <RecordingBar
            state={state}
            level={null}
            elapsedSeconds={Math.floor(seconds())}
            engineLabel={transcriptSourceLabel(engine ?? 'chime_transcribe')}
            onPause={() => void act('pause')}
            onResume={() => void act('resume')}
            onStop={() => void act('stop')}
            onWithdraw={() => {
              if (window.confirm('A participant withdrew consent. Stop and delete this capture?')) {
                void act('withdraw').then(() => {
                  setSegments([]);
                  setCaptureId(null);
                  setState('idle');
                });
              }
            }}
            onDismiss={(reason) => dismiss(reason)}
          />
          <TranscriptPane lines={lines} partial={chime.partial} editable onRelabel={(l, r) => setOverrides((p) => ({ ...p, [l]: r }))} />
          {state === 'stopped' && (
            <Link
              href={`/dashboard/ehr/notes?${new URLSearchParams({ clientId, ...(appointmentId ? { appointmentId } : {}), guide: '1', scribe: '1', capture: captureId }).toString()}`}
              className="rounded-xl bg-[#5C2D91] px-3 py-2 text-center text-sm font-semibold text-white"
            >
              Review &amp; draft the note
            </Link>
          )}
        </>
      )}
      {notice && !captureId && <p className="text-xs text-slate-600">{notice}</p>}
      {(error || chime.saveError) && <p className="text-xs text-rose-700">{error || chime.saveError}</p>}
    </div>
  );
}

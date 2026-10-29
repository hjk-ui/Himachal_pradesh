'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck,
  FileText,
  Heart,
  History,
  Loader2,
  MessageSquare,
  Pill,
  Send,
  Shield,
  ShieldAlert,
  Stethoscope,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LabOrderForm } from '@/components/labs/LabOrderForm';
import { VisitTypeControl } from '@/components/visits/VisitTypeControl';
import { ChartHistoryCard, createChartDigestCache } from '@/components/ai/ChartHistoryCard';
import { canSeeChartHistoryTab } from '@/lib/ai/chartDigest/panelOrder';
import { NOT_ASSESSED, missingInCallSelections, previewInCallCoding } from '@/lib/telehealth/inCallCoding';

export type InCallEhrDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  clientId: string;
  clientName: string;
  clinicianName?: string | null;
  role?: string;
  sessionType?: string;
  patientLocationState?: string | null;
  /** Appointment behind the call: shows the Visit type control (src/components/visits/VisitTypeControl.tsx) */
  appointmentId?: string | null;
  onVisitTypeChanged?: (type: string) => void;
};

type NoteData = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  mseAppearance: string;
  mseMood: string;
  mseThought: string;
  cssrsRiskScore: string;
  isSavedToEhr: boolean;
  /** Draft ProgressNote created by Save to EHR (sign it from Notes) */
  draftNoteId: string | null;
};

type VitalsData = {
  bloodPressure: string;
  pulse: number | '';
  weightLbs: number | '';
  sideEffects: string;
  aimsScore: number;
  qtcWarning: boolean;
};

type ChatMsg = {
  id: string;
  senderRole: string;
  senderName: string;
  message: string;
  sentAt: string;
};

export function InCallEhrDrawer({
  isOpen,
  onClose,
  sessionId,
  clientId,
  clientName,
  clinicianName,
  role = 'DOCTOR_PSYCHIATRIST',
  sessionType = 'Individual Therapy',
  patientLocationState,
  appointmentId,
  onVisitTypeChanged,
}: InCallEhrDrawerProps) {
  const isNp =
    role.toUpperCase().includes('NP') ||
    role.toUpperCase().includes('NURSE') ||
    sessionType.toLowerCase().includes('med');

  const [activeTab, setActiveTab] = useState<'soap' | 'vitals' | 'chat' | 'billing' | 'history'>('soap');
  /** Chart history tab (AI digest of prior chart documents): roles the API gates out never see it; a 403 hides it */
  const [chartHistoryDenied, setChartHistoryDenied] = useState(false);
  /** Digest loaded once per client for this call (switching tabs does not refetch) */
  const [chartDigestCache] = useState(createChartDigestCache);
  const showChartHistory = Boolean(clientId) && canSeeChartHistoryTab(role) && !chartHistoryDenied;

  // SOAP State
  const [note, setNote] = useState<NoteData>({
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    // Never pre-filled: an unchosen MSE / C-SSRS field is saved as blank, not as a normal finding
    mseAppearance: '',
    mseMood: '',
    mseThought: '',
    cssrsRiskScore: '',
    isSavedToEhr: false,
    draftNoteId: null,
  });
  const [posPreview, setPosPreview] = useState<string | null>(null);
  // Elapsed call time for the coding preview (the drawer mounts with the call)
  const callStartRef = useRef(Date.now());
  const [elapsedMin, setElapsedMin] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsedMin(Math.floor((Date.now() - callStartRef.current) / 60000)), 15000);
    return () => clearInterval(t);
  }, []);
  const [savingNote, setSavingNote] = useState(false);
  const [noteLastSaved, setNoteLastSaved] = useState<string | null>(null);

  // Vitals State
  const [vitals, setVitals] = useState<VitalsData>({
    bloodPressure: '',
    pulse: '',
    weightLbs: '',
    sideEffects: '',
    aimsScore: 0,
    qtcWarning: false,
  });
  const [savingVitals, setSavingVitals] = useState(false);
  const [collaborativeCoSign, setCollaborativeCoSign] = useState(true);

  // Chat State
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // E-prescribing goes through DrFirst Rcopia (SSO) — nothing is prescribed in this drawer
  const [openingRcopia, setOpeningRcopia] = useState(false);

  // Modals
  const [labModalOpen, setLabModalOpen] = useState(false);
  const [savedLabOrderId, setSavedLabOrderId] = useState<string | null>(null);

  const [crisisModalOpen, setCrisisModalOpen] = useState(false);
  const [recordingCrisis, setRecordingCrisis] = useState(false);
  const [crisisEpisodeNumber, setCrisisEpisodeNumber] = useState<string | null>(null);

  /** Opens DrFirst Rcopia for this patient (same flow as the client chart's E-Prescribe). */
  const openRcopia = async () => {
    // Open the tab synchronously on click so the popup blocker allows it
    const win = window.open('about:blank', '_blank');
    setOpeningRcopia(true);
    try {
      const res = await fetch(`/api/drfirst/sso?patient=${encodeURIComponent(clientId)}&screen=patient`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url || data.demo) {
        win?.close();
        toast.error(data.error || data.message || 'DrFirst e-prescribing is not available on this server.');
        return;
      }
      if (data.patientSynced === false) {
        toast('This client is not in DrFirst yet, so DrFirst opens on patient search.');
      }
      if (win) win.location.href = data.url;
      else toast.error('Pop-up blocked — allow pop-ups for this site to open DrFirst.');
    } catch {
      win?.close();
      toast.error('Could not reach DrFirst. Try again or use the client chart.');
    } finally {
      setOpeningRcopia(false);
    }
  };

  /**
   * Opens a crisis episode for this client and records a page attempt. Automated
   * paging is not connected (/api/crisis/paging answers 503), so the clinician is
   * told plainly to phone mobile crisis / 988.
   */
  const recordCrisisDispatch = async () => {
    setRecordingCrisis(true);
    try {
      const epRes = await fetch('/api/crisis/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientName,
          location: patientLocationState || 'Telehealth — location not verified',
          priority: 1,
          source: 'telehealth',
          initialNotes: `Escalated from telehealth session (C-SSRS ${note.cssrsRiskScore || NOT_ASSESSED})`,
        }),
      });
      const epData = await epRes.json().catch(() => ({}));
      if (!epRes.ok || !epData.success) {
        toast.error(`${epData.error || 'Could not open a crisis episode'}. No one was notified — call mobile crisis / 988 now.`, {
          duration: 10000,
        });
        return;
      }
      const episodeId: string = epData.episode.id;
      setCrisisEpisodeNumber(epData.episode.episodeNumber ?? episodeId);

      const pageRes = await fetch('/api/crisis/paging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'telehealth_escalation', episodeId }),
      }).catch(() => null);
      const pageData = pageRes ? await pageRes.json().catch(() => ({})) : {};
      if (pageRes?.ok && pageData?.notificationsSent === true) {
        toast.success('Crisis episode opened and on-call team paged.');
      } else {
        toast.error('Crisis episode opened, but NO ONE was notified automatically — call mobile crisis / 988 now.', {
          duration: 10000,
        });
      }
      setCrisisModalOpen(false);
    } catch {
      toast.error('Crisis dispatch failed — no one was notified. Call mobile crisis / 988 now.', { duration: 10000 });
    } finally {
      setRecordingCrisis(false);
    }
  };

  // Fetch initial in-call data
  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    fetch(`/api/telehealth/in-call?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (!mounted || !res.success) return;
        if (res.data.note) {
          setNote({
            subjective: res.data.note.subjective || '',
            objective: res.data.note.objective || '',
            assessment: res.data.note.assessment || '',
            plan: res.data.note.plan || '',
            mseAppearance: res.data.note.mseAppearance || '',
            mseMood: res.data.note.mseMood || '',
            mseThought: res.data.note.mseThought || '',
            cssrsRiskScore: res.data.note.cssrsRiskScore || '',
            isSavedToEhr: Boolean(res.data.note.isSavedToEhr),
            draftNoteId: res.data.note.progressNoteId ?? null,
          });
          setNoteLastSaved('Loaded from session');
        }
        setPosPreview(res.data.posPreview?.pos ?? null);
        if (res.data.vitals) {
          setVitals({
            bloodPressure: res.data.vitals.bloodPressure || '',
            pulse: res.data.vitals.pulse ?? '',
            weightLbs: res.data.vitals.weightLbs ?? '',
            sideEffects: res.data.vitals.sideEffects || '',
            aimsScore: res.data.vitals.aimsScore ?? 0,
            qtcWarning: Boolean(res.data.vitals.qtcWarning),
          });
        }
        if (Array.isArray(res.data.chatMessages)) {
          setMessages(res.data.chatMessages);
        }
      })
      .catch((e) => console.warn('[in-call] load error:', e));

    return () => {
      mounted = false;
    };
  }, [sessionId]);

  // Autosave goes to the session scratch note only. "Save to EHR" creates ONE draft progress
  // note in the chart; after that, autosaves never touch the chart note.
  const saveNoteToDb = useCallback(
    async (currentNote: NoteData, toEhr = false) => {
      if (!sessionId) return;
      if (toEhr && !currentNote.draftNoteId) {
        const missing = missingInCallSelections(currentNote);
        if (missing.length > 0) {
          toast.error(`Choose ${missing.join(', ')} (or "${NOT_ASSESSED}") before creating the chart note.`);
          return;
        }
      }
      setSavingNote(true);
      try {
        const { draftNoteId: _draft, isSavedToEhr: _saved, ...fields } = currentNote;
        void _draft;
        void _saved;
        const res = await fetch('/api/telehealth/in-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-notes',
            sessionId,
            ...fields,
            isSavedToEhr: toEhr && !currentNote.draftNoteId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setNoteLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          if (data.draftNoteId) {
            setNote((prev) => ({ ...prev, isSavedToEhr: true, draftNoteId: data.draftNoteId }));
          }
          if (toEhr && data.draftCreated) {
            toast.success('Draft note created — sign it from Notes');
          } else if (toEhr && data.draftNoteId) {
            toast('A draft note already exists for this visit — edit and sign it from Notes');
          }
        } else if (toEhr) {
          toast.error(data.error || 'Could not create the draft note');
        } else {
          toast.error(data.error || 'Autosave failed — your notes are not saved');
        }
      } catch {
        toast.error(toEhr ? 'Could not create the draft note — check your connection' : 'Autosave failed — check your connection');
      } finally {
        setSavingNote(false);
      }
    },
    [sessionId]
  );

  const saveVitalsToDb = async () => {
    if (!sessionId) return;
    setSavingVitals(true);
    try {
      const res = await fetch('/api/telehealth/in-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-vitals',
          sessionId,
          ...vitals,
          pulse: Number(vitals.pulse) || null,
          weightLbs: Number(vitals.weightLbs) || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Somatic vitals & QTc safety status saved');
      }
    } catch {
      /* ignore */
    } finally {
      setSavingVitals(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !sessionId) return;
    setSendingMsg(true);
    try {
      const res = await fetch('/api/telehealth/in-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-message',
          sessionId,
          senderRole: isNp ? 'NURSE_PRACTITIONER' : 'CLINICIAN',
          senderName: clinicianName || 'Clinician',
          message: chatInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...prev, data.message]);
        setChatInput('');
      }
    } catch {
      /* ignore */
    } finally {
      setSendingMsg(false);
    }
  };

  const coding = previewInCallCoding({ elapsedMinutes: elapsedMin, isPrescriberVisit: isNp, emCode: null, pos: posPreview });

  if (!isOpen) return null;

  return (
    <aside className="w-full sm:w-[420px] bg-slate-900 border-l border-white/10 flex flex-col h-full z-30 shadow-2xl transition-all duration-300">
      {/* Drawer Top Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/80 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Concurrent EHR Chart</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {isNp ? 'NP Med-Mgmt' : 'MD/DO Clinical'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[260px]">
            {clientName} · {sessionType}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
          aria-label="Close drawer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {appointmentId ? (
        <div className="border-b border-white/10 px-4 py-2">
          <VisitTypeControl tone="dark" appointmentId={appointmentId} onChanged={(r) => onVisitTypeChanged?.(r.type)} />
        </div>
      ) : null}

      {/* Tabs Navigation */}
      <div className="flex border-b border-white/10 bg-slate-900/90 text-xs font-semibold px-2 pt-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('soap')}
          className={`flex-1 py-2 rounded-t-xl transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'soap'
              ? 'bg-slate-800 text-emerald-400 border-t-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>SOAP & MSE</span>
        </button>

        {isNp && (
          <button
            type="button"
            onClick={() => setActiveTab('vitals')}
            className={`flex-1 py-2 rounded-t-xl transition text-center flex items-center justify-center gap-1.5 ${
              activeTab === 'vitals'
                ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            <span>Vitals & Labs</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2 rounded-t-xl transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'chat'
              ? 'bg-slate-800 text-purple-400 border-t-2 border-purple-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Chat ({messages.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('billing')}
          className={`flex-1 py-2 rounded-t-xl transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'billing'
              ? 'bg-slate-800 text-amber-400 border-t-2 border-amber-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>Billing</span>
        </button>

        {showChartHistory ? (
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            aria-pressed={activeTab === 'history'}
            aria-label="Chart history"
            title="Chart history: cited facts from prior chart documents (AI-generated)"
            className={`flex-1 py-2 rounded-t-xl transition text-center flex items-center justify-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-slate-800 text-rose-300 border-t-2 border-rose-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            <span>History</span>
          </button>
        ) : null}
      </div>

      {/* Main Drawer Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* TAB 1: SOAP & MSE */}
        {activeTab === 'soap' && (
          <div className="space-y-4">
            {/* Quick Actions Bar */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={openingRcopia || !clientId}
                onClick={() => void openRcopia()}
                title="Opens DrFirst Rcopia for this patient in a new tab"
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 font-semibold transition disabled:opacity-60"
              >
                {openingRcopia ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pill className="h-3.5 w-3.5 text-purple-400" />}
                <span>E-Prescribe (DrFirst)</span>
              </button>

              <button
                type="button"
                onClick={() => setCrisisModalOpen(true)}
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 font-semibold transition"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-rose-400 animate-pulse" />
                <span>Crisis Dispatch</span>
              </button>
            </div>
            {crisisEpisodeNumber && (
              <p className="text-[11px] text-rose-300">
                Crisis episode {crisisEpisodeNumber} opened — automated paging is not connected; confirm responders by phone.
              </p>
            )}

            {/* Suicide Risk Screen (C-SSRS) */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-emerald-400" /> C-SSRS Suicide Risk Screen
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    note.cssrsRiskScore === 'High'
                      ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                      : note.cssrsRiskScore === 'Moderate'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                        : note.cssrsRiskScore === 'Low'
                          ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-700/60 text-slate-300 border border-white/10'
                  }`}
                >
                  {note.cssrsRiskScore === 'Low' || note.cssrsRiskScore === 'Moderate' || note.cssrsRiskScore === 'High'
                    ? `${note.cssrsRiskScore} Risk`
                    : note.cssrsRiskScore || 'Not selected'}
                </span>
              </div>
              <div className="flex gap-1.5">
                {(['Low', 'Moderate', 'High', NOT_ASSESSED] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => {
                      const updated = { ...note, cssrsRiskScore: lvl };
                      setNote(updated);
                      void saveNoteToDb(updated);
                      if (lvl === 'High') {
                        toast.error('High Suicide Risk recorded — no one is notified automatically. Follow the safety protocol and use Crisis Dispatch.', {
                          duration: 6000,
                        });
                      }
                    }}
                    className={`flex-1 py-1 rounded-xl text-[11px] font-semibold transition ${
                      note.cssrsRiskScore === lvl
                        ? lvl === 'High'
                          ? 'bg-rose-600 text-white'
                          : lvl === 'Moderate'
                            ? 'bg-amber-600 text-white'
                            : lvl === 'Low'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* MSE Quick Chips */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2.5">
              <span className="font-bold text-slate-300">Mental Status Exam (MSE) Chips</span>

              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400 font-medium">Appearance:</span>
                <div className="flex flex-wrap gap-1">
                  {['Well-groomed', 'Disheveled', 'Casual', 'Agitated', NOT_ASSESSED].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseAppearance: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition ${
                        note.mseAppearance === chip
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400 font-medium">Mood / Affect:</span>
                <div className="flex flex-wrap gap-1">
                  {['Euthymic', 'Depressed', 'Anxious', 'Labile', 'Euphoric', NOT_ASSESSED].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseMood: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition ${
                        note.mseMood === chip
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400 font-medium">Thought Process:</span>
                <div className="flex flex-wrap gap-1">
                  {['Linear/Goal-directed', 'Circumstantial', 'Tangential', 'Flight of Ideas', NOT_ASSESSED].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseThought: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition ${
                        note.mseThought === chip
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Real-Time SOAP Note Form */}
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Subjective (Chief Complaint & HPI):
                </label>
                <textarea
                  rows={2}
                  value={note.subjective}
                  onChange={(e) => setNote({ ...note, subjective: e.target.value })}
                  onBlur={() => void saveNoteToDb(note)}
                  placeholder="Patient reports sleep disturbances, mild anxiety at night…"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Objective (Clinical Observations):
                </label>
                <textarea
                  rows={2}
                  value={note.objective}
                  onChange={(e) => setNote({ ...note, objective: e.target.value })}
                  onBlur={() => void saveNoteToDb(note)}
                  placeholder="Appears calm, cooperative, speech normal rate and volume…"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Assessment (Diagnostic Impression):
                </label>
                <textarea
                  rows={2}
                  value={note.assessment}
                  onChange={(e) => setNote({ ...note, assessment: e.target.value })}
                  onBlur={() => void saveNoteToDb(note)}
                  placeholder="F41.1 Generalized Anxiety Disorder, coping mechanisms improving…"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Plan (Interventions & Next Steps):
                </label>
                <textarea
                  rows={2}
                  value={note.plan}
                  onChange={(e) => setNote({ ...note, plan: e.target.value })}
                  onBlur={() => void saveNoteToDb(note)}
                  placeholder="CBT thought record practice, continue current regimen, follow-up in 2 weeks…"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Sync & Save Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-[11px] text-slate-400">
                {savingNote ? 'Autosaving…' : noteLastSaved ? `Autosaved: ${noteLastSaved}` : 'Ready'}
              </span>
              {note.draftNoteId ? (
                <a
                  href={`/dashboard/ehr/notes?openNote=${encodeURIComponent(note.draftNoteId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs transition shadow flex items-center gap-1.5"
                  title="The chart draft is not changed by later autosaves; edit and sign it from Notes"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Draft in chart — sign from Notes</span>
                </a>
              ) : (
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => void saveNoteToDb(note, true)}
                  title="Creates an unsigned draft progress note in the chart"
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow flex items-center gap-1.5 disabled:opacity-60"
                >
                  <FileCheck className="h-3.5 w-3.5" />
                  <span>Save to EHR (draft)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: VITALS & LABS (NP / PMHNP) */}
        {activeTab === 'vitals' && (
          <div className="space-y-4">
            {/* Somatic Vitals Inputs */}
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                <Heart className="h-3.5 w-3.5 text-rose-400" /> Somatic Vitals Review
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Blood Pressure:</label>
                  <input
                    type="text"
                    value={vitals.bloodPressure}
                    onChange={(e) => setVitals({ ...vitals, bloodPressure: e.target.value })}
                    placeholder="120/80"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Pulse (bpm):</label>
                  <input
                    type="number"
                    value={vitals.pulse}
                    onChange={(e) => setVitals({ ...vitals, pulse: Number(e.target.value) || '' })}
                    placeholder="72"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Weight (lbs):</label>
                  <input
                    type="number"
                    value={vitals.weightLbs}
                    onChange={(e) => setVitals({ ...vitals, weightLbs: Number(e.target.value) || '' })}
                    placeholder="165"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">AIMS Movement Score (0-4):</label>
                  <select
                    value={vitals.aimsScore}
                    onChange={(e) => setVitals({ ...vitals, aimsScore: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value={0}>0 - None / Normal</option>
                    <option value={1}>1 - Minimal</option>
                    <option value={2}>2 - Mild</option>
                    <option value={3}>3 - Moderate</option>
                    <option value={4}>4 - Severe Tardive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Side Effects & Tolerability:</label>
                <input
                  type="text"
                  value={vitals.sideEffects}
                  onChange={(e) => setVitals({ ...vitals, sideEffects: e.target.value })}
                  placeholder="Dry mouth, sedation in mornings…"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <button
                type="button"
                onClick={() => void saveVitalsToDb()}
                disabled={savingVitals}
                className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition shadow"
              >
                {savingVitals ? 'Saving Vitals…' : 'Save Vitals Record'}
              </button>
            </div>

            {/* Drug Interaction & QTc Flag */}
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-400" /> QTc check (flag for follow-up)
                </span>
                <input
                  type="checkbox"
                  checked={vitals.qtcWarning}
                  onChange={(e) => setVitals({ ...vitals, qtcWarning: e.target.checked })}
                  className="h-4 w-4 accent-amber-500 rounded"
                />
              </div>
              <p className="text-[11px] text-amber-300 leading-relaxed">
                Reminder, not based on this patient&apos;s medication list: if they take a QT-prolonging medication (for example citalopram, ziprasidone or haloperidol), consider an ECG and electrolyte panel. Tick to flag for follow-up.
              </p>
            </div>

            {/* Lab Order Shortcut — saved to chart; printable requisition */}
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-400" /> Lab Requisition Order
                </span>
                <span className="text-[11px] text-slate-400 font-semibold">Saved to chart only</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Order monitoring labs during the visit. Orders are saved to the chart; electronic transmission to Quest/Labcorp is not connected — print the requisition.
              </p>
              <button
                type="button"
                onClick={() => setLabModalOpen(true)}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow flex items-center justify-center gap-1.5"
              >
                <Pill className="h-3.5 w-3.5" />
                <span>Order labs</span>
              </button>
              {savedLabOrderId && (
                <a
                  href={`/api/labs/orders/${encodeURIComponent(savedLabOrderId)}/requisition-html?format=raw`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-300 underline"
                >
                  <ExternalLink className="h-3 w-3" /> Order saved — open printable requisition
                </a>
              )}
            </div>

            {/* State Supervisory Collaborative MD Co-Signature Check */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-200 block">MD Co-Signature Routing</span>
                <span className="text-[11px] text-slate-400">Collaborative practice agreement queue</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={collaborativeCoSign}
                  onChange={(e) => setCollaborativeCoSign(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500 rounded"
                />
                <span className="text-[11px] text-slate-300 font-medium">Route to MD</span>
              </label>
            </div>
          </div>
        )}

        {/* TAB 3: CHAT */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full space-y-3">
            <div className="flex-1 min-h-[300px] max-h-[460px] overflow-y-auto space-y-2 pr-1">
              {messages.length === 0 ? (
                <div className="text-center py-10 text-slate-500 space-y-1">
                  <MessageSquare className="h-6 w-6 mx-auto opacity-50" />
                  <p>No messages yet in this visit.</p>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-2xl max-w-[85%] text-xs ${
                      m.senderRole === 'PATIENT'
                        ? 'bg-slate-800 text-slate-200 mr-auto'
                        : 'bg-emerald-600/90 text-white ml-auto'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] opacity-75 mb-1 font-semibold">
                      <span>{m.senderName}</span>
                      <span>{new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="leading-relaxed break-words">{m.message}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-1.5 pt-2 border-t border-white/10">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void sendChatMessage()}
                placeholder="Type message to patient…"
                className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => void sendChatMessage()}
                disabled={sendingMsg}
                className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition shrink-0"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: CHART HISTORY (mounted only when open: the audited GET runs on first open) */}
        {activeTab === 'history' && showChartHistory && (
          <div className="rounded-2xl bg-white p-3">
            <ChartHistoryCard
              key={clientId}
              variant="panel"
              clientId={clientId}
              role={role}
              cache={chartDigestCache}
              onDenied={() => {
                setChartHistoryDenied(true);
                setActiveTab('soap');
              }}
            />
          </div>
        )}

        {/* TAB 4: BILLING */}
        {activeTab === 'billing' && (
          <div className="space-y-3">
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2.5">
              <span className="font-bold text-slate-200 block">Coding Preview (suggestion only)</span>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Elapsed time:</span>
                  <span className="text-white font-bold">{elapsedMin} min</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5 gap-2">
                  <span className="text-slate-400">Primary CPT:</span>
                  <span className={`font-bold text-right ${coding.primaryCpt ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {coding.primaryCpt ?? coding.primaryNote}
                  </span>
                </div>
                {isNp && (
                  <div className="flex justify-between py-1 border-b border-white/5 gap-2">
                    <span className="text-slate-400">Add-On CPT:</span>
                    <span className={`font-bold text-right ${coding.addOnCpt ? 'text-sky-300' : 'text-slate-400'}`}>
                      {coding.addOnCpt ? `+${coding.addOnCpt}` : coding.addOnNote}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-white/5 gap-2">
                  <span className="text-slate-400">Place of Service:</span>
                  <span className={`font-bold text-right ${coding.pos ? 'text-white' : 'text-amber-300'}`}>{coding.posNote}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">CPT Modifier:</span>
                  <span className="text-purple-300 font-bold">-95 (Synchronous Real-Time Audio/Video)</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Psychotherapy codes follow the elapsed call time (90832 16-37 min, 90834 38-52, 90837 53+). The final code,
                time and POS come from the signed note; billing reviews them before any claim.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 2: Lab order — the shared order form (prescribers; ICD-10 per test, requisition prints) */}
      {labModalOpen && (
        <LabOrderForm
          clientId={clientId}
          clientName={clientName}
          onClose={() => setLabModalOpen(false)}
          onPlaced={(o) => setSavedLabOrderId(o.id)}
        />
      )}

      {/* MODAL 3: In-Call Mobile Crisis Escalation */}
      {crisisModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl text-white space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-rose-500/30">
              <div className="h-10 w-10 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
                <ShieldAlert className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Emergency Mobile Crisis Dispatch</h3>
                <p className="text-xs text-rose-300">Maryland Mobile Crisis / 988 Warm-Transfer</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-500/30 space-y-1">
                <span className="font-bold text-rose-200 block">Patient Information:</span>
                <p className="text-slate-300">Client: {clientName}</p>
                <p className="text-slate-300">
                  Location: {patientLocationState || "Not verified — confirm the patient's current address"}
                </p>
                <p className="text-rose-300 font-semibold">
                  C-SSRS: {note.cssrsRiskScore ? note.cssrsRiskScore : 'Not assessed in this visit'}
                </p>
              </div>
              <p className="text-slate-400">
                This opens a P1 crisis episode in Mobile Crisis (/dashboard/crisis) and logs a page attempt. Automated paging is NOT
                connected — you must phone Maryland mobile crisis / 988 (or 911 for imminent danger) yourself. Your video call stays active.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCrisisModalOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={recordingCrisis || !clientId}
                onClick={() => void recordCrisisDispatch()}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 px-5 py-2 text-xs font-bold text-white shadow-xl shadow-rose-950/50 transition flex items-center gap-1.5 disabled:opacity-60"
              >
                {recordingCrisis ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                <span>Open Crisis Episode</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

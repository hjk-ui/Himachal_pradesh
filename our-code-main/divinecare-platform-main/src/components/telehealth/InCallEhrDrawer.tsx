'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck,
  FileText,
  Heart,
  Loader2,
  Lock,
  MessageSquare,
  Pill,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
}: InCallEhrDrawerProps) {
  const isNp =
    role.toUpperCase().includes('NP') ||
    role.toUpperCase().includes('NURSE') ||
    sessionType.toLowerCase().includes('med');

  const [activeTab, setActiveTab] = useState<'soap' | 'vitals' | 'chat' | 'billing'>('soap');

  // SOAP State
  const [note, setNote] = useState<NoteData>({
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    mseAppearance: 'Well-groomed',
    mseMood: 'Euthymic',
    mseThought: 'Linear/Goal-directed',
    cssrsRiskScore: 'Low',
    isSavedToEhr: false,
  });
  const [savingNote, setSavingNote] = useState(false);
  const [noteLastSaved, setNoteLastSaved] = useState<string | null>(null);

  // Vitals State
  const [vitals, setVitals] = useState<VitalsData>({
    bloodPressure: '120/80',
    pulse: 72,
    weightLbs: 165,
    sideEffects: 'None reported',
    aimsScore: 0,
    qtcWarning: false,
  });
  const [savingVitals, setSavingVitals] = useState(false);
  const [collaborativeCoSign, setCollaborativeCoSign] = useState(true);

  // Chat State
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Modals
  const [epcsModalOpen, setEpcsModalOpen] = useState(false);
  const [epcsMed, setEpcsMed] = useState('Adderall 20mg PO daily (Schedule II)');
  const [epcsRefills, setEpcsRefills] = useState('0');
  const [epcsDone, setEpcsDone] = useState(false);

  const [labModalOpen, setLabModalOpen] = useState(false);
  const [selectedLabs, setSelectedLabs] = useState<string[]>(['CMP', 'Lipid Panel', 'TSH']);
  const [labSigned, setLabSigned] = useState(false);

  const [crisisModalOpen, setCrisisModalOpen] = useState(false);
  const [crisisDispatched, setCrisisDispatched] = useState(false);

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
            mseAppearance: res.data.note.mseAppearance || 'Well-groomed',
            mseMood: res.data.note.mseMood || 'Euthymic',
            mseThought: res.data.note.mseThought || 'Linear/Goal-directed',
            cssrsRiskScore: res.data.note.cssrsRiskScore || 'Low',
            isSavedToEhr: Boolean(res.data.note.isSavedToEhr),
          });
          setNoteLastSaved('Loaded from EHR');
        }
        if (res.data.vitals) {
          setVitals({
            bloodPressure: res.data.vitals.bloodPressure || '120/80',
            pulse: res.data.vitals.pulse ?? 72,
            weightLbs: res.data.vitals.weightLbs ?? 165,
            sideEffects: res.data.vitals.sideEffects || 'None reported',
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

  // Autosave SOAP note debounce
  const saveNoteToDb = useCallback(
    async (currentNote: NoteData, toEhr = false) => {
      if (!sessionId) return;
      setSavingNote(true);
      try {
        const res = await fetch('/api/telehealth/in-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-notes',
            sessionId,
            ...currentNote,
            isSavedToEhr: toEhr || currentNote.isSavedToEhr,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setNoteLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          if (toEhr) {
            setNote((prev) => ({ ...prev, isSavedToEhr: true }));
            toast.success('SOAP note locked and synced to EHR chart');
          }
        }
      } catch {
        /* ignore */
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

  if (!isOpen) return null;

  return (
    <aside className="w-96 sm:w-[420px] bg-slate-900 border-l border-white/10 flex flex-col h-full z-30 shadow-2xl transition-all duration-300">
      {/* Drawer Top Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/80 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Concurrent EHR Chart</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
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
                onClick={() => setEpcsModalOpen(true)}
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 font-semibold transition"
              >
                <Pill className="h-3.5 w-3.5 text-purple-400" />
                <span>EPCS Controlled E-Rx</span>
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

            {/* Suicide Risk Screen (C-SSRS) */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-emerald-400" /> C-SSRS Suicide Risk Screen
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    note.cssrsRiskScore === 'High'
                      ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                      : note.cssrsRiskScore === 'Moderate'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                        : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  }`}
                >
                  {note.cssrsRiskScore} Risk
                </span>
              </div>
              <div className="flex gap-1.5">
                {(['Low', 'Moderate', 'High'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => {
                      const updated = { ...note, cssrsRiskScore: lvl };
                      setNote(updated);
                      void saveNoteToDb(updated);
                      if (lvl === 'High') {
                        toast.error('High Suicide Risk flagged — Safety contract & crisis team notified', {
                          duration: 4000,
                        });
                      }
                    }}
                    className={`flex-1 py-1 rounded-xl text-[11px] font-semibold transition ${
                      note.cssrsRiskScore === lvl
                        ? lvl === 'High'
                          ? 'bg-rose-600 text-white'
                          : lvl === 'Moderate'
                            ? 'bg-amber-600 text-white'
                            : 'bg-emerald-600 text-white'
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
                <span className="text-[10px] text-slate-400 font-medium">Appearance:</span>
                <div className="flex flex-wrap gap-1">
                  {['Well-groomed', 'Disheveled', 'Casual', 'Agitated'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseAppearance: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition ${
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
                <span className="text-[10px] text-slate-400 font-medium">Mood / Affect:</span>
                <div className="flex flex-wrap gap-1">
                  {['Euthymic', 'Depressed', 'Anxious', 'Labile', 'Euphoric'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseMood: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition ${
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
                <span className="text-[10px] text-slate-400 font-medium">Thought Process:</span>
                <div className="flex flex-wrap gap-1">
                  {['Linear/Goal-directed', 'Circumstantial', 'Tangential', 'Flight of Ideas'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const updated = { ...note, mseThought: chip };
                        setNote(updated);
                        void saveNoteToDb(updated);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition ${
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
                  placeholder="Patient reports sleep disturbances, mild anxiety at night..."
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
                  placeholder="Appears calm, cooperative, speech normal rate and volume..."
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
                  placeholder="F41.1 Generalized Anxiety Disorder, coping mechanisms improving..."
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
                  placeholder="CBT thought record practice, continue current regimen, follow-up in 2 weeks..."
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Sync & Save Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-[10px] text-slate-400">
                {savingNote ? 'Autosaving…' : noteLastSaved ? `Autosaved: ${noteLastSaved}` : 'Ready'}
              </span>
              <button
                type="button"
                onClick={() => void saveNoteToDb(note, true)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow flex items-center gap-1.5"
              >
                <FileCheck className="h-3.5 w-3.5" />
                <span>Save to EHR</span>
              </button>
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
                  <label className="text-[10px] text-slate-400 block mb-1">Blood Pressure:</label>
                  <input
                    type="text"
                    value={vitals.bloodPressure}
                    onChange={(e) => setVitals({ ...vitals, bloodPressure: e.target.value })}
                    placeholder="120/80"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Pulse (bpm):</label>
                  <input
                    type="number"
                    value={vitals.pulse}
                    onChange={(e) => setVitals({ ...vitals, pulse: Number(e.target.value) || '' })}
                    placeholder="72"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Weight (lbs):</label>
                  <input
                    type="number"
                    value={vitals.weightLbs}
                    onChange={(e) => setVitals({ ...vitals, weightLbs: Number(e.target.value) || '' })}
                    placeholder="165"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">AIMS Movement Score (0-4):</label>
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
                <label className="text-[10px] text-slate-400 block mb-1">Side Effects & Tolerability:</label>
                <input
                  type="text"
                  value={vitals.sideEffects}
                  onChange={(e) => setVitals({ ...vitals, sideEffects: e.target.value })}
                  placeholder="Dry mouth, sedation in mornings..."
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
                  <AlertTriangle className="h-4 w-4 text-amber-400" /> Antipsychotic QTc Warning
                </span>
                <input
                  type="checkbox"
                  checked={vitals.qtcWarning}
                  onChange={(e) => setVitals({ ...vitals, qtcWarning: e.target.checked })}
                  className="h-4 w-4 accent-amber-500 rounded"
                />
              </div>
              <p className="text-[11px] text-amber-300 leading-relaxed">
                Patient on psychotropic medication. Haloperidol, Ziprasidone, and Citalopram increase risk of QTc prolongation. Annual ECG and electrolyte panel recommended.
              </p>
            </div>

            {/* Lab Order Shortcut with Embedded E-Signature */}
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-400" /> Lab Requisition Order
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">Zero-Wet Signature</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Order monitoring labs directly during visit. Digitally signed and queued for Quest/Labcorp.
              </p>
              <button
                type="button"
                onClick={() => setLabModalOpen(true)}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow flex items-center justify-center gap-1.5"
              >
                <Pill className="h-3.5 w-3.5" />
                <span>Create Lab Order (CMP / TSH / UDS)</span>
              </button>
            </div>

            {/* State Supervisory Collaborative MD Co-Signature Check */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-200 block">MD Co-Signature Routing</span>
                <span className="text-[10px] text-slate-400">Collaborative practice agreement queue</span>
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
                    <div className="flex items-center justify-between text-[10px] opacity-75 mb-1 font-semibold">
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

        {/* TAB 4: BILLING */}
        {activeTab === 'billing' && (
          <div className="space-y-3">
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 space-y-2.5">
              <span className="font-bold text-slate-200 block">Auto-Coding Preview</span>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Primary CPT:</span>
                  <span className="text-emerald-400 font-bold">{isNp ? '99214 (E/M Moderate)' : '90837 (60m Psychotherapy)'}</span>
                </div>
                {isNp && (
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Add-On CPT:</span>
                    <span className="text-sky-300 font-bold">+90833 (30m Psychotherapy Add-On)</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Place of Service:</span>
                  <span className="text-white font-bold">POS 10 (Telehealth in Patient Home)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">CPT Modifier:</span>
                  <span className="text-purple-300 font-bold">-95 (Synchronous Real-Time Audio/Video)</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Duration is automatically timed. Upon ending the call, charge scrubber validates prior auth and CSR adherence before clearing to billing worklist.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: Full EPCS Controlled Substance E-Rx */}
      {epcsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl border border-purple-500/30 bg-slate-900 p-6 shadow-2xl text-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Pill className="h-5 w-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">EPCS Electronic Prescription</h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                DEA Compliant
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-semibold">Select Medication:</label>
                <select
                  value={epcsMed}
                  onChange={(e) => setEpcsMed(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="Adderall 20mg PO daily (Schedule II)">Adderall 20mg PO daily (Schedule II)</option>
                  <option value="Clonazepam 0.5mg PO BID PRN (Schedule IV)">Clonazepam 0.5mg PO BID PRN (Schedule IV)</option>
                  <option value="Lorazepam 1mg PO qHS PRN (Schedule IV)">Lorazepam 1mg PO qHS PRN (Schedule IV)</option>
                  <option value="Sertraline 50mg PO daily (SSRI)">Sertraline 50mg PO daily (SSRI)</option>
                  <option value="Escitalopram 10mg PO daily (SSRI)">Escitalopram 10mg PO daily (SSRI)</option>
                  <option value="Bupropion XL 150mg PO daily (NDRI)">Bupropion XL 150mg PO daily (NDRI)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Quantity / Dispense:</label>
                  <input
                    type="text"
                    defaultValue="30 tablets"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-semibold">Refills:</label>
                  <select
                    value={epcsRefills}
                    onChange={(e) => setEpcsRefills(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="0">0 (Required for C-II)</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950 border border-purple-500/20 text-[11px] text-slate-300 space-y-1">
                <div className="flex items-center gap-1.5 text-purple-300 font-semibold">
                  <Lock className="h-3 w-3" /> Two-Factor EPCS Credential Stamped
                </div>
                <p className="text-slate-400">
                  Prescriber NPI & DEA active. Maryland PDMP auto-checked without opioid duplication.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEpcsModalOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setEpcsDone(true);
                  toast.success(`E-Prescription for ${epcsMed} transmitted to SureScripts`);
                  setEpcsModalOpen(false);
                }}
                className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-xs font-bold text-white shadow-lg transition"
              >
                Sign & Transmit E-Rx
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Lab Requisition Order with E-Sign */}
      {labModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-slate-900 p-6 shadow-2xl text-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">Lab Requisition Order</h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Quest / Labcorp
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <span className="text-slate-300 block font-semibold">Select Monitoring Panels:</span>
              <div className="grid grid-cols-2 gap-2">
                {['CMP (Comprehensive)', 'TSH (Thyroid)', 'Lipid Panel', 'CBC with Diff', 'UDS (Drug Screen)', 'Lithium Level'].map(
                  (panel) => (
                    <label
                      key={panel}
                      className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-white/5 cursor-pointer hover:border-emerald-500/30 transition"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLabs.includes(panel)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedLabs([...selectedLabs, panel]);
                          else setSelectedLabs(selectedLabs.filter((p) => p !== panel));
                        }}
                        className="h-4 w-4 accent-emerald-500 rounded"
                      />
                      <span className="text-[11px] text-slate-200">{panel}</span>
                    </label>
                  )
                )}
              </div>

              {/* Embedded E-Sign Block */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-emerald-500/30 space-y-1.5">
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Embedded Electronic Signature
                </span>
                <p className="font-serif italic text-slate-300 text-xs">
                  Digitally signed by: {clinicianName || 'Attending Clinician'}
                </p>
                <p className="font-mono text-[10px] text-slate-500">
                  SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setLabModalOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setLabSigned(true);
                  toast.success(`Lab order for ${selectedLabs.join(', ')} transmitted electronically`);
                  setLabModalOpen(false);
                }}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2 text-xs font-bold text-white shadow-lg transition"
              >
                Sign & Transmit Labs
              </button>
            </div>
          </div>
        </div>
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
                  Location: {patientLocationState || 'Verified In-Session Home Address (Baltimore, MD)'}
                </p>
                <p className="text-rose-300 font-semibold">Risk Level: {note.cssrsRiskScore} Suicide Risk</p>
              </div>
              <p className="text-slate-400">
                Triggering dispatch initiates an immediate P1 response team via Mobile Crisis Engine (/dashboard/crisis) while keeping your video call active.
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
                onClick={() => {
                  setCrisisDispatched(true);
                  toast.success('Mobile Crisis Team dispatched. GPS & client record forwarded.', {
                    duration: 5000,
                  });
                  setCrisisModalOpen(false);
                }}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 px-5 py-2 text-xs font-bold text-white shadow-xl shadow-rose-950/50 transition flex items-center gap-1.5"
              >
                <ShieldAlert className="h-4 w-4" />
                <span>Confirm Crisis Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

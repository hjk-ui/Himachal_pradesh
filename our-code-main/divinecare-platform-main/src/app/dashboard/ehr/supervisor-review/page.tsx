'use client';
import { useEffect, useMemo, useState } from 'react';
import { fetchEhrProgressNotes } from '@/features/clients';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Clock,
  FileText, MessageSquare, RotateCcw, Shield, User, Users,
  ClipboardList, AlertCircle
} from 'lucide-react';

type RiskSeverity = 'high' | 'medium' | 'low';
type NoteStatus = 'pending_cosign' | 'cosigned' | 'returned';

interface RiskFlag { category: string; severity: RiskSeverity; excerpt: string }
interface SOAPNote { S: string; O: string; A: string; P: string }
interface PendingNote {
  noteId: string;
  clientName: string;
  clinicianName: string;
  clinicianId: string;
  sessionDate: string;
  sessionType: string;
  noteType: string;
  duration: number;
  cptCode: string;
  status: NoteStatus;
  submittedAt: string;
  noteContent: SOAPNote;
  aiSummary: string;
  riskFlags: RiskFlag[];
  supervisorComment: string;
  cosignedAt: string | null;
  returnedAt: string | null;
  returnReason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const RISK_STYLE: Record<RiskSeverity, { dot: string; badge: string; label: string }> = {
  high:   { dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200',   label: 'High Risk' },
  medium: { dot: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Medium' },
  low:    { dot: 'bg-blue-400',   badge: 'bg-blue-50 text-blue-700 border-blue-200',  label: 'Low' },
};

function maxRisk(flags: RiskFlag[]): RiskSeverity | null {
  if (flags.some(f => f.severity === 'high')) return 'high';
  if (flags.some(f => f.severity === 'medium')) return 'medium';
  if (flags.some(f => f.severity === 'low')) return 'low';
  return null;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function daysAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  return d === 0 ? 'Today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

// ─── Return modal ─────────────────────────────────────────────────────────────
function ReturnModal({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Return Note to Clinician</h3>
          <p className="text-sm text-slate-500 mb-4">Provide feedback so the clinician can correct and resubmit.</p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            placeholder="e.g., The Assessment section needs to address the passive SI more explicitly with a documented safety plan rationale..."
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Return Note
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Batch sign modal ─────────────────────────────────────────────────────────
function BatchSignModal({ count, onConfirm, onCancel }: { count: number; onConfirm: (comment: string) => void; onCancel: () => void }) {
  const [comment, setComment] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-md">
        <div className="p-6">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
            <CheckCircle size={24} className="text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Co-sign {count} note{count > 1 ? 's' : ''}?</h3>
          <p className="text-sm text-slate-500 mb-4">
            Your electronic signature will be applied to all selected notes as supervising physician. This action is logged and cannot be undone.
          </p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder="Optional: add a comment visible to the clinician(s)..."
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(comment)}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Sign {count} Note{count > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SOAP section ─────────────────────────────────────────────────────────────
function SOAPSection({ label, text, color }: { label: string; text: string; color: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md text-white ${color}`}>{label}</span>
        <span className="text-xs text-slate-400 flex-1 truncate">{text.slice(0, 60)}…</span>
        {open ? <ChevronDown size={14} className="text-slate-400 shrink-0" />:<ChevronRight size={14} className="text-slate-400 shrink-0" />}
      </button>
      {open && <p className="px-4 py-3 text-sm text-slate-700 leading-relaxed">{text}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SupervisorReviewPage() {
  const [notes, setNotes] = useState<PendingNote[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [filterClinician, setFilterClinician] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'info' } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEhrProgressNotes()
      .then((res) => {
        if (cancelled) return;
        const mapped: PendingNote[] = res.notes
          .filter((note) => note.workflowStatus === 'Draft' || note.workflowStatus === 'Signed' || note.workflowStatus === 'Locked')
          .map((note) => ({
            noteId: note.id,
            clientName: note.clientName,
            clinicianName: note.clinicianName || 'Clinician',
            clinicianId: note.clinicianEmail || note.clinicianName || note.id,
            sessionDate: note.createdAt.slice(0, 10),
            sessionType: 'Individual Therapy',
            noteType: 'SOAP',
            duration: 53,
            cptCode: '90837',
            status: 'pending_cosign',
            submittedAt: note.createdAt,
            noteContent: { S: note.body, O: '', A: '', P: '' },
            aiSummary: note.body.slice(0, 280),
            riskFlags: [],
            supervisorComment: '',
            cosignedAt: null,
            returnedAt: null,
            returnReason: null,
          }));
        setNotes(mapped);
        setActiveNoteId(mapped[0]?.noteId || '');
      })
      .catch(() => {
        if (!cancelled) {
          setNotes([]);
          setActiveNoteId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingNotes = notes.filter(n => n.status === 'pending_cosign');
  const clinicians = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of pendingNotes) {
      if (n.clinicianId) map.set(n.clinicianId, n.clinicianName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [pendingNotes]);
  const visibleNotes = filterClinician
    ? pendingNotes.filter(n => n.clinicianId === filterClinician)
    : pendingNotes;
  const activeNote = notes.find(n => n.noteId === activeNoteId) ?? null;
  const highRiskCount = pendingNotes.filter(n => n.riskFlags.some(f => f.severity === 'high')).length;

  function showToast(msg: string, type: 'success' | 'info' | 'error' = 'success') {
    setToast({ msg, type: type === 'error' ? 'info' : type });
    setTimeout(() => setToast(null), 3000);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === visibleNotes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleNotes.map(n => n.noteId)));
    }
  }

  async function cosignNote(noteId: string, noteComment: string) {
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cosign: true, comment: noteComment }),
      });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        showToast(json.error || 'Co-sign failed — not saved to database', 'error');
        return;
      }
      setNotes((prev) =>
        prev.map((n) =>
          n.noteId === noteId
            ? {
                ...n,
                status: 'cosigned',
                supervisorComment: noteComment,
                cosignedAt: new Date().toISOString(),
              }
            : n
        )
      );
      setSelectedIds((prev) => {
        const s = new Set(prev);
        s.delete(noteId);
        return s;
      });
      const remaining = pendingNotes.filter(
        (n) => n.noteId !== noteId && n.status === 'pending_cosign'
      );
      if (remaining.length > 0) setActiveNoteId(remaining[0]!.noteId);
      showToast('Note co-signed and saved to database');
    } catch {
      showToast('Network error — co-sign not saved', 'error');
    }
  }

  function returnNote(_noteId: string, _reason: string) {
    showToast(
      'Return-for-revision is not persisted yet — use the clinician Notes workflow. No fake success.',
      'error'
    );
    setShowReturnModal(false);
  }

  async function batchCosign(batchComment: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    let ok = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/ehr/notes/${id}/workflow`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Signed' }),
        });
        const json = (await res.json().catch(() => ({}))) as { success?: boolean };
        if (res.ok && json.success) ok += 1;
      } catch {
        /* continue */
      }
    }
    if (ok === 0) {
      showToast('Batch co-sign failed — nothing saved to database', 'error');
      return;
    }
    setNotes((prev) =>
      prev.map((n) =>
        ids.includes(n.noteId) && ok > 0
          ? {
              ...n,
              status: 'cosigned',
              supervisorComment: batchComment,
              cosignedAt: new Date().toISOString(),
            }
          : n
      )
    );
    setSelectedIds(new Set());
    setShowBatchModal(false);
    const remaining = pendingNotes.filter((n) => !ids.includes(n.noteId));
    if (remaining.length > 0) setActiveNoteId(remaining[0]!.noteId);
    showToast(`${ok}/${ids.length} notes co-signed and saved to database`);
  }

  const visibleSelectedCount = visibleNotes.filter(n => selectedIds.has(n.noteId)).length;

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-0">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white transition-all
          ${toast.type === 'success' ? 'bg-blue-600' : 'bg-amber-500'}`}>
          {toast.type === 'success' ? <CheckCircle size={16} />:<RotateCcw size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Modals */}
      {showReturnModal && activeNote && (
        <ReturnModal
          onConfirm={r => returnNote(activeNote.noteId, r)}
          onCancel={() => setShowReturnModal(false)}
        />
      )}
      {showBatchModal && (
        <BatchSignModal
          count={visibleSelectedCount || selectedIds.size}
          onConfirm={batchCosign}
          onCancel={() => setShowBatchModal(false)}
        />
      )}

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Supervisor Review</h1>
        <p className="text-sm text-slate-500 mt-0.5">Co-sign clinician notes for reimbursement optimization — review, comment, and sign individually or in batch.</p>
      </div>

      {/* Stats strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Pending Co-Signature', value: pendingNotes.length, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Clinicians', value: [...new Set(pendingNotes.map(n => n.clinicianId))].length, icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: 'High Risk Flags', value: highRiskCount, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Oldest Pending', value: pendingNotes.length ? daysAgo(pendingNotes.slice().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0].submittedAt) : '—', icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900 leading-none">{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Split pane */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">

        {/* Left — note list */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:w-80">
          {/* Clinician filter tabs */}
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Filter by Clinician</p>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setFilterClinician(null)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors
                  ${!filterClinician ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Users size={13} />
                <span className="flex-1">All Clinicians</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${!filterClinician ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {pendingNotes.length}
                </span>
              </button>
              {clinicians.map(c => {
                const count = pendingNotes.filter(n => n.clinicianId === c.id).length;
                const hasHigh = pendingNotes.some(n => n.clinicianId === c.id && n.riskFlags.some(f => f.severity === 'high'));
                const active = filterClinician === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setFilterClinician(active ? null : c.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors
                      ${active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <User size={13} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {hasHigh && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Select all row */}
          {visibleNotes.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleSelectedCount === visibleNotes.length && visibleNotes.length > 0}
                onChange={toggleSelectAll}
                className="rounded accent-blue-600 cursor-pointer"
              />
              <span className="text-xs text-slate-500">
                {visibleSelectedCount > 0 ? `${visibleSelectedCount} selected` : `Select all (${visibleNotes.length})`}
              </span>
              {visibleSelectedCount > 1 && (
                <button
                  onClick={() => setShowBatchModal(true)}
                  className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                >
                  Sign {visibleSelectedCount}
                </button>
              )}
            </div>
          )}

          {/* Note cards */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {visibleNotes.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle size={32} className="text-blue-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">All caught up</p>
                <p className="text-xs text-slate-400 mt-1">No pending notes{filterClinician ? ' for this clinician' : ''}</p>
              </div>
            ) : visibleNotes.map(note => {
              const risk = maxRisk(note.riskFlags);
              const isActive = note.noteId === activeNoteId;
              const isSelected = selectedIds.has(note.noteId);
              return (
                <div
                  key={note.noteId}
                  onClick={() => setActiveNoteId(note.noteId)}
                  className={`flex gap-2 px-3 py-3 cursor-pointer transition-colors ${isActive ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex flex-col items-center pt-0.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => { e.stopPropagation(); toggleSelect(note.noteId); }}
                      onClick={e => e.stopPropagation()}
                      className="rounded accent-blue-600 cursor-pointer mb-2"
                    />
                    {risk && <span className={`w-2 h-2 rounded-full ${RISK_STYLE[risk].dot}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-slate-900 leading-tight truncate">{note.clientName}</p>
                      <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">{formatDate(note.sessionDate)}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{note.clinicianName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{note.cptCode} · {note.duration} min</p>
                    {note.riskFlags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {note.riskFlags.slice(0, 2).map((f, i) => (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${RISK_STYLE[f.severity].badge}`}>
                            {f.category}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right — detail pane */}
        {activeNote && activeNote.status === 'pending_cosign' ? (
          <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden min-w-0">
            {/* Detail header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold text-slate-900">{activeNote.clientName}</h2>
                  {maxRisk(activeNote.riskFlags) === 'high' && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold ring-1 ring-inset ring-red-100">
                      <AlertTriangle size={11} /> High Risk
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500">
                  {activeNote.clinicianName} · {formatDate(activeNote.sessionDate)} · {activeNote.cptCode} ({activeNote.duration} min)
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Submitted {daysAgo(activeNote.submittedAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowReturnModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw size={14} /> Return
                </button>
                <button
                  onClick={() => cosignNote(activeNote.noteId, comment)}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  <Shield size={14} /> Sign & Co-sign
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* AI Summary */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardList size={14} className="text-blue-600" />
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">AI Summary</p>
                </div>
                <p className="text-sm text-blue-900 leading-relaxed">{activeNote.aiSummary}</p>
              </div>

              {/* Risk flags */}
              {activeNote.riskFlags.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Risk Flags</p>
                  <div className="space-y-2">
                    {activeNote.riskFlags.map((flag, i) => (
                      <div key={i} className={`flex gap-3 px-4 py-3 rounded-xl border ${RISK_STYLE[flag.severity].badge}`}>
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold mb-0.5">{flag.category} <span className="font-normal opacity-75">({RISK_STYLE[flag.severity].label})</span></p>
                          <p className="text-xs leading-relaxed opacity-90">&quot;{flag.excerpt}&quot;</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SOAP note */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Progress Note</p>
                <div className="space-y-2">
                  <SOAPSection label="S" text={activeNote.noteContent.S} color="bg-blue-500" />
                  <SOAPSection label="O" text={activeNote.noteContent.O} color="bg-blue-500" />
                  <SOAPSection label="A" text={activeNote.noteContent.A} color="bg-blue-500" />
                  <SOAPSection label="P" text={activeNote.noteContent.P} color="bg-blue-600" />
                </div>
              </div>

              {/* Supervisor comment */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare size={14} className="text-slate-500" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Supervisor Comment</p>
                  <span className="text-xs text-slate-400">(optional — visible to clinician)</span>
                </div>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={3}
                  placeholder="Add teaching feedback, clinical guidance, or a note about your review..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Sign actions (bottom of scroll) */}
              <div className="flex gap-3 pb-2">
                <button
                  onClick={() => setShowReturnModal(true)}
                  className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw size={15} /> Return to Clinician
                </button>
                <button
                  onClick={() => cosignNote(activeNote.noteId, comment)}
                  className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  <Shield size={15} /> Sign & Co-sign Note
                </button>
              </div>
            </div>
          </div>
        ) : activeNote ? (
          // Already signed or returned
          <div className="flex-1 flex items-center justify-center bg-white rounded-xl border border-slate-200">
            <div className="text-center">
              {activeNote.status === 'cosigned' ? (
                <>
                  <CheckCircle size={40} className="text-blue-500 mx-auto mb-3" />
                  <p className="text-base font-bold text-slate-900">Note Co-signed</p>
                  <p className="text-sm text-slate-500 mt-1">Signed {daysAgo(activeNote.cosignedAt!)}</p>
                  {activeNote.supervisorComment && (
                    <div className="mt-4 mx-auto max-w-sm bg-slate-50 rounded-xl p-4 text-left">
                      <p className="text-xs font-semibold text-slate-500 mb-1">Your comment:</p>
                      <p className="text-sm text-slate-700">{activeNote.supervisorComment}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <RotateCcw size={40} className="text-amber-500 mx-auto mb-3" />
                  <p className="text-base font-bold text-slate-900">Note Returned</p>
                  <p className="text-sm text-slate-500 mt-1">Returned to {activeNote.clinicianName.split(',')[0]}</p>
                  <div className="mt-4 mx-auto max-w-sm bg-amber-50 rounded-xl p-4 text-left border border-amber-100">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Return reason:</p>
                    <p className="text-sm text-amber-900">{activeNote.returnReason}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-white rounded-xl border border-slate-200 border-dashed">
            <div className="text-center text-slate-400">
              <FileText size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Select a note to review</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

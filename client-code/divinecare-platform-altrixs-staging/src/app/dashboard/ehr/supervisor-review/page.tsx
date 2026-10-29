'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, FileText, Lock, MessageSquare, RefreshCw, Shield, User, Users } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { NoteQualityPanel } from '@/components/ai/NoteQualityPanel';
import { SUPERVISOR_ATTESTATION } from '@/lib/notes/standard';
import { buttonClasses, PageHeader, Alert } from '@/components/ui';

/** One signed note awaiting co-signature — shape of GET /api/ehr/supervisor-review */
interface PendingNote {
  noteId: string;
  clientId: string;
  clientName: string;
  authorId: string | null;
  authorName: string | null;
  status: 'Draft' | 'Signed' | 'Locked';
  signedAt: string | null;
  signedByName: string | null;
  body: string;
  noteType: string | null;
  dateOfService: string | null;
  durationMinutes: number | null;
  cptCode: string | null;
  placeOfService: string | null;
  telehealth: boolean;
  part2: boolean;
  aiDrafted: boolean;
  createdAt: string;
}

/** Which notes the queue covers (see cosignQueueScope in src/lib/notes/transitions.ts) */
type ReviewScope = 'all' | 'supervisees_and_caseload' | 'supervisees';

const DASH = '—';

function formatDate(iso: string | null) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatDateTime(iso: string | null) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function daysAgo(iso: string | null) {
  if (!iso) return DASH;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

function authorKey(n: PendingNote) {
  return n.authorId ?? `name:${n.authorName ?? ''}`;
}

// ─── Batch co-sign modal ──────────────────────────────────────────────────────
function BatchCosignModal({
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-clinic-md">
        <div className="p-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10">
            <Shield size={24} className="text-blue-600" />
          </div>
          <h3 className="mb-1 text-lg font-bold text-slate-900">
            Co-sign {count} note{count > 1 ? 's' : ''}?
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            Your co-signature records that you reviewed each selected note as the supervising clinician. It is
            logged and cannot be undone. The notes themselves are not changed.
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Optional comment saved on every selected note"
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={busy}
            className={buttonClasses({ variant: 'secondary', className: 'flex-1' })}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(comment)}
            disabled={busy}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Co-signing…' : `Co-sign ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SupervisorReviewPage() {
  const [notes, setNotes] = useState<PendingNote[]>([]);
  const [scope, setScope] = useState<ReviewScope>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [filterAuthor, setFilterAuthor] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiJson<{ success: true; notes: PendingNote[]; scope: ReviewScope }>(
        '/api/ehr/supervisor-review'
      );
      setNotes(res.notes || []);
      setScope(res.scope);
      // ?noteId= (Clinical Notes worklist "Review & co-sign") opens that note first
      const requested = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('noteId') : null;
      setActiveNoteId((prev) =>
        res.notes.some((n) => n.noteId === prev)
          ? prev
          : requested && res.notes.some((n) => n.noteId === requested)
            ? requested
            : (res.notes[0]?.noteId ?? '')
      );
    } catch (err) {
      setNotes([]);
      setLoadError(err instanceof Error ? err.message : 'Could not load notes awaiting co-signature');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) map.set(authorKey(n), n.authorName || 'Unknown author');
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [notes]);
  const visibleNotes = filterAuthor ? notes.filter((n) => authorKey(n) === filterAuthor) : notes;
  const activeNote = notes.find((n) => n.noteId === activeNoteId) ?? null;
  const activeBody = activeNote ? parseNoteMeta(activeNote.body).displayBody : '';
  const oldest = notes.reduce<string | null>(
    (min, n) => (n.signedAt && (!min || n.signedAt < min) ? n.signedAt : min),
    null
  );
  const visibleSelectedCount = visibleNotes.filter((n) => selectedIds.has(n.noteId)).length;

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (visibleSelectedCount === visibleNotes.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleNotes.map((n) => n.noteId)));
  }

  async function postCosign(noteId: string, noteComment: string): Promise<string | null> {
    try {
      await apiJson(`/api/ehr/notes/${encodeURIComponent(noteId)}/cosign`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(noteComment.trim() ? { comment: noteComment.trim() } : {}),
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Co-sign failed';
    }
  }

  function removeFromQueue(ids: string[]) {
    const remaining = notes.filter((n) => !ids.includes(n.noteId));
    setNotes(remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (ids.includes(activeNoteId)) setActiveNoteId(remaining[0]?.noteId ?? '');
  }

  async function cosignActive() {
    if (!activeNote || busy) return;
    setBusy(true);
    const error = await postCosign(activeNote.noteId, comment);
    setBusy(false);
    if (error) {
      showToast(`${error} Nothing was saved.`, 'error');
      return;
    }
    removeFromQueue([activeNote.noteId]);
    setComment('');
    showToast('Note co-signed');
  }

  async function batchCosign(batchComment: string) {
    const ids = visibleNotes.filter((n) => selectedIds.has(n.noteId)).map((n) => n.noteId);
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const done: string[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const error = await postCosign(id, batchComment);
      if (error) failures.push(error);
      else done.push(id);
    }
    setBusy(false);
    setShowBatchModal(false);
    removeFromQueue(done);
    if (failures.length === 0) showToast(`${done.length} note${done.length === 1 ? '' : 's'} co-signed`);
    else showToast(`${done.length} of ${ids.length} co-signed. ${failures[0]}`, 'error');
  }

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-0">
      {toast && (
        <div
          className={`fixed right-5 top-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg
          ${toast.type === 'success' ? 'bg-blue-600' : 'bg-rose-600'}`}
        >
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {showBatchModal && (
        <BatchCosignModal
          count={visibleSelectedCount}
          busy={busy}
          onConfirm={(c) => void batchCosign(c)}
          onCancel={() => setShowBatchModal(false)}
        />
      )}

      {/* Header */}
      <PageHeader
        title="Supervisor Review"
        description={<>Signed notes that need a supervisor co-signature {scope === 'supervisees' ? ' from clinicians you supervise' : scope === 'supervisees_and_caseload' ? ' from clinicians you supervise or for clients on your caseload' : ''} . Co-signing records your review; it never changes the note. Corrections after signing are made by the author as an addendum.</>}
        actions={<>
          <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        </>}
      />

      {/* Stats strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: 'Awaiting Co-signature', value: loading ? DASH : notes.length, icon: Clock },
          { label: 'Clinicians', value: loading ? DASH : authors.length, icon: Users },
          { label: 'Oldest Signed', value: loading ? DASH : daysAgo(oldest), icon: FileText },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/10">
              <s.icon size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold leading-none text-slate-900">{s.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {loadError && (
        <Alert tone="danger" className="mb-4">{loadError}</Alert>
      )}

      {/* Split pane */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* Left — note list */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:w-80">
          <div className="border-b border-slate-100 px-3 pb-2 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Filter by Clinician</p>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setFilterAuthor(null)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors
                  ${!filterAuthor ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Users size={13} />
                <span className="flex-1">All Clinicians</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${!filterAuthor ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}
                >
                  {notes.length}
                </span>
              </button>
              {authors.map((c) => {
                const count = notes.filter((n) => authorKey(n) === c.id).length;
                const active = filterAuthor === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setFilterAuthor(active ? null : c.id)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors
                      ${active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <User size={13} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {visibleNotes.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <input
                type="checkbox"
                checked={visibleSelectedCount === visibleNotes.length && visibleNotes.length > 0}
                onChange={toggleSelectAll}
                className="cursor-pointer rounded accent-blue-600"
              />
              <span className="text-xs text-slate-500">
                {visibleSelectedCount > 0 ? `${visibleSelectedCount} selected` : `Select all (${visibleNotes.length})`}
              </span>
              {visibleSelectedCount > 1 && (
                <button
                  onClick={() => setShowBatchModal(true)}
                  className="ml-auto rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Co-sign {visibleSelectedCount}
                </button>
              )}
            </div>
          )}

          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-sm text-slate-500">Loading…</p>
            ) : visibleNotes.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle size={32} className="mx-auto mb-2 text-blue-600/50" />
                <p className="text-sm font-semibold text-slate-700">All caught up</p>
                <p className="mt-1 text-xs text-slate-500">
                  No notes awaiting co-signature{filterAuthor ? ' for this clinician' : ''}
                </p>
              </div>
            ) : (
              visibleNotes.map((note) => {
                const isActive = note.noteId === activeNoteId;
                return (
                  <div
                    key={note.noteId}
                    onClick={() => {
                      setActiveNoteId(note.noteId);
                      setComment('');
                    }}
                    className={`flex cursor-pointer gap-2 px-3 py-3 transition-colors ${isActive ? 'bg-blue-600/5' : 'hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(note.noteId)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelect(note.noteId);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 cursor-pointer rounded accent-blue-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className="truncate text-sm font-semibold leading-tight text-slate-900">{note.clientName}</p>
                        <span className="mt-0.5 shrink-0 text-[11px] text-slate-500">
                          {formatDate(note.dateOfService)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{note.authorName || 'Unknown author'}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {note.cptCode || DASH} · {note.durationMinutes != null ? `${note.durationMinutes} min` : DASH}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right — detail pane */}
        {activeNote ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{activeNote.clientName}</h2>
                  <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {activeNote.status === 'Locked' && <Lock size={11} />} {activeNote.status}
                  </span>
                  {activeNote.part2 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                      42 CFR Part 2
                    </span>
                  )}
                  {activeNote.aiDrafted && (
                    <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-semibold text-blue-600">
                      AI-assisted draft
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500">
                  Signed by {activeNote.signedByName || activeNote.authorName || DASH} ·{' '}
                  {formatDateTime(activeNote.signedAt)}
                </p>
              </div>
              <button
                onClick={() => void cosignActive()}
                disabled={busy}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Shield size={14} /> {busy ? 'Co-signing…' : 'Co-sign'}
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 md:grid-cols-4">
                <MetaItem label="Note type" value={activeNote.noteType || DASH} />
                <MetaItem label="Date of service" value={formatDate(activeNote.dateOfService)} />
                <MetaItem
                  label="Duration"
                  value={activeNote.durationMinutes != null ? `${activeNote.durationMinutes} min` : DASH}
                />
                <MetaItem label="CPT" value={activeNote.cptCode || DASH} />
                <MetaItem label="Place of service" value={activeNote.placeOfService || DASH} />
                <MetaItem label="Telehealth" value={activeNote.telehealth ? 'Yes' : 'No'} />
                <MetaItem label="Created" value={formatDate(activeNote.createdAt)} />
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Signed note</p>
                <div className="whitespace-pre-wrap rounded-xl border border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-700">
                  {activeBody.trim() || 'This note has no text.'}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <MessageSquare size={14} className="text-slate-500" />
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Supervisor comment</p>
                  <span className="text-xs text-slate-500">(optional, saved with your co-signature)</span>
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Teaching feedback or clinical guidance for the clinician"
                  className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <NoteQualityPanel
                key={activeNote.noteId}
                noteId={activeNote.noteId}
                mode="cosign"
                comment={comment}
                onCosigned={(id) => {
                  removeFromQueue([id]);
                  setComment('');
                  showToast('Note co-signed; checklist recorded');
                }}
                onReturned={() => showToast('Returned to author with the checklist')}
              />

              <div className="pb-2">
                <button
                  onClick={() => void cosignActive()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  <Shield size={15} /> {busy ? 'Co-signing…' : 'Co-sign note'}
                </button>
                <p className="mt-2 text-center text-xs text-slate-500">
                  Your name, the time, and your comment are recorded on the note and in the audit log.
                </p>
                <p className="mt-1 text-center text-xs text-slate-600">
                  Supervisor attestation (printed with the note): &ldquo;{SUPERVISOR_ATTESTATION}&rdquo; To send it back, use
                  &ldquo;Return to author&rdquo; in the checklist above; the author answers with an addendum.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white">
            <div className="text-center text-slate-500">
              <FileText size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">{loading ? 'Loading…' : 'Select a note to review'}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

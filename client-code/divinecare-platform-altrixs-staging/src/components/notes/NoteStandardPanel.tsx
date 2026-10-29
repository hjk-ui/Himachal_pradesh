'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Copy,
  ExternalLink,
  FileLock,
  Printer,
  Receipt,
  Scale,
  UserRound,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';

type Issue = { id: string; message: string; severity: 'block' | 'warn'; fix?: { label: string; href: string } };
type Amendment = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DENIED';
  requestedBy: string;
  requestedOn: string;
  requestText: string;
  dueOn: string;
  decisionReason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  disagreementStatement: string | null;
};
type StandardResponse = {
  success: true;
  status: 'Draft' | 'Signed' | 'Locked';
  policy: { deadlineHours: number; cloneWarnPercent: number };
  timeliness: {
    state: 'no_dos' | 'due' | 'due_soon' | 'overdue' | 'signed_on_time' | 'late_entry';
    dueAt: string | null;
    hoursLate: number;
    daysSinceService: number | null;
    lateEntryLabel: string | null;
    lateEntryReason: string | null;
    /** Signing now would be a late entry: the sign form asks for the reason */
    lateReasonRequired: boolean;
    lateReasonMinChars: number;
  };
  issues: Issue[];
  clone: { percent: number; likely: boolean; priorNoteId: string; priorDate: string } | null;
  returned: { reviewerName: string | null; comment: string | null; createdAt: string; answered: boolean } | null;
  cosign: { required: boolean; cosignedAt: string | null; cosignedByName: string | null; comment: string | null } | null;
  psychotherapyNotes: { exists: boolean; canOpen: boolean };
  amendments: Amendment[];
  links: {
    clientId: string;
    appointment: { id: string; startsAt: string; status: string } | null;
    claim: { id: string; status: string } | null;
    treatmentPlan: { id: string; status: string; title: string } | null;
  };
};

function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const chip = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold';

/**
 * Note view panel: links (chart, appointment, claim, treatment plan, print), timeliness / late
 * entry, required elements still missing, cloned-note warning, return-for-correction, private
 * psychotherapy notes (author only) and HIPAA amendment requests.
 */
export function NoteStandardPanel({
  noteId,
  onBlockers,
  onLateReason,
  onChanged,
  onAddAddendum,
}: {
  noteId: string;
  /** Blocking messages for the sign button (drafts) */
  onBlockers?: (messages: string[]) => void;
  /** Signing now would be a late entry (past the practice deadline): the reason is required */
  onLateReason?: (rule: { required: boolean; minChars: number }) => void;
  /** Something changed the note's record (e.g. an accepted amendment added an addendum) */
  onChanged?: () => void;
  /** Open the addendum form (answer a return for correction) */
  onAddAddendum?: () => void;
}) {
  const { user } = useAuth();
  // Clinicians see the claim status; only billing roles can open the claim (no 403 dead end)
  const canOpenClaims = canAccessPath(String(user?.role || ''), '/dashboard/billing/claims');
  const [data, setData] = useState<StandardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<StandardResponse>(`/api/notes/${encodeURIComponent(noteId)}/standard`);
      setData(res);
      setError(null);
      onBlockers?.(res.issues.filter((i) => i.severity === 'block').map((i) => i.message));
      onLateReason?.({ required: Boolean(res.timeliness.lateReasonRequired), minChars: res.timeliness.lateReasonMinChars || 10 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load documentation checks');
    }
  }, [noteId, onBlockers, onLateReason]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-xs text-slate-500">Documentation checks unavailable: {error}</p>;
  if (!data) return <p className="text-xs text-slate-400">Loading documentation checks…</p>;

  const t = data.timeliness;
  const signed = data.status !== 'Draft';
  const blocks = data.issues.filter((i) => i.severity === 'block');
  const warns = data.issues.filter((i) => i.severity === 'warn');

  return (
    <div className="space-y-3">
      {/* Links */}
      <nav aria-label="Related records" className="flex flex-wrap gap-2">
        <Link href={`/dashboard/clients/${encodeURIComponent(data.links.clientId)}`} className={`${chip} border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100`}>
          <UserRound size={12} aria-hidden /> Client chart
        </Link>
        {data.links.appointment ? (
          <Link href={`/dashboard/clients/${encodeURIComponent(data.links.clientId)}?tab=appointments`} className={`${chip} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            <CalendarClock size={12} aria-hidden /> Appointment {fmt(data.links.appointment.startsAt)}
          </Link>
        ) : null}
        {data.links.claim ? (
          canOpenClaims ? (
            <Link href={`/dashboard/billing/claims?claimId=${encodeURIComponent(data.links.claim.id)}`} className={`${chip} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              <Receipt size={12} aria-hidden /> Claim · {data.links.claim.status.toLowerCase()}
            </Link>
          ) : (
            <span className={`${chip} border-slate-200 bg-slate-50 text-slate-600`}>
              <Receipt size={12} aria-hidden /> Claim · {data.links.claim.status.toLowerCase()}
            </span>
          )
        ) : null}
        {data.links.treatmentPlan ? (
          <Link href={`/dashboard/ehr/treatment-plans/${encodeURIComponent(data.links.treatmentPlan.id)}`} className={`${chip} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            <ClipboardCheck size={12} aria-hidden /> Treatment plan
          </Link>
        ) : null}
        <Link href={`/dashboard/ehr/notes?filterClient=${encodeURIComponent(data.links.clientId)}`} className={`${chip} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
          All notes for this client
        </Link>
        {signed ? (
          <a href={`/dashboard/ehr/notes/${encodeURIComponent(noteId)}/print`} target="_blank" rel="noopener noreferrer" className={`${chip} border-[#5C2D91]/30 bg-white text-[#5C2D91] hover:bg-violet-50`}>
            <Printer size={12} aria-hidden /> Print / PDF <ExternalLink size={10} aria-hidden />
          </a>
        ) : null}
      </nav>

      {/* Timeliness */}
      <div className="flex flex-wrap gap-2">
        {t.state === 'overdue' ? (
          <span className={`${chip} border-rose-200 bg-rose-50 text-rose-700`}>
            <AlertTriangle size={12} aria-hidden /> Overdue: was due {fmt(t.dueAt)} (practice policy {data.policy.deadlineHours} h)
          </span>
        ) : t.state === 'due_soon' ? (
          <span className={`${chip} border-amber-200 bg-amber-50 text-amber-800`}>
            <Clock size={12} aria-hidden /> Due soon: by {fmt(t.dueAt)} (practice policy {data.policy.deadlineHours} h)
          </span>
        ) : t.state === 'due' ? (
          <span className={`${chip} border-slate-200 bg-slate-50 text-slate-700`}>
            <Clock size={12} aria-hidden /> Due by {fmt(t.dueAt)}
          </span>
        ) : t.state === 'late_entry' ? (
          <span className={`${chip} border-orange-200 bg-orange-50 text-orange-800`}>
            <Clock size={12} aria-hidden /> {t.lateEntryLabel || `Late entry — signed ${t.hoursLate} h after the due time`}
            {t.lateEntryReason ? `. Reason: ${t.lateEntryReason}` : ''}
          </span>
        ) : null}
        {data.cosign?.required ? (
          <span className={`${chip} ${data.cosign.cosignedAt ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-violet-200 bg-violet-50 text-[#5C2D91]'}`}>
            {data.cosign.cosignedAt ? `Co-signed by ${data.cosign.cosignedByName || 'supervisor'} ${fmt(data.cosign.cosignedAt)}` : 'Supervisor co-signature pending'}
          </span>
        ) : null}
      </div>
      {data.cosign?.cosignedAt && data.cosign.comment ? (
        <p className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-900">Supervisor comment: {data.cosign.comment}</p>
      ) : null}

      {/* Returned for correction */}
      {data.returned ? (
        <div className={`rounded-xl border p-3 text-sm ${data.returned.answered ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          <p className="font-semibold">
            {data.returned.answered ? 'Returned for correction — answered with an addendum, awaiting supervisor' : 'Returned for correction'} by {data.returned.reviewerName || 'supervisor'} on {fmt(data.returned.createdAt)}
          </p>
          {data.returned.comment ? <p className="mt-1 whitespace-pre-wrap text-xs">{data.returned.comment}</p> : null}
          {!data.returned.answered && onAddAddendum ? (
            <button type="button" onClick={onAddAddendum} className="mt-2 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white">
              Correct with an addendum
            </button>
          ) : null}
          <p className="mt-1 text-[11px] opacity-80">The signed note is never edited; your addendum keeps the original visible.</p>
        </div>
      ) : null}

      {/* Required elements (drafts) */}
      {!signed && (blocks.length || warns.length) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Required before signing</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blocks.map((i) => (
              <li key={i.id}>
                {i.message}
                {i.fix ? (
                  <>
                    {' '}
                    <Link href={i.fix.href} className="font-semibold text-[#5C2D91] underline hover:no-underline">
                      {i.fix.label}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {warns.length ? (
            <ul className="mt-2 space-y-0.5 text-amber-800">
              {warns.map((i) => (
                <li key={i.id}>Note: {i.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Cloned note */}
      {data.clone?.likely ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Copy size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong>Possible cloned note:</strong> {data.clone.percent}% the same as the client&apos;s note from {data.clone.priorDate} (practice threshold {data.policy.cloneWarnPercent}%).
            Payers deny notes that repeat prior visits; document what was specific to this session.
          </span>
        </div>
      ) : null}

      {data.psychotherapyNotes.canOpen ? <PsychotherapyNotes noteId={noteId} exists={data.psychotherapyNotes.exists} /> : null}

      <AmendmentRequests noteId={noteId} clientId={data.links.clientId} signed={signed} items={data.amendments} onChanged={() => {
        void load();
        onChanged?.();
      }} />
    </div>
  );
}

function PsychotherapyNotes({ noteId, exists }: { noteId: string; exists: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiJson<{ success: true; text: string }>(`/api/notes/${encodeURIComponent(noteId)}/psychotherapy-notes`)
      .then((r) => {
        setText(r.text);
        setLoaded(true);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : 'Could not open'));
  }, [open, loaded, noteId]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(noteId)}/psychotherapy-notes`, { method: 'PUT', body: JSON.stringify({ text }) });
      setMsg(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-slate-800">
        <FileLock size={14} aria-hidden /> Psychotherapy notes (private){exists ? ' · has notes' : ''}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-600">
            HIPAA psychotherapy notes: your private process notes, kept separate from the clinical record. Only you can see them. They are never printed, exported,
            released, billed, copied forward or sent to AI. Do not put diagnosis, medications, session times, risk assessment or the treatment plan here; those belong in the note.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={20000}
            aria-label="Psychotherapy notes (private)"
            disabled={!loaded}
            className="w-full resize-y rounded-xl border border-slate-200 bg-white p-2.5 text-sm focus:border-[#5C2D91] focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={!loaded || saving} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save private notes'}
            </button>
            {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AmendmentRequests({ noteId, clientId, signed, items, onChanged }: { noteId: string; clientId: string; signed: boolean; items: Amendment[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [requestedBy, setRequestedBy] = useState('Client');
  const [requestedOn, setRequestedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [requestText, setRequestText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; action: 'accept' | 'deny' | 'extend' | 'disagreement'; text: string } | null>(null);

  if (!signed && items.length === 0) return null;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiJson('/api/notes/amendment-requests', { method: 'POST', body: JSON.stringify({ clientId, noteId, requestedBy, requestedOn, requestText }) });
      setAdding(false);
      setRequestText('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    setErr(null);
    const body =
      deciding.action === 'accept'
        ? { action: 'accept', amendmentText: deciding.text }
        : deciding.action === 'disagreement'
          ? { action: 'disagreement', statement: deciding.text }
          : { action: deciding.action, reason: deciding.text };
    try {
      await apiJson(`/api/notes/amendment-requests/${encodeURIComponent(deciding.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      setDeciding(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const labels = { accept: 'Amendment text (added to the note as an addendum)', deny: 'Basis for the denial (sent to the client in writing)', extend: 'Reason for the 30-day extension', disagreement: 'Client’s statement of disagreement' };

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Scale size={14} aria-hidden /> Client amendment requests (HIPAA 164.526)
        </p>
        {signed && !adding ? (
          <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-[#5C2D91] hover:underline">
            Log a request
          </button>
        ) : null}
      </div>
      {err ? <p className="mt-1 text-xs text-rose-600">{err}</p> : null}
      {adding ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Requested by
            <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} maxLength={200} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Received on
            <input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            What the client asks to change
            <textarea value={requestText} onChange={(e) => setRequestText(e.target.value)} rows={3} maxLength={8000} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !requestText.trim() || !requestedBy.trim()} onClick={() => void create()} className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Save request (due in 60 days)
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {items.length ? (
        <ul className="mt-2 space-y-2">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-700">
              <p className="font-semibold">
                {a.status === 'PENDING' ? `Pending — decide by ${a.dueOn}` : a.status === 'ACCEPTED' ? 'Accepted' : 'Denied'} · from {a.requestedBy} on {a.requestedOn}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{a.requestText}</p>
              {a.decisionReason ? <p className="mt-1 text-slate-600">Decision ({a.decidedByName || 'staff'}): {a.decisionReason}</p> : null}
              {a.disagreementStatement ? <p className="mt-1 text-slate-600">Statement of disagreement: {a.disagreementStatement}</p> : null}
              {deciding?.id === a.id ? (
                <div className="mt-2 space-y-1.5">
                  <label className="block font-semibold">
                    {labels[deciding.action]}
                    <textarea value={deciding.text} onChange={(e) => setDeciding({ ...deciding, text: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm font-normal" />
                  </label>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !deciding.text.trim()} onClick={() => void decide()} className="rounded-lg bg-[#5C2D91] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                      Save
                    </button>
                    <button type="button" onClick={() => setDeciding(null)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : a.status === 'PENDING' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['accept', 'deny', 'extend'] as const).map((action) => (
                    <button key={action} type="button" onClick={() => setDeciding({ id: a.id, action, text: '' })} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold capitalize text-slate-700 hover:bg-slate-100">
                      {action}
                    </button>
                  ))}
                </div>
              ) : a.status === 'DENIED' && !a.disagreementStatement ? (
                <button type="button" onClick={() => setDeciding({ id: a.id, action: 'disagreement', text: '' })} className="mt-2 text-xs font-semibold text-[#5C2D91] hover:underline">
                  Record the client&apos;s statement of disagreement
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : signed && !adding ? (
        <p className="mt-1 text-[11px] text-slate-500">None. A client may ask to amend their record; the original note always stays unchanged.</p>
      ) : null}
    </div>
  );
}

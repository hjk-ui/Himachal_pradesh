'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, History, Plus, ShieldAlert, Sparkles, Star, X } from 'lucide-react';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import {
  DIAGNOSIS_SOURCE_LABEL,
  DIAGNOSIS_STATUS_LABEL,
  REASON_REQUIRED,
  isCurrent,
  type DiagnosisRow,
  type DiagnosisStatus,
  type ReviewContext,
  type ReviewState,
} from '@/lib/diagnoses/model';
import { Pill, fmtDate, fmtDateTime } from './ChartSection';

type Issue = { id: string; severity: 'block' | 'warn' | 'info'; message: string; alternatives?: { code: string; description: string }[] };
type Row = DiagnosisRow & { issues?: Issue[] };
type ListData = {
  rows: Row[];
  structured: boolean;
  migrated: boolean;
  review: ReviewState;
  canEdit: boolean;
  suggestions: { id: string; code: string; description: string; origin: string; rationale: string | null; createdAt: string }[];
  drfirst: { id: string; code: string; description: string; rcopiaProblemId: string | null }[];
  part2Reminder: boolean;
};
type HistoryEvent = { id: string; diagnosisId: string | null; action: string; context: string | null; before: unknown; after: unknown; reason: string | null; actorName: string | null; createdAt: string };

const STATUS_TONE: Record<DiagnosisStatus, 'emerald' | 'amber' | 'slate' | 'rose' | 'sky'> = {
  ACTIVE: 'emerald',
  PROVISIONAL: 'amber',
  RULED_OUT: 'slate',
  RESOLVED: 'sky',
  ENTERED_IN_ERROR: 'rose',
};

const ACTION_LABEL: Record<string, string> = {
  ADDED: 'Added',
  UPDATED: 'Updated',
  STATUS: 'Status changed',
  RANK: 'Rank changed',
  REVIEWED: 'Reviewed',
  IMPORTED: 'Carried over',
};

const btn = 'inline-flex min-h-10 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] md:min-h-0 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] disabled:opacity-50';
const primaryBtn = 'inline-flex items-center gap-1 rounded-md bg-[#5C2D91] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#4a2475] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] focus-visible:ring-offset-1 disabled:opacity-50';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false || body.error === 'SENSITIVE_RECORD') {
    const err = new Error(body.error === 'SENSITIVE_RECORD' ? 'Protected record (42 CFR Part 2): request access to view diagnoses.' : body.error || `Request failed (${res.status})`) as Error & { issues?: Issue[] };
    err.issues = body.issues;
    throw err;
  }
  return body as T;
}

/**
 * The client's diagnosis list on the chart: ranked current diagnoses (exactly one primary),
 * status chips, history drawer, "Reviewed — no change", DrFirst and AI suggestions that a
 * clinician accepts or dismisses. Keyboard accessible: every action is a button; rank moves with
 * the up / down buttons. Nothing is deleted.
 */
export function DiagnosisListPanel({ clientId, reviewContext = 'manual', compact = false, onChanged }: { clientId: string; reviewContext?: ReviewContext; compact?: boolean; onChanged?: () => void }) {
  const base = `/api/clients/${encodeURIComponent(clientId)}/diagnoses`;
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await call<ListData & { success: true }>(base);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the diagnosis list');
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, body: Record<string, unknown>, done?: string) =>
    act(() => call(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, context: reviewContext }) }), done);

  const review = () =>
    act(() => call(base, { method: 'POST', body: JSON.stringify({ action: 'review', context: reviewContext }) }), 'Review recorded: no change.');

  if (!data) {
    return error ? <p className="text-sm text-rose-700">{error}</p> : <p className="text-sm text-slate-500">Loading diagnoses…</p>;
  }
  const current = data.rows.filter(isCurrent);
  const past = data.rows.filter((r) => !isCurrent(r));
  const r = data.review;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Diagnosis list</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] ${r.due ? 'font-semibold text-amber-800' : 'text-slate-500'}`} role="status">
            {r.lastReviewedAt ? `Last reviewed ${fmtDate(r.lastReviewedAt.slice(0, 10))}${r.lastReviewedBy ? ` by ${r.lastReviewedBy}` : ''}` : 'Not reviewed yet'}
            {r.due ? (r.lastReviewedAt ? ` — review due (every ${r.intervalDays} days)` : ' — review due') : r.dueOn ? ` — next review by ${fmtDate(r.dueOn)}` : ''}
          </span>
          {data.canEdit ? (
            <button type="button" className={btn} disabled={busy} onClick={() => void review()}>
              <CheckCircle2 size={12} aria-hidden /> Reviewed — no change
            </button>
          ) : null}
          <button type="button" className={btn} onClick={() => setHistoryOpen(true)}>
            <History size={12} aria-hidden /> History
          </button>
          {data.canEdit && !adding ? (
            <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
              <Plus size={12} aria-hidden /> Add diagnosis
            </button>
          ) : null}
        </div>
      </div>

      {!data.structured && data.rows.length ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
          These diagnoses come from the client record (Valant import or profile). The first change or review saves them as the diagnosis list.
        </p>
      ) : null}
      {data.part2Reminder ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          A substance use diagnosis is on this list. If the client is treated in the SUD (42 CFR Part 2) program, mark the record protected so the existing Part 2 rules apply.
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-700" role="alert">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-700" role="status">{notice}</p> : null}

      {adding ? <AddDiagnosisForm base={base} hasPrimary={current.length > 0} reviewContext={reviewContext} onCancel={() => setAdding(false)} onSaved={async (msg) => { setAdding(false); setNotice(msg); await load(); onChanged?.(); }} /> : null}

      {current.length ? (
        <ol className="space-y-1.5" aria-label="Current diagnoses, primary first">
          {current.map((d, i) => (
            <DiagnosisItem
              key={d.id}
              d={d}
              index={i}
              count={current.length}
              canEdit={data.canEdit}
              busy={busy}
              compact={compact}
              onMove={(move) => void patch(d.id, { move }, move === 'primary' ? `${d.code || 'Diagnosis'} is now primary.` : undefined)}
              onStatus={(status, reason, resolvedDate) => void patch(d.id, { status, statusReason: reason, resolvedDate }, `${d.code || 'Diagnosis'}: ${DIAGNOSIS_STATUS_LABEL[status].toLowerCase()}.`)}
            />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-500">No current diagnosis on the list.</p>
      )}

      {data.drfirst.length || data.suggestions.length ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#5C2D91]">
            <Sparkles size={12} aria-hidden /> Suggestions to review (not on the list until a clinician adds them)
          </p>
          <ul className="space-y-1">
            {data.drfirst.map((s) => (
              <li key={`df-${s.id}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-800">
                <span className="font-mono font-bold">{s.code}</span>
                <span>{s.description}</span>
                <Pill tone="sky">DrFirst problem list</Pill>
                {data.canEdit ? (
                  <button type="button" className={btn} disabled={busy} onClick={() => void act(() => call(base, { method: 'POST', body: JSON.stringify({ action: 'add', code: s.code, description: s.description, drfirstProblemId: s.rcopiaProblemId || s.id }) }), `${s.code} added from DrFirst.`)}>
                    <Plus size={11} aria-hidden /> Add to list
                  </button>
                ) : null}
              </li>
            ))}
            {data.suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-800">
                <span className="font-mono font-bold">{s.code}</span>
                <span>{s.description}</span>
                <Pill tone="purple">{s.origin === 'ai_scribe' ? 'AI scribe' : s.origin === 'coding_agent' ? 'AI coding' : 'AI'}</Pill>
                {s.rationale ? <span className="text-slate-500">{s.rationale}</span> : null}
                {data.canEdit ? (
                  <>
                    <button type="button" className={btn} disabled={busy} onClick={() => void act(() => call(`${base}/suggestions`, { method: 'PATCH', body: JSON.stringify({ id: s.id, decision: 'ACCEPTED' }) }), `${s.code} added.`)}>
                      Accept
                    </button>
                    <button type="button" className={btn} disabled={busy} onClick={() => void act(() => call(`${base}/suggestions`, { method: 'PATCH', body: JSON.stringify({ id: s.id, decision: 'DISMISSED' }) }), 'Suggestion dismissed.')}>
                      Dismiss
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {past.length ? (
        <div>
          <button type="button" className="text-[11px] font-semibold text-[#5C2D91] hover:underline" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide' : 'Show'} resolved, ruled out and entered in error ({past.length})
          </button>
          {showPast ? (
            <ul className="mt-1.5 space-y-1">
              {past.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <Pill tone={STATUS_TONE[d.status]}>{DIAGNOSIS_STATUS_LABEL[d.status]}</Pill>
                  <span className={`font-mono font-semibold ${d.status === 'ENTERED_IN_ERROR' ? 'line-through' : ''}`}>{d.code || 'Uncoded'}</span>
                  <span>{d.dsmName || d.description}</span>
                  {d.resolvedDate ? <span>since {fmtDate(d.resolvedDate)}</span> : null}
                  {d.statusReason ? <span className="italic">({d.statusReason})</span> : null}
                  {data.canEdit && d.status !== 'ENTERED_IN_ERROR' ? (
                    <button type="button" className={btn} disabled={busy} onClick={() => void patch(d.id, { status: 'ACTIVE' }, `${d.code || 'Diagnosis'} is active again.`)}>
                      Reactivate
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {historyOpen ? <HistoryDrawer base={base} rows={data.rows} onClose={() => setHistoryOpen(false)} /> : null}
    </div>
  );
}

function DiagnosisItem({
  d,
  index,
  count,
  canEdit,
  busy,
  compact,
  onMove,
  onStatus,
}: {
  d: Row;
  index: number;
  count: number;
  canEdit: boolean;
  busy: boolean;
  compact: boolean;
  onMove: (m: 'up' | 'down' | 'primary') => void;
  onStatus: (s: DiagnosisStatus, reason: string | null, resolvedDate: string | null) => void;
}) {
  const [changing, setChanging] = useState<DiagnosisStatus | null>(null);
  const [reason, setReason] = useState('');
  const [resolvedOn, setResolvedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const label = d.code || 'Uncoded diagnosis';
  const warn = (d.issues || []).filter((i) => i.severity !== 'info');
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs font-bold text-slate-500" aria-label={`Rank ${index + 1}`}>
          {index + 1}.
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {d.isPrimary ? (
              <Pill tone="purple">
                <Star size={10} className="mr-0.5" aria-hidden /> Primary
              </Pill>
            ) : null}
            <span className="font-mono text-sm font-bold text-slate-900">{d.code || <Pill tone="amber">Needs coding</Pill>}</span>
            <Pill tone={STATUS_TONE[d.status]}>{DIAGNOSIS_STATUS_LABEL[d.status]}</Pill>
          </div>
          <p className="text-sm text-slate-800">{d.dsmName || d.description}</p>
          {d.dsmName && d.dsmName !== d.description ? <p className="text-[11px] text-slate-500">ICD-10-CM: {d.description}</p> : null}
          {!compact ? (
            <p className="text-[11px] text-slate-500">
              {d.onsetDate ? `Onset ${fmtDate(d.onsetDate)} · ` : ''}
              {d.diagnosingProviderName ? `${d.diagnosingProviderName} · ` : ''}
              {DIAGNOSIS_SOURCE_LABEL[d.source] || d.source}
            </p>
          ) : null}
          {warn.map((i) => (
            <div key={i.id} className="mt-1 text-[11px] text-amber-800">
              {i.message}
              {i.alternatives?.length ? (
                <span className="block text-slate-600">More specific: {i.alternatives.slice(0, 6).map((a) => `${a.code} ${a.description}`).join('; ')}</span>
              ) : null}
            </div>
          ))}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={btn} disabled={busy || index === 0} onClick={() => onMove('up')} aria-label={`Move ${label} up`}>
              <ArrowUp size={12} aria-hidden />
            </button>
            <button type="button" className={btn} disabled={busy || index === count - 1} onClick={() => onMove('down')} aria-label={`Move ${label} down`}>
              <ArrowDown size={12} aria-hidden />
            </button>
            {!d.isPrimary ? (
              <button type="button" className={btn} disabled={busy} onClick={() => onMove('primary')}>
                Make primary
              </button>
            ) : null}
            <label className="sr-only" htmlFor={`dx-status-${d.id}`}>
              Change status of {label}
            </label>
            <select
              id={`dx-status-${d.id}`}
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value as DiagnosisStatus;
                if (!v) return;
                if (REASON_REQUIRED.has(v)) setChanging(v);
                else onStatus(v, null, null);
              }}
            >
              <option value="">Status…</option>
              {(['ACTIVE', 'PROVISIONAL', 'RESOLVED', 'RULED_OUT', 'ENTERED_IN_ERROR'] as DiagnosisStatus[])
                .filter((s) => s !== d.status)
                .map((s) => (
                  <option key={s} value={s}>
                    {DIAGNOSIS_STATUS_LABEL[s]}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
      </div>
      {changing ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
          <label className="text-[11px] font-semibold text-slate-700">
            Reason ({DIAGNOSIS_STATUS_LABEL[changing].toLowerCase()})
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="mt-0.5 block w-64 max-w-full rounded-md border border-slate-300 px-2 py-1 text-xs" maxLength={1000} />
          </label>
          {changing === 'RESOLVED' ? (
            <label className="text-[11px] font-semibold text-slate-700">
              Resolved on
              <input type="date" value={resolvedOn} onChange={(e) => setResolvedOn(e.target.value)} className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1 text-xs" />
            </label>
          ) : null}
          <button
            type="button"
            className={primaryBtn}
            disabled={busy || reason.trim().length < 3}
            onClick={() => {
              onStatus(changing, reason.trim(), changing === 'RESOLVED' ? resolvedOn : null);
              setChanging(null);
              setReason('');
            }}
          >
            Save
          </button>
          <button type="button" className={btn} onClick={() => setChanging(null)}>
            Cancel
          </button>
          {d.isPrimary && count > 1 ? <p className="w-full text-[11px] text-slate-600">The next diagnosis on the list becomes primary.</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function AddDiagnosisForm({
  base,
  hasPrimary,
  reviewContext,
  onCancel,
  onSaved,
}: {
  base: string;
  hasPrimary: boolean;
  reviewContext: ReviewContext;
  onCancel: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'PROVISIONAL'>('ACTIVE');
  const [onset, setOnset] = useState('');
  const [dsmName, setDsmName] = useState('');
  const [makePrimary, setMakePrimary] = useState(!hasPrimary);
  const [preview, setPreview] = useState<{ code: string; description: string | null; billable: boolean; dsmName: string | null; issues: Issue[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = code.trim();
    if (!/^[A-Za-z][0-9][0-9A-Za-z](\.?[0-9A-Za-z]{1,4})?$/.test(c)) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      call<{ code: string; description: string | null; billable: boolean; dsmName: string | null; issues: Issue[] }>(base, { method: 'POST', body: JSON.stringify({ action: 'preview', code: c, makePrimary }) })
        .then((p) => {
          setPreview(p);
          if (p.dsmName) setDsmName((v) => v || p.dsmName || '');
        })
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [code, makePrimary, base]);

  const blocked = preview?.issues.some((i) => i.severity === 'block');
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await call<{ row: DiagnosisRow; issues: Issue[] }>(base, {
        method: 'POST',
        body: JSON.stringify({ action: 'add', code: code.trim(), status, onsetDate: onset || null, dsmName: dsmName.trim() || null, makePrimary, context: reviewContext }),
      });
      await onSaved(`${res.row.code} added${res.row.isPrimary ? ' as primary' : ''}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the diagnosis');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3" role="group" aria-label="Add diagnosis">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <span className="text-[11px] font-semibold text-slate-700">ICD-10-CM code or words (FY2027)</span>
          <Icd10CodeInput value={code} onChange={(c) => setCode(c)} context="bh" autoFocus ariaLabel="ICD-10-CM code or words" placeholder="F33.1 or major depressive recurrent" inputClassName="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-xs" />
        </div>
        <label className="text-[11px] font-semibold text-slate-700">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'PROVISIONAL')} className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs">
            <option value="ACTIVE">Active</option>
            <option value="PROVISIONAL">Provisional</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-700">
          Onset
          <input type="date" value={onset} onChange={(e) => setOnset(e.target.value)} className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
          <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} className="accent-[#5C2D91]" /> Primary
        </label>
      </div>
      <label className="block text-[11px] font-semibold text-slate-700">
        DSM-5-TR name (optional)
        <input value={dsmName} onChange={(e) => setDsmName(e.target.value)} maxLength={300} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="e.g. Major depressive disorder, recurrent episode, moderate" />
      </label>
      {preview ? (
        <div className="text-[11px]">
          {preview.description ? <p className="text-slate-700">{preview.code}: {preview.description}</p> : null}
          {preview.issues.map((i) => (
            <p key={i.id} className={i.severity === 'block' ? 'text-rose-700' : 'text-amber-800'}>
              {i.message}
              {i.alternatives?.length ? (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {i.alternatives.slice(0, 8).map((a) => (
                    <button key={a.code} type="button" className="rounded border border-slate-300 bg-white px-1.5 font-mono text-[11px] text-slate-700 hover:bg-slate-50" title={a.description} onClick={() => setCode(a.code)}>
                      {a.code}
                    </button>
                  ))}
                </span>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
      {err ? <p className="text-[11px] text-rose-700" role="alert">{err}</p> : null}
      <div className="flex gap-2">
        <button type="button" className={primaryBtn} disabled={busy || !code.trim() || blocked} onClick={() => void save()}>
          Add
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          <X size={12} aria-hidden /> Cancel
        </button>
      </div>
    </div>
  );
}

function HistoryDrawer({ base, rows, onClose }: { base: string; rows: Row[]; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<{ events: HistoryEvent[] }>(`${base}/history`)
      .then((b) => setEvents(b.events))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load history'));
  }, [base]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const codeOf = (id: string | null) => {
    const r = rows.find((x) => x.id === id);
    return r ? r.code || r.description : null;
  };
  const describe = (e: HistoryEvent) => {
    const b = (e.before || {}) as Record<string, unknown>;
    const a = (e.after || {}) as Record<string, unknown>;
    if (e.action === 'STATUS') return `${String(b.status ?? '').toLowerCase()} → ${String(a.status ?? '').toLowerCase()}`;
    if (e.action === 'RANK') return `rank ${b.rank ?? '—'} → ${a.rank ?? '—'}`;
    if (e.action === 'REVIEWED') return a.changed ? 'with changes' : 'no change';
    return '';
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Diagnosis history" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Diagnosis history</h3>
          <button type="button" className={btn} onClick={onClose} autoFocus aria-label="Close history">
            <X size={12} aria-hidden />
          </button>
        </div>
        {err ? <p className="text-xs text-rose-700">{err}</p> : null}
        {!events && !err ? <p className="text-xs text-slate-500">Loading…</p> : null}
        {events && !events.length ? <p className="text-xs text-slate-500">No changes recorded yet.</p> : null}
        <ol className="space-y-2">
          {(events || []).map((e) => (
            <li key={e.id} className="border-l-2 border-violet-200 pl-2 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">
                {ACTION_LABEL[e.action] || e.action} {codeOf(e.diagnosisId) ? <span className="font-mono">{codeOf(e.diagnosisId)}</span> : null} {describe(e)}
              </p>
              <p className="text-[11px] text-slate-500">
                {fmtDateTime(e.createdAt)}
                {e.actorName ? ` · ${e.actorName}` : ''}
                {e.context && e.context !== 'manual' ? ` · ${e.context.replace(/_/g, ' ')}` : ''}
              </p>
              {e.reason ? <p className="text-[11px] italic text-slate-600">{e.reason}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BedDouble,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ClipboardCheck,
  Clock,
  Download,
  FileSearch,
  Lock,
  RefreshCw,
  ScanSearch,
  Scale,
  Shield,
  Sparkles,
  Square,
  Users,
  XCircle,
  Zap,
  Activity,
} from 'lucide-react';
import { DISCLAIMER, PROGRAM_META } from '@/lib/clinical/serviceEligibility/criteria';
import {
  GAP_LABELS,
  PROGRAMS,
  type EligibilityStatus,
  type ProgramKey,
  type ProgramResult,
  type ScannedClient,
} from '@/lib/clinical/serviceEligibility/types';
import {
  DEFAULT_FILTERS,
  DISMISS_REASONS,
  DISMISS_REASON_LABELS,
  SNOOZE_DAYS,
  activeDecision,
  listRows,
  pageOf,
  tileCounts,
  tierCounts,
  TIER_LABELS,
  type Tier,
  type DecisionState,
  type DismissReason,
  type RevenueEstimate,
  type ScannerRow,
  type ViewFilters,
  type Workflow,
} from '@/lib/clinical/serviceEligibility/view';
import type { PayerClass, PayerFit } from '@/lib/clinical/serviceEligibility/payerFit';
import type { RationaleResult } from '@/lib/clinical/serviceEligibility/ai';
import { PageHeader, buttonClasses, Alert } from '@/components/ui';

const AUTH_FORECAST_HREF = '/dashboard/billing/authorizations';
const ICONS: Record<ProgramKey, typeof Users> = { prp: Users, spravato: Zap, tms: Brain, aot: Shield, residential: BedDouble, iop: Activity };

const STATUS: Record<EligibilityStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  candidate: { label: 'Candidate', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  potential: { label: 'Potential', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: CircleHelp },
  review: { label: 'Needs review', cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: Scale },
  enrolled: { label: 'Enrolled', cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: ClipboardCheck },
  screen: { label: 'Dx only — screen', cls: 'bg-slate-50 text-slate-600 border-slate-200', icon: CircleHelp },
  not_indicated: { label: 'Not indicated', cls: 'bg-slate-50 text-slate-500 border-slate-200', icon: XCircle },
};

type ListResponse = {
  success: true;
  generatedAt: string | null;
  lastRun: { trigger: string; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null } | null;
  scanBusy: boolean;
  clientsInScope: number;
  clientsScanned: number;
  notScanned: number;
  notIndicatedOnly: number;
  sensitiveHidden: number;
  truncated: boolean;
  rows: ScannerRow[];
  conversion: Record<ProgramKey, { accepted: number; enrolled: number; declined: number }>;
  viewerId: string;
  clinicians: { id: string; name: string }[];
  locations: { id: string; name: string }[];
};

type DetailResponse = {
  success: true;
  client: ScannedClient;
  decisions: Partial<Record<ProgramKey, DecisionState>>;
  payerFit: Partial<Record<ProgramKey, PayerFit>>;
  revenue: Partial<Record<ProgramKey, RevenueEstimate>>;
  evaluatedAt: string;
};

const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function Badge({ status, decision }: { status: EligibilityStatus; decision?: DecisionState | null }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <Icon size={12} aria-hidden /> {s.label}
      {decision && <span className="ml-0.5 text-[11px] font-bold uppercase opacity-80">· {decision.action}</span>}
    </span>
  );
}

function Criteria({ r }: { r: ProgramResult }) {
  const rows: { state: 'met' | 'unmet' | 'unknown' | 'confirm'; text: string }[] = [
    ...r.met.map((text) => ({ state: 'met' as const, text })),
    ...r.unmet.map((text) => ({ state: 'unmet' as const, text })),
    ...r.missing.map((text) => ({ state: 'unknown' as const, text })),
    ...r.confirm.map((text) => ({ state: 'confirm' as const, text })),
  ];
  const meta = {
    met: { label: 'Met', cls: 'text-emerald-700', icon: CheckCircle2 },
    unmet: { label: 'Not met', cls: 'text-rose-700', icon: XCircle },
    unknown: { label: 'Unknown — missing', cls: 'text-sky-700', icon: CircleHelp },
    confirm: { label: 'Clinician confirms', cls: 'text-slate-600', icon: ClipboardCheck },
  };
  return (
    <ul className="space-y-1">
      {rows.map((x, i) => {
        const m = meta[x.state];
        const Icon = m.icon;
        return (
          <li key={i} className={`flex items-start gap-2 text-xs ${m.cls}`}>
            <Icon size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span className="w-28 shrink-0 font-semibold">{m.label}</span>
            <span>{x.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AiSummary({ clientId, program }: { clientId: string; program: ProgramKey }) {
  const [state, setState] = useState<{ loading: boolean; label?: string; result?: RationaleResult; error?: string }>({ loading: false });
  const run = async (refresh = false) => {
    setState({ loading: true });
    try {
      const res = await fetch(`/api/ehr/scanner/service-eligibility/${encodeURIComponent(clientId)}/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program, refresh }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'AI unavailable');
      setState({ loading: false, label: json.label, result: json.result });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : 'AI unavailable' });
    }
  };
  useEffect(() => setState({ loading: false }), [clientId, program]);
  const r = state.result;
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-blue-700"><Sparkles size={13} aria-hidden /> AI clinical summary</p>
        <button onClick={() => void run(Boolean(r))} disabled={state.loading} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {state.loading ? 'Summarizing…' : r ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      {state.error && <p className="mt-2 text-xs text-rose-700">{state.error}</p>}
      {r?.status === 'ok' && (
        <div className="mt-2 space-y-1">
          <p className="text-sm text-slate-800">
            {r.sentences.map((s, i) => (
              <span key={i}>
                {s.text.replace(/\s*\[?fact\d+\]?/gi, '')}{' '}
                <sup className="text-[11px] font-semibold text-blue-600">[{s.cites.map((c) => c.replace('fact', '')).join(',')}]</sup>{' '}
              </span>
            ))}
          </p>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">Facts the summary was grounded in ({r.facts.length})</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">{r.facts.map((f) => <li key={f.id}>{f.text}</li>)}</ol>
          </details>
          <p className="text-[11px] text-blue-700">{state.label}{r.cached ? ' · cached' : ''}</p>
        </div>
      )}
      {r && r.status !== 'ok' && <p className="mt-2 text-xs text-slate-700">{r.message}</p>}
      {!r && !state.error && <p className="mt-1 text-xs text-slate-500">On demand. Decision support only — grounded in the chart facts below; the clinician decides.</p>}
    </div>
  );
}

function Workflow({
  clientId,
  r,
  decision,
  onChanged,
}: {
  clientId: string;
  r: ProgramResult;
  decision: DecisionState | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState<DismissReason>('not_appropriate');
  const [note, setNote] = useState('');
  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/ehr/scanner/service-eligibility/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, program: r.program, ...payload }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save');
      if (payload.action === 'accept') {
        setMsg(json.alreadyReferred ? 'Already referred — the open referral stays with the program lead.' : json.recipient ? `Referral sent to ${json.recipient.name ?? 'the program lead'} (To-Do).` : 'Referral created — no program lead is set, so it is in the Alerts list.');
      }
      setDismissing(false);
      onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const actionable = r.status === 'candidate' || r.status === 'potential' || r.status === 'review';
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-slate-500">Workflow</p>
      {decision && (
        <p className="text-xs text-slate-700">
          <span className="font-semibold capitalize">{decision.action}</span>
          {decision.reason ? ` — ${DISMISS_REASON_LABELS[decision.reason]}${decision.reasonNote ? `: ${decision.reasonNote}` : ''}` : ''}
          {decision.snoozeUntil ? ` until ${decision.snoozeUntil.slice(0, 10)}` : ''}
          {decision.outcome ? ` · outcome: ${decision.outcome.replace('_', ' ')}` : ''} · {fmtDateTime(decision.decidedAt)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actionable && decision?.action !== 'accepted' && (
          <button disabled={busy} onClick={() => void post({ action: 'accept', statusAtDecision: r.status })} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
            Accept — refer to program
          </button>
        )}
        {actionable && decision?.action !== 'dismissed' && (
          <button disabled={busy} onClick={() => setDismissing((v) => !v)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Dismiss…
          </button>
        )}
        {actionable &&
          SNOOZE_DAYS.map((d) => (
            <button key={d} disabled={busy} onClick={() => void post({ action: 'snooze', days: d })} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              <Clock size={12} aria-hidden /> {d}d
            </button>
          ))}
        {decision?.action === 'accepted' &&
          (['enrolled', 'declined', 'not_enrolled'] as const).map((o) => (
            <button key={o} disabled={busy} onClick={() => void post({ action: 'outcome', outcome: o })} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              Outcome: {o.replace('_', ' ')}
            </button>
          ))}
        {decision && (
          <button disabled={busy} onClick={() => void post({ action: 'reopen' })} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Reopen
          </button>
        )}
      </div>
      {dismissing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select aria-label="Dismiss reason" value={reason} onChange={(e) => setReason(e.target.value as DismissReason)} className="rounded-lg border border-slate-300 p-1.5 text-xs">
            {DISMISS_REASONS.map((x) => <option key={x} value={x}>{DISMISS_REASON_LABELS[x]}</option>)}
          </select>
          <input aria-label="Dismiss note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'other' ? 'Reason (required)' : 'Note (optional)'} maxLength={500} className="flex-1 rounded-lg border border-slate-300 p-1.5 text-xs" />
          <button disabled={busy || (reason === 'other' && note.trim().length < 3)} onClick={() => void post({ action: 'dismiss', reason, note: note.trim() || undefined, statusAtDecision: r.status })} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Confirm dismiss
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-slate-700">{msg}</p>}
    </div>
  );
}

function ProgramDetail({ detail, program, onChanged }: { detail: DetailResponse; program: ProgramKey; onChanged: () => void }) {
  const r = detail.client.results[program];
  const meta = PROGRAM_META[program];
  const fit = detail.payerFit[program];
  const rev = detail.revenue[program];
  const decision = detail.decisions[program] ?? null;
  const canRefer = r.status === 'candidate' || r.status === 'potential' || r.status === 'review';
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-800">{meta.fullName}</p>
        <Badge status={r.status} />
        <span className="text-xs text-slate-500">evaluated {fmtDateTime(detail.evaluatedAt)}</span>
      </div>
      <p className="text-sm text-slate-700">{r.summary}</p>
      {r.flags.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase text-rose-700">Flags</p>
          <ul className="space-y-1">{r.flags.map((t, i) => <li key={i} className="flex gap-1.5 text-xs text-rose-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{t}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase text-slate-500">Why — each criterion</p>
        <Criteria r={r} />
      </div>
      {r.missing.length > 0 && (
        <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
          <p className="mb-1.5 text-xs font-bold uppercase text-sky-700">Missing data to confirm</p>
          <ul className="space-y-1">
            {r.gaps.map((g) => <li key={g} className="flex items-center gap-1.5 text-xs text-sky-800"><Square size={12} aria-hidden /> {GAP_LABELS[g]}</li>)}
            {r.gaps.length === 0 && r.missing.map((t, i) => <li key={i} className="flex items-center gap-1.5 text-xs text-sky-800"><Square size={12} aria-hidden /> {t}</li>)}
          </ul>
        </div>
      )}
      {r.evidence.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-1.5 text-xs font-bold uppercase text-slate-500">Chart evidence (source · date)</p>
          <ul className="space-y-1">
            {r.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-700">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{e.kind}</span>
                {e.href ? <Link href={e.href} className="hover:underline">{e.text}</Link> : <span>{e.text}</span>}
                <span className="text-slate-500">{e.date ?? 'date not recorded'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(fit || rev) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fit && (
            <div className="rounded-lg border border-slate-100 p-3 text-xs text-slate-700">
              <p className="mb-1 font-bold uppercase text-slate-500">Payer fit (typical — confirm benefits)</p>
              <p><span className="font-semibold">{fit.coverage.replace('_', ' ')}</span>{fit.priorAuth === true ? ' · prior auth usually required' : fit.priorAuth === false ? ' · prior auth usually not required' : ''}</p>
              <p className="mt-0.5 text-slate-500">{fit.note}</p>
              {fit.priorAuth && <Link href={AUTH_FORECAST_HREF} className="mt-1 inline-block font-semibold text-blue-600 hover:underline">Authorizations &amp; forecast</Link>}
            </div>
          )}
          {rev && (
            <div className="rounded-lg border border-slate-100 p-3 text-xs text-slate-700">
              <p className="mb-1 font-bold uppercase text-slate-500">Revenue (estimate, fee schedule)</p>
              <p className="font-semibold">
                {rev.estimateCents != null ? usd(rev.estimateCents) : rev.feeCents != null ? `${usd(rev.feeCents)} per unit (${rev.code})` : 'Not available'}
              </p>
              <p className="mt-0.5 text-slate-500">{rev.basis}</p>
            </div>
          )}
        </div>
      )}
      {r.status !== 'not_indicated' && r.status !== 'enrolled' && <AiSummary clientId={detail.client.id} program={program} />}
      <Workflow clientId={detail.client.id} r={r} decision={decision} onChanged={onChanged} />
      <div className="flex flex-wrap gap-2 pt-1">
        {canRefer && (
          <Link href={meta.referral.href(detail.client.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50">
            {meta.referral.label} <ChevronRight size={12} aria-hidden />
          </Link>
        )}
        <Link href={`/dashboard/clients/${encodeURIComponent(detail.client.id)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Open chart</Link>
        <Link href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(detail.client.id)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Document in chart</Link>
      </div>
    </div>
  );
}

function ClientDetail({ row, initial, onChanged }: { row: ScannerRow; initial: ProgramKey; onChanged: () => void }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [program, setProgram] = useState<ProgramKey>(initial);
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/ehr/scanner/service-eligibility/${encodeURIComponent(row.id)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the evidence');
      setDetail(json as DetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the evidence');
    }
  }, [row.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">Loading criteria and evidence…</p>;
  const changed = detail.client.results && PROGRAMS.some((p) => detail.client.results[p].status !== row.statuses[p]);
  return (
    <div>
      {changed && <p className="mb-2 text-xs text-amber-700">The chart changed since the last scan — statuses below are evaluated now; Re-scan to update the list.</p>}
      {row.priority.reasons.length > 0 && <p className="mb-2 text-xs text-slate-600">Urgency: {row.priority.reasons.join(' · ')}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {PROGRAMS.map((p) => (
          <button key={p} onClick={() => setProgram(p)} aria-pressed={program === p} className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-semibold ${program === p ? 'border-blue-400 shadow-xs' : 'border-slate-200 hover:border-slate-300'}`}>
            <span className="text-blue-600">{PROGRAM_META[p].label}</span>
            <Badge status={detail.client.results[p].status} decision={detail.decisions[p] ?? null} />
          </button>
        ))}
      </div>
      <ProgramDetail
        detail={detail}
        program={program}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />
    </div>
  );
}

function ProgramLeads() {
  const [data, setData] = useState<{ leads: { program: string; leadUserId: string }[]; staff: { id: string; name: string | null; role: string }[]; canEdit: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || data) return;
    void fetch('/api/ehr/scanner/service-eligibility/leads', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j.success && setData(j));
  }, [open, data]);
  const save = async (program: ProgramKey, leadUserId: string) => {
    await fetch('/api/ehr/scanner/service-eligibility/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program, leadUserId: leadUserId || null }) });
    setData(null);
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />} Program leads (receive Accept referrals)
      </button>
      {open && !data && <p className="mt-2 text-xs text-slate-500">Loading…</p>}
      {open && data && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {PROGRAMS.map((p) => {
            const current = data.leads.find((l) => l.program === p)?.leadUserId ?? '';
            return (
              <label key={p} className="text-xs text-slate-600">
                <span className="mb-1 block font-semibold">{PROGRAM_META[p].label}</span>
                {data.canEdit ? (
                  <select value={current} onChange={(e) => void save(p, e.target.value)} className="w-full rounded-lg border border-slate-200 p-1.5 text-xs">
                    <option value="">Not set (referral goes to Alerts)</option>
                    {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id} · {s.role}</option>)}
                  </select>
                ) : (
                  <span>{current ? 'Set' : 'Not set'}</span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ServiceEligibilityScanner() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ViewFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const set = (patch: Partial<ViewFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ehr/scanner/service-eligibility${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the scan');
      setData(json as ListResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the scan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Deep link from a To-Do: ?clientId=…
    try {
      const id = new URLSearchParams(window.location.search).get('clientId');
      if (id) setExpanded(id);
    } catch {
      /* ignore */
    }
  }, [load]);

  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useMemo(() => ({ ...filters, viewerId: data?.viewerId ?? null }), [filters, data?.viewerId]);
  const counts = useMemo(() => (data ? tileCounts(data.rows, f, now) : null), [data, f, now]);
  const tiers = useMemo(() => (data ? tierCounts(data.rows, f, now) : null), [data, f, now]);
  const tier: Tier = f.tier ?? 'actionable';
  const rows = useMemo(() => (data ? listRows(data.rows, f, now) : []), [data, f, now]);
  const paged = pageOf(rows, page);

  const exportHref = (p: ProgramKey) => {
    const q = new URLSearchParams({ program: p, status: f.status, workflow: f.workflow, tier, clinician: f.clinician, location: f.location, payer: f.payer, caseload: f.caseload ?? 'all' });
    return `/api/ehr/scanner/service-eligibility/export?${q}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Eligibility Scanner"
        description="Active clients in your scope screened for PRP · Spravato · TMS · AOT · Residential SUD · SUD IOP"
        actions={<>
          <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/ehr/scanner/sud-radar" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <FileSearch size={14} aria-hidden /> SUD Referral Radar
          </Link>
          {f.program !== 'all' && (
            <a href={exportHref(f.program)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <Download size={14} aria-hidden /> Export {PROGRAM_META[f.program].label} CSV
            </a>
          )}
          <button onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden /> {loading ? 'Loading…' : 'Re-scan now'}
          </button>
        </div>
        </>}
      >
        {data && (
            <p className="mt-1 text-xs text-slate-500">
              Last scan {fmtDateTime(data.generatedAt)}
              {data.lastRun ? ` · ${data.lastRun.trigger === 'cron' ? 'nightly' : 'run on demand'}${data.lastRun.status === 'failed' ? ' (last run failed)' : ''}` : ''}
              {data.scanBusy ? ' · a scan is running — showing the last results' : ''}
            </p>
          )}
      </PageHeader>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <ScanSearch size={18} className="mt-0.5 shrink-0 text-blue-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-blue-800">Clinical decision support — not a clinical determination</p>
          <p className="mt-0.5 text-xs text-blue-700">
            {DISCLAIMER} Diagnoses come from the chart (Valant diagnosis import) and problem list, scores from recorded PHQ-9 (assessments and
            imported measurements), C-SSRS and LOCUS, ASAM ratings from signed Substance Abuse Intakes, and enrollment also from billed program
            codes. The Valant medication history was not imported: where no medication list is on file, trial criteria show as missing.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => void load()} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold">Try again</button>
        </div>
      )}
      {data && data.notScanned > 0 && (
        <Alert tone="warning">
          {data.notScanned} active client{data.notScanned === 1 ? '' : 's'} added since the last scan {data.notScanned === 1 ? 'is' : 'are'} not in the list yet — Re-scan now to include them.
        </Alert>
      )}

      {/* Program tiles — each number opens exactly the rows it counts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {PROGRAMS.map((p) => {
          const meta = PROGRAM_META[p];
          const Icon = ICONS[p];
          const c = counts?.[p];
          const active = f.program === p;
          const conv = data?.conversion[p];
          const all: { s: EligibilityStatus; label: string; cls: string }[] = [
            { s: 'candidate', label: 'Candidates', cls: 'text-emerald-700' },
            { s: 'review', label: 'Review', cls: 'text-sky-700' },
            { s: 'potential', label: 'Potential', cls: 'text-amber-700' },
            { s: 'screen', label: 'Dx only', cls: 'text-slate-600' },
            { s: 'enrolled', label: 'Enrolled', cls: 'text-blue-700' },
          ];
          const forTier: Record<Tier, EligibilityStatus[]> = {
            actionable: p === 'aot' ? ['review', 'enrolled'] : ['candidate', 'potential', 'enrolled'],
            needs_data: ['potential'],
            dx_only: ['screen'],
            all: p === 'aot' ? ['review', 'enrolled'] : ['candidate', 'potential', 'screen', 'enrolled'],
          };
          const cells = all.filter((x) => forTier[tier].includes(x.s));
          const tc = tiers?.[p];
          return (
            <div key={p} className={`rounded-xl border p-4 ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-100 bg-white'}`}>
              <button onClick={() => set({ program: active && f.status === 'all' ? 'all' : p, status: 'all' })} aria-pressed={active} className="mb-3 flex w-full items-center gap-2 text-left">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600">
                  <Icon size={16} className="text-white" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800">{meta.label}</p>
                  <p className="truncate text-xs text-slate-500">{meta.fullName}</p>
                </div>
              </button>
              <div className="flex items-baseline gap-4">
                {cells.map((x) => (
                  <button key={x.s} onClick={() => set({ program: p, status: x.s })} aria-label={`${meta.label} ${x.label}`} className={`text-left ${active && f.status === x.s ? 'underline' : ''}`}>
                    <p className={`text-xl font-semibold ${x.cls}`}>{c ? c[x.s] : '–'}</p>
                    <p className="text-xs text-slate-500">{x.label}</p>
                  </button>
                ))}
              </div>
              {tc && tier === 'actionable' && (tc.needs_data > 0 || tc.dx_only > 0) && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Hidden:{' '}
                  {tc.needs_data > 0 && <button onClick={() => set({ program: p, status: 'all', tier: 'needs_data' })} className="underline">needs data {tc.needs_data}</button>}
                  {tc.needs_data > 0 && tc.dx_only > 0 && ' · '}
                  {tc.dx_only > 0 && <button onClick={() => set({ program: p, status: 'all', tier: 'dx_only' })} className="underline">diagnosis only {tc.dx_only}</button>}
                </p>
              )}
              {conv && conv.accepted > 0 && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Referred {conv.accepted} · enrolled {conv.enrolled} ({Math.round((100 * conv.enrolled) / conv.accepted)}%)
                </p>
              )}
            </div>
          );
        })}
      </div>

      {f.program !== 'all' && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
          <p className="mb-2 text-xs font-bold uppercase text-blue-600">{PROGRAM_META[f.program].fullName} — criteria screened</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-700">{PROGRAM_META[f.program].criteria.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="mt-2 text-xs text-slate-500">
            Sources:{' '}
            {PROGRAM_META[f.program].citations.map((c, i) => (
              <Fragment key={c.label}>
                {i > 0 && ' · '}
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.label}</a> : c.label}
              </Fragment>
            ))}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="grid gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search client, MRN or diagnosis…" aria-label="Search clients" className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 sm:col-span-2" />
        <select aria-label="Program" value={filters.program} onChange={(e) => set({ program: e.target.value as ProgramKey | 'all' })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All programs</option>
          {PROGRAMS.map((p) => <option key={p} value={p}>{PROGRAM_META[p].label}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as EligibilityStatus | 'all' })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All statuses (indicated)</option>
          {(['candidate', 'potential', 'review', 'screen', 'enrolled', 'not_indicated'] as const).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <select aria-label="Tier" value={tier} onChange={(e) => set({ tier: e.target.value as Tier, status: 'all' })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          {(['actionable', 'needs_data', 'dx_only', 'all'] as const).map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
              {t !== 'all' && tiers ? ` (${tiers[f.program][t]})` : ''}
            </option>
          ))}
        </select>
        <select aria-label="Workflow" value={filters.workflow} onChange={(e) => set({ workflow: e.target.value as Workflow })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="open">Open worklist (hides dismissed / snoozed)</option>
          <option value="accepted">Accepted (referred)</option>
          <option value="dismissed">Dismissed</option>
          <option value="snoozed">Snoozed</option>
          <option value="all">Everything</option>
        </select>
        <select aria-label="Caseload" value={filters.caseload} onChange={(e) => set({ caseload: e.target.value as 'all' | 'mine' })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All clients in my scope</option>
          <option value="mine">My caseload (assigned to me)</option>
        </select>
        <select aria-label="Clinician" value={filters.clinician} onChange={(e) => set({ clinician: e.target.value })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All clinicians</option>
          {data?.clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">Unassigned</option>
        </select>
        <select aria-label="Location" value={filters.location} onChange={(e) => set({ location: e.target.value })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All locations</option>
          {data?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="none">No location</option>
        </select>
        <select aria-label="Payer" value={filters.payer} onChange={(e) => set({ payer: e.target.value as PayerClass | 'all' })} className="rounded-xl border border-slate-200 p-2.5 text-sm">
          <option value="all">All payers</option>
          <option value="medicaid">Maryland Medicaid / PBHS</option>
          <option value="medicare">Medicare</option>
          <option value="commercial">Commercial</option>
          <option value="self_pay">Self-pay</option>
          <option value="unknown">No insurance charted</option>
        </select>
      </div>

      {/* Results */}
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-semibold text-slate-700">
            {data ? `${rows.length} client${rows.length === 1 ? '' : 's'} shown` : loading ? 'Loading…' : 'No scan yet'}
            <span className="ml-2 text-xs font-normal text-slate-500">sorted by clinical urgency{f.program !== 'all' ? ', then estimated revenue' : ''}</span>
          </p>
          {data && (
            <p className="text-xs text-slate-500">
              {data.clientsScanned} active client{data.clientsScanned === 1 ? '' : 's'} scanned
              {data.notIndicatedOnly ? ` · ${data.notIndicatedOnly} with no program indicated (hidden)` : ''}
              {data.sensitiveHidden ? (
                <span className="inline-flex items-center gap-1"> · <Lock size={11} aria-hidden /> {data.sensitiveHidden} protected record{data.sensitiveHidden === 1 ? '' : 's'} not shown</span>
              ) : null}
              {data.truncated ? ' · scan limit reached' : ''}
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-5 py-3 text-left font-semibold">Client</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold">Urgency</th>
                <th scope="col" className="px-3 py-3 text-left font-semibold">Primary diagnosis</th>
                {PROGRAMS.map((p) => <th scope="col" key={p} className="px-2 py-3 text-center font-semibold">{PROGRAM_META[p].label}</th>)}
                <th scope="col" className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.rows.map((c) => {
                const open = expanded === c.id;
                const first = f.program !== 'all' ? f.program : PROGRAMS.find((p) => c.statuses[p] !== 'not_indicated') ?? 'prp';
                return (
                  <Fragment key={c.id}>
                    <tr onClick={() => setExpanded(open ? null : c.id)} className="cursor-pointer transition-colors hover:bg-slate-50" aria-expanded={open}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          {[c.mrn, c.age !== null ? `age ${c.age}` : 'DOB not recorded', c.clinician?.name ?? 'Unassigned', c.location?.name ?? 'No location', c.payer ?? 'No insurance charted'].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-xs" title={c.priority.reasons.join(' · ')}>
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${c.priority.level === 'high' ? 'bg-rose-50 text-rose-700' : c.priority.level === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'}`}>
                          {c.priority.level}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">{c.primaryDx ?? <span className="text-slate-500">None charted</span>}</td>
                      {PROGRAMS.map((p) => (
                        <td key={p} className="px-2 py-3 text-center">
                          <Badge status={c.statuses[p]} decision={activeDecision(c, p, now)} />
                        </td>
                      ))}
                      <td className="px-3 py-3 text-right">
                        {open ? <ChevronUp size={16} className="inline text-slate-500" aria-hidden /> : <ChevronDown size={16} className="inline text-slate-500" aria-hidden />}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={PROGRAMS.length + 4} className="border-b border-slate-100 bg-slate-50 px-5 py-5">
                          <ClientDetail row={c} initial={first} onChanged={() => void load()} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data && rows.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              {data.clientsInScope === 0
                ? 'No active clients in your scope to scan.'
                : data.rows.length === 0
                  ? `${data.clientsScanned} active client${data.clientsScanned === 1 ? '' : 's'} scanned — none has charted data that points to these programs.`
                  : tier === 'actionable' && tiers && (tiers[f.program].needs_data || tiers[f.program].dx_only)
                    ? `No actionable suggestions for these filters — ${tiers[f.program].needs_data} need data, ${tiers[f.program].dx_only} diagnosis only (choose them in the Tier filter).`
                    : 'No clients match the current filters.'}
            </div>
          )}
          {!data && loading && <div className="px-6 py-12 text-center text-sm text-slate-500">Loading the latest scan…</div>}
        </div>
        {paged.pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            <button disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} aria-label="Previous page" className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"><ChevronLeft size={14} aria-hidden /></button>
            <span>Page {paged.page} of {paged.pages}</span>
            <button disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} aria-label="Next page" className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"><ChevronRight size={14} aria-hidden /></button>
          </div>
        )}
      </div>

      <ProgramLeads />

      <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-rose-800">AOT — legal process (Maryland)</p>
          <p className="mt-0.5 text-xs text-rose-700">
            Assisted Outpatient Treatment is governed by Health-General § 10-6A-05. The scanner shows chart context only; run the statutory
            screen in the <Link href="/dashboard/aot" className="font-semibold underline">AOT module</Link> and never initiate a petition from scanner results.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <Zap size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-amber-800">Spravato — REMS required</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Spravato is dispensed only through the SPRAVATO REMS: the setting must be certified, the patient enrolled, and each dose
            self-administered under direct observation with at least 2 hours of post-dose monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}

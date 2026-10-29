'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClaimsClearinghousePanel } from '@/components/clinical/ClaimsClearinghousePanel';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchClaims,
  generateClaimFromNote,
  patchClaimStatus,
  type ClaimDbStatus,
  type ClaimRecord,
} from '@/features/billing/claimsApi';
import { loadLockedNotes, type LockedNoteSnapshot } from '@/lib/notes/workflow';

const STATUS_META: Record<ClaimDbStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'bg-slate-100 text-slate-600' },
  READY: { label: 'Ready', tone: 'bg-blue-50 text-blue-700' },
  SUBMITTED: { label: 'Submitted', tone: 'bg-indigo-50 text-indigo-700' },
  ACCEPTED: { label: 'Accepted', tone: 'bg-emerald-50 text-emerald-700' },
  DENIED: { label: 'Denied', tone: 'bg-rose-50 text-rose-700' },
  PAID: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-700' },
};

const FILTERS: Array<ClaimDbStatus | 'all'> = [
  'all',
  'DRAFT',
  'READY',
  'SUBMITTED',
  'ACCEPTED',
  'DENIED',
  'PAID',
];

function currencyFromCents(cents: number | null) {
  const value = (cents ?? 0) / 100;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusMeta(status: ClaimDbStatus) {
  return STATUS_META[status] ?? { label: status, tone: 'bg-slate-100 text-slate-600' };
}

export default function ClaimsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading claims…
        </div>
      }
    >
      <ClaimsWorkspace />
    </Suspense>
  );
}

function ClaimsWorkspace() {
  const searchParams = useSearchParams();
  const claimIdFromUrl = searchParams.get('claimId');
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [lockedNotes, setLockedNotes] = useState<LockedNoteSnapshot[]>([]);
  const [filter, setFilter] = useState<ClaimDbStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ClaimRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchClaims();
      setClaims(rows);
      setError(null);
      setSelected((prev) => {
        const prefer = claimIdFromUrl || prev?.id;
        if (!prefer) return prev;
        return rows.find((c) => c.id === prefer) ?? prev;
      });
      const notes = await loadLockedNotes().catch(() => [] as LockedNoteSnapshot[]);
      setLockedNotes(notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load claims');
    } finally {
      setLoading(false);
    }
  }, [claimIdFromUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const claimedNoteIds = useMemo(
    () => new Set(claims.map((c) => c.progressNoteId).filter(Boolean)),
    [claims]
  );
  const unlockedForClaim = lockedNotes.filter((n) => !claimedNoteIds.has(n.noteId));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return claims.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.displayId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        (c.payer || '').toLowerCase().includes(q) ||
        c.cptCode.toLowerCase().includes(q) ||
        (c.clinicianName || '').toLowerCase().includes(q)
      );
    });
  }, [claims, filter, query]);

  const stats = useMemo(() => {
    return {
      action: claims.filter((c) => c.status === 'DRAFT' || c.status === 'READY' || c.status === 'DENIED').length,
      submitted: claims.filter((c) => c.status === 'SUBMITTED' || c.status === 'ACCEPTED').length,
      paid: claims.filter((c) => c.status === 'PAID').reduce((sum, c) => sum + (c.amountCents ?? 0), 0),
      denied: claims.filter((c) => c.status === 'DENIED').length,
    };
  }, [claims]);

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(FILTERS.filter((s) => s !== 'all').map((s) => [s, 0])) as Record<
      ClaimDbStatus,
      number
    >;
    for (const claim of claims) {
      byStatus[claim.status] = (byStatus[claim.status] || 0) + 1;
    }
    return byStatus;
  }, [claims]);

  const run = async (fn: () => Promise<ClaimRecord>) => {
    setBusy(true);
    setError(null);
    try {
      const row = await fn();
      setClaims((prev) => {
        const next = prev.some((c) => c.id === row.id)
          ? prev.map((c) => (c.id === row.id ? row : c))
          : [row, ...prev];
        return next;
      });
      setSelected(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="overflow-hidden rounded-[28px] bg-[#10182f] text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr] lg:p-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Billing workflow</p>
            <h1 className="mt-3 text-3xl font-black">Claims</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
              Live payer claims from the clinic database. Filter, search, and move a claim through draft → ready →
              submit → accept / deny / paid. Prepare billing details and submit through the clearinghouse panel.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Action needed', value: stats.action, icon: AlertTriangle },
              { label: 'In flight', value: stats.submitted, icon: Send },
              { label: 'Paid posted', value: currencyFromCents(stats.paid), icon: DollarSign },
              { label: 'Denied', value: stats.denied, icon: ShieldCheck },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <Icon size={18} className="text-indigo-200" />
                <p className="mt-3 text-2xl font-black">{value}</p>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ClaimsClearinghousePanel claims={visible} selected={selected} onChanged={load} />
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-rose-800 ring-1 ring-rose-200"
          >
            Retry
          </button>
        </div>
      ) : null}

      {unlockedForClaim.length > 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Generate from locked note</p>
          <div className="mt-3 space-y-2">
            {unlockedForClaim.slice(0, 8).map((note) => (
              <div key={note.noteId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{note.clientName}</p>
                  <p className="text-xs text-slate-500">Locked {new Date(note.lockedAt).toLocaleDateString()}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => generateClaimFromNote(note.noteId))}
                  className="rounded-xl bg-[#6868D0] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  Generate claim
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, payer, CPT, claim ID"
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none ring-0 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
          />
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/billing" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
            Overview
          </Link>
          <Link href="/dashboard/billing/denials" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
            Denials
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const count = item === 'all' ? claims.length : counts[item] || 0;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                filter === item ? 'bg-[#6868D0] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              {item === 'all' ? 'All' : statusMeta(item).label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[1.2fr_0.9fr_0.8fr_0.7fr_0.8fr] border-b border-slate-100 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400 md:grid">
            <span>Claim</span>
            <span>Payer</span>
            <span>Service</span>
            <span>Charge</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? (
              <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Loading claims…
              </p>
            ) : null}
            {!loading && visible.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                {error
                  ? 'Claims could not be loaded from the database.'
                  : claims.length === 0
                    ? 'No claims yet. Generate one from a locked progress note or run npm run db:seed:billing.'
                    : 'No claims match these filters.'}
              </p>
            ) : null}
            {visible.map((claim) => (
              <button
                key={claim.id}
                type="button"
                onClick={() => setSelected(claim)}
                className={`grid w-full gap-2 px-5 py-4 text-left hover:bg-slate-50 md:grid-cols-[1.2fr_0.9fr_0.8fr_0.7fr_0.8fr] md:items-center ${
                  selected?.id === claim.id ? 'bg-violet-50' : ''
                }`}
              >
                <span>
                  <span className="block text-sm font-black text-slate-900">{claim.displayId}</span>
                  <span className="text-xs text-slate-500">{claim.clientName}</span>
                </span>
                <span className="text-sm text-slate-700">{claim.payer || '—'}</span>
                <span className="text-sm text-slate-700">
                  {claim.serviceDate ? new Date(claim.serviceDate).toLocaleDateString() : '—'} · {claim.cptCode}
                </span>
                <span className="text-sm font-bold text-slate-900">{currencyFromCents(claim.amountCents)}</span>
                <span>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta(claim.status).tone}`}>
                    {statusMeta(claim.status).label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Claim detail</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">{selected.displayId}</h2>
                <p className="text-sm text-slate-500">{selected.clientName}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                {[
                  ['Payer', selected.payer || '—'],
                  ['CPT', `${selected.cptCode} · ${selected.cptDescription}`],
                  ['Clinician', selected.clinicianName || '—'],
                  ['Units', String(selected.units)],
                  ['Charge', currencyFromCents(selected.amountCents)],
                  ['Status', statusMeta(selected.status).label],
                  [
                    'Service',
                    selected.serviceDate ? new Date(selected.serviceDate).toLocaleDateString() : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-white py-2 last:border-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="max-w-[60%] text-right font-bold text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
              {selected.denialReason ? (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                  Denial: {selected.denialReason}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {selected.status === 'DRAFT' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => patchClaimStatus(selected.id, 'READY'))}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                  >
                    Mark ready
                  </button>
                ) : null}
                {selected.status === 'READY' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      className="rounded-xl bg-[#6868D0] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      <Send size={14} className="mr-1 inline" /> Prepare submission
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => patchClaimStatus(selected.id, 'DRAFT'))}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                    >
                      Back to draft
                    </button>
                  </>
                ) : null}
                {selected.status === 'SUBMITTED' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => patchClaimStatus(selected.id, 'ACCEPTED'))}
                    className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} className="mr-1 inline" /> Mark accepted
                  </button>
                ) : null}
                {selected.status === 'ACCEPTED' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => patchClaimStatus(selected.id, 'PAID'))}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Mark paid
                  </button>
                ) : null}
                {selected.status === 'SUBMITTED' || selected.status === 'ACCEPTED' || selected.status === 'READY' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt('Denial reason (optional)', selected.denialReason || 'Denied by payer');
                      if (reason == null) return;
                      void run(() => patchClaimStatus(selected.id, 'DENIED', reason));
                    }}
                    className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50"
                  >
                    Mark denied
                  </button>
                ) : null}
                {selected.status === 'DENIED' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => patchClaimStatus(selected.id, 'READY'))}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                    >
                      <RotateCcw size={14} className="mr-1 inline" /> Reopen
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => patchClaimStatus(selected.id, 'SUBMITTED'))}
                      className="rounded-xl bg-[#6868D0] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      Appeal / resubmit
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <FileText size={34} className="text-slate-300" />
              <h2 className="mt-3 text-lg font-black text-slate-900">Select a claim</h2>
              <p className="mt-1 text-sm text-slate-500">
                Status changes save to Postgres. Clearinghouse EDI is out of scope.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Clock size={16} className="mr-2 inline" />
        Real electronic claim submission is not configured. Submit sets status to SUBMITTED only.
      </div>
    </div>
  );
}

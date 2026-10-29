'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Lightbulb,
  RefreshCw,
  Send,
  FileEdit,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import ClaimEditorModal, { EditableClaim } from '@/components/ClaimEditorModal';

type ScrubStatus = 'ready' | 'errors' | 'warnings';
type ScrubFinding = { code: string; severity: 'error' | 'warning' | 'tip'; message: string };

type ScrubSnapshot = {
  schemaReady: boolean;
  ruleCount: number;
  clearinghouse: 'waystar' | 'availity' | 'demo';
  waystarEnabled: boolean;
  stats: { ready: number; errors: number; warnings: number; cleanAmountCents: number };
  firstPass: { ready: number; warnings: number; errors: number };
  claims: Array<{
    claimId: string;
    displayId: string;
    clientName: string;
    cptCode: string;
    cptDescription: string;
    units: number;
    amountCents: number;
    payer: string | null;
    claimStatus: string;
    scrubStatus: ScrubStatus;
    findings: ScrubFinding[];
    npi: string | null;
    icd10: string[];
    scrubbedAt: string;
    canSubmit: boolean;
  }>;
};

const PURPLE = '#5C2D91';
const CTA = { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' };

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const SEVERITY_META = {
  error: { label: 'Error', tone: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertCircle },
  warning: {
    label: 'Warning',
    tone: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: AlertTriangle,
  },
  tip: { label: 'Tip', tone: 'bg-sky-50 text-sky-800 border-sky-200', icon: Lightbulb },
} as const;

export default function ClaimScrubberPage() {
  const [data, setData] = useState<ScrubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScrubStatus | 'all' | 'clean'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingClaim, setEditingClaim] = useState<EditableClaim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<ScrubSnapshot & { success: true }>('/api/billing/claim-scrub');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scrubber');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const rows = data?.claims ?? [];
    if (filter === 'all') return rows;
    if (filter === 'clean') return rows.filter((c) => c.scrubStatus === 'ready');
    return rows.filter((c) => c.scrubStatus === filter);
  }, [data, filter]);

  const stackTotal = Math.max(
    1,
    (data?.firstPass.ready ?? 0) + (data?.firstPass.warnings ?? 0) + (data?.firstPass.errors ?? 0)
  );

  async function reScrubAll() {
    setBusy('re-scrub');
    setMessage(null);
    try {
      const res = await apiJson<ScrubSnapshot & { success: true }>('/api/billing/claim-scrub', {
        method: 'POST',
        body: JSON.stringify({ action: 're_scrub_all' }),
      });
      setData(res);
      setMessage(`Re-scrubbed ${res.claims.length} claim(s) against ${res.ruleCount} rules.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Re-scrub failed');
    } finally {
      setBusy(null);
    }
  }

  async function submitClaim(claimId: string) {
    setBusy(claimId);
    setMessage(null);
    try {
      const res = await apiJson<{
        success: true;
        demoMode?: boolean;
        message?: string;
        trackingId?: string;
      }>('/api/billing/claim-scrub/submit', {
        method: 'POST',
        body: JSON.stringify({ claimId }),
      });
      setMessage(
        res.message ||
          (res.demoMode
            ? 'DEMO completed. No payer submission.'
            : `Submitted${res.trackingId ? ` · ${res.trackingId}` : ''}`)
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(null);
    }
  }

  const stats = data?.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: PURPLE }}>
            Billing
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[#141C34]">Claim Scrubber</h1>
          <p className="mt-1 text-sm text-slate-500">
            Run payer edits on draft/ready claims before clearinghouse submit.
          </p>
        </div>
        <button
          type="button"
          disabled={busy === 're-scrub'}
          onClick={() => void reScrubAll()}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          style={CTA}
        >
          <RefreshCw size={16} className={busy === 're-scrub' ? 'animate-spin' : ''} />
          Re-Scrub All
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            {
              key: 'ready' as const,
              label: 'Ready',
              value: String(stats?.ready ?? 0),
              color: '#15803D',
              icon: CheckCircle2,
            },
            {
              key: 'errors' as const,
              label: 'Errors',
              value: String(stats?.errors ?? 0),
              color: '#DC2626',
              icon: AlertCircle,
            },
            {
              key: 'warnings' as const,
              label: 'Warnings',
              value: String(stats?.warnings ?? 0),
              color: '#B45309',
              icon: AlertTriangle,
            },
            {
              key: 'clean' as const,
              label: 'Clean Amount',
              value: money(stats?.cleanAmountCents ?? 0),
              color: PURPLE,
              icon: DollarSign,
            },
          ] as const
        ).map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            onClick={() => setFilter((prev) => (prev === kpi.key ? 'all' : kpi.key))}
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
              filter === kpi.key ? 'border-violet-400 ring-4 ring-violet-100' : 'border-slate-200/80'
            }`}
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: kpi.color }}
            >
              <kpi.icon size={16} strokeWidth={2.4} />
            </div>
            <p className="mt-3 text-2xl font-black tracking-tight" style={{ color: kpi.color }}>
              {loading ? '…' : kpi.value}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">{kpi.label}</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-400">
          First-pass scrub mix
        </h2>
        <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${((data?.firstPass.ready ?? 0) / stackTotal) * 100}%` }}
            title="Ready"
          />
          <div
            className="h-full bg-amber-500"
            style={{ width: `${((data?.firstPass.warnings ?? 0) / stackTotal) * 100}%` }}
            title="Warnings"
          />
          <div
            className="h-full bg-rose-600"
            style={{ width: `${((data?.firstPass.errors ?? 0) / stackTotal) * 100}%` }}
            title="Errors"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> Ready {data?.firstPass.ready ?? 0}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Warnings{' '}
            {data?.firstPass.warnings ?? 0}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-600" /> Errors {data?.firstPass.errors ?? 0}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-500">Scrubbing claims…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-semibold text-slate-600">No claims match this scrub filter</p>
            <p className="mt-1 text-xs text-slate-400">
              Draft, ready, and denied claims appear here after scrub rules run.
            </p>
          </div>
        ) : (
          visible.map((claim) => (
            <article
              key={claim.claimId}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-black text-[#141C34]">{claim.clientName}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        claim.scrubStatus === 'ready'
                          ? 'bg-emerald-50 text-emerald-700'
                          : claim.scrubStatus === 'errors'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {claim.scrubStatus}
                    </span>
                    <span className="text-xs text-slate-400">{claim.displayId}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {claim.cptCode} · {claim.units} unit{claim.units === 1 ? '' : 's'} ·{' '}
                    {money(claim.amountCents)} · {claim.payer || 'No payer'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    NPI {claim.npi || '—'} · ICD-10{' '}
                    {claim.icd10.length ? claim.icd10.join(', ') : '—'} · Scrubbed{' '}
                    {formatTs(claim.scrubbedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingClaim({
                        id: claim.claimId,
                        claimNumber: claim.displayId,
                        client: claim.clientName,
                        dos: new Date().toISOString().split('T')[0],
                        payer: claim.payer || 'Optum MD Medicaid BH',
                        renderingProvider: claim.npi ? `Provider — NPI ${claim.npi}` : 'Not on file',
                        billingProvider: 'MD Behavioral Health — Group NPI 1457893210 · TIN 82-1234567',
                        authNumber: '',
                        pos: '11',
                        icd10: claim.icd10.length ? claim.icd10.join(', ') : 'F33.1',
                        lines: [
                          { cpt: claim.cptCode, modifier: '', units: claim.units || 1, charge: claim.amountCents / 100 }
                        ],
                        totalCharge: claim.amountCents / 100,
                        status: (claim.claimStatus as any) || 'DRAFT',
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 transition-colors"
                  >
                    <FileEdit size={14} />
                    Fix in Claim Editor
                  </button>
                  <button
                    type="button"
                    disabled={!claim.canSubmit || busy === claim.claimId}
                    title={
                      claim.canSubmit
                        ? 'Submit to clearinghouse'
                        : 'Resolve scrub errors before submit'
                    }
                    onClick={() => void submitClaim(claim.claimId)}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={CTA}
                  >
                    <Send size={15} />
                    Submit to Clearinghouse
                  </button>
                </div>
              </div>

              {claim.findings.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {claim.findings.map((finding) => {
                    const meta = SEVERITY_META[finding.severity];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={`${claim.claimId}-${finding.code}-${finding.message}`}
                        className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${meta.tone}`}
                      >
                        <Icon size={15} className="mt-0.5 shrink-0" />
                        <span>
                          <span className="font-bold">{meta.label}</span> · {finding.message}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))
        )}
      </div>

      <p className="text-center text-xs text-slate-400">
        Scrub rules ·{' '}
        {data?.clearinghouse === 'waystar'
          ? 'Waystar'
          : data?.clearinghouse === 'availity'
            ? 'Availity'
            : 'Demo'}{' '}
        · {data?.ruleCount ?? 0} rules from config
      </p>

      {/* ClaimEditorModal Integration */}
      {editingClaim && (
        <ClaimEditorModal
          claim={editingClaim}
          isOpen={true}
          onClose={() => setEditingClaim(null)}
          onSave={updated => {
            if (data && editingClaim) {
              setData(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  stats: {
                    ...prev.stats,
                    errors: Math.max(0, prev.stats.errors - 1),
                    ready: prev.stats.ready + 1,
                    cleanAmountCents: prev.stats.cleanAmountCents + Math.round((updated.totalCharge ?? (c => c.amountCents / 100)(prev.claims[0])) * 100),
                  },
                  claims: prev.claims.map(c => c.claimId === editingClaim.id ? {
                    ...c,
                    scrubStatus: 'ready',
                    canSubmit: true,
                    findings: [],
                    amountCents: Math.round((updated.totalCharge ?? (c.amountCents / 100)) * 100),
                    icd10: updated.icd10 ? updated.icd10.split(',').map(s => s.trim()).filter(Boolean) : c.icd10,
                    npi: updated.renderingProvider,
                    payer: updated.payer,
                  } : c)
                };
              });
              setMessage(`Claim ${editingClaim.claimNumber || editingClaim.id} scrub errors resolved via Claim Editor.`);
            }
            setEditingClaim(null);
          }}
        />
      )}
    </div>
  );
}

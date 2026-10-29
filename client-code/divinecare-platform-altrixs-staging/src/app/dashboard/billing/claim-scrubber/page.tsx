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
import { useAuth } from '@/features/auth';
import { BILLING_STAFF_ONLY, canEditClaims } from '@/lib/billing/billingAccess';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardBody,
  CardHeader,
  cardClasses,
  cx,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  TONE_SOFT,
  type Tone,
} from '@/components/ui';

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
  const { user } = useAuth();
  // Re-scrub, submit and claim edits are billing core only (canMutateClaims on the API).
  const canEdit = canEditClaims(user?.role);

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
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="Claim Scrubber"
        description="Run payer edits on draft/ready claims before clearinghouse submission."
        actions={canEdit ? (
            <button
              type="button"
              disabled={busy === 're-scrub'}
              onClick={() => void reScrubAll()}
              className={buttonClasses({ variant: 'primary' })}
            >
              <RefreshCw size={16} aria-hidden className={busy === 're-scrub' ? 'animate-spin' : ''} />
              Re-Scrub All
            </button>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              Read-only. {BILLING_STAFF_ONLY}: re-scrub, edit and submit.
            </p>
          )
        }
      />

      {error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {message && <Alert tone="neutral">{message}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            {
              key: 'ready' as const,
              label: 'Ready',
              value: String(stats?.ready ?? 0),
              tone: 'success' as Tone,
              icon: CheckCircle2,
            },
            {
              key: 'errors' as const,
              label: 'Errors',
              value: String(stats?.errors ?? 0),
              tone: 'danger' as Tone,
              icon: AlertCircle,
            },
            {
              key: 'warnings' as const,
              label: 'Warnings',
              value: String(stats?.warnings ?? 0),
              tone: 'warning' as Tone,
              icon: AlertTriangle,
            },
            {
              key: 'clean' as const,
              label: 'Clean Amount',
              value: money(stats?.cleanAmountCents ?? 0),
              tone: 'brand' as Tone,
              icon: DollarSign,
            },
          ] as const
        ).map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            aria-pressed={filter === kpi.key}
            onClick={() => setFilter((prev) => (prev === kpi.key ? 'all' : kpi.key))}
            className={cx(
              cardClasses,
              'flex items-start justify-between gap-3 p-4 text-left transition hover:border-slate-300 hover:shadow-sm',
              FOCUS_RING,
              filter === kpi.key ? 'border-blue-600 ring-2 ring-blue-200' : '',
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-600">{kpi.label}</span>
              <span className="stat-number mt-1 block text-2xl font-semibold tracking-tight text-slate-900">
                {loading ? '…' : kpi.value}
              </span>
            </span>
            <span
              aria-hidden
              className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONE_SOFT[kpi.tone])}
            >
              <kpi.icon size={18} />
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="First-pass scrub mix" />
        <CardBody>
          <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
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
              <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-600" /> Ready {data?.firstPass.ready ?? 0}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" /> Warnings{' '}
              {data?.firstPass.warnings ?? 0}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-rose-600" /> Errors {data?.firstPass.errors ?? 0}
            </span>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-3">
        {loading ? (
          <Card>
            <LoadingState label="Scrubbing claims…" />
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <EmptyState
              title="No claims match this scrub filter"
              description="Draft, ready, and denied claims appear here after scrub rules run."
            />
          </Card>
        ) : (
          visible.map((claim) => (
            <article key={claim.claimId} className={cx(cardClasses, 'p-5')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{claim.clientName}</h3>
                    <StatusBadge
                      size="sm"
                      tone={
                        claim.scrubStatus === 'ready'
                          ? 'success'
                          : claim.scrubStatus === 'errors'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {claim.scrubStatus}
                    </StatusBadge>
                    <span className="text-xs text-slate-500">{claim.displayId}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {claim.cptCode} · {claim.units} unit{claim.units === 1 ? '' : 's'} ·{' '}
                    {money(claim.amountCents)} · {claim.payer || 'No payer'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    NPI {claim.npi || '—'} · ICD-10{' '}
                    {claim.icd10.length ? claim.icd10.join(', ') : '—'} · Scrubbed{' '}
                    {formatTs(claim.scrubbedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<FileEdit />}
                    onClick={() => {
                      setEditingClaim({
                        id: claim.claimId,
                        claimNumber: claim.displayId,
                        client: claim.clientName,
                        dos: new Date().toISOString().split('T')[0],
                        payer: claim.payer || 'Optum MD Medicaid BH',
                        renderingProvider: claim.npi ? `Provider — NPI ${claim.npi}` : '',
                        billingProvider: 'MD Behavioral Health',
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
                  >
                    {canEdit ? 'Fix in Claim Editor' : 'Claim Details'}
                  </Button>
                  {canEdit && (
                  <button
                    type="button"
                    disabled={!claim.canSubmit || busy === claim.claimId}
                    title={
                      claim.canSubmit
                        ? 'Submit to clearinghouse'
                        : 'Resolve scrub errors before submitting'
                    }
                    onClick={() => void submitClaim(claim.claimId)}
                    className={buttonClasses({ variant: 'primary', size: 'sm' })}
                  >
                    <Send size={16} aria-hidden />
                    Submit to Clearinghouse
                  </button>
                  )}
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
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${meta.tone}`}
                      >
                        <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
                        <span>
                          <span className="font-semibold">{meta.label}</span> · {finding.message}
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

      <p className="text-center text-xs text-slate-500">
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
          onSave={() => {
            // The editor only calls this after the claim was saved; re-scrub for real results.
            setEditingClaim(null);
            void reScrubAll();
          }}
        />
      )}
    </Page>
  );
}

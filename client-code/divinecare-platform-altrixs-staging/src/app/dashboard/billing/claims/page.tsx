'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ClaimsClearinghousePanel } from '@/components/clinical/ClaimsClearinghousePanel';
import { ClaimOutboundTools } from './_components/ClaimOutboundTools';
import { WaystarResponsesPanel, type WaystarChannel } from '@/components/clinical/WaystarResponsesPanel';
import { apiJson } from '@/lib/api-client';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
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
  ErrorState,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  type Tone,
} from '@/components/ui';
import {
  fetchClaims,
  generateClaimFromNote,
  patchClaimStatus,
  type ClaimDbStatus,
  type ClaimRecord,
} from '@/features/billing/claimsApi';
import { loadLockedNotes, type LockedNoteSnapshot } from '@/lib/notes/workflow';

const STATUS_META: Record<ClaimDbStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  READY: { label: 'Ready', tone: 'brand' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DENIED: { label: 'Denied', tone: 'danger' },
  PAID: { label: 'Paid', tone: 'success' },
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
  return STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone };
}

export default function ClaimsPage() {
  return (
    <Suspense
      fallback={<LoadingState label="Loading claims…" className="min-h-[40vh]" />}
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
  const detailRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<ClaimRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<WaystarChannel | null>(null);

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
      const waystar = await apiJson<WaystarChannel>('/api/billing/claims/waystar-sftp').catch(() => null);
      setChannel(waystar);
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
    <Page>
      <PageHeader
        eyebrow="Billing workflow"
        title="Claims"
        description={
          <>
            Live payer claims from the clinic database. Filter, search, and move a claim through draft → ready →
            submit → accept / deny / paid. Prepare billing details and submit through the clearinghouse panel.
          </>
        }
        actions={
          <>
            <Link href="/dashboard/billing" className={buttonClasses({ variant: 'secondary' })}>
              Overview
            </Link>
            <Link href="/dashboard/billing/denials" className={buttonClasses({ variant: 'secondary' })}>
              Denials
            </Link>
          </>
        }
      />

      <StatGrid columns={4}>
        <StatCard label="Action needed" value={stats.action} icon={<AlertTriangle />} tone="warning" />
        <StatCard label="In flight" value={stats.submitted} icon={<Send />} tone="info" />
        <StatCard label="Paid posted" value={currencyFromCents(stats.paid)} icon={<DollarSign />} tone="success" />
        <StatCard label="Denied" value={stats.denied} icon={<ShieldCheck />} tone="danger" />
      </StatGrid>

      <ClaimsClearinghousePanel claims={visible} selected={selected} onChanged={load} />
      {channel?.configured ? <WaystarResponsesPanel channel={channel} onChanged={load} /> : null}
      {error ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {unlockedForClaim.length > 0 ? (
        <Card>
          <CardHeader title="Generate from locked note" />
          <CardBody className="space-y-2">
            {unlockedForClaim.slice(0, 8).map((note) => (
              <div key={note.noteId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{note.clientName}</p>
                  <p className="text-xs text-slate-500">Locked {new Date(note.lockedAt).toLocaleDateString()}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => generateClaimFromNote(note.noteId))}
                >
                  Generate claim
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="relative w-full min-w-0 lg:w-auto lg:min-w-[16rem] lg:max-w-md lg:flex-[1_1_20rem]">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, payer, CPT, claim ID"
            aria-label="Search claims"
            className={cx(inputClasses, 'pl-9')}
          />
        </div>
        <Tabs
          variant="pill"
          label="Filter claims by status"
          className="min-w-0"
          controlsPanels={false}
          value={filter}
          onChange={(key) => setFilter(key)}
          items={FILTERS.map((item) => ({
            key: item,
            label: item === 'all' ? 'All' : statusMeta(item).label,
            count: item === 'all' ? claims.length : counts[item] || 0,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.8fr)] gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-600 md:grid">
            <span>Claim</span>
            <span>Payer</span>
            <span>Service</span>
            <span>Charge</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? <LoadingState label="Loading claims…" /> : null}
            {!loading && visible.length === 0 ? (
              error ? (
                <ErrorState title="Claims could not be loaded from the database." onRetry={() => void load()} retryLabel="Retry" />
              ) : (
                <EmptyState
                  compact
                  icon={<FileText />}
                  title={
                    claims.length === 0
                      ? 'No claims yet. Generate one from a locked progress note or run npm run db:seed:billing.'
                      : 'No claims match these filters.'
                  }
                />
              )
            ) : null}
            {visible.map((claim) => (
              <button
                key={claim.id}
                type="button"
                onClick={() => {
                  setSelected(claim);
                  // Below lg the detail panel stacks under the list: bring it into view.
                  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
                    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                  }
                }}
                aria-pressed={selected?.id === claim.id}
                className={cx(
                  'grid w-full gap-2 px-5 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.8fr)] md:items-center',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600',
                  selected?.id === claim.id ? 'bg-blue-50' : '',
                )}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
                    {claim.displayId}
                    {claim.payerResponsibility && claim.payerResponsibility !== 'P' ? (
                      <StatusBadge size="sm" tone="brand">
                        {claim.payerResponsibility === 'S' ? 'Secondary' : 'Tertiary'}
                      </StatusBadge>
                    ) : null}
                    {claim.frequencyCode === '7' || claim.frequencyCode === '8' ? (
                      <StatusBadge size="sm" tone={claim.frequencyCode === '8' ? 'danger' : 'warning'}>
                        {claim.frequencyCode === '8' ? 'Void' : 'Corrected'}
                      </StatusBadge>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-500">{claim.clientName}</span>
                </span>
                <span className="break-words text-sm text-slate-700">{claim.payer || '—'}</span>
                <span className="text-sm text-slate-700">
                  {claim.serviceDate ? new Date(claim.serviceDate).toLocaleDateString() : '—'} · {claim.cptCode}
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {currencyFromCents(claim.amountCents)}
                </span>
                <span>
                  <StatusBadge tone={statusMeta(claim.status).tone}>{statusMeta(claim.status).label}</StatusBadge>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <aside ref={detailRef} className={cx(cardClasses, 'min-w-0 scroll-mt-4 p-5')}>
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Claim detail</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{selected.displayId}</h2>
                <p className="text-sm text-slate-500">{selected.clientName}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 text-sm">
                {[
                  ['Payer', selected.payer || '—'],
                  ['CPT', `${selected.cptCode} · ${selected.cptDescription}`],
                  ['Clinician', selected.clinicianName || '—'],
                  ['Units', String(selected.units)],
                  ['Charge', currencyFromCents(selected.amountCents)],
                  ['Status', statusMeta(selected.status).label],
                  ['Billed to', `${selected.payerResponsibility === 'S' ? 'Secondary' : selected.payerResponsibility === 'T' ? 'Tertiary' : 'Primary'} payer`],
                  [
                    'Service',
                    selected.serviceDate ? new Date(selected.serviceDate).toLocaleDateString() : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-slate-200 py-2 last:border-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="min-w-0 max-w-[60%] break-words text-right font-semibold text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
              {selected.denialReason ? <Alert tone="danger">Denial: {selected.denialReason}</Alert> : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selected.status === 'DRAFT' ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(() => patchClaimStatus(selected.id, 'READY'))}
                  >
                    Mark ready
                  </Button>
                ) : null}
                {selected.status === 'READY' ? (
                  <>
                    <Button icon={<Send />} disabled={busy} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                      Prepare submission
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(() => patchClaimStatus(selected.id, 'DRAFT'))}
                    >
                      Back to draft
                    </Button>
                  </>
                ) : null}
                {selected.status === 'SUBMITTED' ? (
                  <Button
                    variant="secondary"
                    icon={<CheckCircle2 />}
                    disabled={busy}
                    onClick={() => void run(() => patchClaimStatus(selected.id, 'ACCEPTED'))}
                  >
                    Mark accepted
                  </Button>
                ) : null}
                {selected.status === 'ACCEPTED' ? (
                  <Button disabled={busy} onClick={() => void run(() => patchClaimStatus(selected.id, 'PAID'))}>
                    Mark paid
                  </Button>
                ) : null}
                {selected.status === 'SUBMITTED' || selected.status === 'ACCEPTED' || selected.status === 'READY' ? (
                  <Button
                    variant="secondary"
                    className="text-rose-700 hover:text-rose-800"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt('Denial reason (optional)', selected.denialReason || 'Denied by payer');
                      if (reason == null) return;
                      void run(() => patchClaimStatus(selected.id, 'DENIED', reason));
                    }}
                  >
                    Mark denied
                  </Button>
                ) : null}
                {selected.status === 'DENIED' ? (
                  <>
                    <Button
                      variant="secondary"
                      icon={<RotateCcw />}
                      disabled={busy}
                      onClick={() => void run(() => patchClaimStatus(selected.id, 'READY'))}
                    >
                      Reopen
                    </Button>
                    <Button disabled={busy} onClick={() => void run(() => patchClaimStatus(selected.id, 'SUBMITTED'))}>
                      Appeal / resubmit
                    </Button>
                  </>
                ) : null}
              </div>
              <ClaimOutboundTools
                key={selected.id}
                claim={selected}
                onChanged={async (row) => {
                  await load();
                  if (row) setSelected(row);
                }}
              />
            </div>
          ) : (
            <EmptyState
              className="min-h-[320px] justify-center"
              icon={<FileText />}
              title="Select a claim"
              description={
                <>
                  Status changes save to Postgres.{' '}
                  {channel?.active
                    ? 'READY claims are sent to Waystar as 837 files over SFTP.'
                    : 'Electronic claim submission (EDI) is not active on this server.'}
                </>
              }
            />
          )}
        </aside>
      </div>

      {channel?.active ? (
        <Alert tone="brand" icon={<Send />}>
          {channel.statusLine}
        </Alert>
      ) : (
        <Alert tone="warning" icon={<Clock />}>
          {channel?.statusLine || 'Real electronic claim submission is not configured. Submit sets status to SUBMITTED only.'}
        </Alert>
      )}
    </Page>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, ChevronRight, Database, MapPinOff, Plus, Route, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  buttonClasses,
  cx,
  FOCUS_RING,
  inputClasses,
} from '@/components/ui';
import {
  PAYER_TYPES,
  PAYER_TYPE_LABEL,
  filterPayers,
  missingAddress,
  missingPayerId,
  type PayerMasterRow,
  type ValantPayerOption,
} from '@/lib/billing/payerMaster';
import { PayerForm } from './PayerForm';
import { WaystarSettingsPanels } from './WaystarSettingsPanels';

type Mode = { kind: 'add' } | { kind: 'valant' } | { kind: 'edit'; id: string } | null;

function Missing({ children }: { children: string }) {
  return <StatusBadge size="sm" tone="warning" icon={<TriangleAlert />}>{children}</StatusBadge>;
}

function cityState(p: PayerMasterRow) {
  return [p.claimsCity, p.claimsState].filter(Boolean).join(', ');
}

/**
 * Billing › Payers: the practice's payer master (PayerRegistry). Every value is staff entered or
 * picked from the Valant import; Waystar claim rules are edited on each payer.
 */
export default function PayersPage() {
  const [payers, setPayers] = useState<PayerMasterRow[] | null>(null);
  const [valant, setValant] = useState<ValantPayerOption[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('active');
  const [needId, setNeedId] = useState(false);
  const [needAddress, setNeedAddress] = useState(false);
  const [showClaimSetup, setShowClaimSetup] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiJson<{ payers: PayerMasterRow[]; valant: ValantPayerOption[]; canEdit: boolean }>('/api/billing/payers')
      .then((d) => { setPayers(d.payers); setValant(d.valant); setCanEdit(d.canEdit); })
      .catch((e) => { setPayers((p) => p ?? []); setError(e instanceof Error ? e.message : 'Could not load payers'); });
  }, []);
  useEffect(load, [load]);

  const rows = useMemo(
    () => filterPayers(payers ?? [], { q, type, status, missingPayerId: needId, missingAddress: needAddress }),
    [payers, q, type, status, needId, needAddress],
  );
  const all = payers ?? [];
  const counts = {
    active: all.filter((p) => p.active).length,
    noId: all.filter((p) => p.active && missingPayerId(p)).length,
    noAddress: all.filter((p) => p.active && missingAddress(p)).length,
    rules: all.filter((p) => p.active && p.waystar).length,
  };
  const editing = mode?.kind === 'edit' ? all.find((p) => p.id === mode.id) ?? null : null;
  const closePanel = useCallback(() => setMode(null), []);

  return (
    <Page>
      <PageHeader
        title="Payers"
        description="The practice's payer list for claims: Waystar payer IDs, claims mailing addresses, timely filing, ERA / EFT enrollment, and each payer's Waystar claim rules."
        actions={
          <>
            <a href="/dashboard/billing/panels" className={buttonClasses({ variant: 'secondary' })}>
              <ShieldCheck className="h-4 w-4" aria-hidden /> Insurance panels
            </a>
            {canEdit ? (
              <>
                <Button variant="secondary" icon={<Database />} onClick={() => setMode({ kind: 'valant' })} disabled={payers == null}>
                  Start from Valant
                </Button>
                <Button icon={<Plus />} onClick={() => setMode({ kind: 'add' })} disabled={payers == null}>
                  Add payer
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {error ? <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>}>{error}</Alert> : null}

      <StatGrid columns={4}>
        <StatCard label="Active payers" value={payers ? counts.active : '…'} hint={payers ? `${all.length} on the list` : undefined} icon={<Building2 />} tone="brand" />
        <StatCard label="Missing Waystar payer ID" value={payers ? counts.noId : '…'} hint="active payers" icon={<TriangleAlert />} tone={counts.noId ? 'warning' : 'neutral'} />
        <StatCard label="Missing claims address" value={payers ? counts.noAddress : '…'} hint="active payers" icon={<MapPinOff />} tone={counts.noAddress ? 'warning' : 'neutral'} />
        <StatCard label="Waystar rules linked" value={payers ? counts.rules : '…'} hint="active payers" icon={<Route />} tone="info" />
      </StatGrid>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="relative block">
            <span className="sr-only">Search payers</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, payer ID, city" className={cx(inputClasses, 'pl-9')} />
          </label>
          <label>
            <span className="sr-only">Payer type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputClasses}>
              <option value="all">All types</option>
              {PAYER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              <option value="none">Type not set</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClasses}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">Active and inactive</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={needId} onChange={(e) => setNeedId(e.target.checked)} /> Missing payer ID</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={needAddress} onChange={(e) => setNeedAddress(e.target.checked)} /> Missing claims address</label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {payers == null ? (
          <LoadingState label="Loading payers…" />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title="No payers yet"
            description={
              canEdit
                ? 'Add each payer the practice bills. Use "Start from Valant" to copy the name and claims mailing address from the Valant import, or "Add payer" to type them in. Enter the Waystar payer ID from Waystar\'s payer list (Valant\'s EDI ID is shown only as a hint), then set the payer\'s Waystar claim rules.'
                : 'Billing has not added payers yet. Billing and practice leadership add payers on this page.'
            }
            action={canEdit ? <Button icon={<Plus />} onClick={() => setMode({ kind: 'add' })}>Add payer</Button> : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<Search />} title="No payers match these filters" />
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full table-fixed text-left text-sm md:table">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="w-[30%] px-4 py-2.5">Payer</th>
                  <th scope="col" className="w-[15%] px-3 py-2.5">Waystar payer ID</th>
                  <th scope="col" className="w-[15%] px-3 py-2.5">Type</th>
                  <th scope="col" className="w-[17%] px-3 py-2.5">Claims address</th>
                  <th scope="col" className="w-[10%] px-3 py-2.5">Timely filing</th>
                  <th scope="col" className="w-[13%] px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => setMode({ kind: 'edit', id: p.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode({ kind: 'edit', id: p.id }); } }}
                    className={cx('cursor-pointer hover:bg-slate-50', FOCUS_RING, !p.active && 'opacity-60')}
                    aria-label={`Open ${p.name}`}
                  >
                    <td className="px-4 py-3">
                      <p className="break-words font-semibold text-slate-900">{p.name}</p>
                      {p.valant.length ? <p className="text-xs text-slate-500">From Valant</p> : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{missingPayerId(p) ? <Missing>Missing</Missing> : p.payerId}</td>
                    <td className="px-3 py-3 text-xs text-slate-700">{p.payerType ? PAYER_TYPE_LABEL[p.payerType] ?? p.payerType : <span className="text-slate-400">Not set</span>}</td>
                    <td className="px-3 py-3 text-xs text-slate-700">{missingAddress(p) ? <Missing>Missing</Missing> : cityState(p)}</td>
                    <td className="px-3 py-3 text-xs text-slate-700">{p.timelyFilingDays != null ? `${p.timelyFilingDays} days` : <span className="text-slate-400">Not entered</span>}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge size="sm" tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Inactive'}</StatusBadge>
                        {p.waystar ? (
                          <StatusBadge size="sm" tone={p.waystar.verified ? 'info' : 'warning'} icon={p.waystar.verified ? <BadgeCheck /> : undefined}>
                            {p.waystar.verified ? 'Rules' : 'Rules unverified'}
                          </StatusBadge>
                        ) : (
                          <StatusBadge size="sm" tone="warning">No rules</StatusBadge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phone cards */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setMode({ kind: 'edit', id: p.id })}
                    className={cx('flex w-full items-start gap-3 px-4 py-3 text-left', FOCUS_RING, !p.active && 'opacity-60')}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-words text-sm font-semibold text-slate-900">{p.name}</p>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                        {missingPayerId(p) ? <Missing>Payer ID missing</Missing> : <span className="font-mono">{p.payerId}</span>}
                        {p.payerType ? <StatusBadge size="sm" tone="neutral">{PAYER_TYPE_LABEL[p.payerType] ?? p.payerType}</StatusBadge> : null}
                        {!p.active ? <StatusBadge size="sm" tone="neutral">Inactive</StatusBadge> : null}
                        {!p.waystar ? <StatusBadge size="sm" tone="warning">No rules</StatusBadge> : null}
                      </div>
                      <p className="text-xs text-slate-600">
                        {missingAddress(p) ? <Missing>Address missing</Missing> : cityState(p)}
                        {p.timelyFilingDays != null ? ` · Timely filing ${p.timelyFilingDays} days` : ''}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <section className="space-y-3">
        <button
          type="button"
          aria-expanded={showClaimSetup}
          onClick={() => setShowClaimSetup((s) => !s)}
          className={cx('flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left', FOCUS_RING)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Waystar claim setup</span>
            <span className="block text-xs text-slate-500">Every Waystar payer mapping (including ones not on the payer list yet), billing provider NPIs and rendering provider names.</span>
          </span>
          <ChevronRight className={cx('h-4 w-4 shrink-0 text-slate-400 transition-transform', showClaimSetup && 'rotate-90')} aria-hidden />
        </button>
        {showClaimSetup ? <WaystarSettingsPanels /> : null}
      </section>

      {mode && (mode.kind !== 'edit' || editing) ? (
        <PayerForm
          key={mode.kind === 'edit' ? mode.id : mode.kind}
          mode={mode.kind === 'edit' && editing ? { kind: 'edit', payer: editing } : mode.kind === 'valant' ? { kind: 'valant' } : { kind: 'add' }}
          canEdit={canEdit}
          valant={valant}
          payers={all}
          onClose={closePanel}
          onSaved={(next) => {
            setPayers(next);
            // Valant links change when a payer is added from Valant
            if (mode.kind === 'valant') load();
          }}
          onReload={load}
          onOpenPayer={(id) => setMode({ kind: 'edit', id })}
        />
      ) : null}
    </Page>
  );
}

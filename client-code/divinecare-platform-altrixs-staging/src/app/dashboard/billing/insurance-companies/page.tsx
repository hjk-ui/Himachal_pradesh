'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BadgeCheck, Building2, Link2, Phone, Search, Upload, Users } from 'lucide-react';
import {
  Alert,
  buttonClasses,
  Card,
  cardClasses,
  cx,
  EmptyState,
  FOCUS_RING,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge as Badge,
  Tabs,
} from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { formatPhone } from '@/lib/billing/valantPayers';
import { ValantPayersImport } from '../../admin/migration/ValantPayersImport';

type Address = {
  id: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addressRaw: string | null;
  addressStatus: string;
  addressIssues: string[];
  phone: string | null;
  phonesRaw: string[];
  phoneStatus: string;
  phoneIssues: string[];
  taxIdsRaw: string[];
  sourceLines: number[];
};

type Row = {
  id: string;
  name: string;
  nameVariants: string[];
  ediPayerId: string;
  active: boolean;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addressRaw: string | null;
  phone: string | null;
  phoneRaw: string | null;
  phoneStatus: string;
  practicePhone: boolean;
  sourceRowCount: number;
  duplicateGroup: string | null;
  duplicates: { id: string; name: string; ediPayerId: string }[];
  addresses: Address[];
  clientCount: number;
  activeClientCount: number;
  sharedName: boolean;
  clientNames: { name: string; count: number; kind: 'exact' | 'confirmed' }[];
  suggestedClientNames: { name: string; count: number; score: number }[];
  confirmedAliases: string[];
  agingCents: number | null;
  combinedAgingRows: number;
  journalTransactions: number;
  registry: { id: string; payerId: string; name: string; clearinghouse: string; active: boolean } | null;
  registrySuggestions: { id: string; payerId: string; name: string; by: string }[];
  waystar: { id: string; payerName: string; waystarPayerId: string; verified: boolean; matchesValant: boolean } | null;
};

type ListResponse = {
  rows: Row[];
  canEdit: boolean;
  registryCount: number;
  agingAsOf: string | null;
  unmatchedClientPayers: { name: string; count: number }[];
};

type Filter = 'all' | 'used' | 'edi' | 'not-registry' | 'flagged' | 'duplicates';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'used', label: 'Used by clients' },
  { id: 'edi', label: 'Has Valant EDI ID' },
  { id: 'not-registry', label: 'Not yet in registry' },
  { id: 'flagged', label: 'Address / phone flagged' },
  { id: 'duplicates', label: 'Possible duplicates' },
];

const flagged = (r: Row) => r.practicePhone || r.addresses.some((a) => a.addressStatus === 'suspect' || a.addressStatus === 'unparsed' || a.phoneIssues.length > 0);

function addressText(a: { addressLine: string | null; city: string | null; state: string | null; zip: string | null; addressRaw: string | null }) {
  if (a.addressLine || a.city) return [a.addressLine, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return a.addressRaw || '';
}

/**
 * Billing → Insurance companies. The practice's insurance companies from Valant (Admin → EHR
 * Migration → Import Insurance Companies), with how many clients use each, and the links to the
 * payer registry and the Waystar payer mapping. Links are suggestions until billing confirms them.
 */
export default function InsuranceCompaniesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiJson<ListResponse>('/api/billing/insurance-companies');
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load insurance companies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const stats = useMemo(
    () => ({
      total: rows.length,
      edi: rows.filter((r) => r.ediPayerId).length,
      used: rows.filter((r) => r.clientCount > 0).length,
      clients: rows.reduce((n, r) => n + r.clientCount, 0),
      registry: rows.filter((r) => r.registry).length,
      waystarDiff: rows.filter((r) => r.waystar && !r.waystar.matchesValant).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === 'used' && r.clientCount === 0) return false;
        if (filter === 'edi' && !r.ediPayerId) return false;
        if (filter === 'not-registry' && r.registry) return false;
        if (filter === 'flagged' && !flagged(r)) return false;
        if (filter === 'duplicates' && !r.duplicateGroup) return false;
        if (!needle) return true;
        return [r.name, r.ediPayerId, ...r.nameVariants, ...r.addresses.map((a) => addressText(a))].some((v) => v.toLowerCase().includes(needle));
      })
      .sort((a, b) => b.clientCount - a.clientCount || a.name.localeCompare(b.name));
  }, [rows, q, filter]);

  const current = rows.find((r) => r.id === selected) ?? null;

  return (
    <Page>
      <PageHeader
        eyebrow="Altrixs · Billing"
        title="Insurance companies"
        description="Insurance companies imported from Valant, with how many clients use each. Valant EDI payer IDs are reference only: Waystar payer IDs are set in Payer settings."
        actions={
          <>
            <Link href="/dashboard/billing/payer-settings" className={buttonClasses({ variant: 'secondary' })}>
              Payer settings
            </Link>
            {data?.canEdit ? (
              <button
                type="button"
                onClick={() => setShowImport((v) => !v)}
                className={buttonClasses({ variant: 'primary' })}
              >
                <Upload size={16} aria-hidden /> Import from Valant
              </button>
            ) : null}
          </>
        }
      />

      {showImport ? <ValantPayersImport onImported={() => void load()} /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <StatGrid columns={5}>
        <StatCard label="Insurance companies" value={stats.total} />
        <StatCard label="With Valant EDI ID" value={stats.edi} />
        <StatCard label="Used by clients" value={stats.used} hint="Exact or confirmed client payer name" />
        <StatCard label="Linked to payer registry" value={stats.registry} hint={`${data?.registryCount ?? 0} registry entries`} />
        <StatCard
          label="Waystar ID differs from Valant"
          value={stats.waystarDiff}
          icon={stats.waystarDiff ? <AlertTriangle /> : undefined}
          tone={stats.waystarDiff ? 'warning' : 'neutral'}
          hint="Verify on Waystar's payer list"
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3">
            <label className="relative">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, EDI payer ID or address"
                aria-label="Search insurance companies"
                className={cx(inputClasses, 'pl-9')}
              />
            </label>
            <Tabs
              variant="pill"
              label="Filter insurance companies"
              controlsPanels={false}
              value={filter}
              onChange={(key) => setFilter(key)}
              items={FILTERS.map((f) => ({ key: f.id, label: f.label }))}
            />
          </div>
          {loading && !data ? (
            <LoadingState />
          ) : visible.length === 0 ? (
            <EmptyState
              title={rows.length ? 'No insurance companies match' : 'No insurance companies imported yet'}
              description={rows.length ? 'Change the search or filter.' : 'Import the Valant insurance companies export (Admin → EHR Migration → Import Insurance Companies).'}
            />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {visible.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-pressed={selected === r.id}
                    className={cx('flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600', selected === r.id ? 'bg-blue-50' : '')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{r.name}</span>
                      <span className="block truncate text-slate-500">
                        {r.addresses.length ? addressText(r.addresses[0]) || 'No address' : 'No address'}
                        {r.addresses.length > 1 ? ` · +${r.addresses.length - 1} more` : ''}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.ediPayerId ? <Badge size="sm" tone="brand">Valant EDI {r.ediPayerId}</Badge> : <Badge size="sm">No EDI ID</Badge>}
                        {r.registry ? <Badge size="sm" tone="info">Registry {r.registry.payerId}</Badge> : null}
                        {r.waystar ? <Badge size="sm" tone={r.waystar.matchesValant ? 'info' : 'warning'}>Waystar {r.waystar.waystarPayerId}</Badge> : null}
                        {flagged(r) ? <Badge size="sm" tone="warning">Flagged</Badge> : null}
                        {r.duplicateGroup ? <Badge size="sm" tone="warning">Possible duplicate</Badge> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-slate-900">{r.clientCount}</span>
                      <span className="block text-[11px] text-slate-500">clients</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {current ? (
            <PayerDetail key={current.id} row={current} canEdit={Boolean(data?.canEdit)} agingAsOf={data?.agingAsOf ?? null} onChanged={() => void load()} />
          ) : (
            <Card>
              <EmptyState icon={<Building2 />} title="Select an insurance company" description="See its addresses, phones, clients and links." />
            </Card>
          )}
          {data?.unmatchedClientPayers.length ? (
            <div className={cx(cardClasses, 'p-4 text-xs')}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Users size={16} aria-hidden className="text-slate-500" /> Client payer names with no insurance company
              </p>
              <p className="mt-1 text-slate-500">
                Names on client insurance that match no Valant insurance company exactly. Open the company and confirm the name to count those clients.
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {data.unmatchedClientPayers.slice(0, 20).map((n) => (
                  <li key={n.name} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                    <span className="truncate">{n.name}</span>
                    <span className="font-semibold tabular-nums">{n.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

const LINK_BTN = cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING);
const MUTED_BTN = cx('rounded font-semibold text-slate-600 hover:text-rose-700', FOCUS_RING);
const FIELD = cx(inputClasses, 'mt-1');

function PayerDetail({ row, canEdit, agingAsOf, onChanged }: { row: Row; canEdit: boolean; agingAsOf: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const primary = row.addresses.find((a) => a.addressStatus === 'ok') ?? row.addresses[0];
  const [form, setForm] = useState({
    payerId: '',
    name: row.name,
    clearinghouse: 'Waystar',
    claimsAddress: primary ? addressText(primary) : '',
    phone: row.phone ? formatPhone(row.phone) : '',
  });
  const [showCreate, setShowCreate] = useState(false);

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiJson(`/api/billing/insurance-companies/${row.id}`, { method: 'POST', body: JSON.stringify(body) });
      setMessage({ tone: 'ok', text: ok });
      setShowCreate(false);
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx(cardClasses, 'space-y-4 p-5 text-xs text-slate-700')}>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{row.name}</h2>
        {row.nameVariants.length > 1 ? <p className="text-slate-500">Also spelled: {row.nameVariants.filter((n) => n !== row.name).join(', ')}</p> : null}
        <p className="mt-1">
          Valant EDI payer ID: <span className="font-mono font-semibold">{row.ediPayerId || 'none'}</span>
          <span className="text-slate-500"> · from {row.sourceRowCount} Valant row{row.sourceRowCount === 1 ? '' : 's'}</span>
        </p>
        {row.duplicates.length ? (
          <p className="mt-1 flex items-start gap-1 text-amber-800">
            <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
            Possible duplicate of {row.duplicates.map((d) => `${d.name}${d.ediPayerId ? ` (${d.ediPayerId})` : ' (no EDI ID)'}`).join(', ')}. Kept separate.
          </p>
        ) : null}
      </div>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Building2 size={16} aria-hidden className="text-slate-500" /> Claim addresses and phones
        </h3>
        {row.addresses.length === 0 ? <p className="text-slate-500">No address in Valant.</p> : null}
        <ul className="space-y-1.5">
          {row.addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="font-semibold text-slate-900">{addressText(a) || 'No address'}</p>
              {a.addressIssues.length ? (
                <p className="text-amber-800">
                  Check: {a.addressIssues.join('; ')} (printed &quot;{a.addressRaw}&quot;)
                </p>
              ) : null}
              <p className="flex flex-wrap items-center gap-1">
                <Phone size={14} aria-hidden className="text-slate-500" />
                {a.phone ? formatPhone(a.phone) : null}
                {a.phonesRaw.filter((p) => !a.phone || p.replace(/\D/g, '').slice(-10) !== a.phone).map((p) => (
                  <span key={p} className="text-slate-500">{p}</span>
                ))}
                {!a.phonesRaw.length ? <span className="text-slate-500">no phone</span> : null}
              </p>
              {a.phoneIssues.length ? <p className="text-amber-800">Not a valid US number: {a.phoneIssues.join('; ')}</p> : null}
              <p className="text-[11px] text-slate-500">Valant rows {a.sourceLines.join(', ')}</p>
            </li>
          ))}
        </ul>
        {row.practicePhone ? <p className="mt-1 text-amber-800">A phone on this company is one of the practice&apos;s own billing numbers (entered in Valant by mistake).</p> : null}
        <p className="mt-1 text-xs text-slate-500">
          Valant&apos;s &quot;Tax IDs&quot; column is an internal association list (it includes the practice&apos;s own EIN), so it is not shown as the payer&apos;s tax ID.
        </p>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Users size={16} aria-hidden className="text-slate-500" /> Clients: {row.clientCount}
          <span className="font-normal text-slate-500">({row.activeClientCount} active)</span>
        </h3>
        {row.sharedName ? <p className="text-amber-800">Another Valant company has the same name, so these clients are counted on both.</p> : null}
        {row.clientNames.length ? (
          <ul className="space-y-0.5">
            {row.clientNames.map((n) => (
              <li key={n.name} className="flex items-center justify-between gap-2">
                <span>
                  {n.name} <span className="text-slate-500">{n.kind === 'exact' ? 'same name' : 'confirmed'}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{n.count}</span>
                  {canEdit && n.kind === 'confirmed' ? (
                    <button type="button" disabled={busy} onClick={() => void act({ action: 'remove_alias', name: n.name }, 'Name removed')} className={MUTED_BTN}>
                      Remove
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No client insurance uses this exact name.</p>
        )}
        {row.suggestedClientNames.length ? (
          <div className="mt-2 rounded-lg bg-amber-50 p-2">
            <p className="font-semibold text-amber-900">Similar client payer names (not counted until confirmed)</p>
            <ul className="mt-1 space-y-0.5">
              {row.suggestedClientNames.map((n) => (
                <li key={n.name} className="flex items-center justify-between gap-2">
                  <span>
                    {n.name} <span className="text-amber-800">({n.count} clients)</span>
                  </span>
                  {canEdit ? (
                    <button type="button" disabled={busy} onClick={() => void act({ action: 'confirm_alias', name: n.name }, `"${n.name}" now counts as ${row.name}`)} className={LINK_BTN}>
                      Same company
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-2 text-slate-500">
          Valant A/R: {row.agingCents != null ? `${formatCents(row.agingCents)} insurance aging${agingAsOf ? ` as of ${agingAsOf}` : ''}` : 'no insurance aging imported'}
          {' · '}
          {row.combinedAgingRows} combined-aging lines · {row.journalTransactions} journal transactions
        </p>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Link2 size={16} aria-hidden className="text-slate-500" /> Payer registry and Waystar
        </h3>
        {row.registry ? (
          <div className="flex items-center justify-between gap-2">
            <p>
              Linked: <span className="font-semibold">{row.registry.name}</span> · payer ID <span className="font-mono font-semibold">{row.registry.payerId}</span> ·{' '}
              {row.registry.clearinghouse}
            </p>
            {canEdit ? (
              <button type="button" disabled={busy} onClick={() => void act({ action: 'unlink_registry' }, 'Link removed')} className={MUTED_BTN}>
                Unlink
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {row.registrySuggestions.length ? (
              <ul className="space-y-0.5">
                {row.registrySuggestions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>
                      Suggested: {s.name} · <span className="font-mono">{s.payerId}</span> <span className="text-slate-500">(same {s.by === 'edi' ? 'payer ID' : s.by === 'name' ? 'name' : 'name and payer ID'})</span>
                    </span>
                    {canEdit ? (
                      <button type="button" disabled={busy} onClick={() => void act({ action: 'link_registry', payerRegistryId: s.id }, 'Linked to the payer registry')} className={LINK_BTN}>
                        Link
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">Not in the payer registry.</p>
            )}
            {canEdit && !showCreate ? (
              <button type="button" onClick={() => setShowCreate(true)} className={cx(LINK_BTN, 'mt-1')}>
                Create registry entry from this company
              </button>
            ) : null}
            {canEdit && showCreate ? (
              <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                <label className="font-medium text-slate-700 sm:col-span-2">
                  Payer ID for the clearinghouse (required)
                  <input
                    value={form.payerId}
                    onChange={(e) => setForm({ ...form, payerId: e.target.value.toUpperCase() })}
                    className={cx(FIELD, 'font-mono')}
                    placeholder="Confirm on the clearinghouse payer list"
                  />
                  {row.ediPayerId ? (
                    <span className="mt-1 block text-slate-500">
                      Valant used <span className="font-mono">{row.ediPayerId}</span> with its clearinghouse.{' '}
                      <button type="button" onClick={() => setForm({ ...form, payerId: row.ediPayerId })} className={LINK_BTN}>
                        Use it
                      </button>{' '}
                      only after checking it on {form.clearinghouse === 'Waystar' ? "Waystar's" : 'the'} payer list.
                    </span>
                  ) : null}
                </label>
                <label className="font-medium text-slate-700">
                  Name
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={FIELD} />
                </label>
                <label className="font-medium text-slate-700">
                  Clearinghouse
                  <select value={form.clearinghouse} onChange={(e) => setForm({ ...form, clearinghouse: e.target.value })} className={FIELD}>
                    <option>Waystar</option>
                    <option>Availity</option>
                    <option>Other</option>
                  </select>
                </label>
                <label className="font-medium text-slate-700 sm:col-span-2">
                  Claims address
                  <select value={form.claimsAddress} onChange={(e) => setForm({ ...form, claimsAddress: e.target.value })} className={FIELD}>
                    <option value="">None</option>
                    {row.addresses.map((a) => addressText(a)).filter(Boolean).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-medium text-slate-700">
                  Phone
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={FIELD} />
                </label>
                <div className="flex items-end gap-3">
                  <button
                    type="button"
                    disabled={busy || form.payerId.trim().length < 2 || form.name.trim().length < 2}
                    onClick={() =>
                      void act(
                        { action: 'create_registry', payerId: form.payerId.trim(), name: form.name.trim(), clearinghouse: form.clearinghouse, claimsAddress: form.claimsAddress || null, phone: form.phone || null },
                        'Registry entry created and linked'
                      )
                    }
                    className={buttonClasses({ variant: 'primary', size: 'sm' })}
                  >
                    {busy ? 'Saving…' : 'Create entry'}
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
        <div className="mt-2">
          {row.waystar ? (
            <p className={row.waystar.matchesValant ? '' : 'text-amber-800'}>
              Waystar mapping: {row.waystar.payerName} · <span className="font-mono font-semibold">{row.waystar.waystarPayerId}</span>{' '}
              {row.waystar.verified ? (
                <span className="inline-flex items-center gap-0.5 text-emerald-700">
                  <BadgeCheck size={14} aria-hidden /> verified
                </span>
              ) : (
                <span>unverified</span>
              )}
              {!row.waystar.matchesValant ? ` · differs from Valant's ${row.ediPayerId}: verify against Waystar's payer list` : ''}
            </p>
          ) : (
            <p className="text-slate-500">
              No Waystar payer mapping for this name. Add one in{' '}
              <Link href="/dashboard/billing/payer-settings" className={LINK_BTN}>
                Payer settings
              </Link>{' '}
              with the ID from Waystar&apos;s payer list.
            </p>
          )}
        </div>
      </section>
      {message ? <p role="status" className={message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}>{message.text}</p> : null}
    </div>
  );
}

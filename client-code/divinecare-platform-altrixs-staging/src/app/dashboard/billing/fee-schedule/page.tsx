'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Pencil, Search } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
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
import { formatCents } from '@/lib/migration/valantReportCommon';
import { createFeeForCode, fetchFeeSchedule, updateFeeItem, type FeeRow } from '@/features/billing/feeScheduleApi';
import { STICKY_ACTIONS_TD, STICKY_ACTIONS_TH, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';
import { CPT_CODES, FEE_NOT_SET } from '@/lib/constants/cpt';

type Filter = 'all' | 'review' | 'billable' | 'nonbillable' | 'inactive' | 'edited';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Needs review' },
  { id: 'billable', label: 'Insurance-billable' },
  { id: 'nonbillable', label: 'Self-pay / admin' },
  { id: 'edited', label: 'Edited in Altrixs' },
  { id: 'inactive', label: 'Inactive' },
];

const FLAGS = [
  { key: 'telehealth', label: 'Telehealth' },
  { key: 'selfPay', label: 'Self-pay' },
  { key: 'child', label: 'Child' },
  { key: 'itp', label: 'ITP' },
  { key: 'exactOnly', label: 'Exact code only' },
] as const;

type Draft = {
  description: string;
  fee: string;
  billedCpt: string;
  variantLabel: string;
  telehealth: boolean;
  selfPay: boolean;
  child: boolean;
  itp: boolean;
  exactOnly: boolean;
  needsReview: boolean;
  reviewNote: string;
};

function toDraft(r: FeeRow): Draft {
  return {
    description: r.description,
    fee: (r.feeCents / 100).toFixed(2),
    billedCpt: r.billedCpt ?? '',
    variantLabel: r.variantLabel,
    telehealth: r.telehealth,
    selfPay: r.selfPay,
    child: r.child,
    itp: r.itp,
    exactOnly: r.exactOnly,
    needsReview: r.needsReview,
    reviewNote: r.reviewNote ?? '',
  };
}

/**
 * Billing → Fee Schedule. The practice fee schedule imported from Valant (Admin → EHR Migration →
 * Import Fee Schedule). Claim lines default their charge from here; the payer gets the billed CPT.
 */
export default function FeeSchedulePage() {
  const [items, setItems] = useState<FeeRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFeeSchedule();
      setItems(r.items);
      setCanEdit(r.canEdit);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the fee schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      total: items.length,
      billable: items.filter((i) => i.insuranceBillable).length,
      review: items.filter((i) => i.needsReview).length,
      edited: items.filter((i) => i.source === 'altrixs').length,
    }),
    [items]
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'review' && !i.needsReview) return false;
      if (filter === 'billable' && !i.insuranceBillable) return false;
      if (filter === 'nonbillable' && i.insuranceBillable) return false;
      if (filter === 'inactive' && i.active) return false;
      if (filter === 'edited' && i.source !== 'altrixs') return false;
      if (!needle) return true;
      return [i.code, i.description, i.billedCpt ?? '', i.variantLabel].some((v) => v.toLowerCase().includes(needle));
    });
  }, [items, q, filter]);

  // Built-in codes with no fee (e.g. 99212) and no active fee row: claims refuse a blank charge for them
  const noFee = useMemo(() => {
    const have = new Set(items.filter((i) => i.active && i.baseCpt).map((i) => i.baseCpt as string));
    return CPT_CODES.filter((c) => c.rate == null && !have.has(c.code));
  }, [items]);
  const [newFee, setNewFee] = useState<Record<string, string>>({});
  const addFee = async (code: string) => {
    const fee = Number(newFee[code]);
    if (!Number.isFinite(fee) || fee <= 0) {
      setError(`Enter a fee greater than $0.00 for ${code}`);
      return;
    }
    setSaving(true);
    try {
      const item = await createFeeForCode(code, Math.round(fee * 100));
      setItems((prev) => [...prev, item]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const replace = (row: FeeRow) => setItems((prev) => prev.map((p) => (p.id === row.id ? row : p)));

  const toggleActive = async (row: FeeRow) => {
    try {
      replace(await updateFeeItem(row.id, { active: !row.active }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const save = async (row: FeeRow) => {
    if (!draft) return;
    const fee = Number(draft.fee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Enter a fee of $0.00 or more');
      return;
    }
    setSaving(true);
    try {
      const next = await updateFeeItem(row.id, {
        description: draft.description,
        feeCents: Math.round(fee * 100),
        billedCpt: draft.billedCpt.trim() || null,
        variantLabel: draft.variantLabel,
        telehealth: draft.telehealth,
        selfPay: draft.selfPay,
        child: draft.child,
        itp: draft.itp,
        exactOnly: draft.exactOnly,
        needsReview: draft.needsReview,
        reviewNote: draft.reviewNote.trim() || null,
      });
      replace(next);
      setEditing(null);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const cell = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

  return (
    <Page>
      <PageHeader
        eyebrow="Altrixs · Billing"
        title="Fee Schedule"
        description="Practice fees by code and variant. New claim lines default their charge from here (telehealth, self-pay and child variants picked by the visit); the payer always gets the billed CPT, never the Valant code."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <StatGrid columns={4}>
        <StatCard label="Fee items" value={stats.total} />
        <StatCard label="Insurance-billable" value={stats.billable} hint="Real CPT/HCPCS billed code, not self-pay" />
        <StatCard
          label="Needs review"
          value={stats.review}
          icon={stats.review ? <AlertTriangle /> : undefined}
          tone={stats.review ? 'warning' : 'neutral'}
        />
        <StatCard label="Edited in Altrixs" value={stats.edited} hint="Kept on Valant re-import" />
      </StatGrid>

      {!loading && noFee.length ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle aria-hidden className="h-4 w-4 text-amber-700" /> Built-in codes without a fee
          </p>
          <p className="mt-0.5">Claims with these codes need a fee here (or a charge entered on the line); they are never billed at $0.</p>
          <ul className="mt-2 space-y-1.5">
            {noFee.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="text-amber-800">{c.desc}</span>
                <Badge tone="warning">{FEE_NOT_SET}</Badge>
                {canEdit ? (
                  <>
                    <input
                      aria-label={`Fee for ${c.code}`}
                      inputMode="decimal"
                      placeholder="Fee ($)"
                      value={newFee[c.code] ?? ''}
                      onChange={(e) => setNewFee((m) => ({ ...m, [c.code]: e.target.value }))}
                      className={`${cell} w-24 bg-white`}
                    />
                    <button type="button" disabled={saving} onClick={() => void addFee(c.code)} className={buttonClasses({ variant: 'primary', size: 'sm' })}>
                      Set fee
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={cx(cardClasses, 'flex flex-col gap-3 p-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between')}>
        <div className="relative w-full min-w-0 sm:max-w-sm lg:min-w-[16rem] lg:flex-[1_1_18rem]">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, description, billed CPT…"
            aria-label="Search fee schedule"
            className={cx(inputClasses, 'pl-9')}
          />
        </div>
        <Tabs
          variant="pill"
          label="Filter fee items"
          className="min-w-0"
          controlsPanels={false}
          value={filter}
          onChange={(key) => setFilter(key)}
          items={FILTERS.map((f) => ({ key: f.id, label: f.label }))}
        />
      </div>

      <div className={cx(cardClasses, 'clinic-scroll-x overflow-x-auto')}>
        {loading ? (
          <LoadingState label="Loading fee schedule…" />
        ) : items.length === 0 ? (
          <div>
            <EmptyState title="No fee schedule yet" description="Import Valant's Fees export to set practice fees. Until then claims use the built-in rates." />
            <p className="pb-8 text-center text-sm">
              <Link href="/dashboard/admin/migration" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
                Admin → EHR Migration → Import Fee Schedule
              </Link>
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className={cx('px-3 py-2', STICKY_FIRST_TH)}>Valant code</th>
                <th scope="col" className="px-3 py-2">Description</th>
                <th scope="col" className="px-3 py-2 text-right">Fee</th>
                <th scope="col" className="px-3 py-2">Billed CPT</th>
                <th scope="col" className="px-3 py-2">Variant</th>
                <th scope="col" className="px-3 py-2">Insurance</th>
                <th scope="col" className="px-3 py-2">Source</th>
                <th scope="col" className="px-3 py-2">Active</th>
                <th scope="col" className={cx('px-3 py-2', STICKY_ACTIONS_TH)}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) =>
                editing === row.id && draft ? (
                  <tr key={row.id} className="border-t border-slate-100 bg-blue-50/40 align-top">
                    <td className="sticky left-0 z-10 bg-blue-50 px-3 py-2 font-mono font-semibold text-slate-900">{row.code}</td>
                    <td className="px-3 py-2">
                      <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${cell} w-full`} />
                      <label className="mt-2 flex items-center gap-1.5">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-blue-600" checked={draft.needsReview} onChange={(e) => setDraft({ ...draft, needsReview: e.target.checked })} />
                        Needs review
                      </label>
                      <textarea
                        value={draft.reviewNote}
                        onChange={(e) => setDraft({ ...draft, reviewNote: e.target.value })}
                        placeholder="Review note"
                        rows={2}
                        className={`${cell} mt-1 w-full`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min={0} step="0.01" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} className={`${cell} w-24 text-right`} />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={draft.billedCpt}
                        onChange={(e) => setDraft({ ...draft, billedCpt: e.target.value.toUpperCase() })}
                        placeholder="blank = not billed"
                        className={`${cell} w-24 font-mono`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {FLAGS.map((f) => (
                          <label key={f.key} className="flex items-center gap-1.5">
                            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-blue-600" checked={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} />
                            {f.label}
                          </label>
                        ))}
                        <input
                          value={draft.variantLabel}
                          onChange={(e) => setDraft({ ...draft, variantLabel: e.target.value })}
                          placeholder="Label"
                          className={`${cell} mt-1 w-36`}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500" colSpan={3}>
                      Insurance-billable is recomputed on save: a real CPT/HCPCS billed code and not self-pay.
                    </td>
                    <td className="sticky right-0 z-10 bg-blue-50 px-3 py-2 shadow-[inset_1px_0_0_0_rgb(226,232,240)]">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void save(row)}
                          className={buttonClasses({ variant: 'primary', size: 'sm' })}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setDraft(null);
                          }}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className={`group border-t border-slate-100 align-top hover:bg-slate-50 ${row.active ? '' : 'opacity-60'}`}>
                    <td className={cx('px-3 py-2 font-mono font-semibold text-slate-900', STICKY_FIRST_TD)}>
                      {row.code}
                      {row.baseCpt && row.baseCpt !== row.code.toUpperCase() ? <span className="block font-normal text-slate-500">base {row.baseCpt}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {row.description}
                      {row.needsReview ? (
                        <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800">
                          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
                          {row.reviewNote || 'Marked for review'}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{formatCents(row.feeCents)}</td>
                    <td className="px-3 py-2 font-mono">{row.billedCpt ?? <span className="text-slate-500">—</span>}</td>
                    <td className="px-3 py-2">
                      <Badge tone={row.selfPay ? 'warning' : row.telehealth ? 'info' : row.child ? 'brand' : 'neutral'}>{row.variantLabel}</Badge>
                      {row.exactOnly ? <span className="ml-1 text-xs text-slate-500">exact code only</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.insuranceBillable ? <Badge tone="success">Billable</Badge> : <Badge tone="neutral">Not billed</Badge>}
                      {row.needsReview ? (
                        <span className="ml-1">
                          <Badge tone="warning">Check</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.source === 'altrixs' ? 'Edited in Altrixs' : 'Valant'}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => void toggleActive(row)}
                        role="switch"
                        aria-checked={row.active}
                        aria-label={`${row.code} active`}
                        className={cx('relative h-5 w-9 rounded-full transition disabled:opacity-50', FOCUS_RING, row.active ? 'bg-blue-600' : 'bg-slate-300')}
                      >
                        <span aria-hidden className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition ${row.active ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className={cx('px-3 py-2', STICKY_ACTIONS_TD)}>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Pencil />}
                          onClick={() => {
                            setEditing(row.id);
                            setDraft(toDraft(row));
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              )}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    No fee items match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Variant flags are derived from the Valant code suffix (T telehealth, S self-pay, C child, CS child self-pay, ITP with treatment plan) and the description;
        correct them here. Edits are kept when the Valant file is imported again unless &quot;overwrite edits&quot; is ticked.
      </p>
    </Page>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { buttonClasses, cx, FOCUS_RING, inputClasses } from '@/components/ui';
import { FILTER_BAR, FILTER_SEARCH, FILTER_SELECT, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

const RUNOUT_SELECT =
  'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

export type ValantTotals = {
  displayBucketsCents: number[];
  valantBucketsCents: number[];
  totalCents: number;
  rows: number;
};

type Presented = {
  displayBucketsCents: number[];
  valantBucketsCents: number[];
  totalCents: number;
  shownAsOver120: boolean;
};

export type ValantRunout = {
  available: boolean;
  note: string;
  labels: string[];
  labelsConfirmed: boolean;
  displayAllOver120: boolean;
  over120Note: string;
  asOf: { insurance: string | null; patient: string | null; combined: string | null };
  latestAsOf: string | null;
  totals: { insurance: ValantTotals | null; patient: ValantTotals | null; all: ValantTotals | null };
  combined: { insuranceLines: ValantTotals; patientLines: ValantTotals } | null;
  byPayer: Array<{ payerName: string; rowCount: number; combinedLines: number } & Presented>;
  facilityNote: string;
  unmatched: {
    patientAgingRows: number;
    patientAgingTotal: number;
    combinedPatients: number;
    combinedPatientsTotal: number;
    combinedInsuranceLines: number;
  };
  worklist: {
    rows: Array<
      {
        id: string;
        valantPatientId: string;
        clientId: string | null;
        clientName: string | null;
        mrn: string | null;
        party: string;
        payerName: string | null;
        lastBilledAt: string | null;
        oldestBucket: number;
      } & Presented
    >;
    total: number;
    page: number;
    pageSize: number;
    totalCents: number;
    payers: string[];
  };
};

export type ValantQuery = {
  payer: string;
  bucket: string;
  min: string;
  party: string;
  q: string;
  unmatched: boolean;
  sort: 'oldest' | 'amount' | 'lastBilled' | 'name';
  page: number;
};

export const DEFAULT_VALANT_QUERY: ValantQuery = {
  payer: '',
  bucket: '',
  min: '',
  party: '',
  q: '',
  unmatched: false,
  sort: 'oldest',
  page: 1,
};

export function valantQueryString(q: ValantQuery, withPage = true) {
  const p = new URLSearchParams();
  if (q.payer) p.set('payer', q.payer);
  if (q.bucket) p.set('bucket', q.bucket);
  if (q.min) p.set('min', q.min);
  if (q.party) p.set('party', q.party);
  if (q.q.trim()) p.set('q', q.q.trim());
  if (q.unmatched) p.set('unmatched', '1');
  if (q.sort !== 'oldest') p.set('sort', q.sort);
  if (withPage && q.page > 1) p.set('page', String(q.page));
  return p.toString();
}

/** Same colors as the claim aging buckets (youngest green -> oldest dark red) */
export const BUCKET_COLORS = ['#15803D', '#B45309', '#DC2626', '#7C2D12', '#450A0A'];
/** Tailwind fills/text per bucket, youngest (emerald) to oldest (deep rose). */
const BUCKET_BG = ['bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-rose-700', 'bg-rose-900'];
const BUCKET_TEXT = ['text-emerald-700', 'text-amber-700', 'text-rose-700', 'text-rose-800', 'text-rose-900'];
const VALANT_BALANCES = '/dashboard/billing/valant-balances';

export function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const PARTY_LABEL: Record<string, string> = { primary: 'Primary', secondary: 'Secondary', other: 'Other', patient: 'Patient' };

function StackedBar({ buckets, total }: { buckets: number[]; total: number }) {
  if (total <= 0) return <div className="h-2.5 rounded-full bg-slate-100" />;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
      {buckets.map((c, i) =>
        c > 0 ? <div key={i} className={BUCKET_BG[i]} style={{ width: `${(c / total) * 100}%` }} /> : null
      )}
    </div>
  );
}

export default function ValantRunoutSection({
  data,
  loading,
  query,
  onQuery,
}: {
  data: ValantRunout | null;
  loading: boolean;
  query: ValantQuery;
  onQuery: (next: Partial<ValantQuery>) => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);

  if (!data) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <p className="text-sm text-slate-500">{loading ? 'Loading Valant run-out A/R…' : 'Valant run-out A/R could not be loaded.'}</p>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-base font-semibold text-slate-900">Valant run-out A/R</h2>
        <p className="mt-2 text-sm text-slate-500">
          No Valant aging reports have been imported yet. Import the Patient, Insurance and Combined Aging reports on{' '}
          <Link href={VALANT_BALANCES} className="font-semibold text-blue-700 hover:underline">Valant Balances</Link>.
        </p>
      </section>
    );
  }

  const { labels } = data;
  const original = data.displayAllOver120 && showOriginal;
  const pick = (t: { displayBucketsCents: number[]; valantBucketsCents: number[] }) => (original ? t.valantBucketsCents : t.displayBucketsCents);

  const agingRows: Array<{ label: string; asOf: string | null; t: ValantTotals | null; strong?: boolean }> = [
    { label: 'Insurance A/R', asOf: data.asOf.insurance, t: data.totals.insurance },
    { label: 'Patient A/R', asOf: data.asOf.patient, t: data.totals.patient },
    { label: 'Total Valant A/R', asOf: null, t: data.totals.all, strong: true },
  ];

  const wl = data.worklist;
  const pages = Math.max(1, Math.ceil(wl.total / wl.pageSize));
  const exportHref = `/api/billing/ar/valant/export${valantQueryString(query, false) ? `?${valantQueryString(query, false)}` : ''}`;

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Valant run-out aging</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Bucket labels from Valant Balances{data.labelsConfirmed ? '' : ' (not yet confirmed in Valant)'}.
            </p>
          </div>
          {data.displayAllOver120 ? (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
              Show Valant&apos;s original buckets
            </label>
          ) : null}
        </div>
        {data.displayAllOver120 ? (
          <p className="mt-2 text-xs text-slate-500">
            {original ? "Showing Valant's original buckets." : `Shown as ${labels[4]} (practice setting). Tick the box to see Valant's original buckets.`}
          </p>
        ) : null}
        <div className="clinic-scroll-x mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <th scope="col" className="py-2 pr-3">Source</th>
                <th scope="col" className="py-2 pr-3">As of</th>
                {labels.map((l, i) => (
                  <th scope="col" key={l} className="py-2 pr-3 text-right">
                    <span aria-hidden className={cx('mr-1 inline-block h-2 w-2 rounded-full', BUCKET_BG[i])} />
                    {l}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agingRows.map((r) => (
                <tr key={r.label} className={r.strong ? 'font-semibold text-slate-900' : 'text-slate-700'}>
                  <td className="py-2 pr-3">
                    {r.label}
                    {r.t ? <div className="mt-1 w-40"><StackedBar buckets={pick(r.t)} total={r.t.totalCents} /></div> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{r.strong ? '' : r.t ? fmtDate(r.asOf) : 'Not imported'}</td>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <td key={i} className="py-2 pr-3 text-right tabular-nums">{r.t ? money(pick(r.t)[i] ?? 0) : '—'}</td>
                  ))}
                  <td className="py-2 text-right tabular-nums">{r.t ? money(r.t.totalCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Unmatched to an Altrixs client: {data.unmatched.patientAgingRows} of {data.unmatched.patientAgingTotal} patient aging rows ·{' '}
          {data.unmatched.combinedPatients} of {data.unmatched.combinedPatientsTotal} combined aging patients ({data.unmatched.combinedInsuranceLines} insurance lines).{' '}
          <Link href={`${VALANT_BALANCES}?tab=combined`} className="font-semibold text-blue-700 hover:underline">Match on Valant Balances</Link>
        </p>
        <p className="mt-1 text-xs text-slate-500">{data.facilityNote}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Insurance A/R by payer</h2>
          <span className="text-xs text-slate-500">Valant Insurance Aging · as of {fmtDate(data.asOf.insurance)} · click a payer to filter the worklist</span>
        </div>
        {data.byPayer.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No insurance aging imported.</p>
        ) : (
          <div className="clinic-scroll-x mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className={cx('py-2 pr-3', STICKY_FIRST_TH)}>Payer</th>
                  <th scope="col" className="py-2 pr-3 text-right" title="Insurance aging rows / combined aging patient lines">Rows / lines</th>
                  {labels.map((l) => <th scope="col" key={l} className="py-2 pr-3 text-right">{l}</th>)}
                  <th scope="col" className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byPayer.slice(0, 25).map((p) => {
                  const active = query.payer.toLowerCase() === p.payerName.toLowerCase();
                  return (
                    <tr
                      key={p.payerName}
                      onClick={() => onQuery({ payer: active ? '' : p.payerName, page: 1 })}
                      className={`group cursor-pointer hover:bg-slate-50 ${active ? 'bg-blue-50' : ''}`}
                    >
                      <td className={cx('py-2 pr-3 font-medium text-slate-900', STICKY_FIRST_TD, active ? 'bg-blue-50' : '')}>
                        {p.payerName}
                        <div className="mt-1 w-40"><StackedBar buckets={pick(p)} total={p.totalCents} /></div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{p.rowCount} / {p.combinedLines}</td>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <td key={i} className="py-2 pr-3 text-right tabular-nums text-slate-700">{money(pick(p)[i] ?? 0)}</td>
                      ))}
                      <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{money(p.totalCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.byPayer.length > 25 ? (
              <p className="mt-2 text-xs text-slate-500">Top 25 of {data.byPayer.length} payers. All payers are on Valant Balances.</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Run-out worklist</h2>
            <p className="text-xs text-slate-500">
              Insurance balances by patient and payer · Valant Combined Aging as of {fmtDate(data.asOf.combined)} · work these in Valant
            </p>
          </div>
          <a
            href={exportHref}
            className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'ml-auto' })}
          >
            <Download size={14} aria-hidden /> Export worklist CSV
          </a>
        </div>
        <div className={cx(FILTER_BAR, 'border-b border-slate-200 px-5 py-3')}>
          <div className={cx(FILTER_SEARCH, 'sm:max-w-sm')}>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
            <input
              value={query.q}
              onChange={(e) => onQuery({ q: e.target.value, page: 1 })}
              placeholder="Search client, MRN, Valant ID, payer…"
              aria-label="Search the run-out worklist"
              className={cx(inputClasses, 'pl-9')}
            />
          </div>
          <select aria-label="Payer" value={query.payer} onChange={(e) => onQuery({ payer: e.target.value, page: 1 })} className={cx(RUNOUT_SELECT, FILTER_SELECT)}>
            <option value="">All payers</option>
            {wl.payers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Aging bucket" value={query.bucket} onChange={(e) => onQuery({ bucket: e.target.value, page: 1 })} className={cx(RUNOUT_SELECT, FILTER_SELECT)}>
            <option value="">All aging</option>
            {labels.map((l, i) => <option key={l} value={String(i)}>{l}</option>)}
          </select>
          <select aria-label="Responsible party" value={query.party} onChange={(e) => onQuery({ party: e.target.value, page: 1 })} className={cx(RUNOUT_SELECT, FILTER_SELECT)}>
            <option value="">Primary + secondary</option>
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="other">Other</option>
          </select>
          <input
            type="number"
            min={0}
            step="1"
            value={query.min}
            onChange={(e) => onQuery({ min: e.target.value, page: 1 })}
            placeholder="Min $"
            aria-label="Minimum balance in dollars"
            className={cx(RUNOUT_SELECT, 'w-full sm:w-24')}
          />
          <select aria-label="Sort" value={query.sort} onChange={(e) => onQuery({ sort: e.target.value as ValantQuery['sort'], page: 1 })} className={cx(RUNOUT_SELECT, FILTER_SELECT)}>
            <option value="oldest">Oldest first</option>
            <option value="amount">Highest balance</option>
            <option value="lastBilled">Longest since billed</option>
            <option value="name">Client name</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={query.unmatched} onChange={(e) => onQuery({ unmatched: e.target.checked, page: 1 })} />
            Unmatched only
          </label>
        </div>

        {wl.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {loading ? 'Loading…' : wl.total === 0 && !valantQueryString(query, false) ? 'No insurance balances in the Combined Aging import.' : 'No run-out balances match your filters.'}
          </p>
        ) : (
          <div className={`clinic-scroll-x overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className={cx('px-5 py-2', STICKY_FIRST_TH)}>Client</th>
                  <th scope="col" className="py-2 pr-3">Payer</th>
                  <th scope="col" className="py-2 pr-3">Last billed</th>
                  {labels.map((l) => <th scope="col" key={l} className="py-2 pr-3 text-right">{l}</th>)}
                  <th scope="col" className="py-2 pr-5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {wl.rows.map((r) => (
                  <tr key={r.id} className="group align-top hover:bg-slate-50">
                    <td className={cx('px-5 py-2.5', STICKY_FIRST_TD)}>
                      {r.clientId ? (
                        <Link href={`/dashboard/clients/${r.clientId}`} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">
                          {r.clientName ?? 'Client'}
                        </Link>
                      ) : (
                        <Link href={`${VALANT_BALANCES}?tab=combined`} className="font-semibold text-amber-800 hover:underline" title="Not matched to an Altrixs client">
                          Unmatched
                        </Link>
                      )}
                      <div className="text-xs text-slate-500">
                        Valant {r.valantPatientId}{r.mrn ? ` · MRN ${r.mrn}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">
                      {r.payerName ?? '—'}
                      <div className="text-xs text-slate-500">{PARTY_LABEL[r.party] ?? r.party}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">{fmtDate(r.lastBilledAt)}</td>
                    {[0, 1, 2, 3, 4].map((i) => {
                      const c = pick(r)[i] ?? 0;
                      return (
                        <td key={i} className={cx('py-2.5 pr-3 text-right tabular-nums', c > 0 ? BUCKET_TEXT[i] : 'text-slate-500')}>
                          {c ? money(c) : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2.5 pr-5 text-right font-semibold tabular-nums text-slate-900">{money(r.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>
            {wl.total} line{wl.total === 1 ? '' : 's'} · {money(wl.totalCents)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={wl.page <= 1 || loading}
              onClick={() => onQuery({ page: wl.page - 1 })}
              className={cx('inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 sm:h-8 sm:w-8', FOCUS_RING)}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} aria-hidden />
            </button>
            <span>Page {wl.page} of {pages}</span>
            <button
              type="button"
              disabled={wl.page >= pages || loading}
              onClick={() => onQuery({ page: wl.page + 1 })}
              className={cx('inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 sm:h-8 sm:w-8', FOCUS_RING)}
              aria-label="Next page"
            >
              <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

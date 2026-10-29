'use client';

import { useState } from 'react';
import { BookOpen, Database, Download, Radio, Table2 } from 'lucide-react';
import type { CptUsageRow, OverviewPreset, PayerMix, ValantKpis } from '@/lib/billing/overviewValant';
import { OVERVIEW_DEFINITIONS } from '@/lib/billing/overviewValant';

/** Shared pieces of the Billing overview and the Medical billing summary (two sources, never summed). */

export function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const s = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}$${s}`;
}

function moneyShort(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(0)}k`;
  return `$${d.toFixed(0)}`;
}

export function pct(p: number | null | undefined): string {
  return p == null ? '—' : `${p.toFixed(1)}%`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function shortDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ─── Source labels ───────────────────────────────────────────────────────────

export function SourceHeader({ source, asOf, note }: { source: 'valant' | 'altrixs'; asOf?: string | null; note?: string | null }) {
  const valant = source === 'valant';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          valant ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-purple-50 text-purple-800 border border-purple-200'
        }`}
      >
        {valant ? <Database size={12} /> : <Radio size={12} />}
        {valant ? `Valant (imported${asOf ? `, as of ${shortDate(asOf)}` : ''})` : 'Altrixs (live)'}
      </span>
      {note && <span className="text-xs text-gray-500">{note}</span>}
    </div>
  );
}

export function SourceTag({ text }: { text: string }) {
  return <p className="mt-2 text-[11px] text-gray-500">{text}</p>;
}

// ─── Range controls ──────────────────────────────────────────────────────────

export type RangeValue = { preset: OverviewPreset; from: string; to: string };

export function RangeControls({
  value,
  onChange,
  facility,
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  facility?: { options: { facility: string; rows: number }[]; selected: string | null; note: string | null; onChange: (f: string | null) => void };
}) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const btn = (active: boolean) =>
    `inline-flex min-h-10 items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors sm:min-h-8 ${active ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        <button className={btn(value.preset === 'mtd')} style={value.preset === 'mtd' ? { background: '#5C2D91' } : {}}
          onClick={() => onChange({ preset: 'mtd', from: '', to: '' })}>Month to date</button>
        <button className={btn(value.preset === '90d')} style={value.preset === '90d' ? { background: '#5C2D91' } : {}}
          onClick={() => onChange({ preset: '90d', from: '', to: '' })}>Last 90 days</button>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) onChange({ preset: 'custom', from, to });
        }}
      >
        <label className="text-[11px] text-gray-500">From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 block min-h-10 border border-gray-200 rounded-lg px-2 py-1 text-xs sm:min-h-8" />
        </label>
        <label className="text-[11px] text-gray-500">To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 block min-h-10 border border-gray-200 rounded-lg px-2 py-1 text-xs sm:min-h-8" />
        </label>
        <button type="submit" disabled={!from || !to} className={btn(value.preset === 'custom')}
          style={value.preset === 'custom' ? { background: '#5C2D91' } : {}}>Apply</button>
      </form>
      {facility && (
        facility.options.length ? (
          <label className="w-full text-[11px] text-gray-500 sm:w-auto">Location (Valant facility)
            <select value={facility.selected ?? ''} onChange={(e) => facility.onChange(e.target.value || null)}
              className="mt-0.5 block min-h-10 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white sm:min-h-8 sm:w-auto sm:max-w-[260px]">
              <option value="">All facilities</option>
              {facility.options.map((o) => <option key={o.facility} value={o.facility}>{o.facility}</option>)}
            </select>
          </label>
        ) : (
          facility.note && <p className="text-[11px] text-gray-500 max-w-xs">{facility.note}</p>
        )
      )}
    </div>
  );
}

// ─── KPI cards ───────────────────────────────────────────────────────────────

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="stat-number mt-1 break-words text-lg font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/**
 * KPI grid for a card that sits in a two-column (lg:grid-cols-2) row: four across on tablets
 * and very wide screens, two across while the card is only half the content width.
 */
export const HALF_CARD_KPI_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4';

export function ValantKpiGrid({ kpis, rangeLabel }: { kpis: ValantKpis; rangeLabel: string }) {
  return (
    <div className={HALF_CARD_KPI_GRID}>
      <Kpi label="Charges" value={money(kpis.chargesCents)} sub={`${kpis.chargeCount.toLocaleString()} charge rows`} />
      <Kpi label="Insurance payments" value={money(kpis.insurancePaymentsCents)} />
      <Kpi label="Patient payments" value={money(kpis.patientPaymentsCents)} />
      <Kpi label="Adjustments" value={money(kpis.adjustmentsCents)} sub="Insurance + patient" />
      <Kpi label="Net collections" value={money(kpis.netCollectionsCents)} sub="Insurance + patient payments" />
      <Kpi
        label="Collection rate"
        value={pct(kpis.collectionRate.pct)}
        sub={`Payments ÷ charges, same service dates (${rangeLabel})`}
      />
      <Kpi label="Visits billed" value={kpis.visitsBilled.toLocaleString()} sub="Patient + date of service" />
      <Kpi label="Avg charge / visit" value={money(kpis.avgChargePerVisitCents)} />
      {(kpis.feesCents !== 0 || kpis.otherCents !== 0) && (
        <p className="col-span-2 sm:col-span-4 lg:col-span-2 2xl:col-span-4 text-[11px] text-gray-500">
          Not in the figures above: no-show / late-cancel fees {money(kpis.feesCents)}; transfers and unclassified codes {money(kpis.otherCents)} (net).
        </p>
      )}
    </div>
  );
}

// ─── Trend chart (charges vs payments by month) ──────────────────────────────

const CHARGES_COLOR = '#7C3AED';
const PAYMENTS_COLOR = '#0D9488';

export function TrendChart<T extends { month: string }>({
  points,
  pick,
  seriesLabels = ['Charges', 'Payments'],
  onCsv,
}: {
  points: T[];
  pick: (p: T) => [number, number];
  seriesLabels?: [string, string];
  onCsv?: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = points.map((p) => pick(p));
  const max = Math.max(1, ...values.flat().map((v) => Math.max(0, v)));
  const H = 160;
  const empty = values.every(([a, b]) => a === 0 && b === 0);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-4 text-xs text-gray-600" aria-label="Legend">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: CHARGES_COLOR }} />{seriesLabels[0]}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: PAYMENTS_COLOR }} />{seriesLabels[1]}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTable((t) => !t)} className="flex items-center gap-1 text-xs text-purple-700 hover:underline">
            <Table2 size={12} /> {table ? 'Chart' : 'Table'}
          </button>
          {onCsv && (
            <button onClick={onCsv} className="flex items-center gap-1 text-xs text-purple-700 hover:underline"><Download size={12} /> CSV</button>
          )}
        </div>
      </div>
      {empty && <p className="py-6 text-center text-sm text-gray-500">No rows in the last 12 months.</p>}
      {!empty && !table && (
        <div className="relative">
          <div className="flex items-end gap-1 border-b border-gray-200" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {points.map((p, i) => {
              const [a, b] = values[i];
              return (
                <div key={p.month} className="flex-1 h-full flex items-end justify-center gap-[2px] cursor-default"
                  onMouseEnter={() => setHover(i)} aria-label={`${monthLabel(p.month)}: ${seriesLabels[0]} ${money(a)}, ${seriesLabels[1]} ${money(b)}`}>
                  <div className="w-[38%] rounded-t" style={{ height: `${(Math.max(0, a) / max) * 100}%`, background: CHARGES_COLOR, opacity: hover == null || hover === i ? 1 : 0.45 }} />
                  <div className="w-[38%] rounded-t" style={{ height: `${(Math.max(0, b) / max) * 100}%`, background: PAYMENTS_COLOR, opacity: hover == null || hover === i ? 1 : 0.45 }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-1">
            {points.map((p) => <div key={p.month} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500 sm:text-[11px]">{monthLabel(p.month)}</div>)}
          </div>
          <p className="absolute -top-1 left-0 text-[11px] text-slate-500">{moneyShort(max)}</p>
          {hover != null && (
            <div className="absolute top-2 z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md pointer-events-none"
              style={{ left: `min(calc(${(hover / points.length) * 100}% ), calc(100% - 180px))` }}>
              <p className="font-semibold text-gray-800">{monthLabel(points[hover].month)}</p>
              <p className="text-gray-600">{seriesLabels[0]}: <span className="font-semibold text-gray-900">{money(values[hover][0])}</span></p>
              <p className="text-gray-600">{seriesLabels[1]}: <span className="font-semibold text-gray-900">{money(values[hover][1])}</span></p>
            </div>
          )}
        </div>
      )}
      {!empty && table && (
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 border-b border-gray-100"><th className="text-left py-1">Month</th><th className="text-right py-1">{seriesLabels[0]}</th><th className="text-right py-1">{seriesLabels[1]}</th></tr></thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.month} className="border-b border-gray-50">
                <td className="py-1">{monthLabel(p.month)}</td>
                <td className="py-1 text-right tabular-nums">{money(values[i][0])}</td>
                <td className="py-1 text-right tabular-nums">{money(values[i][1])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// ─── Payer mix ───────────────────────────────────────────────────────────────

export function PayerMixTable({ mix, onCsv }: { mix: PayerMix; onCsv?: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px] text-gray-500">{mix.sourceNote}</p>
        {onCsv && <button onClick={onCsv} className="shrink-0 flex items-center gap-1 text-xs text-purple-700 hover:underline"><Download size={12} /> CSV</button>}
      </div>
      {mix.source === 'valant_journal' ? (
        <div className="grid md:grid-cols-2 gap-4 [&>*]:min-w-0">
          {([['Top 10 by charges', mix.topByCharges, 'chargesCents'], ['Top 10 by payments', mix.topByPayments, 'paymentsCents']] as const).map(([title, rows, key]) => (
            <div key={title}>
              <p className="text-xs font-semibold text-gray-700 mb-1">{title}</p>
              {rows.length === 0 ? <p className="text-xs text-gray-500">None in range</p> : (
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sr-only"><tr><th scope="col">Payer</th><th scope="col">Amount</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.payer} className="border-b border-gray-50">
                        <td className="py-1 pr-2 text-gray-700 break-words">{r.payer}</td>
                        <td className="py-1 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">{money(r[key])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          ))}
          <p className="md:col-span-2 text-[11px] text-gray-500">
            {mix.rowsWithInsurance.toLocaleString()} of {mix.rowsInRange.toLocaleString()} rows in range carry an insurance cell.
          </p>
        </div>
      ) : mix.fallback.length ? (
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 border-b border-gray-100">
            <th className="text-left py-1">Payer</th>
            <th className="text-right py-1">{mix.source === 'insurance_aging' ? 'Open insurance A/R' : 'Active clients'}</th>
          </tr></thead>
          <tbody>
            {mix.fallback.map((r) => (
              <tr key={r.payer} className="border-b border-gray-50">
                <td className="py-1 pr-2 text-gray-700 break-words">{r.payer}</td>
                <td className="py-1 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">{r.cents != null ? money(r.cents) : r.clients}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </div>
  );
}

// ─── CPT usage ───────────────────────────────────────────────────────────────

export function CptUsageTable({ rows, onCsv, feeScheduleHref }: { rows: CptUsageRow[]; onCsv?: () => void; feeScheduleHref?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 15);
  const unpriced = rows.reduce((s, r) => s + r.unpricedLines, 0);
  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="min-w-0 text-[11px] text-gray-500">
          Charge lines by CPT / HCPCS (Valant exports no units column). Expected = lines × fee-schedule fee of the same Valant code.
          {unpriced > 0 && ` ${unpriced.toLocaleString()} lines have no fee-schedule match and are unpriced.`}
          {feeScheduleHref && <> <a href={feeScheduleHref} className="text-purple-700 hover:underline">Fee schedule</a></>}
        </p>
        {onCsv && <button onClick={onCsv} className="shrink-0 flex items-center gap-1 text-xs text-purple-700 hover:underline"><Download size={12} /> CSV</button>}
      </div>
      {rows.length === 0 ? <p className="py-4 text-center text-sm text-gray-500">No charge lines in range</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-left py-1.5">Code</th><th className="text-left py-1.5">Description</th>
                <th className="text-right py-1.5">Lines</th><th className="text-right py-1.5">Charges</th><th className="text-right py-1.5">Expected at fee schedule</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.codeBase} className="border-b border-gray-50">
                  <td className="py-1.5 font-mono font-bold text-purple-700" title={r.codes.join(', ')}>{r.codeBase}</td>
                  <td className="py-1.5 text-gray-600 max-w-[240px] truncate">{r.description ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.lines.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{money(r.chargesCents)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">
                    {money(r.expectedCents)}{r.unpricedLines > 0 && r.expectedCents != null && <span className="text-gray-400"> ({r.unpricedLines} unpriced)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 15 && (
            <button onClick={() => setAll((a) => !a)} className="mt-2 text-xs text-purple-700 hover:underline">
              {all ? 'Show top 15' : `Show all ${rows.length} codes`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Definitions ─────────────────────────────────────────────────────────────

export function DefinitionsPanel({ extra = [] }: { extra?: { term: string; text: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-gray-700" aria-expanded={open}>
        <BookOpen size={15} /> Definitions
      </button>
      {open && (
        <dl className="mt-3 grid md:grid-cols-2 gap-x-6 gap-y-2">
          {[...OVERVIEW_DEFINITIONS, ...extra].map((d) => (
            <div key={d.term}>
              <dt className="text-xs font-semibold text-gray-800">{d.term}</dt>
              <dd className="text-xs text-gray-600">{d.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Download a CSV from an API URL (keeps the session cookie) */
export async function downloadCsv(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Export failed (${res.status})`);
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

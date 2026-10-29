'use client';

import { useMemo, useState } from 'react';
import { TRENDED_TEST_KEYS, findTestByKey, findTestByName } from '@/lib/labs/catalog';
import { parseReferenceRange } from '@/lib/labs/results';
import { FLAG_STYLE, fmtDay, type LabOrderDto, type LabTestDef } from './labClient';

type Point = { at: number; value: number; raw: string; unit: string | null; refRange: string | null; flag: string };
type Series = { key: string; name: string; unit: string | null; points: Point[] };

/** Trended drug levels / ANC from released or unreleased results (numeric values only) */
export function buildTrendSeries(orders: LabOrderDto[], tests: LabTestDef[]): Series[] {
  const byKey = new Map<string, Series>();
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const r of o.results) {
      if (r.numericValue == null && !/^[<>]?=?\s*-?\d/.test(r.value)) continue;
      const value = r.numericValue ?? Number(String(r.value).replace(/[<>=\s,]/g, ''));
      if (!Number.isFinite(value)) continue;
      const direct = r.testKey && !r.panelName && TRENDED_TEST_KEYS.includes(r.testKey) ? findTestByKey(r.testKey, tests) : null;
      const def = direct ?? findTestByName(r.testName, tests);
      if (!def || !TRENDED_TEST_KEYS.includes(def.key)) continue;
      const at = new Date(r.collectedAt || o.collectedAt || o.resultedAt || o.orderedAt).getTime();
      const s = byKey.get(def.key) ?? { key: def.key, name: def.name, unit: r.unit, points: [] };
      s.points.push({ at, value, raw: r.value, unit: r.unit, refRange: r.refRange, flag: r.flag });
      byKey.set(def.key, s);
    }
  }
  return [...byKey.values()].map((s) => ({ ...s, points: s.points.sort((a, b) => a.at - b.at) })).sort((a, b) => a.name.localeCompare(b.name));
}

const W = 520;
const H = 150;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

function TrendChart({ s }: { s: Series }) {
  const [hover, setHover] = useState<number | null>(null);
  const latest = s.points[s.points.length - 1];
  // Reference band only from a range the lab printed (latest result); never a default range
  const band = latest?.refRange ? parseReferenceRange(latest.refRange) : null;
  const values = s.points.map((p) => p.value);
  const bandVals = band?.kind === 'between' ? [band.low, band.high] : [];
  let min = Math.min(...values, ...bandVals);
  let max = Math.max(...values, ...bandVals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.1;
  max += span * 0.1;
  const t0 = s.points[0].at;
  const t1 = latest.at === t0 ? t0 + 1 : latest.at;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const single = s.points.length === 1;
  const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${(single ? W / 2 : x(p.at)).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const hp = hover != null ? s.points[hover] : null;

  return (
    <figure className="rounded-xl border border-slate-200 p-3">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{s.name}</span>
        <span className="text-xs text-slate-500">
          Latest <span className={`font-mono ${FLAG_STYLE[latest.flag] ?? ''}`}>{latest.raw} {latest.unit || ''}</span> · {fmtDay(new Date(latest.at).toISOString())}
          {latest.refRange ? ` · ref ${latest.refRange}` : ''}
        </span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${s.name} trend, ${s.points.length} results`} onMouseLeave={() => setHover(null)}>
          {band?.kind === 'between' ? (
            <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(band.high)} height={Math.max(1, y(band.low) - y(band.high))} fill="#5C2D91" opacity={0.08} />
          ) : null}
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#E2E8F0" />
          <text x={PAD.l - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill="#64748B">{max.toFixed(max < 10 ? 2 : 0)}</text>
          <text x={PAD.l - 6} y={y(min)} textAnchor="end" fontSize="10" fill="#64748B">{min.toFixed(min < 10 ? 2 : 0)}</text>
          <text x={PAD.l} y={H - 8} fontSize="10" fill="#64748B">{fmtDay(new Date(t0).toISOString())}</text>
          {!single ? <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="10" fill="#64748B">{fmtDay(new Date(t1).toISOString())}</text> : null}
          <path d={path} fill="none" stroke="#5C2D91" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {s.points.map((p, i) => {
            const cx = single ? W / 2 : x(p.at);
            const cy = y(p.value);
            const abnormal = p.flag && p.flag !== 'N';
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle cx={cx} cy={cy} r={4} fill={abnormal ? '#BE123C' : '#5C2D91'} stroke="#fff" strokeWidth={2} />
              </g>
            );
          })}
        </svg>
        {hp ? (
          <div className="pointer-events-none absolute right-2 top-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] shadow">
            <span className="font-semibold">{fmtDay(new Date(hp.at).toISOString())}</span>: <span className="font-mono">{hp.raw} {hp.unit || ''}</span>
            {hp.flag !== 'N' ? <span className="ml-1 font-bold text-rose-700">{hp.flag}</span> : null}
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        Shaded band = reference range printed with the latest result{band?.kind === 'between' ? '' : ' (none entered)'}. Red points are flagged. Values: {s.points.map((p) => p.raw).join(', ')}
      </p>
    </figure>
  );
}

export function LabTrends({ orders, tests }: { orders: LabOrderDto[]; tests: LabTestDef[] }) {
  const series = useMemo(() => buildTrendSeries(orders, tests), [orders, tests]);
  if (!series.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {series.map((s) => (
        <TrendChart key={s.key} s={s} />
      ))}
    </div>
  );
}

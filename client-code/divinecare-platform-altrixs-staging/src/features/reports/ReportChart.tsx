'use client';

/**
 * Report library chart (recharts). Loaded with next/dynamic from the runner page so recharts is
 * not in the library bundle. Non-numeric cells (e.g. "<10" after suppression) plot as gaps.
 */
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { displayCell } from '@/lib/reports/library/exportFormat';
import type { ChartSpec, ReportRow } from '@/lib/reports/library/types';
import { EmptyState } from '@/components/ui';

// Series colours (Recharts needs hex): brand blue-600, sky-600, emerald-600, amber-600, slate-500, rose-600.
const PALETTE = ['#5C2D91', '#0284C7', '#059669', '#D97706', '#64748B', '#E11D48'];

export default function ReportChart({ spec, rows, timeZone }: { spec: ChartSpec; rows: ReportRow[]; timeZone: string }) {
  const source = (spec.data ?? rows).slice(0, 40);
  const data = source.map((r) => {
    const out: Record<string, string | number | null> = { [spec.xKey]: String(r[spec.xKey] ?? '') };
    for (const s of spec.series) {
      const v = r[s.key];
      out[s.key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return out;
  });
  const hasValues = data.some((d) => spec.series.some((s) => typeof d[s.key] === 'number' && (d[s.key] as number) !== 0));
  if (!data.length || !hasValues) return <EmptyState compact title="Nothing to chart for these parameters." />;
  const type = spec.valueType ?? 'number';
  const fmt = (v: unknown) => (typeof v === 'number' ? displayCell(v, type, timeZone) : '—');
  const tick = (v: unknown) => {
    if (typeof v !== 'number') return '';
    if (type === 'money') return `$${Math.round(v / 100).toLocaleString('en-US')}`;
    if (type === 'percent') return `${v}%`;
    return v.toLocaleString('en-US');
  };
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
      <XAxis dataKey={spec.xKey} tick={{ fontSize: 11, fill: '#64748B' }} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 70 : 30} />
      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={tick} width={70} />
      <Tooltip formatter={(v) => fmt(v)} />
      {spec.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
    </>
  );
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {spec.type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            {axis}
            {spec.series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            {axis}
            {spec.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={PALETTE[i % PALETTE.length]} stackId={spec.type === 'stackedBar' ? 'a' : undefined} radius={spec.type === 'stackedBar' ? 0 : [4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

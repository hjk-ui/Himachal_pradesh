'use client';

/**
 * Clinical Insights trend charts (recharts; loaded with next/dynamic from the page).
 * Suppressed points (n < 10) are gaps, never zero; every point's tooltip shows its n.
 * Palette validated with the dataviz validator: #7B4BB7 / #00897B (light surface).
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Trends } from '@/lib/insights/clinical/population';

const C1 = '#7B4BB7';
const C2 = '#00897B';
const AXIS = { fontSize: 11, fill: '#64748b' };

type Point = { label: string; [k: string]: string | number | null };

function TooltipBox({ active, payload, label, nKey }: { active?: boolean; payload?: { name: string; value: number | null; color: string; payload: Point }[]; label?: string; nKey: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-800">{label}</p>
      {payload.map((x) => (
        <p key={x.name} className="text-slate-700">
          <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: x.color }} />
          {x.name}: {x.value == null ? 'suppressed (n<10)' : `${x.value}%`}
        </p>
      ))}
      <p className="text-slate-500">n = {p[nKey] ?? 0}</p>
    </div>
  );
}

function Chart({ title, sub, data, lines, nKey }: { title: string; sub: string; data: Point[]; lines: { key: string; name: string; color: string }[]; nKey: string }) {
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <figcaption>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </figcaption>
      <div className="mt-3 h-48" role="img" aria-label={`${title}. Values are listed in the table below the chart.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" domain={[0, 'auto']} allowDecimals={false} />
            <Tooltip content={<TooltipBox nKey={nKey} />} />
            {lines.length > 1 ? <Legend wrapperStyle={{ fontSize: 11, color: '#334155' }} iconType="circle" /> : null}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: l.color }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none font-medium text-slate-600">Table view</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-3 font-medium">Period</th>
                {lines.map((l) => <th key={l.key} className="py-1 pr-3 font-medium">{l.name}</th>)}
                <th className="py-1 font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{d.label}</td>
                  {lines.map((l) => <td key={l.key} className="py-1 pr-3">{d[l.key] == null ? '— (n<10)' : `${d[l.key]}%`}</td>)}
                  <td className="py-1">{d[nKey] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortMonth = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export default function TrendsCharts({ trends, currentWeek, currentMonth }: { trends: Trends; currentWeek: string; currentMonth: string }) {
  const weeks: Point[] = trends.weeks.map((w) => ({
    label: `${shortDay(w.start)}${w.start === currentWeek ? ' (to date)' : ''}`,
    noShow: w.noShowRate.pct,
    n: w.attended + w.missed,
  }));
  const months: Point[] = trends.months.map((m) => ({
    label: `${shortMonth(m.month)}${m.month === currentMonth ? ' (to date)' : ''}`,
    worsening: m.worsening.pct,
    improving: m.improving.pct,
    n: m.withTrajectory,
    measurement: m.measurement.pct,
    seen: m.measurement.den,
  }));
  if (!weeks.length && !months.length) {
    return <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">No appointments or scores in the trend window yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Chart title="No-show / late-cancel rate" sub="Weekly: missed ÷ (attended + missed) appointments with a recorded status" data={weeks} lines={[{ key: 'noShow', name: 'Missed', color: C1 }]} nKey="n" />
      <Chart title="Reliable change" sub="Monthly share of clients with a current trajectory (PHQ-9, GAD-7, PCL-5)" data={months} lines={[{ key: 'worsening', name: 'Worsening', color: C1 }, { key: 'improving', name: 'Improving', color: C2 }]} nKey="n" />
      <Chart title="Measurement completion" sub="Monthly: clients seen who had a PHQ-9 or GAD-7 that month" data={months} lines={[{ key: 'measurement', name: 'Measured', color: C2 }]} nKey="seen" />
    </div>
  );
}

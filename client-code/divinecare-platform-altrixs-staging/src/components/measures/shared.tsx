'use client';

/**
 * Shared bits for the MBC outcomes page and the chart Measures card: severity tone from the
 * instrument's score bands, the trend sparkline, send-status badge and "Send now".
 */
import { cx, StatusBadge, type Tone } from '@/components/ui';

export type ScoreBand = { min: number; max: number; label: string };

/** Band label + tone: best band success, worst band danger, the ones between warning / info */
export function bandFor(score: number | null, bands: ScoreBand[], higherIsBetter = false): { label: string; tone: Tone } | null {
  if (score == null || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => (higherIsBetter ? b.min - a.min : a.min - b.min));
  const idx = sorted.findIndex((b) => score >= b.min && score <= b.max);
  if (idx === -1) return null;
  const tone: Tone = idx === 0 ? 'success' : idx === sorted.length - 1 ? 'danger' : idx === 1 && sorted.length > 3 ? 'info' : 'warning';
  return { label: sorted[idx].label, tone };
}

const TONE_SPARK: Record<Tone, string> = {
  neutral: 'stroke-slate-500 fill-slate-500',
  brand: 'stroke-blue-600 fill-blue-600',
  info: 'stroke-sky-600 fill-sky-600',
  success: 'stroke-emerald-600 fill-emerald-600',
  warning: 'stroke-amber-500 fill-amber-500',
  danger: 'stroke-rose-600 fill-rose-600',
};

/** Mini line chart (dots + polyline, severity-colored) */
export function TrendSparkline({ scores, tone, width = 128, height = 40 }: { scores: number[]; tone: Tone; width?: number; height?: number }) {
  if (scores.length < 2) return <span className="text-xs text-slate-500">Not enough data</span>;
  const pad = 8;
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const span = Math.max(hi - lo, 1);
  const points = scores.map((s, i) => ({ x: pad + (i / (scores.length - 1)) * (width - pad * 2), y: height - pad - ((s - lo) / span) * (height - pad * 2) }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cx('block', TONE_SPARK[tone])} aria-hidden>
      <path d={path} fill="none" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.25} className="stroke-white" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  Sent: 'info',
  Opened: 'brand',
  Started: 'warning',
  Completed: 'success',
  Expired: 'neutral',
  Locked: 'danger',
  'Not sent': 'danger',
  Cancelled: 'neutral',
};

export function SendStatusBadge({ status, title }: { status: string; title?: string }) {
  return (
    <span title={title}>
      <StatusBadge size="sm" tone={STATUS_TONE[status] ?? 'neutral'}>
        {status}
      </StatusBadge>
    </span>
  );
}

export type SendNowResult = { sent: boolean; message: string };

/** POST /api/clinical/measure-requests: one link for these measures (consent / DOB / Part 2 checked server-side) */
export async function sendMeasuresNow(clientId: string, instrumentIds: string[], assignmentIds?: string[]): Promise<SendNowResult> {
  try {
    const res = await fetch('/api/clinical/measure-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, instrumentIds, assignmentIds }),
    });
    const data = await res.json().catch(() => ({}));
    const channels = Array.isArray(data.results) ? (data.results as { ok: boolean; message: string }[]).filter((r) => !r.ok).map((r) => r.message) : [];
    const base = data.message || data.error || (res.ok ? 'Done' : `Could not send (${res.status})`);
    return { sent: Boolean(data.success), message: [base, ...channels].join(' ') };
  } catch {
    return { sent: false, message: 'Could not send (network error).' };
  }
}

/** "Give in session": the existing assessment form, filtered to the instrument */
export function giveInSessionHref(clientId: string, measureName: string): string {
  return `/dashboard/ehr/assessments?clientId=${encodeURIComponent(clientId)}&instrument=${encodeURIComponent(measureName)}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  program: 'Program rule',
  provider_rule: 'Provider rule',
  visit_rule: 'Visit rule',
  sud_radar: 'SUD radar',
  legacy: 'Migrated',
};

export function scheduleLabel(schedule: string, everyDays: number | null): string {
  if (schedule === 'once') return 'one-time';
  if (schedule === 'before_visit') return 'before each visit';
  return `every ${everyDays ?? 30} days`;
}

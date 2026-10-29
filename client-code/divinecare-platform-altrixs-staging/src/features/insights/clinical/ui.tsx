'use client';

import { AlertOctagon, AlertTriangle, Eye, CheckCircle2, TrendingDown, Info } from 'lucide-react';
import { StatusBadge, type Tone } from '@/components/ui';
import { TIER_LABEL, type Signal, type SignalLevel, type Tier } from '@/lib/insights/clinical/types';

/** Tier tone (semantic) and the AA text colour class used for tier numbers. */
export const TIER_STYLE: Record<Tier, { tone: Tone; text: string }> = {
  urgent: { tone: 'danger', text: 'text-rose-700' },
  high: { tone: 'warning', text: 'text-amber-700' },
  watch: { tone: 'warning', text: 'text-amber-800' },
  stable: { tone: 'neutral', text: 'text-slate-900' },
};

const TIER_ICON = { urgent: AlertOctagon, high: AlertTriangle, watch: Eye, stable: CheckCircle2 } as const;

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  const Icon = TIER_ICON[tier];
  return (
    <StatusBadge tone={s.tone} icon={<Icon />}>
      {TIER_LABEL[tier]}
    </StatusBadge>
  );
}

const LEVEL_STYLE: Record<SignalLevel, string> = {
  urgent: 'border-rose-200 bg-rose-50 text-rose-800',
  high: 'border-amber-200 bg-amber-50 text-amber-800',
  watch: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  positive: 'border-sky-200 bg-sky-50 text-sky-800',
  stable: 'border-slate-200 bg-slate-50 text-slate-700',
};

/** "Why" chip: label + date; the level is spelled out for screen readers (never color alone). */
export function SignalChip({ signal }: { signal: Signal }) {
  const Icon = signal.level === 'positive' ? TrendingDown : signal.level === 'info' ? Info : null;
  return (
    <span title={signal.detail} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${LEVEL_STYLE[signal.level]}`}>
      {Icon ? <Icon size={12} aria-hidden /> : null}
      <span className="sr-only">{signal.level}: </span>
      {signal.label}
      {signal.date ? <span className="font-normal opacity-80">· {fmtDay(signal.date)}</span> : null}
    </span>
  );
}

export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function pctText(r: { pct: number | null; num: number; den: number; suppressed: boolean }): string {
  if (r.suppressed) return r.den === 0 ? '— (no data)' : `— (n<10)`;
  return r.pct == null ? '—' : `${r.pct}%`;
}

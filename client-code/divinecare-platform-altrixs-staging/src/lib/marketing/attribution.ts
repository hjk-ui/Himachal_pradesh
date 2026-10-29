/**
 * Attribution analytics (pure): counts and rates only, no PHI. Client-linked counts in breakdown
 * cells (converted, first appointments) are small-cell suppressed: a value from 1 to threshold-1
 * shows as "<threshold" and the rate it feeds is hidden.
 */
import { LEAD_SOURCES, OPEN_STAGES } from './constants';

export type AttributionLead = {
  source: string;
  stage: string;
  furthestStage: string;
  partnerId?: string | null;
  eventId?: string | null;
  createdAt: Date;
  firstResponseAt?: Date | null;
  convertedAt?: Date | null;
  /** First appointment attended / scheduled after conversion */
  firstAppointmentAt?: Date | null;
};

export type SpendRow = { channel: string; month: string; amountCents: number };

export type Cell = { value: number; display: string; suppressed: boolean };

export function suppress(n: number, threshold: number): Cell {
  if (threshold > 1 && n > 0 && n < threshold) return { value: n, display: `<${threshold}`, suppressed: true };
  return { value: n, display: n.toLocaleString('en-US'), suppressed: false };
}

/** Percent with one decimal, or null when the denominator is 0. */
export function rate(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

const stageIndex = (s: string) => (s === 'converted' ? OPEN_STAGES.length : (OPEN_STAGES as string[]).indexOf(s));

/** Stage funnel: how many leads reached at least each stage (by furthest stage). */
export function stageFunnel(leads: AttributionLead[]): { stage: string; count: number; rateFromPrev: number | null }[] {
  const stages = [...OPEN_STAGES, 'converted'];
  const counts = stages.map((st) => leads.filter((l) => stageIndex(l.furthestStage === 'converted' || l.stage === 'converted' ? 'converted' : l.furthestStage) >= stageIndex(st)).length);
  return stages.map((stage, i) => ({ stage, count: counts[i], rateFromPrev: i === 0 ? null : rate(counts[i], counts[i - 1]) }));
}

export type SourceRow = {
  source: string;
  label: string;
  leads: number;
  contacted: number;
  converted: Cell;
  firstAppointments: Cell;
  conversionRate: number | null;
  spendCents: number;
  costPerLeadCents: number | null;
  costPerConversionCents: number | null;
};

/** Spend channel names map to lead sources by key or label (case-insensitive). */
export function spendForSource(spend: SpendRow[], source: string): number {
  const label = LEAD_SOURCES.find((s) => s.key === source)?.label.toLowerCase();
  return spend
    .filter((r) => r.channel.toLowerCase() === source || (label && r.channel.toLowerCase() === label))
    .reduce((a, r) => a + r.amountCents, 0);
}

export function sourceReport(leads: AttributionLead[], spend: SpendRow[], threshold: number): SourceRow[] {
  const sources = Array.from(new Set([...LEAD_SOURCES.map((s) => s.key as string), ...leads.map((l) => l.source)]));
  return sources
    .map((source) => {
      const ls = leads.filter((l) => l.source === source);
      const converted = ls.filter((l) => l.stage === 'converted' || l.convertedAt).length;
      const appts = ls.filter((l) => l.firstAppointmentAt).length;
      const contacted = ls.filter((l) => stageIndex(l.furthestStage) >= 1 || l.stage === 'converted').length;
      const spendCents = spendForSource(spend, source);
      const c = suppress(converted, threshold);
      return {
        source,
        label: LEAD_SOURCES.find((s) => s.key === source)?.label ?? source,
        leads: ls.length,
        contacted,
        converted: c,
        firstAppointments: suppress(appts, threshold),
        conversionRate: c.suppressed ? null : rate(converted, ls.length),
        spendCents,
        costPerLeadCents: ls.length && spendCents ? Math.round(spendCents / ls.length) : null,
        costPerConversionCents: !c.suppressed && converted && spendCents ? Math.round(spendCents / converted) : null,
      };
    })
    .filter((r) => r.leads > 0 || r.spendCents > 0)
    .sort((a, b) => b.leads - a.leads);
}

export type SpeedSummary = { responded: number; medianMinutes: number | null; averageMinutes: number | null; withinTargetRate: number | null; waiting: number };

export function speedSummary(leads: AttributionLead[], targetMinutes: number): SpeedSummary {
  const mins = leads
    .filter((l) => l.firstResponseAt)
    .map((l) => Math.max(0, (l.firstResponseAt!.getTime() - l.createdAt.getTime()) / 60000))
    .sort((a, b) => a - b);
  const waiting = leads.filter((l) => !l.firstResponseAt && (OPEN_STAGES as string[]).includes(l.stage)).length;
  if (!mins.length) return { responded: 0, medianMinutes: null, averageMinutes: null, withinTargetRate: null, waiting };
  const mid = Math.floor(mins.length / 2);
  const median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
  const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
  return {
    responded: mins.length,
    medianMinutes: Math.round(median),
    averageMinutes: Math.round(avg),
    withinTargetRate: rate(mins.filter((m) => m <= targetMinutes).length, mins.length),
    waiting,
  };
}

export type PartnerRow = { partnerId: string; name: string; leads: number; converted: Cell; lastTouchAt: string | null; quiet: boolean };

/** Referral leaderboard: leads per partner (counts only). quiet = no referral and no touch in 60 days. */
export function partnerLeaderboard(
  leads: AttributionLead[],
  partners: { id: string; name: string; lastTouchAt?: Date | null }[],
  threshold: number,
  now: Date,
): PartnerRow[] {
  const sixty = 60 * 24 * 3600000;
  return partners
    .map((p) => {
      const ls = leads.filter((l) => l.partnerId === p.id);
      const lastLead = ls.reduce<Date | null>((a, l) => (!a || l.createdAt > a ? l.createdAt : a), null);
      const lastActivity = [lastLead, p.lastTouchAt ?? null].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      return {
        partnerId: p.id,
        name: p.name,
        leads: ls.length,
        converted: suppress(ls.filter((l) => l.stage === 'converted').length, threshold),
        lastTouchAt: p.lastTouchAt ? p.lastTouchAt.toISOString() : null,
        quiet: !lastActivity || now.getTime() - lastActivity.getTime() > sixty,
      };
    })
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
}

export type EventRoi = {
  eventId: string;
  title: string;
  registrations: number;
  attended: number;
  leads: number;
  converted: Cell;
  costCents: number;
  costPerLeadCents: number | null;
};

export function eventRoi(
  events: { id: string; title: string; costCents: number; registrations: number; attended: number }[],
  leads: AttributionLead[],
  threshold: number,
): EventRoi[] {
  return events.map((e) => {
    const ls = leads.filter((l) => l.eventId === e.id);
    return {
      eventId: e.id,
      title: e.title,
      registrations: e.registrations,
      attended: e.attended,
      leads: ls.length,
      converted: suppress(ls.filter((l) => l.stage === 'converted').length, threshold),
      costCents: e.costCents,
      costPerLeadCents: ls.length && e.costCents ? Math.round(e.costCents / ls.length) : null,
    };
  });
}

export type RatingPoint = { month: string; count: number; average: number | null };

/** Monthly review trend (YYYY-MM), oldest first. */
export function ratingTrend(reviews: { rating: number; reviewedAt: Date }[], months = 6, now = new Date()): RatingPoint[] {
  const out: RatingPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const rs = reviews.filter((r) => r.reviewedAt.toISOString().slice(0, 7) === key);
    out.push({ month: key, count: rs.length, average: rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : null });
  }
  return out;
}

export function averageRating(reviews: { rating: number }[]): number | null {
  if (!reviews.length) return null;
  return Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10;
}

export function formatCents(c: number | null | undefined): string {
  if (c == null) return '—';
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: c % 100 === 0 ? 0 : 2 });
}

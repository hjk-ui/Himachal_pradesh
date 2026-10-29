/**
 * No-show risk score for upcoming SCHEDULED appointments.
 *
 * This is a transparent, rule-based checklist: every point in the score comes
 * from one row of NO_SHOW_WEIGHTS below, and each row that fires adds a plain
 * reason string. It is NOT a machine-learning model or an LLM, it has not been
 * validated against this practice's outcomes, and it should be read as "worth a
 * confirmation call", never as a prediction of what a client will do.
 *
 * Attendance history is thin (most appointments were imported from Valant in
 * October 2026), so history-based factors are damped when a client has fewer
 * than MIN_HISTORY resolved past appointments, and imported clients without
 * attendance history in Altrixs are not treated as first-time visitors.
 */
import type { AppointmentStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { behavioralCareTeamClientWhere, canAccessClientAppointments, canAccessClientRoster, clientOrgFilter } from '@/lib/clients/orgScope';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { addCalendarDays, clinicDate, parseDateOnly } from '@/lib/workflows/dates';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

export const CLINIC_TIME_ZONE = 'America/New_York';

// ─── Weights (points added to a 0-100 score) ───────────────────────────────────
// Edit here only. The values are judgment-based starting points drawn from common
// outpatient no-show patterns, not fitted to data. Total is capped at 100.
export const NO_SHOW_WEIGHTS = {
  /** Share of resolved past appointments (12 months) that were NO_SHOW or LATE_CANCEL, times this */
  priorMissRate: 40,
  /** Multiplier applied to priorMissRate when history is below MIN_HISTORY */
  limitedHistoryDamping: 0.25,
  /** Per CANCELLED appointment in the last 60 days (or already cancelled ahead), capped */
  recentCancellationEach: 6,
  recentCancellationCap: 15,
  /** No completed / checked-in visit on record, and not imported from a previous EHR */
  firstVisit: 12,
  /** Imported client with no attended visit in Altrixs yet (history not migrated) */
  importedNoHistory: 3,
  /** Booked 21+ / 42+ days ahead (only for appointments booked in Altrixs) */
  leadTime21: 6,
  leadTime42: 10,
  /** Slot timing (ET) */
  monday: 4,
  earlyMorning: 5, // before 9:00
  lateEvening: 4, // 17:00 or later
  /** In-person rather than telehealth */
  inPerson: 5,
  /** Days since last attended visit */
  gap60: 6,
  gap120: 10,
} as const;

/** Resolved past appointments needed before history-based factors count fully */
export const MIN_HISTORY = 3;

export const LEVEL_THRESHOLDS = { high: 45, medium: 25 } as const;

export type RiskLevel = 'low' | 'medium' | 'high';

export type HistoryRow = {
  status: AppointmentStatus;
  startsAt: Date;
};

export type ScoreInput = {
  startsAt: Date;
  createdAt: Date;
  isVirtual: boolean;
  /** Client.importedAt / sourcePlatform: the client came from a previous EHR */
  clientImportedAt: Date | null;
  clientImported: boolean;
  history: HistoryRow[];
  now?: Date;
};

export type ScoreResult = {
  score: number;
  level: RiskLevel;
  reasons: string[];
  historyAvailable: boolean;
  /** Resolved past appointments (12 months) used for the history factor */
  historyCount: number;
};

const ATTENDED: AppointmentStatus[] = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'];
const MISSED: AppointmentStatus[] = ['NO_SHOW', 'LATE_CANCEL'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Weekday (0=Sun) and hour/minute of an instant in clinic time. */
export function clinicParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** UTC instant of 00:00 clinic time on a YYYY-MM-DD date (DST-safe). */
export function clinicMidnightUtc(date: string): Date {
  parseDateOnly(date);
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetAt = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: CLINIC_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
    return asUtc - ms;
  };
  let ts = guess - offsetAt(guess);
  ts = guess - offsetAt(ts);
  return new Date(ts);
}

export function formatClinicDateTime(d: Date) {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return { date, time: `${time} ET` };
}

function levelFor(score: number): RiskLevel {
  if (score >= LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/** Pure scoring: no I/O, easy to test. */
export function scoreAppointment(input: ScoreInput): ScoreResult {
  const W = NO_SHOW_WEIGHTS;
  const now = input.now ?? new Date();
  const factors: { points: number; reason: string }[] = [];

  const yearAgo = now.getTime() - 365 * DAY_MS;
  const past = input.history.filter(
    (h) => h.startsAt.getTime() < now.getTime() && h.status !== 'SCHEDULED'
  );
  const resolved12 = past.filter((h) => h.startsAt.getTime() >= yearAgo);
  const historyCount = resolved12.length;
  const historyAvailable = historyCount >= MIN_HISTORY;

  // 1. Prior missed-appointment rate (12 months)
  const missed = resolved12.filter((h) => MISSED.includes(h.status)).length;
  if (historyCount > 0 && missed > 0) {
    const rate = missed / historyCount;
    const damp = historyAvailable ? 1 : W.limitedHistoryDamping;
    const pts = rate * W.priorMissRate * damp;
    factors.push({
      points: pts,
      reason: `${missed} of ${historyCount} past appointment${historyCount === 1 ? '' : 's'} missed or late-cancelled (12 mo)${historyAvailable ? '' : ', limited history'}`,
    });
  }

  // 2. Recent cancellations (last 60 days, or upcoming slots already cancelled)
  const cancelFrom = now.getTime() - 60 * DAY_MS;
  const cancels = input.history.filter(
    (h) => h.status === 'CANCELLED' && h.startsAt.getTime() >= cancelFrom
  ).length;
  if (cancels > 0) {
    factors.push({
      points: Math.min(W.recentCancellationCap, cancels * W.recentCancellationEach),
      reason: `${cancels} cancellation${cancels === 1 ? '' : 's'} in the last 60 days`,
    });
  }

  // 3. First visit / imported without history
  const attended = past.filter((h) => ATTENDED.includes(h.status));
  if (attended.length === 0) {
    if (input.clientImported) {
      factors.push({
        points: W.importedNoHistory,
        reason: 'No attended visits recorded yet in Altrixs (history from previous EHR not imported)',
      });
    } else {
      factors.push({ points: W.firstVisit, reason: 'First visit with the practice' });
    }
  }

  // 4. Lead time — only when the appointment was booked in Altrixs (import sets createdAt to import time)
  const bookedInAltrixs =
    !input.clientImported ||
    (input.clientImportedAt != null &&
      input.createdAt.getTime() - input.clientImportedAt.getTime() > DAY_MS);
  if (bookedInAltrixs) {
    const leadDays = Math.floor((input.startsAt.getTime() - input.createdAt.getTime()) / DAY_MS);
    if (leadDays >= 42) {
      factors.push({ points: W.leadTime42, reason: `Booked ${leadDays} days in advance` });
    } else if (leadDays >= 21) {
      factors.push({ points: W.leadTime21, reason: `Booked ${leadDays} days in advance` });
    }
  }

  // 5. Slot timing (clinic time)
  const { weekday, hour } = clinicParts(input.startsAt);
  if (weekday === 1) factors.push({ points: W.monday, reason: 'Monday appointment' });
  if (hour < 9) factors.push({ points: W.earlyMorning, reason: 'Early-morning slot (before 9 AM)' });
  else if (hour >= 17) factors.push({ points: W.lateEvening, reason: 'Evening slot (5 PM or later)' });

  // 6. In-person vs telehealth
  if (!input.isVirtual) factors.push({ points: W.inPerson, reason: 'In-person visit' });

  // 7. Days since last attended visit
  if (attended.length > 0) {
    const last = Math.max(...attended.map((h) => h.startsAt.getTime()));
    const gap = Math.floor((input.startsAt.getTime() - last) / DAY_MS);
    if (gap >= 120) factors.push({ points: W.gap120, reason: `${gap} days since last attended visit` });
    else if (gap >= 60) factors.push({ points: W.gap60, reason: `${gap} days since last attended visit` });
  }

  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const reasons = [...factors].sort((a, b) => b.points - a.points).map((f) => f.reason);
  return { score, level: levelFor(score), reasons, historyAvailable, historyCount };
}

// ─── Data access ───────────────────────────────────────────────────────────────

export type Actor = { id: string; role: Role; organizationId: string };

/** Same org scoping as listAppointmentsForUser (manage.ts). */
export function appointmentScopeWhere(actor: Actor): Prisma.AppointmentWhereInput {
  const orgFilter: Prisma.AppointmentWhereInput = {
    OR: [{ organizationId: actor.organizationId }, { client: clientOrgFilter(actor.organizationId) }],
  };
  return isCaseloadScoped({ role: actor.role, userId: actor.id, organizationId: actor.organizationId })
    ? { AND: [orgFilter, { OR: [{ clinicianId: actor.id }, { client: behavioralCareTeamClientWhere(actor.id) }] }] }
    : orgFilter;
}

export type NoShowRiskItem = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  startsAt: string;
  clinicianName: string | null;
  type: string;
  isVirtual: boolean;
  score: number;
  level: RiskLevel;
  reasons: string[];
  phone: string | null;
  hasEmail: boolean;
  historyAvailable: boolean;
};

export type NoShowRiskSummary = {
  total: number;
  high: number;
  medium: number;
  low: number;
  historyLimited: number;
};

export async function listNoShowRisk(
  actor: Actor,
  opts: { date?: string; days?: number; now?: Date } = {}
): Promise<{ from: string; to: string; items: NoShowRiskItem[]; summary: NoShowRiskSummary }> {
  const now = opts.now ?? new Date();
  const date = opts.date ?? clinicDate(now);
  const days = Math.max(1, Math.min(14, Math.floor(opts.days ?? 1)));
  const windowStart = clinicMidnightUtc(date);
  const windowEnd = clinicMidnightUtc(addCalendarDays(date, days));
  const empty = { total: 0, high: 0, medium: 0, low: 0, historyLimited: 0 };

  if (!canAccessClientAppointments(actor.role)) {
    return { from: windowStart.toISOString(), to: windowEnd.toISOString(), items: [], summary: empty };
  }

  const scope = appointmentScopeWhere(actor);
  const gte = windowStart.getTime() > now.getTime() ? windowStart : now;
  const upcoming = await prisma.appointment.findMany({
    where: {
      AND: [scope, { status: 'SCHEDULED', startsAt: { gte, lt: windowEnd } }],
    },
    orderBy: { startsAt: 'asc' },
    take: 1000,
    select: {
      id: true,
      clientId: true,
      clientName: true,
      clinicianName: true,
      type: true,
      startsAt: true,
      createdAt: true,
      isVirtual: true,
      clinician: { select: { name: true } },
      client: {
        select: { name: true, phone: true, email: true, importedAt: true, sourcePlatform: true },
      },
    },
  });

  if (upcoming.length === 0) {
    return { from: windowStart.toISOString(), to: windowEnd.toISOString(), items: [], summary: empty };
  }

  const clientIds = [...new Set(upcoming.map((a) => a.clientId))];
  const historyFrom = new Date(now.getTime() - 2 * 365 * DAY_MS);
  const cancelFrom = new Date(now.getTime() - 60 * DAY_MS);

  // One batched history query for every client in the window.
  const [historyRows, sensitive] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        AND: [
          scope,
          { clientId: { in: clientIds } },
          {
            OR: [
              { startsAt: { gte: historyFrom, lt: now }, status: { not: 'SCHEDULED' } },
              { status: 'CANCELLED', startsAt: { gte: cancelFrom } },
            ],
          },
        ],
      },
      select: { clientId: true, status: true, startsAt: true },
    }),
    resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.id,
      role: actor.role,
      clientIds,
    }).catch((err) => {
      console.error('[no-show-risk] sensitive access map failed', err);
      return null;
    }),
  ]);

  const byClient = new Map<string, HistoryRow[]>();
  for (const h of historyRows) {
    const list = byClient.get(h.clientId) ?? [];
    list.push({ status: h.status, startsAt: h.startsAt });
    byClient.set(h.clientId, list);
  }

  const mayViewContact = canAccessClientRoster(actor.role);

  const items: NoShowRiskItem[] = upcoming.map((a) => {
    const result = scoreAppointment({
      startsAt: a.startsAt,
      createdAt: a.createdAt,
      isVirtual: a.isVirtual,
      clientImportedAt: a.client.importedAt,
      clientImported: Boolean(a.client.importedAt || a.client.sourcePlatform),
      history: byClient.get(a.clientId) ?? [],
      now,
    });
    // If the sensitive-access lookup failed, fail closed and mask like a locked record.
    const s = sensitive ? sensitive.get(a.clientId) : undefined;
    const locked = sensitive === null || Boolean(s && !s.canAccessSensitive);
    const realName = a.clientName?.trim() || a.client.name;
    return {
      appointmentId: a.id,
      clientId: a.clientId,
      clientName: locked ? s?.alias || 'Protected Client' : realName,
      startsAt: a.startsAt.toISOString(),
      clinicianName: a.clinicianName?.trim() || a.clinician?.name || null,
      type: a.type,
      isVirtual: a.isVirtual,
      score: result.score,
      level: result.level,
      reasons: locked ? result.reasons.filter((r) => !/missed|cancell|attended|first visit/i.test(r)) : result.reasons,
      phone: mayViewContact && !locked ? a.client.phone?.trim() || null : null,
      hasEmail: Boolean(a.client.email?.trim()),
      historyAvailable: result.historyAvailable,
    };
  });

  items.sort((x, y) => y.score - x.score || x.startsAt.localeCompare(y.startsAt));

  const summary: NoShowRiskSummary = {
    total: items.length,
    high: items.filter((i) => i.level === 'high').length,
    medium: items.filter((i) => i.level === 'medium').length,
    low: items.filter((i) => i.level === 'low').length,
    historyLimited: items.filter((i) => !i.historyAvailable).length,
  };

  return { from: windowStart.toISOString(), to: windowEnd.toISOString(), items, summary };
}

/**
 * Operational reports: schedule volume and attendance, utilization, intake, waitlist, census,
 * outreach lists, modality mix, recurring series. Scope: ctx.clientWhere() on every query.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { ReportContext } from '../context';
import { clientIdWhere } from '../context';
import {
  addApptStatus,
  bookedTotal,
  emptyApptCounts,
  keptRate,
  lateCancelRate,
  noShowRate,
  pct,
  round1,
  type ApptCounts,
} from '../formulas';
import type { ReportColumn, ReportOutput, ReportRow, ResolvedParams } from '../types';
import {
  NO_PROVIDER,
  UNSPECIFIED,
  clientAtSite,
  monthBuckets,
  monthIn,
  monthLabel,
  requireRange,
  siteBuckets,
  source,
  staffNames,
  ymdIn,
} from './shared';

const DAY_MS = 86_400_000;
type Range = NonNullable<ResolvedParams['range']>;
type Dim = 'provider' | 'site' | 'type' | 'month';
const KEPT_STATUSES = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] as const;

function apptWhere(ctx: ReportContext, range: { from: Date; toExclusive: Date }, extra: Prisma.AppointmentWhereInput = {}, client?: Prisma.ClientWhereInput): Prisma.AppointmentWhereInput {
  return {
    client: client ?? ctx.clientWhere(),
    startsAt: { gte: range.from, lt: range.toExclusive },
    ...(ctx.scope.clinicianId ? { clinicianId: ctx.scope.clinicianId } : {}),
    ...extra,
  };
}

type Group = { key: string; label: string; rows: Record<string, unknown>[] };

/**
 * Appointment groupBy along one dimension. Provider / type: one groupBy with the dimension column;
 * month / site: one groupBy per bucket (practice-time month bounds; client home site).
 */
async function apptGroups(
  ctx: ReportContext,
  range: Range,
  dim: Dim,
  by: Prisma.AppointmentScalarFieldEnum[],
  extra: Prisma.AppointmentWhereInput = {}
): Promise<Group[]> {
  const gb = (where: Prisma.AppointmentWhereInput, fields: Prisma.AppointmentScalarFieldEnum[]) =>
    (prisma.appointment.groupBy as any)({ by: fields, where, _count: { _all: true } }) as Promise<Record<string, unknown>[]>;
  if (dim === 'provider' || dim === 'type') {
    const col = dim === 'provider' ? 'clinicianId' : 'type';
    const rows = await gb(apptWhere(ctx, range, extra), [col, ...by]);
    const names = dim === 'provider' ? await staffNames(ctx.organizationId, rows.map((r) => r.clinicianId as string | null)) : null;
    const map = new Map<string, Group>();
    for (const r of rows) {
      const raw = (r[col] as string | null) ?? null;
      const key = raw ?? '__none__';
      const label = dim === 'provider' ? (raw ? names!.get(raw) ?? 'Other organization / removed user' : NO_PROVIDER) : (raw?.trim() || UNSPECIFIED);
      const g = map.get(key) ?? { key, label, rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.values()];
  }
  if (dim === 'month') {
    const months = monthBuckets(range, ctx.timeZone);
    const results = await Promise.all(months.map((m) => gb(apptWhere(ctx, m, extra), by)));
    return months.map((m, i) => ({ key: m.key, label: monthLabel(m.key), rows: results[i] }));
  }
  const sites = await siteBuckets(ctx);
  const results = await Promise.all(sites.map((s) => gb(apptWhere(ctx, range, extra, clientAtSite(ctx, s.id)), by)));
  return sites.map((s, i) => ({ key: s.id ?? '__none__', label: s.name, rows: results[i] }));
}

function countsOf(rows: Record<string, unknown>[]): ApptCounts {
  const c = emptyApptCounts();
  for (const r of rows) addApptStatus(c, String(r.status), (r._count as { _all: number })._all);
  return c;
}

const groupColumn = (dim: Dim): ReportColumn => ({
  key: 'group',
  label: dim === 'provider' ? 'Provider' : dim === 'site' ? 'Site' : dim === 'type' ? 'Appointment type' : 'Month',
  type: 'text',
});

function sortGroups(rows: ReportRow[], dim: Dim, metric = 'booked'): ReportRow[] {
  if (dim === 'month') return rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return rows.sort((a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0) || String(a.group).localeCompare(String(b.group)));
}

async function apptSourceInfo(ctx: ReportContext, range: Range) {
  const total = await prisma.appointment.count({ where: apptWhere(ctx, range) });
  return source('Appointments (Altrixs schedule incl. imported Valant appointments)', total, null);
}

function emptyNotice(rows: number, what = 'appointments'): string[] {
  return rows === 0 ? [`No ${what} found for these parameters.`] : [];
}

// ─── Appointment volume ──────────────────────────────────────────────────────

export async function runAppointmentVolume(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'provider') as Dim;
  const [groups, src] = await Promise.all([apptGroups(ctx, range, dim, ['status']), apptSourceInfo(ctx, range)]);
  const total = emptyApptCounts();
  const rows: ReportRow[] = groups.map((g) => {
    const c = countsOf(g.rows);
    for (const k of Object.keys(total) as (keyof ApptCounts)[]) total[k] += c[k];
    return {
      key: g.key, group: g.label, booked: bookedTotal(c), completed: c.completed + c.arrived, noShow: c.noShow,
      lateCancel: c.lateCancel, cancelled: c.cancelled, open: c.scheduled, keptRate: keptRate(c),
    };
  }).filter((r) => Number(r.booked) > 0 || dim === 'month');
  return {
    columns: [
      groupColumn(dim),
      { key: 'booked', label: 'Booked', type: 'number' },
      { key: 'completed', label: 'Kept', type: 'number' },
      { key: 'noShow', label: 'No-show', type: 'number' },
      { key: 'lateCancel', label: 'Late cancel', type: 'number' },
      { key: 'cancelled', label: 'Cancelled', type: 'number' },
      { key: 'open', label: 'Still scheduled', type: 'number', description: 'Status still Scheduled (future, or past and not closed out)' },
      { key: 'keptRate', label: 'Kept rate', type: 'percent' },
    ],
    rows: sortGroups(rows, dim),
    kpis: [
      { label: 'Booked', value: bookedTotal(total), type: 'number' },
      { label: 'Kept', value: total.completed + total.arrived, type: 'number' },
      { label: 'Kept rate', value: keptRate(total), type: 'percent' },
      { label: 'No-show rate', value: noShowRate(total), type: 'percent' },
    ],
    chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', series: [{ key: 'booked', label: 'Booked' }, { key: 'completed', label: 'Kept' }] },
    sources: [src],
    notices: emptyNotice(src.rows ?? 0),
  };
}

// ─── No-show / late-cancel ───────────────────────────────────────────────────

export async function runNoShowRates(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'provider') as Dim;
  const [groups, src] = await Promise.all([apptGroups(ctx, range, dim, ['status']), apptSourceInfo(ctx, range)]);
  const total = emptyApptCounts();
  const rows: ReportRow[] = groups.map((g) => {
    const c = countsOf(g.rows);
    for (const k of Object.keys(total) as (keyof ApptCounts)[]) total[k] += c[k];
    return {
      key: g.key, group: g.label, kept: c.completed + c.arrived, noShow: c.noShow, lateCancel: c.lateCancel,
      noShowRate: noShowRate(c), lateCancelRate: lateCancelRate(c),
    };
  }).filter((r) => Number(r.kept) + Number(r.noShow) + Number(r.lateCancel) > 0 || dim === 'month');
  return {
    columns: [
      groupColumn(dim),
      { key: 'kept', label: 'Kept', type: 'number' },
      { key: 'noShow', label: 'No-shows', type: 'number' },
      { key: 'lateCancel', label: 'Late cancels', type: 'number' },
      { key: 'noShowRate', label: 'No-show rate', type: 'percent' },
      { key: 'lateCancelRate', label: 'Late-cancel rate', type: 'percent' },
    ],
    rows: sortGroups(rows, dim, 'kept'),
    kpis: [
      { label: 'No-show rate', value: noShowRate(total), type: 'percent', hint: `${total.noShow} of ${total.completed + total.arrived + total.noShow}` },
      { label: 'Late-cancel rate', value: lateCancelRate(total), type: 'percent' },
      { label: 'No-shows', value: total.noShow, type: 'number' },
      { label: 'Late cancels', value: total.lateCancel, type: 'number' },
    ],
    chart: { type: dim === 'month' ? 'line' : 'bar', xKey: 'group', valueType: 'percent', series: [{ key: 'noShowRate', label: 'No-show rate' }, { key: 'lateCancelRate', label: 'Late-cancel rate' }] },
    sources: [src],
    notices: emptyNotice(src.rows ?? 0),
  };
}

// ─── Cancellations ───────────────────────────────────────────────────────────

export async function runCancellations(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'provider') as Dim;
  const [groups, src, cancelled] = await Promise.all([
    apptGroups(ctx, range, dim, ['status']),
    apptSourceInfo(ctx, range),
    prisma.appointment.findMany({
      where: apptWhere(ctx, range, { status: { in: ['CANCELLED', 'LATE_CANCEL'] } }),
      select: { id: true, clientId: true, startsAt: true, clinicianId: true, type: true, client: { select: { locationId: true } } },
      take: 20_000,
    }),
  ]);
  // Rebooked: another non-cancelled appointment for the client within 14 days after the cancelled start
  const clientIds = [...new Set(cancelled.map((c) => c.clientId))];
  const later = clientIds.length
    ? await prisma.appointment.findMany({
        where: {
          clientId: { in: clientIds },
          status: { notIn: ['CANCELLED', 'LATE_CANCEL'] },
          startsAt: { gt: range.from, lt: new Date(range.toExclusive.getTime() + 14 * DAY_MS) },
        },
        select: { clientId: true, startsAt: true },
      })
    : [];
  const byClient = new Map<string, number[]>();
  for (const a of later) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a.startsAt.getTime()]);
  const keyOf = (c: (typeof cancelled)[number]): string => {
    if (dim === 'provider') return c.clinicianId ?? '__none__';
    if (dim === 'type') return c.type;
    if (dim === 'site') return c.client.locationId ?? '__none__';
    return monthIn(c.startsAt, ctx.timeZone);
  };
  const rebooked = new Map<string, number>();
  for (const c of cancelled) {
    const t = c.startsAt.getTime();
    const hit = (byClient.get(c.clientId) ?? []).some((x) => x > t && x <= t + 14 * DAY_MS);
    if (hit) rebooked.set(keyOf(c), (rebooked.get(keyOf(c)) ?? 0) + 1);
  }
  const total = emptyApptCounts();
  let totalRebooked = 0;
  const rows: ReportRow[] = groups.map((g) => {
    const c = countsOf(g.rows);
    for (const k of Object.keys(total) as (keyof ApptCounts)[]) total[k] += c[k];
    const rb = rebooked.get(g.key) ?? 0;
    totalRebooked += rb;
    const cancels = c.cancelled + c.lateCancel;
    return { key: g.key, group: g.label, booked: bookedTotal(c), cancelled: c.cancelled, lateCancel: c.lateCancel, cancelRate: pct(cancels, bookedTotal(c)), rebooked14: rb, rebookRate: pct(rb, cancels) };
  }).filter((r) => Number(r.booked) > 0 || dim === 'month');
  const cancels = total.cancelled + total.lateCancel;
  return {
    columns: [
      groupColumn(dim),
      { key: 'booked', label: 'Booked', type: 'number' },
      { key: 'cancelled', label: 'Cancelled', type: 'number' },
      { key: 'lateCancel', label: 'Late cancelled', type: 'number' },
      { key: 'cancelRate', label: 'Cancellation rate', type: 'percent' },
      { key: 'rebooked14', label: 'Rebooked in 14 days', type: 'number' },
      { key: 'rebookRate', label: 'Rebook rate', type: 'percent' },
    ],
    rows: sortGroups(rows, dim, 'cancelled'),
    kpis: [
      { label: 'Cancellations', value: cancels, type: 'number' },
      { label: 'Cancellation rate', value: pct(cancels, bookedTotal(total)), type: 'percent' },
      { label: 'Rebooked in 14 days', value: pct(totalRebooked, cancels), type: 'percent' },
    ],
    chart: { type: 'stackedBar', xKey: 'group', series: [{ key: 'cancelled', label: 'Cancelled' }, { key: 'lateCancel', label: 'Late cancelled' }] },
    sources: [src],
    notices: [
      ...emptyNotice(src.rows ?? 0),
      'Cancellation reasons are not recorded on Altrixs appointments, so reasons cannot be broken out. Add a required reason to the cancel action to report them.',
      ...(cancelled.length >= 20_000 ? ['Rebooking was checked for the first 20,000 cancellations only.'] : []),
    ],
  };
}

// ─── Provider utilization ────────────────────────────────────────────────────

export async function runProviderUtilization(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const appts = await prisma.appointment.findMany({
    where: apptWhere(ctx, range),
    select: { clinicianId: true, status: true, startsAt: true, endsAt: true, clientId: true },
  });
  const names = await staffNames(ctx.organizationId, appts.map((a) => a.clinicianId));
  type Acc = { counts: ApptCounts; bookedMin: number; keptMin: number; clients: Set<string> };
  const map = new Map<string, Acc>();
  for (const a of appts) {
    const key = a.clinicianId ?? '__none__';
    const acc = map.get(key) ?? { counts: emptyApptCounts(), bookedMin: 0, keptMin: 0, clients: new Set<string>() };
    addApptStatus(acc.counts, a.status);
    const minutes = Math.max(0, Math.min(24 * 60, (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000));
    if (a.status !== 'CANCELLED') acc.bookedMin += minutes;
    if ((KEPT_STATUSES as readonly string[]).includes(a.status)) {
      acc.keptMin += minutes;
      acc.clients.add(a.clientId);
    }
    map.set(key, acc);
  }
  let bookedMin = 0;
  let keptMin = 0;
  const rows: ReportRow[] = [...map.entries()].map(([key, a]) => {
    bookedMin += a.bookedMin;
    keptMin += a.keptMin;
    return {
      key,
      group: key === '__none__' ? NO_PROVIDER : names.get(key) ?? 'Other organization / removed user',
      booked: bookedTotal(a.counts) - a.counts.cancelled,
      kept: a.counts.completed + a.counts.arrived,
      noShow: a.counts.noShow,
      bookedHours: round1(a.bookedMin / 60),
      keptHours: round1(a.keptMin / 60),
      utilization: pct(a.keptMin, a.bookedMin),
      clientsSeen: a.clients.size,
    };
  }).sort((a, b) => Number(b.keptHours) - Number(a.keptHours));
  return {
    columns: [
      { key: 'group', label: 'Provider', type: 'text' },
      { key: 'booked', label: 'Booked (excl. cancelled)', type: 'number' },
      { key: 'kept', label: 'Kept', type: 'number' },
      { key: 'noShow', label: 'No-show', type: 'number' },
      { key: 'bookedHours', label: 'Booked hours', type: 'number' },
      { key: 'keptHours', label: 'Completed hours', type: 'number' },
      { key: 'utilization', label: 'Utilization', type: 'percent' },
      { key: 'clientsSeen', label: 'Clients seen', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Booked hours', value: round1(bookedMin / 60), type: 'number' },
      { label: 'Completed hours', value: round1(keptMin / 60), type: 'number' },
      { label: 'Utilization', value: pct(keptMin, bookedMin), type: 'percent' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'bookedHours', label: 'Booked hours' }, { key: 'keptHours', label: 'Completed hours' }] },
    sources: [source('Appointments', appts.length)],
    notices: [
      ...emptyNotice(appts.length),
      'Provider capacity (open template hours) is not stored in Altrixs, so utilization is completed ÷ booked time, not completed ÷ available time.',
    ],
  };
}

// ─── New clients / intakes ───────────────────────────────────────────────────

export async function runNewClients(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'month';
  const client = ctx.clientWhere();
  const [firsts, created, imported, conversions] = await Promise.all([
    // First-ever kept visit per client (all history) -> those inside the range are new clients
    prisma.appointment.groupBy({
      by: ['clientId'],
      where: { client, status: { in: [...KEPT_STATUSES] } },
      _min: { startsAt: true },
    }),
    prisma.client.findMany({
      where: { AND: [client, { importedAt: null, sourcePlatform: null, createdAt: { gte: range.from, lt: range.toExclusive } }] },
      select: { createdAt: true, locationId: true },
    }),
    prisma.client.count({ where: { AND: [client, { importedAt: { not: null } }] } }),
    prisma.waitlistEntry.findMany({
      where: {
        organizationId: ctx.organizationId,
        convertedAt: { gte: range.from, lt: range.toExclusive },
        ...(ctx.scopeKind === 'caseload' || ctx.scope.locationId ? { convertedClient: client } : {}),
      },
      select: { convertedAt: true, referralSource: true, convertedClient: { select: { locationId: true } } },
    }),
  ]);
  const newFirst = firsts.filter((f) => f._min.startsAt && f._min.startsAt >= range.from && f._min.startsAt < range.toExclusive);
  const siteOf = new Map<string, string | null>();
  if (dim === 'site' && newFirst.length) {
    const rows = await prisma.client.findMany({ where: { id: { in: newFirst.map((f) => f.clientId) } }, select: { id: true, locationId: true } });
    for (const r of rows) siteOf.set(r.id, r.locationId);
  }
  const map = new Map<string, { key: string; group: string; newFirstVisit: number; newCharts: number; conversions: number }>();
  const bump = (key: string, label: string, field: 'newFirstVisit' | 'newCharts' | 'conversions') => {
    const r = map.get(key) ?? { key, group: label, newFirstVisit: 0, newCharts: 0, conversions: 0 };
    r[field]++;
    map.set(key, r);
  };
  const sites = dim === 'site' ? new Map((await siteBuckets(ctx)).map((s) => [s.id ?? '__none__', s.name])) : null;
  if (dim === 'month') for (const m of monthBuckets(range, ctx.timeZone)) map.set(m.key, { key: m.key, group: monthLabel(m.key), newFirstVisit: 0, newCharts: 0, conversions: 0 });
  for (const f of newFirst) {
    if (dim === 'month') { const k = monthIn(f._min.startsAt as Date, ctx.timeZone); bump(k, monthLabel(k), 'newFirstVisit'); }
    else if (dim === 'site') { const k = siteOf.get(f.clientId) ?? '__none__'; bump(k, sites!.get(k) ?? 'Other', 'newFirstVisit'); }
  }
  for (const c of created) {
    if (dim === 'month') { const k = monthIn(c.createdAt, ctx.timeZone); bump(k, monthLabel(k), 'newCharts'); }
    else if (dim === 'site') { const k = c.locationId ?? '__none__'; bump(k, sites!.get(k) ?? 'Other', 'newCharts'); }
  }
  for (const w of conversions) {
    if (dim === 'month') { const k = monthIn(w.convertedAt as Date, ctx.timeZone); bump(k, monthLabel(k), 'conversions'); }
    else if (dim === 'site') { const k = w.convertedClient?.locationId ?? '__none__'; bump(k, sites!.get(k) ?? 'Other', 'conversions'); }
    else { const label = w.referralSource?.trim() || UNSPECIFIED; bump(label.toLowerCase(), label, 'conversions'); }
  }
  const rows = [...map.values()].sort((a, b) => (dim === 'month' ? a.key.localeCompare(b.key) : b.conversions + b.newFirstVisit - (a.conversions + a.newFirstVisit)));
  const columns: ReportColumn[] = dim === 'referral'
    ? [{ key: 'group', label: 'Referral source', type: 'text' }, { key: 'conversions', label: 'Waitlist conversions', type: 'number' }]
    : [
        { key: 'group', label: dim === 'site' ? 'Site' : 'Month', type: 'text' },
        { key: 'newFirstVisit', label: 'New clients (first visit)', type: 'number' },
        { key: 'newCharts', label: 'New charts created', type: 'number' },
        { key: 'conversions', label: 'Waitlist conversions', type: 'number' },
      ];
  return {
    columns,
    rows,
    kpis: [
      { label: 'New clients (first visit)', value: newFirst.length, type: 'number' },
      { label: 'New charts created', value: created.length, type: 'number' },
      { label: 'Waitlist conversions', value: conversions.length, type: 'number' },
    ],
    chart: dim === 'referral'
      ? { type: 'bar', xKey: 'group', series: [{ key: 'conversions', label: 'Conversions' }] }
      : { type: 'bar', xKey: 'group', series: [{ key: 'newFirstVisit', label: 'New clients' }, { key: 'newCharts', label: 'New charts' }] },
    sources: [
      source('Appointments (first kept visit per client)', firsts.length),
      source('Client records created in Altrixs', created.length, null, `${imported} client records in scope were imported (not counted as new charts)`),
      source('Waitlist conversions', conversions.length),
    ],
    notices: [
      ...(firsts.length === 0 ? ['No kept appointments recorded, so first visits cannot be found.'] : []),
      ...(dim === 'referral' ? ['Referral source is only recorded on waitlist entries; clients added directly or imported from Valant have no referral source in Altrixs.'] : []),
      ...(ctx.scope.clinicianId ? ['The provider filter does not apply to this report (new clients are counted for the whole scope).'] : []),
    ],
  };
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

export async function runWaitlist(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'urgency';
  const entries = await prisma.waitlistEntry.findMany({
    where: { organizationId: ctx.organizationId },
    select: { status: true, urgency: true, specialty: true, referralSource: true, createdAt: true, closedAt: true, convertedAt: true, matchedAt: true },
  });
  const OPEN = new Set(['WAITING', 'MATCHED', 'SCHEDULED']);
  const keyOf = (e: (typeof entries)[number]) =>
    dim === 'status' ? e.status : dim === 'urgency' ? e.urgency : dim === 'specialty' ? (e.specialty?.trim() || UNSPECIFIED) : (e.referralSource?.trim() || UNSPECIFIED);
  const map = new Map<string, { group: string; open: number; waits: number[]; added: number; closed: number }>();
  for (const e of entries) {
    const k = keyOf(e);
    const r = map.get(k) ?? { group: k.charAt(0) + k.slice(1).toLowerCase(), open: 0, waits: [], added: 0, closed: 0 };
    if (dim === 'specialty' || dim === 'referral') r.group = k;
    if (OPEN.has(e.status)) {
      r.open++;
      r.waits.push(Math.floor((ctx.now.getTime() - e.createdAt.getTime()) / DAY_MS));
    }
    if (e.createdAt >= range.from && e.createdAt < range.toExclusive) r.added++;
    const closedAt = e.convertedAt ?? e.closedAt;
    if (closedAt && closedAt >= range.from && closedAt < range.toExclusive) r.closed++;
    map.set(k, r);
  }
  const allWaits: number[] = [];
  const rows: ReportRow[] = [...map.values()].map((r) => {
    allWaits.push(...r.waits);
    const sorted = [...r.waits].sort((a, b) => a - b);
    return {
      group: r.group, open: r.open, addedInPeriod: r.added, closedInPeriod: r.closed,
      avgDaysWaiting: r.waits.length ? round1(r.waits.reduce((s, v) => s + v, 0) / r.waits.length) : null,
      maxDaysWaiting: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }).sort((a, b) => Number(b.open) - Number(a.open));
  return {
    columns: [
      { key: 'group', label: dim === 'referral' ? 'Referral source' : dim.charAt(0).toUpperCase() + dim.slice(1), type: 'text' },
      { key: 'open', label: 'Open now', type: 'number' },
      { key: 'avgDaysWaiting', label: 'Avg days waiting', type: 'days' },
      { key: 'maxDaysWaiting', label: 'Longest wait', type: 'days' },
      { key: 'addedInPeriod', label: 'Added in period', type: 'number' },
      { key: 'closedInPeriod', label: 'Closed / converted in period', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Open entries', value: allWaits.length, type: 'number' },
      { label: 'Avg days waiting', value: allWaits.length ? round1(allWaits.reduce((s, v) => s + v, 0) / allWaits.length) : null, type: 'days' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'open', label: 'Open' }] },
    sources: [source('Waitlist entries', entries.length)],
    notices: entries.length === 0 ? ['No waitlist entries recorded.'] : [],
  };
}

// ─── Active census ───────────────────────────────────────────────────────────

export async function runActiveCensus(ctx: ReportContext, _p: ResolvedParams): Promise<ReportOutput> {
  void _p;
  const sites = await siteBuckets(ctx);
  const since90 = new Date(ctx.now.getTime() - 90 * DAY_MS);
  const perSite = await Promise.all(
    sites.map(async (s) => {
      const active: Prisma.ClientWhereInput = { AND: [clientAtSite(ctx, s.id), { status: 'ACTIVE' }] };
      const [activeCount, assigned, primaryCare, prp, tms, spravato, aot, seen90] = await Promise.all([
        prisma.client.count({ where: active }),
        prisma.client.count({ where: { AND: [active, { assignedToId: { not: null } }] } }),
        prisma.client.count({ where: { AND: [active, { primaryCare: true }] } }),
        prisma.prpEnrollment.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, status: 'active', client: active } }),
        prisma.tmsCourse.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, status: 'active', client: active } }),
        prisma.spravatoEnrollment.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, status: 'active', client: active } }),
        prisma.client.findMany({ where: active, select: { id: true } }).then(async (ids) => {
          if (!ids.length) return [0, 0];
          const list = ids.map((i) => i.id);
          const [a, r] = await Promise.all([
            prisma.aotParticipant.groupBy({ by: ['clientId'], where: { clientId: { in: list }, status: { in: ['active', 'renewal', 'stepdown'] } } }),
            prisma.residentialResident.groupBy({ by: ['clientId'], where: { clientId: { in: list }, active: true } }),
          ]);
          return [a.length, r.length];
        }),
        prisma.appointment.groupBy({ by: ['clientId'], where: { client: active, status: { in: [...KEPT_STATUSES] }, startsAt: { gte: since90, lte: ctx.now } } }),
      ]);
      const [aotCount, resCount] = aot as number[];
      return {
        key: s.id ?? '__none__', group: s.name, active: activeCount, assigned, seen90: seen90.length, primaryCare,
        prp: prp.length, tms: tms.length, spravato: spravato.length, aot: aotCount, residential: resCount,
      };
    })
  );
  const rows = perSite.filter((r) => r.active > 0 || r.key !== '__none__');
  const sum = (k: keyof (typeof perSite)[number]) => perSite.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return {
    columns: [
      { key: 'group', label: 'Site', type: 'text' },
      { key: 'active', label: 'Active clients', type: 'number' },
      { key: 'assigned', label: 'With assigned clinician', type: 'number' },
      { key: 'seen90', label: 'Seen in 90 days', type: 'number' },
      { key: 'primaryCare', label: 'Primary care', type: 'number' },
      { key: 'prp', label: 'PRP', type: 'number' },
      { key: 'tms', label: 'TMS', type: 'number' },
      { key: 'spravato', label: 'Spravato', type: 'number' },
      { key: 'aot', label: 'AOT', type: 'number' },
      { key: 'residential', label: 'Residential', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active clients', value: sum('active'), type: 'number' },
      { label: 'Seen in 90 days', value: sum('seen90'), type: 'number' },
      { label: 'In a program', value: sum('prp') + sum('tms') + sum('spravato') + sum('aot') + sum('residential'), type: 'number', hint: 'Enrollments; a client in two programs counts twice' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'active', label: 'Active' }, { key: 'seen90', label: 'Seen in 90 days' }] },
    sources: [source('Client (active)', sum('active'), ctx.now)],
    notices: sum('active') === 0 ? ['No active clients in scope.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Clients with no future appointment ─────────────────────────────────────

export async function runNoFutureAppointment(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const filter = p.values.lastVisit ?? 'any';
  const clients = await prisma.client.findMany({
    where: {
      AND: [
        ctx.clientWhere({ byAssignee: true }),
        { status: 'ACTIVE' },
        { appointments: { none: { status: 'SCHEDULED', startsAt: { gt: ctx.now } } } },
      ],
    },
    select: { id: true, name: true, mrn: true, assignedToId: true, location: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 12_000,
  });
  const ids = clients.map((c) => c.id);
  const last = ids.length
    ? await prisma.appointment.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: { in: [...KEPT_STATUSES] }, startsAt: { lte: ctx.now } }, _max: { startsAt: true } })
    : [];
  const lastBy = new Map(last.map((l) => [l.clientId, l._max.startsAt]));
  const names = await staffNames(ctx.organizationId, clients.map((c) => c.assignedToId));
  const minDays = filter === 'any' || filter === 'never' ? null : Number(filter);
  const rows: ReportRow[] = [];
  let never = 0;
  for (const c of clients) {
    const lv = lastBy.get(c.id) ?? null;
    const days = lv ? Math.floor((ctx.now.getTime() - lv.getTime()) / DAY_MS) : null;
    if (!lv) never++;
    if (filter === 'never' && lv) continue;
    if (minDays != null && (days == null || days <= minDays)) continue;
    rows.push({
      clientId: c.id, client: c.name, mrn: c.mrn ?? null,
      clinician: c.assignedToId ? names.get(c.assignedToId) ?? null : null,
      site: c.location?.name ?? null,
      lastVisit: lv ? ymdIn(lv, ctx.timeZone) : null,
      daysSinceLastVisit: days,
    });
  }
  rows.sort((a, b) => Number(b.daysSinceLastVisit ?? 1e9) - Number(a.daysSinceLastVisit ?? 1e9));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Assigned clinician', type: 'text' },
      { key: 'site', label: 'Site', type: 'text' },
      { key: 'lastVisit', label: 'Last visit', type: 'date' },
      { key: 'daysSinceLastVisit', label: 'Days since last visit', type: 'days' },
    ],
    rows,
    kpis: [
      { label: 'Active clients with nothing scheduled', value: clients.length, type: 'number' },
      { label: 'Never seen', value: never, type: 'number' },
      { label: 'Listed', value: rows.length, type: 'number' },
    ],
    sources: [source('Client (active) / Appointments', clients.length, ctx.now)],
    notices: clients.length === 0 ? ['Every active client in scope has a future appointment.'] : [],
    truncated: clients.length >= 12_000,
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Telehealth mix ──────────────────────────────────────────────────────────

export async function runTelehealthMix(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = (p.values.groupBy ?? 'month') as Dim;
  const groups = await apptGroups(ctx, range, dim, ['isVirtual', 'audioOnly'], { status: { in: [...KEPT_STATUSES] } });
  let tot = 0;
  let tele = 0;
  let audio = 0;
  const rows: ReportRow[] = groups.map((g) => {
    let completed = 0;
    let video = 0;
    let audioOnly = 0;
    for (const r of g.rows) {
      const n = (r._count as { _all: number })._all;
      completed += n;
      if (r.isVirtual && r.audioOnly) audioOnly += n;
      else if (r.isVirtual) video += n;
    }
    tot += completed;
    tele += video + audioOnly;
    audio += audioOnly;
    return { key: g.key, group: g.label, completed, inPerson: completed - video - audioOnly, video, audioOnly, telehealthShare: pct(video + audioOnly, completed) };
  }).filter((r) => Number(r.completed) > 0 || dim === 'month');
  return {
    columns: [
      groupColumn(dim),
      { key: 'completed', label: 'Kept visits', type: 'number' },
      { key: 'inPerson', label: 'In person', type: 'number' },
      { key: 'video', label: 'Video', type: 'number' },
      { key: 'audioOnly', label: 'Audio-only', type: 'number' },
      { key: 'telehealthShare', label: 'Telehealth share', type: 'percent' },
    ],
    rows: sortGroups(rows, dim, 'completed'),
    kpis: [
      { label: 'Kept visits', value: tot, type: 'number' },
      { label: 'Telehealth share', value: pct(tele, tot), type: 'percent' },
      { label: 'Audio-only', value: audio, type: 'number' },
    ],
    chart: { type: 'stackedBar', xKey: 'group', series: [{ key: 'inPerson', label: 'In person' }, { key: 'video', label: 'Video' }, { key: 'audioOnly', label: 'Audio-only' }] },
    sources: [source('Appointments (kept)', tot)],
    notices: tot === 0 ? ['No kept appointments in this period.'] : [],
  };
}

// ─── Recurring series ────────────────────────────────────────────────────────

export async function runRecurringSeries(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const dim = p.values.groupBy ?? 'provider';
  const idFilter = await ctx.clientIdFilter();
  const series = await prisma.appointmentSeries.findMany({
    where: { organizationId: ctx.organizationId, ...clientIdWhere(idFilter), ...(ctx.scope.clinicianId ? { clinicianId: ctx.scope.clinicianId } : {}) },
    select: { id: true, clinicianId: true, clientId: true, frequency: true, interval: true, status: true, endDate: true },
  });
  const today = ymdIn(ctx.now, ctx.timeZone);
  const isActive = (s: (typeof series)[number]) => s.status === 'active' && (!s.endDate || s.endDate.toISOString().slice(0, 10) >= today);
  const upcoming = series.length
    ? await prisma.appointment.groupBy({ by: ['seriesId'], where: { seriesId: { in: series.map((s) => s.id) }, status: 'SCHEDULED', startsAt: { gt: ctx.now } }, _count: { _all: true } })
    : [];
  const upBy = new Map(upcoming.map((u) => [u.seriesId as string, u._count._all]));
  const names = dim === 'provider' ? await staffNames(ctx.organizationId, series.map((s) => s.clinicianId)) : new Map<string, string>();
  const freqLabel = (s: (typeof series)[number]) => `${s.interval > 1 ? `Every ${s.interval} ` : ''}${s.frequency}`.trim();
  const map = new Map<string, { group: string; active: number; ended: number; clients: Set<string>; upcoming: number }>();
  for (const s of series) {
    const key = dim === 'provider' ? s.clinicianId : freqLabel(s).toLowerCase();
    const label = dim === 'provider' ? names.get(s.clinicianId) ?? 'Other organization / removed user' : freqLabel(s);
    const r = map.get(key) ?? { group: label, active: 0, ended: 0, clients: new Set<string>(), upcoming: 0 };
    if (isActive(s)) {
      r.active++;
      r.clients.add(s.clientId);
    } else r.ended++;
    r.upcoming += upBy.get(s.id) ?? 0;
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.values()].map((r) => ({ group: r.group, active: r.active, clients: r.clients.size, upcoming: r.upcoming, ended: r.ended })).sort((a, b) => Number(b.active) - Number(a.active));
  return {
    columns: [
      { key: 'group', label: dim === 'provider' ? 'Provider' : 'Frequency', type: 'text' },
      { key: 'active', label: 'Active series', type: 'number' },
      { key: 'clients', label: 'Clients', type: 'number' },
      { key: 'upcoming', label: 'Upcoming visits', type: 'number' },
      { key: 'ended', label: 'Ended / cancelled series', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active series', value: rows.reduce((s, r) => s + Number(r.active), 0), type: 'number' },
      { label: 'Upcoming visits from series', value: rows.reduce((s, r) => s + Number(r.upcoming), 0), type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'active', label: 'Active series' }] },
    sources: [source('Appointment series', series.length)],
    notices: series.length === 0 ? ['No recurring appointment series recorded.'] : [],
  };
}

/**
 * Program reports: PRP, TMS / Spravato, AOT, residential, primary care.
 * Program session tables store calendar days (UTC midnight), so they are filtered by the
 * calendar-day bounds of the range (range.dayFrom / dayToExclusive).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listParticipantsInOrg } from '@/app/api/aot/_scope';
import { PRP_BILLING_RULE_NOTE, PRP_UNIT_RULE_LABEL } from '@/lib/prp/billingRule';
import { PER_DIEM_CATEGORY } from '@/lib/billing/residentialPerDiem';
import type { ReportContext } from '../context';
import { clientIdWhere } from '../context';
import { pct } from '../formulas';
import type { ReportOutput, ReportRow, ResolvedParams } from '../types';
import { NO_PROVIDER, UNSPECIFIED, asRecord, monthBuckets, monthIn, monthLabel, monthOfDateOnly, requireRange, source, staffNames } from './shared';

const DAY_MS = 86_400_000;

// ─── PRP ─────────────────────────────────────────────────────────────────────

export async function runPrpAttendance(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'month';
  const f = await ctx.clientIdFilter();
  const [rows0, groups, activeEnrollments] = await Promise.all([
    prisma.prpAttendance.findMany({
      where: { organizationId: ctx.organizationId, serviceDate: { gte: range.dayFrom, lt: range.dayToExclusive }, ...clientIdWhere(f) },
      select: { clientId: true, groupId: true, serviceDate: true, minutes: true, serviceType: true, billable: true },
    }),
    prisma.prpGroup.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } }),
    prisma.prpEnrollment.count({ where: { organizationId: ctx.organizationId, status: 'active', client: ctx.clientWhere() } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const map = new Map<string, { group: string; clients: Set<string>; encounters: number; billable: number; minutes: number; minutesRows: number; days: Set<string> }>();
  if (dim === 'month') for (const m of monthBuckets(range, ctx.timeZone)) map.set(m.key, { group: monthLabel(m.key), clients: new Set(), encounters: 0, billable: 0, minutes: 0, minutesRows: 0, days: new Set() });
  for (const a of rows0) {
    const key = dim === 'month' ? monthOfDateOnly(a.serviceDate) : dim === 'serviceType' ? a.serviceType : a.groupId ?? '__none__';
    const label = dim === 'month' ? monthLabel(key) : dim === 'serviceType' ? a.serviceType : a.groupId ? groupName.get(a.groupId) ?? 'Removed group' : 'No group (individual / community)';
    const r = map.get(key) ?? { group: label, clients: new Set<string>(), encounters: 0, billable: 0, minutes: 0, minutesRows: 0, days: new Set<string>() };
    r.clients.add(a.clientId);
    r.encounters++;
    if (a.billable) r.billable++;
    if (a.minutes != null) {
      r.minutes += a.minutes;
      r.minutesRows++;
    }
    r.days.add(a.serviceDate.toISOString().slice(0, 10));
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].encounters - a[1].encounters)).map(([, r]) => ({
    group: r.group, participants: r.clients.size, encounters: r.encounters, billable: r.billable, nonBillable: r.encounters - r.billable,
    minutes: r.minutesRows ? r.minutes : null, serviceDays: r.days.size,
  }));
  return {
    columns: [
      { key: 'group', label: dim === 'month' ? 'Month' : dim === 'serviceType' ? 'Service type' : 'Group', type: 'text' },
      { key: 'participants', label: 'Participants', type: 'number' },
      { key: 'encounters', label: 'Encounters', type: 'number' },
      { key: 'billable', label: 'Billable encounters', type: 'number' },
      { key: 'nonBillable', label: 'Non-billable', type: 'number' },
      { key: 'minutes', label: 'Minutes recorded', type: 'number' },
      { key: 'serviceDays', label: 'Service days', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active PRP enrollments', value: activeEnrollments, type: 'number' },
      { label: 'Participants served', value: new Set(rows0.map((a) => a.clientId)).size, type: 'number' },
      { label: 'Billable encounters', value: rows0.filter((a) => a.billable).length, type: 'number' },
      { label: 'Units', value: null, type: 'number', hint: PRP_UNIT_RULE_LABEL },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'encounters', label: 'Encounters' }, { key: 'billable', label: 'Billable' }] },
    sources: [source('PRP attendance', rows0.length), source('PRP enrollments (active)', activeEnrollments, ctx.now)],
    notices: [...(rows0.length === 0 ? ['No PRP attendance recorded in this period.'] : []), PRP_BILLING_RULE_NOTE],
  };
}

// ─── TMS / Spravato ──────────────────────────────────────────────────────────

export async function runTmsSpravato(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const client = ctx.clientWhere();
  const day = { gte: range.dayFrom, lt: range.dayToExclusive };
  const [tms, spr, activeCourses, activeEnroll] = await Promise.all([
    prisma.tmsSession.findMany({ where: { sessionDate: day, course: { organizationId: ctx.organizationId, client } }, select: { sessionDate: true, course: { select: { clientId: true } } } }),
    prisma.spravatoSession.findMany({ where: { sessionDate: day, enrollment: { organizationId: ctx.organizationId, client } }, select: { sessionDate: true, withheld: true, enrollment: { select: { clientId: true } } } }),
    prisma.tmsCourse.count({ where: { organizationId: ctx.organizationId, client, status: 'active' } }),
    prisma.spravatoEnrollment.count({ where: { organizationId: ctx.organizationId, client, status: 'active' } }),
  ]);
  const map = new Map<string, { group: string; tms: number; tmsClients: Set<string>; spravato: number; withheld: number; sprClients: Set<string> }>();
  for (const m of monthBuckets(range, ctx.timeZone)) map.set(m.key, { group: monthLabel(m.key), tms: 0, tmsClients: new Set(), spravato: 0, withheld: 0, sprClients: new Set() });
  for (const s of tms) {
    const r = map.get(monthOfDateOnly(s.sessionDate));
    if (!r) continue;
    r.tms++;
    r.tmsClients.add(s.course.clientId);
  }
  for (const s of spr) {
    const r = map.get(monthOfDateOnly(s.sessionDate));
    if (!r) continue;
    if (s.withheld) r.withheld++;
    else r.spravato++;
    r.sprClients.add(s.enrollment.clientId);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => ({
    group: r.group, tms: r.tms, tmsClients: r.tmsClients.size, spravato: r.spravato, withheld: r.withheld, spravatoClients: r.sprClients.size,
  }));
  return {
    columns: [
      { key: 'group', label: 'Month', type: 'text' },
      { key: 'tms', label: 'TMS sessions', type: 'number' },
      { key: 'tmsClients', label: 'TMS clients', type: 'number' },
      { key: 'spravato', label: 'Spravato sessions (dosed)', type: 'number' },
      { key: 'withheld', label: 'Spravato withheld', type: 'number' },
      { key: 'spravatoClients', label: 'Spravato clients', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'TMS sessions', value: tms.length, type: 'number' },
      { label: 'Spravato sessions', value: spr.length, type: 'number' },
      { label: 'Active TMS courses', value: activeCourses, type: 'number' },
      { label: 'Active Spravato enrollments', value: activeEnroll, type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'tms', label: 'TMS' }, { key: 'spravato', label: 'Spravato' }] },
    sources: [source('TMS sessions', tms.length), source('Spravato sessions', spr.length)],
    notices: tms.length + spr.length === 0 ? ['No TMS or Spravato sessions recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── AOT ─────────────────────────────────────────────────────────────────────

const AOT_PRE = new Set(['referral', 'screening', 'petition', 'hearing']);
const AOT_RENEW = new Set(['renewal', 'stepdown']);

export async function runAot(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const filter = p.values.status ?? 'all';
  const all = await listParticipantsInOrg(ctx.organizationId);
  const f = await ctx.clientIdFilter();
  const allowed = f && 'in' in f ? new Set(f.in) : null;
  const locked = new Set(ctx.scope.lockedClientIds);
  const visible = all.filter((x) => {
    if (x.clientId && locked.has(x.clientId)) return false;
    if (allowed) return Boolean(x.clientId && allowed.has(x.clientId));
    return true;
  });
  const linkedIds = [...new Set(visible.map((x) => x.clientId).filter((x): x is string => Boolean(x)))];
  const people = linkedIds.length ? await prisma.client.findMany({ where: { id: { in: linkedIds } }, select: { id: true, name: true, mrn: true } }) : [];
  const byId = new Map(people.map((x) => [x.id, x]));
  const today = Date.parse(`${new Date(ctx.now).toISOString().slice(0, 10)}T00:00:00Z`);
  let ending30 = 0;
  let overdueDeadlines = 0;
  const rows: ReportRow[] = [];
  for (const x of visible) {
    if (filter === 'active' && x.status !== 'active') continue;
    if (filter === 'pre' && !AOT_PRE.has(x.status)) continue;
    if (filter === 'renewal' && !AOT_RENEW.has(x.status)) continue;
    const deadlines = (Array.isArray(x.deadlines) ? x.deadlines : []).map(asRecord).filter((d): d is Record<string, unknown> => Boolean(d));
    const open = deadlines
      .filter((d) => d.status !== 'done' && typeof d.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.due as string))
      .map((d) => ({ label: String(d.label ?? 'Deadline'), due: String(d.due).slice(0, 10), daysLeft: Math.round((Date.parse(`${String(d.due).slice(0, 10)}T00:00:00Z`) - today) / DAY_MS) }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
    overdueDeadlines += open.filter((d) => d.daysLeft < 0).length;
    const orderDays = x.orderEnd ? Math.round((x.orderEnd.getTime() - ctx.now.getTime()) / DAY_MS) : null;
    if (orderDays != null && orderDays >= 0 && orderDays <= 30) ending30++;
    const person = x.clientId ? byId.get(x.clientId) : undefined;
    rows.push({
      clientId: person?.id ?? null, participant: person?.name ?? x.name, mrn: person?.mrn ?? null, status: x.status, county: x.county,
      hearing: x.hearingDate ? x.hearingDate.toISOString().slice(0, 10) : null, orderStart: x.orderStart ? x.orderStart.toISOString().slice(0, 10) : null,
      orderEnd: x.orderEnd ? x.orderEnd.toISOString().slice(0, 10) : null, orderDaysLeft: orderDays,
      nextDeadline: open[0] ? `${open[0].label} (${open[0].due})` : null, nextDeadlineDays: open[0]?.daysLeft ?? null, overdue: open.filter((d) => d.daysLeft < 0).length,
    });
  }
  rows.sort((a, b) => Number(a.nextDeadlineDays ?? 1e9) - Number(b.nextDeadlineDays ?? 1e9));
  return {
    columns: [
      { key: 'participant', label: 'Participant', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'county', label: 'County', type: 'text' },
      { key: 'hearing', label: 'Hearing', type: 'date' },
      { key: 'orderStart', label: 'Order start', type: 'date' },
      { key: 'orderEnd', label: 'Order end', type: 'date' },
      { key: 'orderDaysLeft', label: 'Days to order end', type: 'days' },
      { key: 'nextDeadline', label: 'Next open deadline', type: 'text' },
      { key: 'nextDeadlineDays', label: 'Days to deadline', type: 'days' },
      { key: 'overdue', label: 'Overdue deadlines', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Participants', value: rows.length, type: 'number' },
      { label: 'Active orders', value: visible.filter((x) => x.status === 'active').length, type: 'number' },
      { label: 'Orders ending in 30 days', value: ending30, type: 'number' },
      { label: 'Overdue deadlines', value: overdueDeadlines, type: 'number' },
    ],
    sources: [source('AOT participants', visible.length, ctx.now)],
    notices: [
      ...(visible.length === 0 ? ['No AOT participants recorded.'] : []),
      ...(allowed ? ['Caseload view: only participants linked to a chart on your caseload are listed.'] : []),
    ],
  };
}

// ─── Residential ─────────────────────────────────────────────────────────────

export async function runResidential(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const clientIds = (await prisma.client.findMany({ where: ctx.clientWhere(), select: { id: true } })).map((c) => c.id);
  const [residents, capacity, charges] = await Promise.all([
    clientIds.length ? prisma.residentialResident.findMany({ where: { active: true, clientId: { in: clientIds } }, select: { id: true, program: true } }) : [],
    prisma.residentialCapacity.findMany({ where: { organizationId: ctx.organizationId }, select: { asamLevel: true, beds: true } }),
    prisma.specializedBillingCharge.findMany({
      where: {
        organizationId: ctx.organizationId, category: PER_DIEM_CATEGORY, serviceDate: { gte: range.dayFrom, lt: range.dayToExclusive },
        ...(ctx.scopeKind === 'caseload' || ctx.scope.locationId || ctx.scope.lockedClientIds.length ? { clientId: { in: clientIds } } : {}),
      },
      select: { referenceId: true, units: true, totalAmount: true, status: true },
    }),
  ]);
  const programOfResident = new Map(
    (await prisma.residentialResident.findMany({ where: { id: { in: [...new Set(charges.map((c) => c.referenceId))] } }, select: { id: true, program: true } })).map((r) => [r.id, r.program])
  );
  const levels = new Map<string, { group: string; beds: number | null; residents: number; days: number; cents: number; held: number }>();
  const get = (lvl: string) => {
    const k = lvl.trim() || UNSPECIFIED;
    const r = levels.get(k) ?? { group: `ASAM ${k}`, beds: null, residents: 0, days: 0, cents: 0, held: 0 };
    levels.set(k, r);
    return r;
  };
  for (const c of capacity) {
    const r = get(c.asamLevel);
    r.beds = (r.beds ?? 0) + c.beds;
  }
  for (const r of residents) get(r.program).residents++;
  for (const c of charges) {
    const r = get(programOfResident.get(c.referenceId) ?? UNSPECIFIED);
    r.days += c.units;
    r.cents += Math.round(c.totalAmount * 100);
    if (c.status === 'held') r.held++;
  }
  const rows: ReportRow[] = [...levels.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => ({
    group: r.group, beds: r.beds, residents: r.residents, occupancy: r.beds ? pct(r.residents, r.beds) : null, perDiemDays: r.days, perDiemCharges: r.cents, held: r.held,
  }));
  const beds = capacity.reduce((s, c) => s + c.beds, 0);
  return {
    columns: [
      { key: 'group', label: 'Level', type: 'text' },
      { key: 'beds', label: 'Beds', type: 'number' },
      { key: 'residents', label: 'Active residents', type: 'number' },
      { key: 'occupancy', label: 'Occupancy', type: 'percent' },
      { key: 'perDiemDays', label: 'Per-diem days', type: 'number' },
      { key: 'perDiemCharges', label: 'Per-diem charges', type: 'money' },
      { key: 'held', label: 'Held charge lines', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active residents', value: residents.length, type: 'number' },
      { label: 'Occupancy', value: beds ? pct(residents.length, beds) : null, type: 'percent', hint: beds ? `${beds} beds configured` : 'No bed capacity configured' },
      { label: 'Per-diem days', value: charges.reduce((s, c) => s + c.units, 0), type: 'number' },
    ],
    sources: [source('Residential residents (active)', residents.length, ctx.now), source('Residential bed capacity', capacity.length), source('Per-diem charge lines', charges.length)],
    notices: [
      ...(residents.length + charges.length === 0 ? ['No residential residents or per-diem charges recorded.'] : []),
      ...(capacity.length === 0 ? ['Bed capacity is not configured, so occupancy cannot be calculated.'] : []),
    ],
  };
}

// ─── Primary care ────────────────────────────────────────────────────────────

export async function runPrimaryCare(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'month';
  const where: Prisma.MedicalVisitWhereInput = { client: ctx.clientWhere(), visitDate: { gte: range.from, lt: range.toExclusive } };
  const [visits, chargeAgg] = await Promise.all([
    prisma.medicalVisit.findMany({ where, select: { clientId: true, providerId: true, providerName: true, visitDate: true, visitType: true, signedAt: true } }),
    prisma.medicalCharge.aggregate({ where: { organizationId: ctx.organizationId, client: ctx.clientWhere(), dos: { gte: range.from, lt: range.toExclusive } }, _sum: { amountCents: true }, _count: { _all: true } }),
  ]);
  const names = dim === 'provider' ? await staffNames(ctx.organizationId, visits.map((v) => v.providerId)) : new Map<string, string>();
  const map = new Map<string, { group: string; visits: number; patients: Set<string>; signed: number }>();
  if (dim === 'month') for (const m of monthBuckets(range, ctx.timeZone)) map.set(m.key, { group: monthLabel(m.key), visits: 0, patients: new Set(), signed: 0 });
  for (const v of visits) {
    const key = dim === 'month' ? monthIn(v.visitDate, ctx.timeZone) : dim === 'provider' ? v.providerId ?? `n:${v.providerName ?? ''}` : v.visitType;
    const label = dim === 'month' ? monthLabel(key) : dim === 'provider' ? (v.providerId ? names.get(v.providerId) ?? v.providerName ?? 'Other' : v.providerName?.trim() || NO_PROVIDER) : v.visitType;
    const r = map.get(key) ?? { group: label, visits: 0, patients: new Set<string>(), signed: 0 };
    r.visits++;
    r.patients.add(v.clientId);
    if (v.signedAt) r.signed++;
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].visits - a[1].visits)).map(([, r]) => ({
    group: r.group, visits: r.visits, patients: r.patients.size, signed: r.signed, unsigned: r.visits - r.signed, signedPct: pct(r.signed, r.visits),
  }));
  return {
    columns: [
      { key: 'group', label: dim === 'month' ? 'Month' : dim === 'provider' ? 'Provider' : 'Visit type', type: 'text' },
      { key: 'visits', label: 'Visits', type: 'number' },
      { key: 'patients', label: 'Patients', type: 'number' },
      { key: 'signed', label: 'Signed', type: 'number' },
      { key: 'unsigned', label: 'Unsigned', type: 'number' },
      { key: 'signedPct', label: 'Signed %', type: 'percent' },
    ],
    rows,
    kpis: [
      { label: 'Visits', value: visits.length, type: 'number' },
      { label: 'Patients seen', value: new Set(visits.map((v) => v.clientId)).size, type: 'number' },
      { label: 'Primary care charges', value: chargeAgg._sum.amountCents ?? 0, type: 'money', hint: `${chargeAgg._count._all} charge lines` },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'visits', label: 'Visits' }] },
    sources: [source('Primary care visits', visits.length), source('Primary care charges', chargeAgg._count._all)],
    notices: visits.length === 0 ? ['No primary care visits recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Group therapy / SUD group counseling (src/lib/groups/reportRunners.ts) ───

export async function runGroupAttendance(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  return (await import('@/lib/groups/reportRunners')).groupAttendanceReport(ctx, p);
}

export async function runGroupUtilization(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  return (await import('@/lib/groups/reportRunners')).groupUtilizationReport(ctx, p);
}

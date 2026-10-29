/**
 * Clinical reports: caseload, diagnoses, treatment plans, documentation timeliness, co-sign,
 * measurement-based care, C-SSRS / safety plans, crisis follow-up, discharges, risk alerts, SDOH,
 * session frequency, monitoring labs. Scope: ctx.clientWhere() / ctx.clientIdFilter().
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { GAD7, PHQ9, computeInstrumentOutcomes, type ScorePoint } from '@/lib/reports/outcomesReports';
import { hasFilledJson, safetyPlanClientIds } from '@/lib/reports/populationHealthQueries';
import { getModuleData } from '@/lib/modules/manage';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { summarizeByClinician } from '@/lib/clinical/sessionFrequency';
import { chapterOf } from '@/lib/icd10/search';
import { icd10Key } from '@/lib/icd10/normalize';
import { loadIcd10CodeSet } from '@/lib/icd10/codeSet';
import { orderSetByKey, suggestedOrderSets } from '@/lib/labs/orderSets';
import { standingDueState } from '@/lib/labs/standing';
import type { ReportContext } from '../context';
import { clientIdWhere } from '../context';
import {
  NOTE_TIMELINESS_BUCKETS,
  RELIABLE_CHANGE,
  UNSIGNED_AGING_BUCKETS,
  medianOrNull,
  noteTimeliness,
  pct,
  reliableChange,
  unsignedAgingBucket,
  classifyPlan,
  PLAN_STATE_LABEL,
  type PlanState,
} from '../formulas';
import { addDaysYmd, practiceDayStart } from '../params';
import type { ReportOutput, ReportRow, ResolvedParams } from '../types';
import { NO_PROVIDER, UNSPECIFIED, asRecord, monthIn, monthLabel, requireRange, source, staffNames, ymdIn } from './shared';

const DAY_MS = 86_400_000;
const KEPT = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] as const;
const MONITORED_SETS = ['clozapine', 'lithium', 'valproate', 'carbamazepine', 'antipsychotic-metabolic'];

function clinicianLabel(names: Map<string, string>, id: string | null | undefined): string {
  if (!id) return NO_PROVIDER;
  return names.get(id) ?? 'Other organization / removed user';
}

// ─── Caseload ────────────────────────────────────────────────────────────────

export async function runCaseload(ctx: ReportContext, _p: ResolvedParams): Promise<ReportOutput> {
  void _p;
  const clients = await prisma.client.findMany({
    where: { AND: [ctx.clientWhere({ byAssignee: true }), { status: 'ACTIVE' }] },
    select: { id: true, assignedToId: true, riskLevel: true },
  });
  const ids = clients.map((c) => c.id);
  const since90 = new Date(ctx.now.getTime() - 90 * DAY_MS);
  const since30 = new Date(ctx.now.getTime() - 30 * DAY_MS);
  const [last, future] = ids.length
    ? await Promise.all([
        prisma.appointment.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: { in: [...KEPT] }, startsAt: { gte: since90, lte: ctx.now } }, _max: { startsAt: true } }),
        prisma.appointment.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: 'SCHEDULED', startsAt: { gt: ctx.now } } }),
      ])
    : [[], []];
  const lastBy = new Map(last.map((l) => [l.clientId, l._max.startsAt as Date]));
  const hasFuture = new Set(future.map((f) => f.clientId));
  const names = await staffNames(ctx.organizationId, clients.map((c) => c.assignedToId));
  const map = new Map<string, { group: string; caseload: number; seen30: number; seen90: number; high: number; noFuture: number }>();
  for (const c of clients) {
    const key = c.assignedToId ?? '__none__';
    const r = map.get(key) ?? { group: c.assignedToId ? clinicianLabel(names, c.assignedToId) : 'Unassigned', caseload: 0, seen30: 0, seen90: 0, high: 0, noFuture: 0 };
    r.caseload++;
    const lv = lastBy.get(c.id);
    if (lv) {
      r.seen90++;
      if (lv >= since30) r.seen30++;
    }
    if (c.riskLevel === 'HIGH') r.high++;
    if (!hasFuture.has(c.id)) r.noFuture++;
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.values()].map((r) => ({ ...r, seen90Pct: pct(r.seen90, r.caseload) })).sort((a, b) => Number(b.caseload) - Number(a.caseload));
  return {
    columns: [
      { key: 'group', label: 'Assigned clinician', type: 'text' },
      { key: 'caseload', label: 'Active caseload', type: 'number' },
      { key: 'seen30', label: 'Seen in 30 days', type: 'number' },
      { key: 'seen90', label: 'Seen in 90 days', type: 'number' },
      { key: 'seen90Pct', label: 'Seen in 90 days %', type: 'percent' },
      { key: 'high', label: 'High risk', type: 'number' },
      { key: 'noFuture', label: 'No future appointment', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active clients', value: clients.length, type: 'number' },
      { label: 'Unassigned', value: map.get('__none__')?.caseload ?? 0, type: 'number' },
      { label: 'Seen in 90 days', value: pct(rows.reduce((s, r) => s + Number(r.seen90), 0), clients.length), type: 'percent' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'caseload', label: 'Caseload' }, { key: 'seen90', label: 'Seen in 90 days' }] },
    sources: [source('Client (active)', clients.length, ctx.now), source('Appointments (last 90 days)', last.length)],
    notices: clients.length === 0 ? ['No active clients in scope.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Diagnosis distribution ──────────────────────────────────────────────────

function icdDescription(key: string): string | null {
  try {
    const set = loadIcd10CodeSet();
    const i = set.index.byKey.get(key);
    return i == null ? null : set.index.longs[i] || set.index.shorts[i] || null;
  } catch {
    return null;
  }
}

export async function runDiagnosisDistribution(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const status = p.values.status ?? 'ACTIVE';
  const level = p.values.level ?? 'category';
  const where: Prisma.ClientWhereInput = { AND: [ctx.clientWhere({ byAssignee: true }), ...(status === 'all' ? [] : [{ status: status as 'ACTIVE' | 'INACTIVE' | 'DISCHARGED' }])] };
  const groups = await prisma.client.groupBy({ by: ['primaryDiagnosisCode'], where, _count: { _all: true } });
  let total = 0;
  let uncoded = 0;
  const map = new Map<string, { code: string; description: string; clients: number }>();
  for (const g of groups) {
    const n = g._count._all;
    total += n;
    const raw = g.primaryDiagnosisCode?.trim();
    const key = raw ? icd10Key(raw) : '';
    if (key.length < 3) {
      uncoded += n;
      continue;
    }
    if (level === 'chapter') {
      const ch = chapterOf(key);
      const k = ch ? `${String(ch.number).padStart(2, '0')}` : 'zz';
      const r = map.get(k) ?? { code: ch ? `Ch. ${ch.number} (${ch.range})` : 'Unrecognized code', description: ch?.title ?? 'Code outside the ICD-10-CM chapters', clients: 0 };
      r.clients += n;
      map.set(k, r);
    } else {
      const cat = key.slice(0, 3);
      const r = map.get(cat) ?? { code: cat, description: icdDescription(cat) ?? chapterOf(cat)?.title ?? '', clients: 0 };
      r.clients += n;
      map.set(cat, r);
    }
  }
  const coded = total - uncoded;
  const rows: ReportRow[] = [...map.entries()]
    .sort((a, b) => (level === 'chapter' ? a[0].localeCompare(b[0]) : b[1].clients - a[1].clients))
    .map(([, r]) => ({ code: r.code, description: r.description, clients: r.clients, share: pct(r.clients, coded) }));
  return {
    columns: [
      { key: 'code', label: level === 'chapter' ? 'Chapter' : 'Category', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'clients', label: 'Clients', type: 'number', smallCell: 'count' },
      { key: 'share', label: '% of coded clients', type: 'percent', smallCell: { rateOf: 'clients' } },
    ],
    rows,
    kpis: [
      { label: 'Clients', value: total, type: 'number' },
      { label: 'With a coded primary diagnosis', value: coded, type: 'number' },
      { label: 'No coded primary diagnosis', value: uncoded, type: 'number', smallCell: 'count' },
    ],
    chart: { type: 'bar', xKey: 'code', series: [{ key: 'clients', label: 'Clients' }], data: rows.slice(0, 15) },
    sources: [source('Client primary diagnosis', coded, ctx.now)],
    notices: [
      ...(coded === 0 ? ['No coded primary diagnoses recorded for clients in scope.'] : []),
      'Only the primary diagnosis on the chart is counted; secondary diagnoses are free text and are not coded.',
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Treatment plan status ───────────────────────────────────────────────────

export async function runTreatmentPlanStatus(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const filter = p.values.planStatus ?? 'all';
  const clientWhere: Prisma.ClientWhereInput = { AND: [ctx.clientWhere({ byAssignee: true }), { status: 'ACTIVE' }] };
  const [clients, plans, imported] = await Promise.all([
    prisma.client.findMany({ where: clientWhere, select: { id: true, name: true, mrn: true, assignedToId: true, location: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: ctx.organizationId, client: clientWhere, status: { notIn: ['CLOSED', 'EXPIRED'] } },
      select: { id: true, clientId: true, status: true, reviewDueAt: true, clinicianSignedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: ctx.organizationId, client: clientWhere, goals: { path: ['source', 'platform'], equals: 'valant' } },
      select: { id: true },
    }),
  ]);
  const importedIds = new Set(imported.map((i) => i.id));
  const current = new Map<string, (typeof plans)[number]>();
  for (const pl of plans) if (!current.has(pl.clientId)) current.set(pl.clientId, pl);
  const names = await staffNames(ctx.organizationId, clients.map((c) => c.assignedToId));
  const counts: Record<PlanState, number> = { missing: 0, valant: 0, draft: 0, overdue: 0, due: 0, current: 0 };
  const rows: ReportRow[] = [];
  for (const c of clients) {
    const pl = current.get(c.id) ?? null;
    const state = classifyPlan(pl ? { ...pl, imported: importedIds.has(pl.id) } : null, ctx.now);
    counts[state]++;
    if (filter !== 'all' && filter !== state) continue;
    const daysOverdue = pl?.reviewDueAt && pl.reviewDueAt < ctx.now ? Math.floor((ctx.now.getTime() - pl.reviewDueAt.getTime()) / DAY_MS) : null;
    rows.push({
      clientId: c.id, client: c.name, mrn: c.mrn ?? null, clinician: c.assignedToId ? clinicianLabel(names, c.assignedToId) : 'Unassigned',
      site: c.location?.name ?? null, state: PLAN_STATE_LABEL[state], source: pl ? (importedIds.has(pl.id) ? 'Valant' : 'Altrixs') : null,
      planStatus: pl?.status ?? null, signed: pl?.clinicianSignedAt ? ymdIn(pl.clinicianSignedAt, ctx.timeZone) : null,
      reviewDue: pl?.reviewDueAt ? pl.reviewDueAt.toISOString().slice(0, 10) : null, daysOverdue,
    });
  }
  const order: PlanState[] = ['missing', 'overdue', 'draft', 'valant', 'due', 'current'];
  rows.sort((a, b) => order.indexOf(Object.entries(PLAN_STATE_LABEL).find(([, v]) => v === a.state)?.[0] as PlanState) - order.indexOf(Object.entries(PLAN_STATE_LABEL).find(([, v]) => v === b.state)?.[0] as PlanState) || Number(b.daysOverdue ?? 0) - Number(a.daysOverdue ?? 0));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Assigned clinician', type: 'text' },
      { key: 'site', label: 'Site', type: 'text' },
      { key: 'state', label: 'Plan state', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'planStatus', label: 'Plan status', type: 'text' },
      { key: 'signed', label: 'Clinician signed', type: 'date' },
      { key: 'reviewDue', label: 'Review due', type: 'date' },
      { key: 'daysOverdue', label: 'Days overdue', type: 'days' },
    ],
    rows,
    kpis: [
      { label: 'Active clients', value: clients.length, type: 'number' },
      { label: 'Missing a plan', value: counts.missing, type: 'number' },
      { label: 'Review overdue', value: counts.overdue, type: 'number' },
      { label: 'Draft', value: counts.draft, type: 'number' },
      { label: 'Valant imported', value: counts.valant, type: 'number' },
      { label: 'Current (incl. due soon)', value: pct(counts.current + counts.due, clients.length), type: 'percent' },
    ],
    chart: {
      type: 'bar', xKey: 'state', series: [{ key: 'clients', label: 'Clients' }],
      data: order.map((s) => ({ state: PLAN_STATE_LABEL[s], clients: counts[s] })),
    },
    sources: [source('Treatment plans (current)', plans.length, ctx.now, `${imported.length} imported from Valant`), source('Client (active)', clients.length)],
    notices: [
      ...(plans.length === 0 ? ['No treatment plans recorded for clients in scope.'] : []),
      "Valant's treatment plan export has status, last update and next review only (no goals); imported plans are listed for rewrite in Altrixs.",
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Notes: timeliness / unsigned / co-sign ─────────────────────────────────

function noteWhere(ctx: ReportContext, extra: Prisma.ProgressNoteWhereInput[] = []): Prisma.ProgressNoteWhereInput {
  return {
    AND: [
      { client: ctx.clientWhere() },
      ...(ctx.scope.clinicianId ? [{ clinicianId: ctx.scope.clinicianId }] : []),
      ...extra,
    ],
  };
}

// Dismissed drafts (src/lib/notes/dismiss.ts) are not unsigned work
const UNSIGNED_NOTE: Prisma.ProgressNoteWhereInput = { dismissedAt: null, OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }] };

/** Service time: linked visit end; else end of the date-of-service day (practice clock); else creation. */
function serviceTime(n: { dateOfService: Date | null; createdAt: Date; appointment: { endsAt: Date } | null }, tz: string): Date {
  if (n.appointment?.endsAt) return n.appointment.endsAt;
  if (n.dateOfService) return practiceDayStart(addDaysYmd(n.dateOfService.toISOString().slice(0, 10), 1), tz);
  return n.createdAt;
}

export async function runNoteTimeliness(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const notes = await prisma.progressNote.findMany({
    where: noteWhere(ctx, [{
      OR: [
        { dateOfService: { gte: range.dayFrom, lt: range.dayToExclusive } },
        { dateOfService: null, createdAt: { gte: range.from, lt: range.toExclusive } },
      ],
    }]),
    select: { clinicianId: true, dateOfService: true, createdAt: true, appointment: { select: { endsAt: true } }, workflow: { select: { status: true, signedAt: true, lockedAt: true } } },
  });
  const names = await staffNames(ctx.organizationId, notes.map((n) => n.clinicianId));
  type Acc = { group: string; notes: number; within24: number; within72: number; over72: number; unsigned: number; hours: number[] };
  const map = new Map<string, Acc>();
  const total: Acc = { group: 'All', notes: 0, within24: 0, within72: 0, over72: 0, unsigned: 0, hours: [] };
  for (const n of notes) {
    const key = n.clinicianId ?? '__none__';
    const a = map.get(key) ?? { group: clinicianLabel(names, n.clinicianId), notes: 0, within24: 0, within72: 0, over72: 0, unsigned: 0, hours: [] };
    const signed = n.workflow && n.workflow.status !== 'DRAFT' ? n.workflow.signedAt ?? n.workflow.lockedAt : null;
    const svc = serviceTime(n, ctx.timeZone);
    const bucket = noteTimeliness(svc, signed);
    for (const acc of [a, total]) {
      acc.notes++;
      acc[bucket]++;
      if (signed) acc.hours.push(Math.max(0, (signed.getTime() - svc.getTime()) / 3_600_000));
    }
    map.set(key, a);
  }
  const rowOf = (a: Acc): ReportRow => ({
    group: a.group, notes: a.notes, within24: a.within24, within72: a.within72, over72: a.over72, unsigned: a.unsigned,
    pct24: pct(a.within24, a.notes), pct72: pct(a.within24 + a.within72, a.notes), medianHours: medianOrNull(a.hours),
  });
  const rows = [...map.values()].map(rowOf).sort((a, b) => Number(b.notes) - Number(a.notes));
  return {
    columns: [
      { key: 'group', label: 'Clinician', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'number' },
      { key: 'within24', label: NOTE_TIMELINESS_BUCKETS[0].label, type: 'number' },
      { key: 'within72', label: NOTE_TIMELINESS_BUCKETS[1].label, type: 'number' },
      { key: 'over72', label: NOTE_TIMELINESS_BUCKETS[2].label, type: 'number' },
      { key: 'unsigned', label: NOTE_TIMELINESS_BUCKETS[3].label, type: 'number' },
      { key: 'pct24', label: '% within 24 h', type: 'percent' },
      { key: 'pct72', label: '% within 72 h', type: 'percent' },
      { key: 'medianHours', label: 'Median hours to sign', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Notes', value: total.notes, type: 'number' },
      { label: 'Signed within 24 h', value: pct(total.within24, total.notes), type: 'percent' },
      { label: 'Signed within 72 h', value: pct(total.within24 + total.within72, total.notes), type: 'percent' },
      { label: 'Still unsigned', value: total.unsigned, type: 'number' },
    ],
    chart: { type: 'stackedBar', xKey: 'group', series: [{ key: 'within24', label: '≤ 24 h' }, { key: 'within72', label: '24-72 h' }, { key: 'over72', label: '> 72 h' }, { key: 'unsigned', label: 'Unsigned' }] },
    sources: [source('Progress notes', notes.length)],
    notices: notes.length === 0 ? ['No progress notes with a service date in this period.'] : [],
  };
}

export async function runUnsignedNotes(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const minAge = p.values.age && p.values.age !== 'all' ? Number(p.values.age) : 0;
  const notes = await prisma.progressNote.findMany({
    where: noteWhere(ctx, [UNSIGNED_NOTE]),
    select: { id: true, clinicianId: true, noteType: true, dateOfService: true, createdAt: true, client: { select: { id: true, name: true, mrn: true } } },
    orderBy: { createdAt: 'asc' },
    take: 12_000,
  });
  const names = await staffNames(ctx.organizationId, notes.map((n) => n.clinicianId));
  const counts = new Map<string, number>();
  const rows: ReportRow[] = [];
  for (const n of notes) {
    const svcDay = n.dateOfService ? n.dateOfService.toISOString().slice(0, 10) : ymdIn(n.createdAt, ctx.timeZone);
    const days = Math.max(0, Math.floor((Date.parse(`${ymdIn(ctx.now, ctx.timeZone)}T00:00:00Z`) - Date.parse(`${svcDay}T00:00:00Z`)) / DAY_MS));
    const bucket = unsignedAgingBucket(days);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (days <= minAge && minAge > 0) continue;
    rows.push({
      clientId: n.client.id, client: n.client.name, mrn: n.client.mrn ?? null, clinician: clinicianLabel(names, n.clinicianId),
      noteType: n.noteType ?? null, serviceDate: svcDay, daysOpen: days, bucket: UNSIGNED_AGING_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket,
    });
  }
  rows.sort((a, b) => Number(b.daysOpen) - Number(a.daysOpen));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Clinician', type: 'text' },
      { key: 'noteType', label: 'Note type', type: 'text' },
      { key: 'serviceDate', label: 'Date of service', type: 'date' },
      { key: 'daysOpen', label: 'Days open', type: 'days' },
      { key: 'bucket', label: 'Age', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Unsigned notes', value: notes.length, type: 'number' },
      { label: 'Over 3 days', value: notes.length - (counts.get('d0_1') ?? 0) - (counts.get('d2_3') ?? 0), type: 'number' },
      { label: 'Over 30 days', value: counts.get('d30p') ?? 0, type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'bucket', series: [{ key: 'notes', label: 'Notes' }], data: UNSIGNED_AGING_BUCKETS.map((b) => ({ bucket: b.label, notes: counts.get(b.key) ?? 0 })) },
    sources: [source('Progress notes (unsigned)', notes.length, ctx.now)],
    notices: notes.length === 0 ? ['No unsigned notes. Every note in scope is signed.'] : [],
    truncated: notes.length >= 12_000,
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

export async function runCosignQueue(ctx: ReportContext, _p: ResolvedParams): Promise<ReportOutput> {
  void _p;
  const rows0 = await prisma.progressNoteWorkflow.findMany({
    where: {
      cosignRequired: true,
      cosignedAt: null,
      status: { in: ['SIGNED', 'LOCKED'] },
      note: { client: ctx.clientWhere(), ...(ctx.scope.clinicianId ? { clinicianId: ctx.scope.clinicianId } : {}) },
    },
    select: { signedAt: true, lockedAt: true, clinicianId: true, note: { select: { dateOfService: true, noteType: true, client: { select: { id: true, name: true, mrn: true } } } } },
    take: 5000,
  });
  const names = await staffNames(ctx.organizationId, rows0.map((r) => r.clinicianId));
  const waits: number[] = [];
  const rows: ReportRow[] = rows0.map((r) => {
    const signed = r.signedAt ?? r.lockedAt;
    const days = signed ? Math.floor((ctx.now.getTime() - signed.getTime()) / DAY_MS) : null;
    if (days != null) waits.push(days);
    return {
      clientId: r.note.client.id, client: r.note.client.name, mrn: r.note.client.mrn ?? null, clinician: clinicianLabel(names, r.clinicianId),
      noteType: r.note.noteType ?? null, serviceDate: r.note.dateOfService ? r.note.dateOfService.toISOString().slice(0, 10) : null,
      signedAt: signed ? signed.toISOString() : null, daysWaiting: days,
    };
  }).sort((a, b) => Number(b.daysWaiting ?? 0) - Number(a.daysWaiting ?? 0));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Clinician (supervisee)', type: 'text' },
      { key: 'noteType', label: 'Note type', type: 'text' },
      { key: 'serviceDate', label: 'Date of service', type: 'date' },
      { key: 'signedAt', label: 'Clinician signed', type: 'datetime' },
      { key: 'daysWaiting', label: 'Days waiting', type: 'days' },
    ],
    rows,
    kpis: [
      { label: 'Awaiting co-signature', value: rows.length, type: 'number' },
      { label: 'Over 7 days', value: waits.filter((d) => d > 7).length, type: 'number' },
      { label: 'Median days waiting', value: medianOrNull(waits), type: 'days' },
    ],
    sources: [source('Note workflow (co-sign required)', rows.length, ctx.now)],
    notices: rows.length === 0 ? ['No notes are waiting for a co-signature.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Measurement-based care ──────────────────────────────────────────────────

export async function runMeasurementBasedCare(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const spec = p.values.instrument === 'gad-7' ? GAD7 : PHQ9;
  const threshold = RELIABLE_CHANGE[spec.id as 'phq-9' | 'gad-7'];
  const client = ctx.clientWhere({ byAssignee: true });
  const [seen, scores, anyScores] = await Promise.all([
    prisma.appointment.groupBy({ by: ['clientId'], where: { client, status: { in: [...KEPT] }, startsAt: { gte: range.from, lt: range.toExclusive } } }),
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: ctx.organizationId, client, instrumentId: spec.id, totalScore: { not: null }, createdAt: { lt: range.toExclusive } },
      select: { clientId: true, totalScore: true, createdAt: true },
    }),
    prisma.clinicalAssessmentRecord.count({ where: { organizationId: ctx.organizationId, instrumentId: spec.id } }),
  ]);
  const points: ScorePoint[] = scores.map((s) => ({ clientId: s.clientId, score: s.totalScore as number, at: s.createdAt }));
  const outcomes = computeInstrumentOutcomes(points, spec, range);
  const seenIds = new Set(seen.map((s) => s.clientId));
  const allIds = [...new Set([...seenIds, ...outcomes.clients.map((c) => c.clientId)])];
  const assignees = allIds.length ? await prisma.client.findMany({ where: { id: { in: allIds } }, select: { id: true, assignedToId: true } }) : [];
  const assigneeOf = new Map(assignees.map((a) => [a.id, a.assignedToId]));
  const names = await staffNames(ctx.organizationId, assignees.map((a) => a.assignedToId));
  type Acc = { group: string; seen: number; measured: number; pairs: number; improved: number; worsened: number; elevated: number; response: number };
  const map = new Map<string, Acc>();
  const get = (id: string) => {
    const key = assigneeOf.get(id) ?? '__none__';
    const a = map.get(key) ?? { group: key === '__none__' ? 'Unassigned' : clinicianLabel(names, key), seen: 0, measured: 0, pairs: 0, improved: 0, worsened: 0, elevated: 0, response: 0 };
    map.set(key, a);
    return a;
  };
  for (const id of seenIds) get(id).seen++;
  const measuredSeen = new Set<string>();
  for (const c of outcomes.clients) {
    const a = get(c.clientId);
    if (seenIds.has(c.clientId)) {
      a.measured++;
      measuredSeen.add(c.clientId);
    }
    if (c.followUpEligible) {
      a.pairs++;
      const rc = reliableChange(c.baseline, c.latest, threshold);
      if (rc === 'improved') a.improved++;
      if (rc === 'worsened') a.worsened++;
    }
    if (c.elevatedBaseline) {
      a.elevated++;
      if (c.response) a.response++;
    }
  }
  const tot = [...map.values()].reduce((t, a) => ({ seen: t.seen + a.seen, measured: t.measured + a.measured, pairs: t.pairs + a.pairs, improved: t.improved + a.improved, worsened: t.worsened + a.worsened, elevated: t.elevated + a.elevated, response: t.response + a.response }), { seen: 0, measured: 0, pairs: 0, improved: 0, worsened: 0, elevated: 0, response: 0 });
  const rows: ReportRow[] = [...map.values()].map((a) => ({
    group: a.group, seen: a.seen, measured: a.measured, completion: pct(a.measured, a.seen), pairs: a.pairs,
    improved: a.improved, worsened: a.worsened, improvedPct: pct(a.improved, a.pairs), worsenedPct: pct(a.worsened, a.pairs),
    elevated: a.elevated, responsePct: pct(a.response, a.elevated),
  })).sort((a, b) => Number(b.seen) - Number(a.seen));
  const noData = anyScores === 0;
  return {
    columns: [
      { key: 'group', label: 'Assigned clinician', type: 'text' },
      { key: 'seen', label: 'Clients seen', type: 'number', smallCell: 'count' },
      { key: 'measured', label: `Measured (${spec.label})`, type: 'number', smallCell: 'count' },
      { key: 'completion', label: 'Completion', type: 'percent', smallCell: { rateOf: 'seen' } },
      { key: 'pairs', label: 'Follow-up pairs', type: 'number', smallCell: 'count' },
      { key: 'improved', label: 'Reliably improved', type: 'number', smallCell: 'count' },
      { key: 'improvedPct', label: 'Improved %', type: 'percent', smallCell: { rateOf: 'pairs' } },
      { key: 'worsened', label: 'Reliably worsened', type: 'number', smallCell: 'count' },
      { key: 'worsenedPct', label: 'Worsened %', type: 'percent', smallCell: { rateOf: 'pairs' } },
      { key: 'elevated', label: 'Baseline ≥ 10', type: 'number', smallCell: 'count' },
      { key: 'responsePct', label: 'Response %', type: 'percent', smallCell: { rateOf: 'elevated' } },
    ],
    rows: noData ? [] : rows,
    kpis: noData
      ? [{ label: `${spec.label} scores`, value: null, type: 'number', hint: `No ${spec.label} scores recorded` }]
      : [
          { label: 'Completion', value: pct(tot.measured, tot.seen), type: 'percent', smallCell: { denominator: tot.seen } },
          { label: 'Reliably improved', value: pct(tot.improved, tot.pairs), type: 'percent', smallCell: { denominator: tot.pairs } },
          { label: 'Reliably worsened', value: pct(tot.worsened, tot.pairs), type: 'percent', smallCell: { denominator: tot.pairs } },
          { label: 'Response', value: pct(tot.response, tot.elevated), type: 'percent', smallCell: { denominator: tot.elevated } },
        ],
    chart: noData ? null : { type: 'bar', xKey: 'group', series: [{ key: 'seen', label: 'Seen' }, { key: 'measured', label: 'Measured' }] },
    sources: [source(`${spec.label} scores`, scores.length), source('Appointments (kept, in period)', seen.length)],
    notices: [
      ...(noData ? [`No ${spec.label} scores recorded. Measurement-based care cannot be reported until clinicians administer ${spec.label} in Altrixs (Valant scores were not imported).`] : []),
      ...(outcomes.invalidScoresDropped ? [`${outcomes.invalidScoresDropped} out-of-range score(s) ignored.`] : []),
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── C-SSRS / safety plans ───────────────────────────────────────────────────

export async function runCssrsSafety(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const client = ctx.clientWhere({ byAssignee: true });
  const screens = await prisma.clinicalAssessmentRecord.findMany({
    where: { organizationId: ctx.organizationId, client, instrumentId: { startsWith: 'c-ssrs' }, createdAt: { gte: range.from, lt: range.toExclusive } },
    select: { clientId: true, totalScore: true, safetyFlagged: true, createdAt: true },
  });
  const positive = screens.filter((s) => s.safetyFlagged || (s.totalScore ?? 0) > 0);
  const posIds = [...new Set(positive.map((s) => s.clientId))];
  const [people, evals, planModule] = await Promise.all([
    posIds.length ? prisma.client.findMany({ where: { id: { in: posIds } }, select: { id: true, name: true, mrn: true, riskLevel: true, assignedToId: true } }) : [],
    posIds.length ? prisma.clinicalEvaluationRecord.findMany({ where: { organizationId: ctx.organizationId, clientId: { in: posIds }, status: { in: ['FINALIZED', 'AMENDED'] } }, select: { clientId: true, safetyPlanJson: true } }) : [],
    getModuleData<unknown>(ctx.organizationId, 'ehr-safety-plans').catch(() => null),
  ]);
  const plans = safetyPlanClientIds(planModule);
  const evalPlan = new Set(evals.filter((e) => hasFilledJson(e.safetyPlanJson)).map((e) => e.clientId));
  const names = await staffNames(ctx.organizationId, people.map((x) => x.assignedToId));
  let withPlan = 0;
  const rows: ReportRow[] = people.map((c) => {
    const mine = positive.filter((s) => s.clientId === c.id);
    const last = mine.reduce((m, s) => (s.createdAt > m ? s.createdAt : m), mine[0].createdAt);
    const has = plans.ids.has(c.id) || evalPlan.has(c.id);
    if (has) withPlan++;
    return {
      clientId: c.id, client: c.name, mrn: c.mrn ?? null, clinician: c.assignedToId ? clinicianLabel(names, c.assignedToId) : 'Unassigned',
      lastPositive: ymdIn(last, ctx.timeZone), positives: mine.length, riskLevel: c.riskLevel,
      safetyPlan: has ? (plans.ids.has(c.id) ? 'Yes (Safety Plans)' : 'Yes (evaluation)') : 'No',
    };
  }).sort((a, b) => (a.safetyPlan === 'No' ? -1 : 0) - (b.safetyPlan === 'No' ? -1 : 0) || String(b.lastPositive).localeCompare(String(a.lastPositive)));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Assigned clinician', type: 'text' },
      { key: 'lastPositive', label: 'Last positive screen', type: 'date' },
      { key: 'positives', label: 'Positive screens', type: 'number' },
      { key: 'riskLevel', label: 'Risk level', type: 'text' },
      { key: 'safetyPlan', label: 'Safety plan on file', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'C-SSRS screens', value: screens.length, type: 'number' },
      { label: 'Clients screened', value: new Set(screens.map((s) => s.clientId)).size, type: 'number' },
      { label: 'Clients positive', value: posIds.length, type: 'number' },
      { label: 'Positive with safety plan', value: pct(withPlan, posIds.length), type: 'percent' },
    ],
    sources: [
      source('C-SSRS screens', screens.length),
      { name: 'Safety Plans module', rows: plans.ids.size, empty: plans.ids.size === 0, note: plans.unlinked ? `${plans.unlinked} plan(s) have no client link and cannot be matched` : undefined },
    ],
    notices: screens.length === 0 ? ['No C-SSRS screens recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Crisis episodes and 7-day follow-up ─────────────────────────────────────

export async function runCrisisFollowUp(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  const clientCond: Prisma.CrisisEpisodeWhereInput =
    !f ? {} : 'in' in f ? { clientId: { in: f.in } } : { OR: [{ clientId: null }, { clientId: { notIn: f.notIn } }] };
  const episodes = await prisma.crisisEpisode.findMany({
    where: { organizationId: ctx.organizationId, startedAt: { gte: range.from, lt: range.toExclusive }, ...clientCond },
    select: { episodeNumber: true, clientId: true, startedAt: true, priority: true, status: true, disposition: true, followUp24hStatus: true, followUp72hStatus: true },
    orderBy: { startedAt: 'desc' },
  });
  const linked = [...new Set(episodes.map((e) => e.clientId).filter((x): x is string => Boolean(x)))];
  const [people, visits] = linked.length
    ? await Promise.all([
        prisma.client.findMany({ where: { AND: [ctx.clientWhere(), { id: { in: linked } }] }, select: { id: true, name: true, mrn: true } }),
        prisma.appointment.findMany({
          where: { clientId: { in: linked }, status: { in: [...KEPT] }, startsAt: { gte: range.from, lt: new Date(range.toExclusive.getTime() + 8 * DAY_MS) } },
          select: { clientId: true, startsAt: true },
        }),
      ])
    : [[], []];
  const byId = new Map(people.map((x) => [x.id, x]));
  let eligible = 0;
  let followed = 0;
  const rows: ReportRow[] = episodes.map((e) => {
    const person = e.clientId ? byId.get(e.clientId) : undefined;
    const t = e.startedAt.getTime();
    const visit = e.clientId ? visits.filter((v) => v.clientId === e.clientId && v.startsAt.getTime() > t && v.startsAt.getTime() <= t + 7 * DAY_MS).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] : undefined;
    const isEligible = Boolean(person) && ctx.now.getTime() - t >= 7 * DAY_MS;
    if (isEligible) {
      eligible++;
      if (visit) followed++;
    }
    return {
      episode: e.episodeNumber, started: e.startedAt.toISOString(), clientId: person?.id ?? null,
      client: person ? person.name : 'Not linked to a chart', mrn: person?.mrn ?? null, priority: e.priority, status: e.status,
      disposition: e.disposition ?? null, followUpVisit: visit ? ymdIn(visit.startsAt, ctx.timeZone) : null,
      within7: person ? (visit ? 'Yes' : isEligible ? 'No' : 'Window open') : 'n/a',
      followUp24h: e.followUp24hStatus, followUp72h: e.followUp72hStatus,
    };
  });
  return {
    columns: [
      { key: 'episode', label: 'Episode', type: 'text' },
      { key: 'started', label: 'Started', type: 'datetime' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'priority', label: 'Priority', type: 'number' },
      { key: 'disposition', label: 'Disposition', type: 'text' },
      { key: 'followUpVisit', label: 'First visit after', type: 'date' },
      { key: 'within7', label: 'Seen within 7 days', type: 'text' },
      { key: 'followUp24h', label: '24 h follow-up', type: 'text' },
      { key: 'followUp72h', label: '72 h follow-up', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Crisis episodes', value: episodes.length, type: 'number' },
      { label: 'Linked to a chart', value: episodes.filter((e) => e.clientId).length, type: 'number' },
      { label: '7-day follow-up rate', value: pct(followed, eligible), type: 'percent', hint: `${followed} of ${eligible} eligible` },
    ],
    sources: [source('Mobile crisis episodes', episodes.length), source('Appointments (kept)', visits.length)],
    notices: episodes.length === 0 ? ['No crisis episodes recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Discharges ──────────────────────────────────────────────────────────────

export async function runDischarges(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'reason';
  const [data, dischargedCharts, f] = await Promise.all([
    getModuleData<unknown>(ctx.organizationId, 'ehr-discharge-cases').catch(() => null),
    prisma.client.count({ where: { AND: [ctx.clientWhere({ byAssignee: true }), { status: 'DISCHARGED' }] } }),
    ctx.clientIdFilter(),
  ]);
  const list = (Array.isArray(data) ? data : []).map(asRecord).filter((x): x is Record<string, unknown> => Boolean(x));
  const allowed = f && 'in' in f ? new Set(f.in) : null;
  const locked = f && 'notIn' in f ? new Set(f.notIn) : null;
  const inScope = list.filter((c) => {
    const id = typeof c.clientId === 'string' && c.clientId ? c.clientId : null;
    if (allowed) return Boolean(id && allowed.has(id));
    if (locked && id && locked.has(id)) return false;
    return true;
  });
  const inRange = inScope.filter((c) => {
    const d = typeof c.targetDischarge === 'string' ? c.targetDischarge.slice(0, 10) : '';
    return d >= range.fromDate && d <= range.toDate;
  });
  const map = new Map<string, { group: string; cases: number; discharged: number; checklistDone: number }>();
  for (const c of inRange) {
    const d = String(c.targetDischarge).slice(0, 10);
    const key = dim === 'status' ? String(c.status ?? UNSPECIFIED) : dim === 'month' ? d.slice(0, 7) : String(c.reason ?? '').trim() || UNSPECIFIED;
    const label = dim === 'month' ? monthLabel(key) : key.replace(/_/g, ' ');
    const r = map.get(key) ?? { group: label, cases: 0, discharged: 0, checklistDone: 0 };
    r.cases++;
    if (c.status === 'discharged' || c.status === 'follow_up') r.discharged++;
    const checklist = Array.isArray(c.checklist) ? c.checklist : [];
    if (checklist.length && checklist.every((i) => asRecord(i)?.done === true || asRecord(i)?.completed === true)) r.checklistDone++;
    map.set(key, r);
  }
  const rows: ReportRow[] = [...map.entries()].sort((a, b) => (dim === 'month' ? a[0].localeCompare(b[0]) : b[1].cases - a[1].cases)).map(([, r]) => ({ ...r, checklistPct: pct(r.checklistDone, r.cases) }));
  return {
    columns: [
      { key: 'group', label: dim === 'status' ? 'Status' : dim === 'month' ? 'Target month' : 'Reason', type: 'text' },
      { key: 'cases', label: 'Discharge cases', type: 'number', smallCell: 'count' },
      { key: 'discharged', label: 'Discharged / in follow-up', type: 'number', smallCell: 'count' },
      { key: 'checklistDone', label: 'Checklist complete', type: 'number', smallCell: 'count' },
      { key: 'checklistPct', label: 'Checklist complete %', type: 'percent', smallCell: { rateOf: 'cases' } },
    ],
    rows,
    kpis: [
      { label: 'Discharge cases in period', value: inRange.length, type: 'number', smallCell: 'count' },
      { label: 'Charts in Discharged status (now)', value: dischargedCharts, type: 'number', smallCell: 'count' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'cases', label: 'Cases' }] },
    sources: [source('Discharge cases (Discharge page)', inScope.length), source('Client status Discharged', dischargedCharts, ctx.now)],
    notices: [
      ...(list.length === 0 ? ['No discharge cases recorded on the Discharge page.'] : []),
      'The chart stores the current status only (no discharge date), so discharged charts cannot be placed in a period.',
    ],
  };
}

// ─── Risk alerts ─────────────────────────────────────────────────────────────

export async function runRiskAlerts(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const dim = p.values.groupBy ?? 'severity';
  const alerts = await prisma.riskAlert.findMany({
    where: { client: ctx.clientWhere(), createdAt: { gte: range.from, lt: range.toExclusive } },
    select: { severity: true, type: true, source: true, reviewed: true, createdAt: true, reviewedAt: true, clientId: true },
  });
  const map = new Map<string, { group: string; alerts: number; clients: Set<string>; reviewed: number; hours: number[] }>();
  for (const a of alerts) {
    const key = dim === 'severity' ? a.severity : dim === 'type' ? a.type : dim === 'source' ? a.source : monthIn(a.createdAt, ctx.timeZone);
    const label = dim === 'month' ? monthLabel(key) : key.replace(/_/g, ' ');
    const r = map.get(key) ?? { group: label, alerts: 0, clients: new Set<string>(), reviewed: 0, hours: [] };
    r.alerts++;
    r.clients.add(a.clientId);
    if (a.reviewed) {
      r.reviewed++;
      if (a.reviewedAt) r.hours.push(Math.max(0, (a.reviewedAt.getTime() - a.createdAt.getTime()) / 3_600_000));
    }
    map.set(key, r);
  }
  const order = ['HIGH', 'MEDIUM', 'LOW'];
  const rows: ReportRow[] = [...map.entries()]
    .sort((a, b) => (dim === 'severity' ? order.indexOf(a[0]) - order.indexOf(b[0]) : dim === 'month' ? a[0].localeCompare(b[0]) : b[1].alerts - a[1].alerts))
    .map(([, r]) => ({ group: r.group, alerts: r.alerts, clients: r.clients.size, reviewed: r.reviewed, reviewedPct: pct(r.reviewed, r.alerts), medianHours: medianOrNull(r.hours) }));
  const allHours = [...map.values()].flatMap((r) => r.hours);
  return {
    columns: [
      { key: 'group', label: dim.charAt(0).toUpperCase() + dim.slice(1), type: 'text' },
      { key: 'alerts', label: 'Alerts', type: 'number', smallCell: 'count' },
      { key: 'clients', label: 'Clients', type: 'number', smallCell: 'count' },
      { key: 'reviewed', label: 'Reviewed', type: 'number', smallCell: 'count' },
      { key: 'reviewedPct', label: 'Reviewed %', type: 'percent', smallCell: { rateOf: 'alerts' } },
      { key: 'medianHours', label: 'Median hours to review', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Alerts', value: alerts.length, type: 'number', smallCell: 'count' },
      { label: 'High severity', value: alerts.filter((a) => a.severity === 'HIGH').length, type: 'number', smallCell: 'count' },
      { label: 'Unreviewed', value: alerts.filter((a) => !a.reviewed).length, type: 'number', smallCell: 'count' },
      { label: 'Median hours to review', value: medianOrNull(allHours), type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'alerts', label: 'Alerts' }, { key: 'reviewed', label: 'Reviewed' }] },
    sources: [source('Risk alerts', alerts.length)],
    notices: alerts.length === 0 ? ['No risk alerts in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── SDOH ────────────────────────────────────────────────────────────────────

export async function runSdoh(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  const screenings = await prisma.sdohScreening.findMany({
    where: { organizationId: ctx.organizationId, completedAt: { gte: range.from, lt: range.toExclusive }, ...clientIdWhere(f) },
    select: { clientId: true, positiveDomains: true, confirmedZCodes: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
  });
  const latest = new Map<string, (typeof screenings)[number]>();
  for (const s of screenings) if (!latest.has(s.clientId)) latest.set(s.clientId, s);
  const domains = new Map<string, number>();
  const zcodes = new Map<string, number>();
  let anyPositive = 0;
  for (const s of latest.values()) {
    if (s.positiveDomains.length) anyPositive++;
    for (const d of new Set(s.positiveDomains)) domains.set(d, (domains.get(d) ?? 0) + 1);
    for (const z of new Set(s.confirmedZCodes)) zcodes.set(z, (zcodes.get(z) ?? 0) + 1);
  }
  const screened = latest.size;
  const rows: ReportRow[] = [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ domain: d.replace(/_/g, ' '), clients: n, share: pct(n, screened), screened }));
  return {
    columns: [
      { key: 'domain', label: 'Domain', type: 'text' },
      { key: 'clients', label: 'Clients positive', type: 'number', smallCell: 'count' },
      { key: 'share', label: '% of screened', type: 'percent', smallCell: { rateOf: 'clients' } },
    ],
    rows: rows.map(({ screened: _s, ...r }) => { void _s; return r; }),
    kpis: [
      { label: 'Screenings', value: screenings.length, type: 'number', smallCell: 'count' },
      { label: 'Clients screened', value: screened, type: 'number', smallCell: 'count' },
      { label: 'Any positive domain', value: pct(anyPositive, screened), type: 'percent', smallCell: { denominator: screened } },
      { label: 'Z codes confirmed', value: [...zcodes.values()].reduce((s, v) => s + v, 0), type: 'number', smallCell: 'count' },
    ],
    chart: { type: 'bar', xKey: 'domain', series: [{ key: 'clients', label: 'Clients positive' }] },
    sources: [source('SDOH screenings (AHC HRSN)', screenings.length)],
    notices: screenings.length === 0 ? ['No SDOH screenings recorded in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

// ─── Session frequency ───────────────────────────────────────────────────────

export async function runSessionFrequency(ctx: ReportContext, _p: ResolvedParams): Promise<ReportOutput> {
  void _p;
  const r = await loadSessionFrequency(
    { organizationId: ctx.organizationId, actorUserId: ctx.userId, actorRole: ctx.role as Role },
    { locationId: ctx.scope.locationId ?? undefined },
    ctx.now
  );
  const items = r.items.filter((i) => !i.locked);
  const byClin = summarizeByClinician(items);
  const unassigned = items.filter((i) => !i.assignedToId).length;
  const rows: ReportRow[] = byClin.map((c) => ({
    group: c.name, total: c.total, overdue: c.counts.overdue, dueSoon: c.counts.due_soon, scheduled: c.counts.scheduled,
    onTrack: c.counts.on_track, noSessions: c.counts.no_sessions, notTracked: c.counts.not_tracked,
    adherence: pct(c.counts.on_track + c.counts.scheduled, c.total - c.counts.not_tracked),
  }));
  const tracked = items.filter((i) => i.assignedToId && i.bucket !== 'not_tracked');
  return {
    columns: [
      { key: 'group', label: 'Assigned clinician', type: 'text' },
      { key: 'total', label: 'Active clients', type: 'number' },
      { key: 'overdue', label: 'Overdue', type: 'number' },
      { key: 'dueSoon', label: 'Due soon', type: 'number' },
      { key: 'scheduled', label: 'Scheduled', type: 'number' },
      { key: 'onTrack', label: 'On track', type: 'number' },
      { key: 'noSessions', label: 'No sessions yet', type: 'number' },
      { key: 'notTracked', label: 'Not tracked', type: 'number' },
      { key: 'adherence', label: 'Adherence', type: 'percent', description: '(On track + scheduled) ÷ tracked clients' },
    ],
    rows,
    kpis: [
      { label: 'Overdue clients', value: items.filter((i) => i.bucket === 'overdue').length, type: 'number' },
      { label: 'Adherence', value: pct(tracked.filter((i) => i.bucket === 'on_track' || i.bucket === 'scheduled').length, tracked.length), type: 'percent' },
      { label: 'Unassigned clients', value: unassigned, type: 'number' },
    ],
    chart: { type: 'stackedBar', xKey: 'group', series: [{ key: 'overdue', label: 'Overdue' }, { key: 'dueSoon', label: 'Due soon' }, { key: 'onTrack', label: 'On track' }, { key: 'scheduled', label: 'Scheduled' }] },
    sources: [source('Session frequency (active clients)', items.length, ctx.now)],
    notices: [
      ...(items.length === 0 ? ['No active clients in scope.'] : []),
      ...(ctx.scope.clinicianId ? ['The provider filter does not apply to this report; use the clinician rows.'] : []),
    ],
    hiddenSensitiveClients: r.items.length - items.length,
  };
}

// ─── Monitoring labs ─────────────────────────────────────────────────────────

export async function runLabMonitoring(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const showAll = p.values.state === 'all';
  const meds = await prisma.clientMedication.findMany({
    where: {
      client: { AND: [ctx.clientWhere({ byAssignee: true }), { status: 'ACTIVE' }] },
      active: true,
      status: { notIn: ['discontinued', 'stopped', 'deleted'] },
      OR: [{ stopDate: null }, { stopDate: { gt: ctx.now } }],
    },
    select: { clientId: true, medicationName: true, drugName: true, genericName: true, brandName: true, isAntipsychotic: true, status: true },
  });
  const monitored = new Map<string, Set<string>>();
  for (const m of meds) {
    if (/discontinu|stopped|inactive|completed/i.test(m.status || '')) continue;
    const names = [m.medicationName, m.drugName, m.genericName, m.brandName].filter((x): x is string => Boolean(x && x.trim()));
    const sets = suggestedOrderSets(names.map((name) => ({ name, isAntipsychotic: m.isAntipsychotic }))).filter((s) => MONITORED_SETS.includes(s));
    if (!sets.length) continue;
    const cur = monitored.get(m.clientId) ?? new Set<string>();
    for (const s of sets) cur.add(s);
    monitored.set(m.clientId, cur);
  }
  const ids = [...monitored.keys()];
  const since = new Date(ctx.now.getTime() - 365 * DAY_MS);
  const [people, standing, lastOrders] = ids.length
    ? await Promise.all([
        prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, mrn: true, assignedToId: true } }),
        prisma.labStandingOrder.findMany({ where: { organizationId: ctx.organizationId, clientId: { in: ids }, active: true }, select: { clientId: true, nextDueAt: true, endDate: true, active: true } }),
        prisma.labOrder.groupBy({ by: ['clientId'], where: { organizationId: ctx.organizationId, clientId: { in: ids }, status: { not: 'cancelled' } }, _max: { orderedAt: true } }),
      ])
    : [[], [], []];
  const lastBy = new Map(lastOrders.map((l) => [l.clientId, l._max.orderedAt]));
  const names = await staffNames(ctx.organizationId, people.map((x) => x.assignedToId));
  let overdue = 0;
  let dueSoon = 0;
  const rows: ReportRow[] = [];
  for (const c of people) {
    const st = standing.filter((s) => s.clientId === c.id).map((s) => ({ s, state: standingDueState(s, ctx.now) })).filter((x) => x.state !== 'ended');
    const next = st.sort((a, b) => a.s.nextDueAt.getTime() - b.s.nextDueAt.getTime())[0];
    const last = lastBy.get(c.id) ?? null;
    let state: string;
    if (next) state = next.state === 'overdue' ? 'Overdue (standing order)' : next.state === 'due_soon' ? 'Due within 14 days' : 'Scheduled';
    else state = last && last >= since ? 'Ordered in last 12 months' : 'Overdue (no lab in 12 months)';
    const isOverdue = state.startsWith('Overdue');
    if (isOverdue) overdue++;
    if (state === 'Due within 14 days') dueSoon++;
    if (!showAll && !isOverdue && state !== 'Due within 14 days') continue;
    rows.push({
      clientId: c.id, client: c.name, mrn: c.mrn ?? null, clinician: c.assignedToId ? clinicianLabel(names, c.assignedToId) : 'Unassigned',
      monitoring: [...(monitored.get(c.id) ?? [])].map((k) => orderSetByKey(k)?.name ?? k).join('; '),
      nextDue: next ? next.s.nextDueAt.toISOString().slice(0, 10) : null, lastOrdered: last ? ymdIn(last, ctx.timeZone) : null, state,
    });
  }
  rows.sort((a, b) => (String(a.state).startsWith('Overdue') ? 0 : 1) - (String(b.state).startsWith('Overdue') ? 0 : 1) || String(a.client).localeCompare(String(b.client)));
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'clinician', label: 'Assigned clinician', type: 'text' },
      { key: 'monitoring', label: 'Monitoring', type: 'text' },
      { key: 'nextDue', label: 'Standing order next due', type: 'date' },
      { key: 'lastOrdered', label: 'Last lab ordered', type: 'date' },
      { key: 'state', label: 'State', type: 'text' },
    ],
    rows,
    kpis: [
      { label: 'Clients on monitored medications', value: ids.length, type: 'number' },
      { label: 'Overdue', value: overdue, type: 'number' },
      { label: 'Due within 14 days', value: dueSoon, type: 'number' },
    ],
    sources: [source('Active medications', meds.length), source('Lab standing orders', standing.length), source('Lab orders (latest per client)', lastOrders.length)],
    notices: [
      ...(meds.length === 0 ? ['No active medications recorded for clients in scope (DrFirst medication sync fills this list).'] : []),
      ...(meds.length > 0 && ids.length === 0 ? ['No client is on a medication that needs monitoring labs.'] : []),
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}


// ─── Resource library (src/lib/resources/reportRunners.ts) ───────────────────

export async function runResourcesAssigned(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  return (await import('@/lib/resources/reportRunners')).runResourcesAssigned(ctx, p);
}

export async function runCommunityReferrals(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  return (await import('@/lib/resources/reportRunners')).runCommunityReferrals(ctx, p);
}

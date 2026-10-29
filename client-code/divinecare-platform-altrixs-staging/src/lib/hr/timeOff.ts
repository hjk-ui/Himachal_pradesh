/**
 * Time off: requests, supervisor / HR approval, a ledger for PTO and sick balances (accruals,
 * usage, adjustments), and the schedule check. Altrixs has no provider availability-block model,
 * so approval does not change the calendar: it counts the clinician's booked appointments in the
 * window (a number only) and warns the approver to reschedule.
 */
import { prisma } from '@/lib/db/prisma';
import {
  addDaysYmd,
  bucketForType,
  canApproveTimeOff,
  dateOnlyValue,
  ledgerBalance,
  ptoAccrualForPeriod,
  sickAccrual,
  ymd,
} from './standard';
import { assertOrgUser, isMissingTable, loadHrSettings, loadRoster, type HrCtx } from './server';

/** Provider availability blocks do not exist in Altrixs scheduling yet; approvals warn instead. */
export const SCHEDULE_INTEGRATION = {
  mode: 'warn' as const,
  message:
    'Approved time off does not block the calendar yet (Altrixs has no provider availability blocks). Booked appointments in the window are counted so the front desk can reschedule.',
};

export type TimeOffView = {
  id: string;
  userId: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number;
  note: string | null;
  status: string;
  approverName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  scheduleConflicts: number | null;
  createdAt: string;
  canDecide: boolean;
};

export async function listTimeOff(ctx: HrCtx, opts: { userIds?: string[]; from?: string; to?: string; status?: string } = {}) {
  const roster = await loadRoster(ctx.organizationId, { includeDeactivated: true });
  const byId = new Map(roster.map((p) => [p.userId, p]));
  let rows: Awaited<ReturnType<typeof prisma.hrTimeOffRequest.findMany>> = [];
  try {
    rows = await prisma.hrTimeOffRequest.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.from ? { endDate: { gte: dateOnlyValue(opts.from)! } } : {}),
        ...(opts.to ? { startDate: { lte: dateOnlyValue(opts.to)! } } : {}),
      },
      orderBy: [{ startDate: 'desc' }],
      take: 500,
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
  return rows.map<TimeOffView>((r) => ({
    id: r.id,
    userId: r.userId,
    name: byId.get(r.userId)?.name ?? 'Staff',
    type: r.type,
    startDate: ymd(r.startDate)!,
    endDate: ymd(r.endDate)!,
    hours: r.hours,
    note: r.note,
    status: r.status,
    approverName: r.approverName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    scheduleConflicts: r.scheduleConflicts,
    createdAt: r.createdAt.toISOString(),
    canDecide: r.status === 'pending' && canApproveTimeOff({ userId: ctx.userId, role: ctx.role }, { userId: r.userId, managerUserId: byId.get(r.userId)?.managerUserId }),
  }));
}

export async function balancesFor(organizationId: string, userIds: string[]) {
  if (!userIds.length) return {} as Record<string, { pto: number; sick: number }>;
  let entries: Array<{ userId: string; bucket: string; hours: number }> = [];
  try {
    entries = await prisma.hrTimeOffLedger.findMany({ where: { organizationId, userId: { in: userIds } }, select: { userId: true, bucket: true, hours: true } });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  const out: Record<string, { pto: number; sick: number }> = {};
  for (const id of userIds) {
    const mine = entries.filter((e) => e.userId === id);
    out[id] = { pto: ledgerBalance(mine, 'pto'), sick: ledgerBalance(mine, 'sick') };
  }
  return out;
}

export async function requestTimeOff(
  ctx: HrCtx,
  input: { userId?: string; type: string; startDate: string; endDate: string; hours: number; note?: string | null },
  opts: { onBehalf: boolean },
) {
  const userId = opts.onBehalf && input.userId ? input.userId : ctx.userId;
  const staff = await assertOrgUser(ctx.organizationId, userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const start = ymd(input.startDate);
  const end = ymd(input.endDate);
  if (!start || !end || end < start) return { ok: false as const, status: 400, error: 'End date must be on or after the start date' };
  if (!(input.hours > 0) || input.hours > 2000) return { ok: false as const, status: 400, error: 'Enter the hours requested' };
  const overlap = await prisma.hrTimeOffRequest.findFirst({
    where: {
      organizationId: ctx.organizationId,
      userId,
      status: { in: ['pending', 'approved'] },
      startDate: { lte: dateOnlyValue(end)! },
      endDate: { gte: dateOnlyValue(start)! },
    },
    select: { id: true },
  });
  if (overlap) return { ok: false as const, status: 409, error: 'This overlaps another pending or approved request' };
  const row = await prisma.hrTimeOffRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId,
      type: input.type,
      startDate: dateOnlyValue(start)!,
      endDate: dateOnlyValue(end)!,
      hours: Math.round(input.hours * 100) / 100,
      note: input.note?.trim() || null,
    },
  });
  return { ok: true as const, id: row.id, userId };
}

/** Booked appointments for the clinician in the window (count only; no client data). */
export async function scheduleConflictCount(organizationId: string, userId: string, startDate: string, endDate: string) {
  return prisma.appointment.count({
    where: {
      organizationId,
      clinicianId: userId,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      startsAt: { gte: new Date(`${startDate}T00:00:00.000Z`), lt: new Date(`${addDaysYmd(endDate, 1)}T06:00:00.000Z`) },
    },
  });
}

export async function decideTimeOff(ctx: HrCtx, id: string, decision: 'approved' | 'denied' | 'cancelled', note?: string | null) {
  const row = await prisma.hrTimeOffRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row) return { ok: false as const, status: 404, error: 'Request not found' };
  const profile = await prisma.staffHrProfile.findUnique({ where: { userId: row.userId }, select: { managerUserId: true } });
  if (decision === 'cancelled') {
    const own = row.userId === ctx.userId;
    if (!own && !canApproveTimeOff({ userId: ctx.userId, role: ctx.role }, { userId: row.userId, managerUserId: profile?.managerUserId })) {
      return { ok: false as const, status: 403, error: 'Forbidden' };
    }
    if (!['pending', 'approved'].includes(row.status)) return { ok: false as const, status: 400, error: 'Only pending or approved requests can be cancelled' };
  } else {
    if (row.status !== 'pending') return { ok: false as const, status: 400, error: 'This request was already decided' };
    if (!canApproveTimeOff({ userId: ctx.userId, role: ctx.role }, { userId: row.userId, managerUserId: profile?.managerUserId })) {
      return { ok: false as const, status: 403, error: 'Only the supervisor or HR can decide this request' };
    }
  }
  const start = ymd(row.startDate)!;
  const end = ymd(row.endDate)!;
  let conflicts: number | null = row.scheduleConflicts;
  if (decision === 'approved') conflicts = await scheduleConflictCount(ctx.organizationId, row.userId, start, end);
  const bucket = bucketForType(row.type);
  await prisma.$transaction(async (tx) => {
    await tx.hrTimeOffRequest.update({
      where: { id },
      data: {
        status: decision,
        approverId: ctx.userId,
        approverName: ctx.name,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        scheduleConflicts: conflicts,
      },
    });
    if (bucket && decision === 'approved') {
      await tx.hrTimeOffLedger.create({
        data: { organizationId: ctx.organizationId, userId: row.userId, bucket, entryType: 'usage', hours: -row.hours, effectiveOn: row.startDate, requestId: row.id, note: 'Approved request', createdById: ctx.userId },
      });
    }
    if (bucket && decision === 'cancelled' && row.status === 'approved') {
      await tx.hrTimeOffLedger.create({
        data: { organizationId: ctx.organizationId, userId: row.userId, bucket, entryType: 'adjustment', hours: row.hours, effectiveOn: row.startDate, requestId: row.id, note: 'Approved request cancelled', createdById: ctx.userId },
      });
    }
  });
  const balance = bucket ? (await balancesFor(ctx.organizationId, [row.userId]))[row.userId]?.[bucket] ?? 0 : null;
  return { ok: true as const, userId: row.userId, scheduleConflicts: conflicts, balance, negativeBalance: balance != null && balance < 0 };
}

/**
 * HR ledger entry. Sick accrual from hours worked uses the HR setting (1 h per N worked; Maryland
 * HWFA default N = 30, practice policy, confirm) and the annual / balance caps when set.
 */
export async function addLedgerEntry(
  ctx: HrCtx,
  input: { userId: string; bucket: 'pto' | 'sick'; entryType: 'accrual' | 'adjustment' | 'carryover'; hours?: number | null; hoursWorked?: number | null; effectiveOn: string; note?: string | null },
) {
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const effective = ymd(input.effectiveOn);
  if (!effective) return { ok: false as const, status: 400, error: 'Invalid date' };
  let hours = Number(input.hours ?? 0);
  let detail: string | null = null;
  if (input.entryType === 'accrual' && input.bucket === 'sick' && input.hoursWorked != null) {
    const settings = await loadHrSettings(ctx.organizationId);
    const year = effective.slice(0, 4);
    const entries = await prisma.hrTimeOffLedger.findMany({ where: { organizationId: ctx.organizationId, userId: input.userId, bucket: 'sick' } });
    const accruedThisYear = entries.filter((e) => e.entryType === 'accrual' && ymd(e.effectiveOn)!.startsWith(year)).reduce((s, e) => s + e.hours, 0);
    const res = sickAccrual(
      { hoursWorked: input.hoursWorked, accruedThisYear, balance: ledgerBalance(entries, 'sick') },
      { sickAccrualHoursWorked: settings.sickAccrualHoursWorked, sickAnnualAccrualCap: settings.sickAnnualAccrualCap, sickBalanceCap: settings.sickBalanceCap },
    );
    if (res.reason && res.hours === 0 && !res.capped) return { ok: false as const, status: 400, error: res.reason };
    hours = res.hours;
    detail = res.reason;
  } else if (input.entryType === 'accrual' && input.bucket === 'pto' && (input.hours == null || input.hours === 0)) {
    const settings = await loadHrSettings(ctx.organizationId);
    const profile = await prisma.staffHrProfile.findUnique({ where: { userId: input.userId }, select: { fte: true } });
    const entries = await prisma.hrTimeOffLedger.findMany({ where: { organizationId: ctx.organizationId, userId: input.userId, bucket: 'pto' } });
    const res = ptoAccrualForPeriod(settings.ptoPolicy, { fte: profile?.fte, balance: ledgerBalance(entries, 'pto') });
    if (res.reason && res.hours === 0 && !res.capped) return { ok: false as const, status: 400, error: res.reason };
    hours = res.hours;
    detail = res.reason;
  }
  if (!Number.isFinite(hours) || Math.abs(hours) > 2000) return { ok: false as const, status: 400, error: 'Invalid hours' };
  const row = await prisma.hrTimeOffLedger.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      bucket: input.bucket,
      entryType: input.entryType,
      hours: Math.round(hours * 100) / 100,
      effectiveOn: dateOnlyValue(effective)!,
      hoursWorked: input.hoursWorked ?? null,
      note: [input.note?.trim(), detail].filter(Boolean).join(' · ') || null,
      createdById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id, hours: row.hours };
}

export async function ledgerFor(organizationId: string, userId: string) {
  try {
    const rows = await prisma.hrTimeOffLedger.findMany({ where: { organizationId, userId }, orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map((r) => ({ id: r.id, bucket: r.bucket, entryType: r.entryType, hours: r.hours, effectiveOn: ymd(r.effectiveOn)!, hoursWorked: r.hoursWorked, note: r.note }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

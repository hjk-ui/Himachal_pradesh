import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientContext } from '@/patient/domain';
import { sanitizeJournal } from '@/patient/application/shared/sanitize';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { maybeCreateCheckInAlert } from '@/lib/alerts/manage';

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function riskFromMood(mood: number) {
  if (mood <= 3) return 'HIGH' as const;
  if (mood <= 5) return 'MEDIUM' as const;
  return 'LOW' as const;
}

function serialize(row: {
  id: string;
  mood: number;
  stress: number;
  sleep: number | null;
  note: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    mood: row.mood,
    stress: row.stress,
    sleep: row.sleep,
    journal: row.note,
    createdAt: row.createdAt.toISOString(),
    date: row.createdAt.toISOString().slice(0, 10),
  };
}

function validateScores(mood: number, stress: number, sleep?: number | null) {
  if (mood < 1 || mood > 10 || stress < 1 || stress > 10) {
    throw new PatientAppError('Mood and stress must be between 1 and 10', 400, 'VALIDATION_ERROR');
  }
  if (sleep != null && (sleep < 1 || sleep > 10)) {
    throw new PatientAppError('Sleep score must be between 1 and 10', 400, 'VALIDATION_ERROR');
  }
}

export async function createPatientCheckIn(
  ctx: PatientContext,
  input: { mood: number; stress: number; sleep?: number | null; journal?: string | null }
) {
  const mood = Math.round(input.mood);
  const stress = Math.round(input.stress);
  const sleep = input.sleep == null ? null : Math.round(input.sleep);
  validateScores(mood, stress, sleep);

  const note = sanitizeJournal(input.journal);
  const now = new Date();

  const [last, client] = await Promise.all([
    prisma.checkIn.findFirst({
      where: { clientId: ctx.clientId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.client.findUnique({
      where: { id: ctx.clientId },
      select: { checkInStreak: true },
    }),
  ]);

  let streak = 1;
  if (last && client) {
    const diffDays = Math.round(
      (startOfLocalDay(now).getTime() - startOfLocalDay(last.createdAt).getTime()) / 86_400_000
    );
    if (diffDays === 0) streak = Math.max(1, client.checkInStreak);
    else if (diffDays === 1) streak = client.checkInStreak + 1;
  }

  const riskLevel = riskFromMood(mood);

  const checkIn = await prisma.$transaction(async (tx) => {
    const created = await tx.checkIn.create({
      data: { clientId: ctx.clientId, mood, stress, sleep, note },
    });
    await tx.client.update({
      where: { id: ctx.clientId },
      data: { checkInStreak: streak, riskLevel },
    });
    return created;
  });

  await Promise.all([
    maybeCreateCheckInAlert({
      clientId: ctx.clientId,
      mood,
      stress,
      note,
    }),
    logPatientAudit({
      clientId: ctx.clientId,
      accountId: ctx.accountId,
      action: 'checkin.created',
      entityType: 'check_in',
      entityId: checkIn.id,
    }),
  ]);

  return serialize(checkIn);
}

export async function listPatientCheckIns(
  ctx: PatientContext,
  options: { skip: number; limit: number; from?: string; to?: string }
) {
  const where: { clientId: string; createdAt?: { gte?: Date; lte?: Date } } = {
    clientId: ctx.clientId,
  };
  if (options.from) {
    const from = new Date(`${options.from}T00:00:00`);
    if (!Number.isNaN(from.getTime())) {
      where.createdAt = { ...where.createdAt, gte: from };
    }
  }
  if (options.to) {
    const to = new Date(`${options.to}T23:59:59.999`);
    if (!Number.isNaN(to.getTime())) {
      where.createdAt = { ...where.createdAt, lte: to };
    }
  }

  const [total, rows] = await Promise.all([
    prisma.checkIn.count({ where }),
    prisma.checkIn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: options.skip,
      take: options.limit,
    }),
  ]);

  return {
    checkIns: rows.map(serialize),
    pagination: {
      total,
      page: Math.floor(options.skip / options.limit) + 1,
      limit: options.limit,
    },
  };
}

export async function getPatientProgress(ctx: PatientContext) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [rows, client] = await Promise.all([
    prisma.checkIn.findMany({
      where: { clientId: ctx.clientId, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.client.findUnique({
      where: { id: ctx.clientId },
      select: { checkInStreak: true, riskLevel: true },
    }),
  ]);

  const moods = rows.map((r) => r.mood);
  const stresses = rows.map((r) => r.stress);
  const sleeps = rows.map((r) => r.sleep).filter((s): s is number => s != null);
  const avg = (nums: number[]) =>
    nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;

  return {
    weekly: {
      checkInsCompleted: rows.length,
      averageMood: avg(moods),
      averageStress: avg(stresses),
      averageSleep: avg(sleeps),
      daily: rows.map((r) => ({
        date: r.createdAt.toISOString().slice(0, 10),
        mood: r.mood,
        stress: r.stress,
        sleep: r.sleep,
      })),
    },
    streak: client?.checkInStreak ?? 0,
    riskLevel: client?.riskLevel?.toLowerCase() ?? 'low',
  };
}

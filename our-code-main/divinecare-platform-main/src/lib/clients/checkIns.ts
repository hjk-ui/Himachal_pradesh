import type { RiskLevel, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { maybeCreateCheckInAlert } from '@/lib/alerts/manage';
import { isCaseloadRole } from '@/types/roles';
import { clientOrgFilter } from '@/lib/clients/orgScope';

type AccessError = { ok: false; status: number; error: string };

export type SerializedCheckIn = {
  id: string;
  date: string;
  dateLabel: string;
  mood: number;
  stress: number;
  sleep: number | null;
  note: string | null;
  createdAt: string;
};

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function riskFromMood(mood: number): RiskLevel {
  if (mood <= 3) return 'HIGH';
  if (mood <= 5) return 'MEDIUM';
  return 'LOW';
}

function serializeCheckIn(row: {
  id: string;
  mood: number;
  stress: number;
  sleep: number | null;
  note: string | null;
  createdAt: Date;
}): SerializedCheckIn {
  return {
    id: row.id,
    date: row.createdAt.toISOString().slice(0, 10),
    dateLabel: row.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    mood: row.mood,
    stress: row.stress,
    sleep: row.sleep ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeScore(raw: number, label: string): { ok: true; value: number } | AccessError {
  const value = Math.round(raw);
  if (value < 1 || value > 10) {
    return { ok: false, status: 400, error: `${label} must be between 1 and 10` };
  }
  return { ok: true, value };
}

async function findAllowedClient(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(input.organizationId) },
    select: {
      id: true,
      assignedToId: true,
      checkInStreak: true,
      riskLevel: true,
    },
  });

  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  if (isCaseloadRole(input.actorRole) && client.assignedToId !== input.actorUserId) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, client };
}

export async function listClientCheckIns(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  take?: number;
}): Promise<{ ok: true; checkIns: SerializedCheckIn[] } | AccessError> {
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }

  const rows = await prisma.checkIn.findMany({
    where: { clientId: input.clientId },
    orderBy: { createdAt: 'desc' },
    take: input.take ?? 60,
  });

  return {
    ok: true,
    checkIns: rows.map(serializeCheckIn),
  };
}

export async function createClientCheckIn(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  mood: number;
  stress: number;
  sleep?: number | null;
  note?: string | null;
}): Promise<
  | {
      ok: true;
      checkIn: SerializedCheckIn;
      client: {
        checkInStreak: number;
        riskLevel: RiskLevel;
        avgMood: number | null;
        avgStress: number | null;
        avgSleep: number | null;
      };
    }
  | AccessError
> {
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }

  const moodNorm = normalizeScore(input.mood, 'Mood');
  if (moodNorm.ok === false) return moodNorm;
  const stressNorm = normalizeScore(input.stress, 'Stress');
  if (stressNorm.ok === false) return stressNorm;

  let sleep: number | null = null;
  if (input.sleep != null && input.sleep !== undefined) {
    const sleepNorm = normalizeScore(input.sleep, 'Sleep');
    if (sleepNorm.ok === false) return sleepNorm;
    sleep = sleepNorm.value;
  }

  const mood = moodNorm.value;
  const stress = stressNorm.value;

  const now = new Date();
  const last = await prisma.checkIn.findFirst({
    where: { clientId: input.clientId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  let streak = 1;
  if (last) {
    const diffDays = Math.round(
      (startOfLocalDay(now).getTime() - startOfLocalDay(last.createdAt).getTime()) / 86_400_000
    );
    if (diffDays === 0) {
      streak = Math.max(1, allowed.client.checkInStreak);
    } else if (diffDays === 1) {
      streak = allowed.client.checkInStreak + 1;
    }
  }

  const riskLevel = riskFromMood(mood);
  const note = input.note?.trim() || null;

  const checkIn = await prisma.$transaction(async (tx) => {
    const created = await tx.checkIn.create({
      data: {
        clientId: input.clientId,
        mood,
        stress,
        sleep,
        note,
      },
    });

    await tx.client.update({
      where: { id: input.clientId },
      data: {
        checkInStreak: streak,
        riskLevel,
      },
    });

    return created;
  });

  await maybeCreateCheckInAlert({
    clientId: input.clientId,
    mood,
    stress,
    note,
  });

  const recent = await prisma.checkIn.findMany({
    where: { clientId: input.clientId },
    orderBy: { createdAt: 'desc' },
    take: 14,
    select: { mood: true, stress: true, sleep: true },
  });
  const moods = recent.map((c) => c.mood);
  const stresses = recent.map((c) => c.stress);
  const sleeps = recent
    .map((c) => c.sleep)
    .filter((s): s is number => s != null);

  return {
    ok: true,
    checkIn: serializeCheckIn(checkIn),
    client: {
      checkInStreak: streak,
      riskLevel,
      avgMood: moods.length
        ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length)
        : null,
      avgStress: stresses.length
        ? Math.round(stresses.reduce((a, b) => a + b, 0) / stresses.length)
        : null,
      avgSleep: sleeps.length
        ? Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length)
        : null,
    },
  };
}

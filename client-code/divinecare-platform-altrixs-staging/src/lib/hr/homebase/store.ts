/**
 * Persistence for the Homebase cache (prisma/migrations/20261024_homebase_connector.sql).
 *
 * The tables are SQL-first (the Prisma models are added to schema.prisma separately), so every
 * query is a parameterized tagged template ($queryRaw / $executeRaw); no string concatenation.
 * Every statement is scoped by organizationId. Homebase ids are unique per organization.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import type { HbEmployee, HbLocation, HbShift, HbTimecard } from './mappers';
import type { LinkState, MatchDecision } from './matching';

export type StoredLocation = { homebaseId: string; name: string; city: string | null; state: string | null; altrixsLocationId: string | null; mappedAt: Date | null; lastSeenAt: Date };
export type StoredEmployee = {
  homebaseId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  status: 'active' | 'archived' | 'unknown';
  homebaseLocationIds: string[];
  linkedUserId: string | null;
  linkStatus: LinkState['linkStatus'];
  suggestedUserId: string | null;
  linkedAt: Date | null;
  lastSeenAt: Date;
};
export type StoredTimecard = {
  homebaseId: string;
  homebaseEmployeeId: string | null;
  homebaseLocationId: string | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  breakMinutes: number;
  workedMinutes: number | null;
  approved: boolean | null;
  deletedAt: Date | null;
};
export type StoredShift = {
  homebaseId: string;
  homebaseEmployeeId: string | null;
  homebaseLocationId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  roleLabel: string | null;
  deletedAt: Date | null;
};
export type SyncRunRow = {
  id: string;
  trigger: string;
  triggeredById: string | null;
  rangeStart: string;
  rangeEnd: string;
  status: string;
  counts: Record<string, number> | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

/** The sync's view of storage (an in-memory fake implements it in tests). */
export interface HomebaseStore {
  startRun(organizationId: string, run: { trigger: 'manual' | 'cron'; triggeredById: string | null; rangeStart: string; rangeEnd: string }): Promise<string>;
  finishRun(id: string, status: 'success' | 'partial' | 'failed', counts: Record<string, number>, error: string | null): Promise<void>;
  upsertLocations(organizationId: string, rows: HbLocation[]): Promise<void>;
  loadEmployeeLinks(organizationId: string): Promise<Map<string, LinkState>>;
  upsertEmployees(organizationId: string, rows: Array<HbEmployee & MatchDecision>): Promise<void>;
  upsertShifts(organizationId: string, rows: HbShift[]): Promise<void>;
  upsertTimecards(organizationId: string, rows: HbTimecard[]): Promise<void>;
  markShiftsDeleted(organizationId: string, homebaseIds: string[]): Promise<number>;
  markTimecardsDeleted(organizationId: string, homebaseIds: string[]): Promise<number>;
  loadStaffForMatch(organizationId: string): Promise<Array<{ userId: string; name: string; email: string; accountStatus: string }>>;
}

const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

export const sqlHomebaseStore: HomebaseStore = {
  async startRun(organizationId, run) {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "HomebaseSyncRun" ("id", "organizationId", "trigger", "triggeredById", "rangeStart", "rangeEnd", "status", "startedAt")
      VALUES (${id}, ${organizationId}, ${run.trigger}, ${run.triggeredById}, ${run.rangeStart}::date, ${run.rangeEnd}::date, 'running', NOW())`;
    return id;
  },

  async finishRun(id, status, counts, error) {
    await prisma.$executeRaw`
      UPDATE "HomebaseSyncRun" SET "status" = ${status}, "counts" = ${JSON.stringify(counts)}::jsonb,
        "error" = ${error ? error.slice(0, 500) : null}, "finishedAt" = NOW()
      WHERE "id" = ${id}`;
  },

  async upsertLocations(organizationId, rows) {
    for (const l of rows) {
      await prisma.$executeRaw`
        INSERT INTO "HomebaseLocation" ("id", "organizationId", "homebaseId", "name", "city", "state", "lastSeenAt", "updatedAt")
        VALUES (${randomUUID()}, ${organizationId}, ${l.homebaseId}, ${l.name}, ${l.city}, ${l.state}, NOW(), NOW())
        ON CONFLICT ("organizationId", "homebaseId") DO UPDATE SET
          "name" = EXCLUDED."name", "city" = EXCLUDED."city", "state" = EXCLUDED."state",
          "lastSeenAt" = NOW(), "updatedAt" = NOW()`;
    }
  },

  async loadEmployeeLinks(organizationId) {
    const rows = await prisma.$queryRaw<Array<{ homebaseId: string; linkedUserId: string | null; linkStatus: string; suggestedUserId: string | null }>>`
      SELECT "homebaseId", "linkedUserId", "linkStatus", "suggestedUserId" FROM "HomebaseEmployee" WHERE "organizationId" = ${organizationId}`;
    return new Map(rows.map((r) => [r.homebaseId, { linkedUserId: r.linkedUserId, linkStatus: r.linkStatus as LinkState['linkStatus'], suggestedUserId: r.suggestedUserId }]));
  },

  async upsertEmployees(organizationId, rows) {
    for (const e of rows) {
      await prisma.$executeRaw`
        INSERT INTO "HomebaseEmployee" ("id", "organizationId", "homebaseId", "firstName", "lastName", "email", "jobTitle", "status",
          "homebaseLocationIds", "linkedUserId", "linkStatus", "suggestedUserId", "linkedAt", "lastSeenAt", "updatedAt")
        VALUES (${randomUUID()}, ${organizationId}, ${e.homebaseId}, ${e.firstName}, ${e.lastName}, ${e.email}, ${e.jobTitle}, ${e.status},
          ${e.locationIds}::text[], ${e.linkedUserId}, ${e.linkStatus}, ${e.suggestedUserId}, ${e.linkedUserId ? new Date() : null}, NOW(), NOW())
        ON CONFLICT ("organizationId", "homebaseId") DO UPDATE SET
          "firstName" = EXCLUDED."firstName", "lastName" = EXCLUDED."lastName", "email" = EXCLUDED."email",
          "jobTitle" = EXCLUDED."jobTitle", "status" = EXCLUDED."status", "homebaseLocationIds" = EXCLUDED."homebaseLocationIds",
          "linkedAt" = CASE WHEN "HomebaseEmployee"."linkedUserId" IS DISTINCT FROM EXCLUDED."linkedUserId" THEN EXCLUDED."linkedAt" ELSE "HomebaseEmployee"."linkedAt" END,
          "linkedById" = CASE WHEN "HomebaseEmployee"."linkedUserId" IS DISTINCT FROM EXCLUDED."linkedUserId" THEN NULL ELSE "HomebaseEmployee"."linkedById" END,
          "linkedUserId" = EXCLUDED."linkedUserId", "linkStatus" = EXCLUDED."linkStatus", "suggestedUserId" = EXCLUDED."suggestedUserId",
          "lastSeenAt" = NOW(), "updatedAt" = NOW()`;
    }
  },

  async upsertShifts(organizationId, rows) {
    for (const s of rows) {
      await prisma.$executeRaw`
        INSERT INTO "HomebaseShift" ("id", "organizationId", "homebaseId", "homebaseLocationId", "homebaseEmployeeId", "startAt", "endAt",
          "roleLabel", "published", "deletedAt", "syncedAt", "updatedAt")
        VALUES (${randomUUID()}, ${organizationId}, ${s.homebaseId}, ${s.homebaseLocationId}, ${s.homebaseEmployeeId}, ${s.startAt}, ${s.endAt},
          ${s.roleLabel}, ${s.published}, NULL, NOW(), NOW())
        ON CONFLICT ("organizationId", "homebaseId") DO UPDATE SET
          "homebaseLocationId" = EXCLUDED."homebaseLocationId", "homebaseEmployeeId" = EXCLUDED."homebaseEmployeeId",
          "startAt" = EXCLUDED."startAt", "endAt" = EXCLUDED."endAt", "roleLabel" = EXCLUDED."roleLabel",
          "published" = EXCLUDED."published", "deletedAt" = NULL, "syncedAt" = NOW(), "updatedAt" = NOW()`;
    }
  },

  async upsertTimecards(organizationId, rows) {
    for (const t of rows) {
      await prisma.$executeRaw`
        INSERT INTO "HomebaseTimecard" ("id", "organizationId", "homebaseId", "homebaseLocationId", "homebaseEmployeeId", "homebaseShiftId",
          "clockInAt", "clockOutAt", "breakMinutes", "workedMinutes", "approved", "deletedAt", "syncedAt", "updatedAt")
        VALUES (${randomUUID()}, ${organizationId}, ${t.homebaseId}, ${t.homebaseLocationId}, ${t.homebaseEmployeeId}, ${t.homebaseShiftId},
          ${t.clockInAt}, ${t.clockOutAt}, ${t.breakMinutes}, ${t.workedMinutes}, ${t.approved}, NULL, NOW(), NOW())
        ON CONFLICT ("organizationId", "homebaseId") DO UPDATE SET
          "homebaseLocationId" = EXCLUDED."homebaseLocationId", "homebaseEmployeeId" = EXCLUDED."homebaseEmployeeId",
          "homebaseShiftId" = EXCLUDED."homebaseShiftId", "clockInAt" = EXCLUDED."clockInAt", "clockOutAt" = EXCLUDED."clockOutAt",
          "breakMinutes" = EXCLUDED."breakMinutes", "workedMinutes" = EXCLUDED."workedMinutes", "approved" = EXCLUDED."approved",
          "deletedAt" = NULL, "syncedAt" = NOW(), "updatedAt" = NOW()`;
    }
  },

  async markShiftsDeleted(organizationId, homebaseIds) {
    if (!homebaseIds.length) return 0;
    return n(
      await prisma.$executeRaw`
        UPDATE "HomebaseShift" SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "organizationId" = ${organizationId} AND "homebaseId" = ANY(${homebaseIds}::text[]) AND "deletedAt" IS NULL`,
    );
  },

  async markTimecardsDeleted(organizationId, homebaseIds) {
    if (!homebaseIds.length) return 0;
    return n(
      await prisma.$executeRaw`
        UPDATE "HomebaseTimecard" SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "organizationId" = ${organizationId} AND "homebaseId" = ANY(${homebaseIds}::text[]) AND "deletedAt" IS NULL`,
    );
  },

  async loadStaffForMatch(organizationId) {
    const users = await prisma.user.findMany({
      where: { organizationId, role: { not: 'SUPER_ADMIN' } },
      select: { id: true, name: true, email: true, status: true },
    });
    return users.map((u) => ({ userId: u.id, name: u.name?.trim() || u.email, email: u.email, accountStatus: String(u.status) }));
  },
};

// ─── Reads for the HR screens ────────────────────────────────────────────────

export async function listLocations(organizationId: string): Promise<StoredLocation[]> {
  return prisma.$queryRaw<StoredLocation[]>`
    SELECT "homebaseId", "name", "city", "state", "altrixsLocationId", "mappedAt", "lastSeenAt"
    FROM "HomebaseLocation" WHERE "organizationId" = ${organizationId} ORDER BY "name"`;
}

export async function setLocationMapping(organizationId: string, homebaseId: string, altrixsLocationId: string | null, actorId: string): Promise<number> {
  return n(
    await prisma.$executeRaw`
      UPDATE "HomebaseLocation" SET "altrixsLocationId" = ${altrixsLocationId}, "mappedById" = ${actorId}, "mappedAt" = NOW(), "updatedAt" = NOW()
      WHERE "organizationId" = ${organizationId} AND "homebaseId" = ${homebaseId}`,
  );
}

export async function listEmployees(organizationId: string): Promise<StoredEmployee[]> {
  return prisma.$queryRaw<StoredEmployee[]>`
    SELECT "homebaseId", "firstName", "lastName", "email", "jobTitle", "status", "homebaseLocationIds",
      "linkedUserId", "linkStatus", "suggestedUserId", "linkedAt", "lastSeenAt"
    FROM "HomebaseEmployee" WHERE "organizationId" = ${organizationId} ORDER BY "lastName", "firstName"`;
}

export async function getEmployee(organizationId: string, homebaseId: string): Promise<StoredEmployee | null> {
  const rows = await prisma.$queryRaw<StoredEmployee[]>`
    SELECT "homebaseId", "firstName", "lastName", "email", "jobTitle", "status", "homebaseLocationIds",
      "linkedUserId", "linkStatus", "suggestedUserId", "linkedAt", "lastSeenAt"
    FROM "HomebaseEmployee" WHERE "organizationId" = ${organizationId} AND "homebaseId" = ${homebaseId}`;
  return rows[0] ?? null;
}

export async function writeEmployeeLink(
  organizationId: string,
  homebaseId: string,
  link: { linkedUserId: string | null; linkStatus: LinkState['linkStatus']; suggestedUserId: string | null },
  actorId: string,
): Promise<number> {
  return n(
    await prisma.$executeRaw`
      UPDATE "HomebaseEmployee" SET "linkedUserId" = ${link.linkedUserId}, "linkStatus" = ${link.linkStatus},
        "suggestedUserId" = ${link.suggestedUserId}, "linkedById" = ${actorId}, "linkedAt" = NOW(), "updatedAt" = NOW()
      WHERE "organizationId" = ${organizationId} AND "homebaseId" = ${homebaseId}`,
  );
}

export async function listTimecards(organizationId: string, from: Date, to: Date, employeeIds?: string[]): Promise<StoredTimecard[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  if (employeeIds) {
    return prisma.$queryRaw<StoredTimecard[]>`
      SELECT "homebaseId", "homebaseEmployeeId", "homebaseLocationId", "clockInAt", "clockOutAt", "breakMinutes", "workedMinutes", "approved", "deletedAt"
      FROM "HomebaseTimecard"
      WHERE "organizationId" = ${organizationId} AND "clockInAt" >= ${from} AND "clockInAt" < ${to}
        AND "homebaseEmployeeId" = ANY(${employeeIds}::text[])
      ORDER BY "clockInAt"`;
  }
  return prisma.$queryRaw<StoredTimecard[]>`
    SELECT "homebaseId", "homebaseEmployeeId", "homebaseLocationId", "clockInAt", "clockOutAt", "breakMinutes", "workedMinutes", "approved", "deletedAt"
    FROM "HomebaseTimecard"
    WHERE "organizationId" = ${organizationId} AND "clockInAt" >= ${from} AND "clockInAt" < ${to} AND "deletedAt" IS NULL
    ORDER BY "clockInAt"`;
}

export async function listShifts(organizationId: string, from: Date, to: Date, employeeIds: string[]): Promise<StoredShift[]> {
  if (!employeeIds.length) return [];
  return prisma.$queryRaw<StoredShift[]>`
    SELECT "homebaseId", "homebaseEmployeeId", "homebaseLocationId", "startAt", "endAt", "roleLabel", "deletedAt"
    FROM "HomebaseShift"
    WHERE "organizationId" = ${organizationId} AND "startAt" >= ${from} AND "startAt" < ${to}
      AND "homebaseEmployeeId" = ANY(${employeeIds}::text[])
    ORDER BY "startAt"`;
}

export async function listSyncRuns(organizationId: string, take = 5): Promise<SyncRunRow[]> {
  return prisma.$queryRaw<SyncRunRow[]>`
    SELECT "id", "trigger", "triggeredById", to_char("rangeStart", 'YYYY-MM-DD') AS "rangeStart", to_char("rangeEnd", 'YYYY-MM-DD') AS "rangeEnd",
      "status", "counts", "error", "startedAt", "finishedAt"
    FROM "HomebaseSyncRun" WHERE "organizationId" = ${organizationId} ORDER BY "startedAt" DESC LIMIT ${take}`;
}

export async function cacheCounts(organizationId: string): Promise<{ locations: number; employees: number; shifts: number; timecards: number }> {
  const rows = await prisma.$queryRaw<Array<{ locations: bigint; employees: bigint; shifts: bigint; timecards: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM "HomebaseLocation" WHERE "organizationId" = ${organizationId}) AS "locations",
      (SELECT COUNT(*) FROM "HomebaseEmployee" WHERE "organizationId" = ${organizationId}) AS "employees",
      (SELECT COUNT(*) FROM "HomebaseShift" WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL) AS "shifts",
      (SELECT COUNT(*) FROM "HomebaseTimecard" WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL) AS "timecards"`;
  const r = rows[0];
  return { locations: n(r?.locations), employees: n(r?.employees), shifts: n(r?.shifts), timecards: n(r?.timecards) };
}

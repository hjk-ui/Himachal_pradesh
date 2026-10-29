import { prisma } from '@/lib/db/prisma';

export type PhiAuditInput = {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
};

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StaffPhiAudit" (
      "id" TEXT PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "actorUserId" TEXT NOT NULL,
      "actorRole" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "resourceType" TEXT NOT NULL,
      "resourceId" TEXT,
      "patientId" TEXT,
      "outcome" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "StaffPhiAudit_org_created_idx" ON "StaffPhiAudit" ("organizationId", "createdAt")`
  );
  tableReady = true;
}

export async function recordPhiAudit(input: PhiAuditInput) {
  try {
    await ensureTable();
    const id = `pha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await prisma.$executeRaw`
      INSERT INTO "StaffPhiAudit"
        ("id","organizationId","actorUserId","actorRole","action","resourceType","resourceId","patientId","outcome")
      VALUES (
        ${id},
        ${input.organizationId},
        ${input.actorUserId},
        ${input.actorRole},
        ${input.action},
        ${input.resourceType},
        ${input.resourceId ?? null},
        ${input.patientId ?? null},
        ${input.outcome}
      )
    `;
  } catch (err) {
    console.error('[phi-audit]', err);
  }
}

export type PhiAuditRow = PhiAuditInput & { id: string; createdAt: string };

export async function listPhiAudit(organizationId: string): Promise<PhiAuditRow[]> {
  await ensureTable();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      organizationId: string;
      actorUserId: string;
      actorRole: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      patientId: string | null;
      outcome: string;
      createdAt: Date;
    }>
  >`
    SELECT "id","organizationId","actorUserId","actorRole","action","resourceType","resourceId","patientId","outcome","createdAt"
    FROM "StaffPhiAudit"
    WHERE "organizationId" = ${organizationId}
    ORDER BY "createdAt" DESC
    LIMIT 200
  `;
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    patientId: row.patientId,
    outcome: row.outcome === 'DENIED' || row.outcome === 'FAILURE' ? row.outcome : 'SUCCESS',
    createdAt: row.createdAt.toISOString(),
  }));
}

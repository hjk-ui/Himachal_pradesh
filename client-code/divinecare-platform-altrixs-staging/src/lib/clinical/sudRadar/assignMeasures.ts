/**
 * Writes SUD Referral Radar measure assignments onto the MBC schedule (measure_assignments,
 * source sud_radar; 20261023_measures_to_patients.sql). The database and audit writer are injected
 * so the radar scan (auto-assign) and its tests can use mocks.
 *
 * One open assignment per client and measure: the plan skips measures already open, and the
 * unique activeKey (client:instrument while active) with skipDuplicates means a concurrent assign
 * never opens a measure twice. Every client assignment is audit-logged (SUD_MEASURES_ASSIGNED)
 * with the measure keys only.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clinicDate } from '@/lib/workflows/dates';
import { activeKeyFor } from '@/lib/measures/schedule';
import { planSudMeasureAssignments, SUD_MEASURE_SOURCE, SUD_MEASURES, type AssignmentPlan, type SudMeasureKey } from './measures';

export type MeasureDb = { measureAssignment: Pick<PrismaClient['measureAssignment'], 'findMany' | 'createMany'> };

const instrumentOf = (key: string) => SUD_MEASURES.find((m) => m.key === key)?.instrumentId ?? key.toLowerCase();

/** Open (active) assignments as the plan's "existing" rows: measure = catalog id upper-cased (AUDIT, CAGE-AID, NIDA-ASSIST, BAM) */
async function existingRows(db: MeasureDb, organizationId: string, clientIds: string[]) {
  const rows = await db.measureAssignment.findMany({
    where: { organizationId, clientId: { in: clientIds }, status: 'active' },
    select: { clientId: true, instrumentId: true },
  });
  return rows.map((r) => ({ patientId: r.clientId, measure: r.instrumentId.toUpperCase(), active: true }));
}

export async function assignSudMeasures(opts: {
  organizationId: string;
  actor: { userId: string | null; role: string };
  clients: { id: string; name: string }[];
  measures: SudMeasureKey[];
  trigger: 'manual' | 'auto';
  db?: MeasureDb;
  audit?: typeof writeAuditLog;
  now?: Date;
}): Promise<AssignmentPlan> {
  const db = opts.db ?? prisma;
  const audit = opts.audit ?? writeAuditLog;
  const now = opts.now ?? new Date();
  if (!opts.clients.length || !opts.measures.length) return { add: [], skipped: [] };

  const today = clinicDate(now);
  const plan = planSudMeasureAssignments({
    existing: await existingRows(db, opts.organizationId, [...new Set(opts.clients.map((c) => c.id))]),
    clients: opts.clients,
    measures: opts.measures,
    today,
    actorUserId: opts.actor.userId,
    trigger: opts.trigger,
    nowIso: now.toISOString(),
    idSeed: now.getTime().toString(36),
  });
  if (!plan.add.length) return plan;

  await db.measureAssignment.createMany({
    data: plan.add.map((a) => {
      const instrumentId = a.instrumentId ?? instrumentOf(a.measure);
      return {
        organizationId: opts.organizationId,
        clientId: a.patientId,
        instrumentId,
        schedule: a.frequency === 'once' ? 'once' : 'interval',
        everyDays: a.frequency === 'once' ? null : a.frequency === 'weekly' ? 7 : a.frequency === 'biweekly' ? 14 : 30,
        startDate: new Date(`${today}T00:00:00Z`),
        source: 'sud_radar',
        sourceRef: opts.trigger,
        status: 'active',
        activeKey: activeKeyFor(a.patientId, instrumentId),
        assignedById: opts.actor.userId,
      };
    }),
    skipDuplicates: true,
  });

  const byClient = new Map<string, string[]>();
  for (const a of plan.add) byClient.set(a.patientId, [...(byClient.get(a.patientId) ?? []), a.measure]);
  for (const [clientId, measures] of byClient) {
    await audit({
      action: 'SUD_MEASURES_ASSIGNED',
      actorUserId: opts.actor.userId,
      actorRole: opts.actor.role,
      organizationId: opts.organizationId,
      resourceType: 'measureAssignment',
      resourceId: null,
      patientId: clientId,
      metadata: {
        source: SUD_MEASURE_SOURCE,
        trigger: opts.trigger,
        measures,
        skipped: plan.skipped.filter((s) => s.clientId === clientId).map((s) => s.measure),
      },
    });
  }
  return plan;
}

/** Measures already open (active assignment) per client, for the radar display */
export async function openMeasuresFor(organizationId: string, clientIds: string[], db: MeasureDb = prisma) {
  const out: Record<string, string[]> = {};
  if (!clientIds.length) return out;
  for (const r of await existingRows(db, organizationId, clientIds)) {
    out[r.patientId] = [...new Set([...(out[r.patientId] ?? []), r.measure])];
  }
  return out;
}

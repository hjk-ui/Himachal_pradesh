import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveProvider, type StaffRef } from '@/lib/migration/providers';
import {
  VALANT_PLAN_TITLE,
  buildPlanSource,
  importedPlanGoals,
  latestPlanPerPatient,
  parseValantTreatmentPlanRow,
  planUpsertTarget,
  reimportStatus,
  type ValantTreatmentPlan,
} from '@/lib/migration/valantTreatmentPlans';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);
/** Same tag as the client import: a client re-import replaces these members, then this import can add them back */
const IMPORT_TAG = 'valant-import';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  // Header-keyed rows from the Valant treatment plan grid (Excel or CSV)
  rows: z.array(z.record(z.string().max(60), z.string().max(500))).min(1).max(5000),
});

/**
 * POST /api/migration/treatment-plans — import Valant's treatment plan grid.
 * Patients are matched by Valant Patient ID (Client.sourceId), so clients must be imported first.
 * Each patient gets one imported plan (status, next review, owner); running the import again
 * updates that plan. Plans written in Altrixs are never changed. The grid has no goals, problems or
 * diagnoses, so none are created: the plan says its content is still in Valant.
 * Supervisor and other providers who are staff join the client's treatment team when not on it yet.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import treatment plans' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const errors: { row: number; error: string }[] = [];
    const parsed: ValantTreatmentPlan[] = [];
    let skipped = 0;
    body.rows.forEach((row, i) => {
      const r = parseValantTreatmentPlanRow(row);
      if (r.kind === 'plan') parsed.push(r.plan);
      else if (r.kind === 'error') errors.push({ row: i + 2, error: r.error });
      else skipped += 1;
    });
    const { plans, duplicates } = latestPlanPerPatient(parsed);

    const [clients, staff] = await Promise.all([
      prisma.client.findMany({
        where: {
          organizationId: gate.organizationId,
          sourcePlatform: 'valant',
          sourceId: { in: plans.map((p) => p.sourcePatientId) },
        },
        select: {
          id: true,
          sourceId: true,
          treatmentPlans: { select: { id: true, goals: true, status: true }, orderBy: { createdAt: 'desc' } },
          treatmentTeamMembers: { select: { providerId: true } },
        },
      }),
      prisma.user
        .findMany({
          where: { organizationId: gate.organizationId, status: { not: 'DEACTIVATED' } },
          select: { id: true, name: true, role: true },
        })
        .then((users): StaffRef[] => users.map((u) => ({ ...u, role: String(u.role) }))),
    ]);
    const bySource = new Map(clients.map((c) => [String(c.sourceId).toUpperCase(), c]));

    const importedAt = new Date();
    let created = 0;
    let updated = 0;
    let teamMembersAdded = 0;
    let ownersLinked = 0;
    const notFound: string[] = [];
    // Provider names (staff, not PHI) with how many plans could not link them
    const unlinkedOwners: Record<string, number> = {};
    const unlinkedProviders: Record<string, number> = {};
    const preview: Record<string, unknown>[] = [];
    const touchedClientIds: string[] = [];

    for (const p of plans) {
      const client = bySource.get(p.sourcePatientId);
      if (!client) {
        notFound.push(p.sourcePatientId);
        continue;
      }

      const owner = p.owner ? resolveProvider(p.owner, staff) : null;
      if (owner?.staff) ownersLinked += 1;
      else if (owner) unlinkedOwners[owner.name] = (unlinkedOwners[owner.name] || 0) + 1;

      const onTeam = new Set(client.treatmentTeamMembers.map((m) => m.providerId).filter(Boolean));
      const newMembers: Prisma.ClientTreatmentTeamMemberCreateManyInput[] = [];
      for (const raw of [p.supervisor, ...p.otherProviders]) {
        if (!raw) continue;
        const r = resolveProvider(raw, staff);
        if (!r.staff) {
          unlinkedProviders[r.name] = (unlinkedProviders[r.name] || 0) + 1;
          continue;
        }
        if (onTeam.has(r.staff.id)) continue;
        onTeam.add(r.staff.id);
        const name = r.staff.name || r.name;
        newMembers.push({
          clientId: client.id,
          providerId: r.staff.id,
          name,
          role: raw === p.supervisor ? 'Clinical Supervisor' : r.role,
          credentials: r.credentials || null,
          isPrimary: false,
          initials: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
          assignedBy: IMPORT_TAG,
        });
      }

      const target = planUpsertTarget(client.treatmentPlans);
      if (preview.length < 10) {
        preview.push({
          action: target.action,
          status: p.status,
          nextReview: p.reviewDueAt?.toISOString().slice(0, 10) ?? null,
          ownerLinked: Boolean(owner?.staff),
          teamMembersToAdd: newMembers.length,
        });
      }

      if (!body.dryRun) {
        const source = buildPlanSource(p, importedAt);
        const prior = target.action === 'update' ? client.treatmentPlans.find((t) => t.id === target.planId) : undefined;
        const fields = {
          title: VALANT_PLAN_TITLE,
          // A Valant plan already replaced by a plan written in Altrixs stays closed
          status: reimportStatus(prior?.status, p.status),
          reviewDueAt: p.reviewDueAt,
          clinicianId: owner?.staff?.id ?? null,
        };
        try {
          await prisma.$transaction(async (tx) => {
            if (target.action === 'update') {
              await tx.treatmentPlan.update({
                where: { id: target.planId },
                data: { ...fields, goals: importedPlanGoals(prior?.goals, source) as Prisma.InputJsonValue },
              });
            } else {
              await tx.treatmentPlan.create({
                data: {
                  organizationId: gate.organizationId,
                  clientId: client.id,
                  diagnosisCodes: [],
                  ...fields,
                  goals: importedPlanGoals(null, source) as Prisma.InputJsonValue,
                },
              });
            }
            if (newMembers.length) await tx.clientTreatmentTeamMember.createMany({ data: newMembers });
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() || 'Write failed' : 'Write failed';
          errors.push({ row: 0, error: `Patient ${p.sourcePatientId}: ${msg}` });
          continue;
        }
      }
      if (target.action === 'update') updated += 1;
      else created += 1;
      teamMembersAdded += newMembers.length;
      touchedClientIds.push(client.id);
    }

    for (const id of notFound) errors.push({ row: 0, error: `Patient ${id} not found — import Valant clients first` });

    const written = created + updated;
    const summary = {
      totalRows: body.rows.length,
      plans: plans.length,
      duplicateRows: duplicates,
      skippedRows: skipped,
      active: plans.filter((p) => p.status === 'ACTIVE').length,
      draft: plans.filter((p) => p.status === 'DRAFT').length,
      noNextReview: plans.filter((p) => !p.reviewDueAt).length,
      ...(body.dryRun
        ? { wouldCreate: created, wouldUpdate: updated, wouldAddTeamMembers: teamMembersAdded, created: 0, updated: 0, teamMembersAdded: 0 }
        : { created, updated, teamMembersAdded }),
      ownersLinked,
      ownersNotLinked: Object.values(unlinkedOwners).reduce((a, b) => a + b, 0),
      patientsNotFound: notFound.length,
      errorRows: errors.length,
    };
    const auditCounts = { ...summary, unlinkedOwnerCount: Object.keys(unlinkedOwners).length, unlinkedProviderCount: Object.keys(unlinkedProviders).length };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'treatment_plans', platform: body.platform, dryRun: true, ...auditCounts, clientIds: touchedClientIds.slice(0, 50) },
      });
      return NextResponse.json({
        success: true, dryRun: true, ...summary, unlinkedOwners, unlinkedProviders,
        preview, errors: errors.slice(0, 50), jobId: null,
      });
    }

    const status = errors.length === 0 ? 'success' : written > 0 ? 'partial' : 'failed';
    const job = await prisma.migrationJob.create({
      data: {
        organizationId: gate.organizationId,
        type: 'treatment_plans',
        platform: 'valant',
        total: plans.length,
        imported: written,
        errors: errors.length,
        status,
        createdById: gate.userId,
        errorJson: errors.length ? (errors.slice(0, 100) as Prisma.InputJsonValue[]) : undefined,
      },
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'treatment_plans', platform: body.platform, dryRun: false, jobId: job.id, status, ...auditCounts, clientIds: touchedClientIds.slice(0, 50) },
    });

    return NextResponse.json({
      success: true, dryRun: false, ...summary, unlinkedOwners, unlinkedProviders,
      preview, errors: errors.slice(0, 50), jobId: job.id, status,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/treatment-plans POST]', err);
    return NextResponse.json({ success: false, error: 'Treatment plan import failed' }, { status: 500 });
  }
}

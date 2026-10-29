import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferenceJob, handleImportError, requireImportGate } from '@/lib/migration/referenceImport';
import { parseValantLabTypes, planLabCatalogImport, VALANT_LAB_TYPES_HEADER } from '@/lib/labs/catalogImport';
import { applyLabCatalogImport, loadOrgLabTestRows } from '@/lib/labs/catalogDb';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  records: z.array(z.array(z.string().max(500)).max(20)).min(2).max(2000),
});

/**
 * POST /api/migration/lab-request-types — Valant "Lab request types" grid export (Name,
 * Is Lab Panel?, LOINC Code, Status). Dry run reports the mapping onto the Altrixs catalog
 * (same test / alias / new), merged duplicates and anything needing review; the import upserts
 * per-org LabTest rows by key. Re-importing the same file changes nothing (idempotent).
 * Reference data, no patient data; audited with counts and keys only.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('lab request types');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseValantLabTypes(body.records);
    if (!parsed.headerOk) {
      return NextResponse.json(
        { success: false, error: `This is not the Valant lab request types export (expected header ${VALANT_LAB_TYPES_HEADER.join(', ')}).` },
        { status: 400 }
      );
    }
    const orgId = gate.organizationId;
    const existing = await loadOrgLabTestRows(orgId);
    const plan = planLabCatalogImport(parsed.rows, existing);
    const report = {
      rows: parsed.rows.length,
      errors: parsed.errors,
      orderables: plan.create.length + plan.update.length + plan.unchanged.length,
      newCount: plan.create.length,
      changedCount: plan.update.length,
      unchangedCount: plan.unchanged.length,
      mapping: plan.mapping,
      duplicatesMerged: plan.duplicatesMerged,
      review: plan.review,
      changed: plan.update.map((u) => ({ key: u.key, fields: u.changed })),
    };
    const auditCounts = {
      rows: report.rows, orderables: report.orderables, newCount: report.newCount, changedCount: report.changedCount,
      unchangedCount: report.unchangedCount, merged: plan.duplicatesMerged.length, review: plan.review.length, errorRows: parsed.errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'labCatalog', metadata: { importType: 'valant_lab_request_types', dryRun: true, ...auditCounts } });
      return NextResponse.json({ success: true, dryRun: true, ...report, jobId: null });
    }

    const result = await prisma.$transaction(async (tx) => {
      const applied = await applyLabCatalogImport(orgId, plan, tx);
      const { job, status } = await createReferenceJob(gate, 'valant_lab_request_types', parsed.rows.length + parsed.errors.length, parsed.rows.length, parsed.errors, tx);
      return { ...applied, job, status };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'labCatalog', resourceId: result.job.id,
      outcome: result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: {
        importType: 'valant_lab_request_types', dryRun: false, jobId: result.job.id, ...auditCounts,
        createdKeys: plan.create.map((c) => c.key), updatedKeys: plan.update.map((u) => u.key),
      },
    });
    return NextResponse.json({ success: true, dryRun: false, ...report, created: result.created, updated: result.updated, jobId: result.job.id, status: result.status });
  } catch (err) {
    return handleImportError(err, 'migration/lab-request-types POST', 'Lab request types import failed');
  }
}

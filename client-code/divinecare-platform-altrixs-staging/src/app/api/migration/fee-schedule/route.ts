import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferenceJob, handleImportError, requireImportGate } from '@/lib/migration/referenceImport';
import { parseFeeScheduleRecords, planFeeImport, summarizeFees } from '@/lib/billing/feeSchedule';
import { loadFeeSchedule } from '@/lib/billing/feeScheduleDb';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  /** Replace rows staff edited in Altrixs with the Valant values */
  overwriteEdits: z.boolean().optional().default(false),
  records: z.array(z.array(z.string().max(500)).max(20)).min(2).max(5000),
});

/**
 * POST /api/migration/fee-schedule — Valant "Fees" export (header PatientName1, ServiceDate11,
 * textBox1, textBox2 = description, fee, Valant code, billed code). Dry run reports
 * new / changed / unchanged / kept edits and the anomalies; the import upserts by code.
 * Re-importing updates Valant-sourced rows only, unless overwriteEdits. Active state is kept.
 * Not PHI; audited with counts and codes only.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('the fee schedule');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseFeeScheduleRecords(body.records);
    if (!parsed.headerOk) {
      return NextResponse.json(
        { success: false, error: 'This is not the Valant Fees export (expected header PatientName1, ServiceDate11, textBox1, textBox2).' },
        { status: 400 }
      );
    }
    const orgId = gate.organizationId;
    const existing = await loadFeeSchedule(orgId);
    const plan = planFeeImport(existing, parsed.items, { overwriteEdits: body.overwriteEdits });
    const summary = summarizeFees(parsed.items);
    const report = {
      ...summary,
      rows: body.records.length - 1,
      errors: parsed.errors,
      newCount: plan.create.length,
      changedCount: plan.update.length,
      unchangedCount: plan.unchanged.length,
      keptEditsCount: plan.keptEdits.length,
      overwrittenEditsCount: plan.update.filter((u) => u.overwritesEdit).length,
      notInFileCount: plan.notInFile.length,
      newCodes: plan.create.map((c) => c.code),
      changed: plan.update.map((u) => ({ code: u.code, fields: u.changed, overwritesEdit: u.overwritesEdit })),
      keptEdits: plan.keptEdits,
      notInFile: plan.notInFile,
    };
    const auditCounts = {
      rows: report.rows, items: summary.items, newCount: report.newCount, changedCount: report.changedCount,
      unchangedCount: report.unchangedCount, keptEditsCount: report.keptEditsCount, needsReview: summary.needsReview.length,
      errorRows: parsed.errors.length, overwriteEdits: body.overwriteEdits,
    };

    if (body.dryRun) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'feeSchedule', metadata: { importType: 'valant_fee_schedule', dryRun: true, ...auditCounts } });
      return NextResponse.json({ success: true, dryRun: true, ...report, jobId: null });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      if (plan.create.length) {
        await tx.feeScheduleItem.createMany({
          data: plan.create.map((f) => ({ ...f, organizationId: orgId, source: 'valant', active: true, importedAt: now })),
          skipDuplicates: true,
        });
      }
      for (const u of plan.update) {
        await tx.feeScheduleItem.update({
          where: { id: u.id },
          data: { ...u.data, source: 'valant', importedAt: now, ...(u.overwritesEdit ? { editedById: null, editedAt: null } : {}) },
        });
      }
      const imported = plan.create.length + plan.update.length;
      const { job, status } = await createReferenceJob(gate, 'valant_fee_schedule', parsed.items.length + parsed.errors.length, imported, parsed.errors, tx);
      return { job, status, imported };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'feeSchedule', resourceId: result.job.id,
      outcome: result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: {
        importType: 'valant_fee_schedule', dryRun: false, jobId: result.job.id, ...auditCounts,
        createdCodes: report.newCodes.slice(0, 200), updatedCodes: report.changed.map((c) => c.code).slice(0, 200),
      },
    });
    return NextResponse.json({ success: true, dryRun: false, ...report, imported: result.imported, jobId: result.job.id, status: result.status });
  } catch (err) {
    return handleImportError(err, 'migration/fee-schedule POST', 'Fee schedule import failed');
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { INSURANCE_AGING_LAYOUT, parseAgingReport } from '@/lib/migration/valantAging';
import { isoDate } from '@/lib/migration/valantReportCommon';
import {
  badRequest,
  createReferenceJob,
  handleImportError,
  referenceBodySchema,
  requireImportGate,
} from '@/lib/migration/referenceImport';

export const runtime = 'nodejs';

/**
 * POST /api/migration/insurance-aging — import the Valant "Insurance Aging Summary" (payer A/R).
 * REFERENCE ONLY: one row per payer line as Valant printed it (names can repeat for different plans).
 * No patient data. Re-importing the same as-of replaces that snapshot.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('insurance aging');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = referenceBodySchema.parse(await req.json());
    const parsed = parseAgingReport(body.records, INSURANCE_AGING_LAYOUT);
    if (!parsed.ok || !parsed.asOf) return badRequest(parsed.error ?? 'Could not read the insurance aging report');
    const asOf = parsed.asOf;

    const [existingForAsOf, newest] = await Promise.all([
      prisma.valantInsuranceAgingSnapshot.count({ where: { organizationId: gate.organizationId, asOf } }),
      prisma.valantInsuranceAgingSnapshot.findFirst({
        where: { organizationId: gate.organizationId },
        orderBy: { asOf: 'desc' },
        select: { asOf: true },
      }),
    ]);
    const summary = {
      asOf: isoDate(asOf),
      rows: parsed.rows.length,
      distinctPayers: new Set(parsed.rows.map((r) => r.key)).size,
      errorRows: parsed.errors.length,
      rowsWithBucketMismatch: parsed.rowsWithBucketMismatch,
      reconciles: parsed.reconcile.all,
      reconcile: parsed.reconcile,
      columnSumsCents: parsed.columnSumsCents,
      totalSumCents: parsed.totalSumCents,
      reportBucketsCents: parsed.reportBucketsCents,
      reportTotalCents: parsed.reportTotalCents,
      replacesExistingSnapshot: existingForAsOf,
      becomesCurrent: !newest || newest.asOf <= asOf,
    };
    const auditCounts = {
      asOf: summary.asOf, rows: summary.rows, distinctPayers: summary.distinctPayers,
      errorRows: summary.errorRows, reconciles: summary.reconciles,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_insurance_aging', dryRun: true, ...auditCounts },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, errors: parsed.errors.slice(0, 50), jobId: null });
    }

    const { job, status, imp } = await prisma.$transaction(async (tx) => {
      const { job, status } = await createReferenceJob(gate, 'valant_insurance_aging', parsed.rows.length, parsed.rows.length, parsed.errors, tx);
      const imp = await tx.valantReferenceImport.create({
        data: {
          organizationId: gate.organizationId,
          reportType: 'insurance_aging',
          asOf,
          rowCount: parsed.rows.length,
          matched: 0,
          unmatched: 0,
          reconciles: parsed.reconcile.all,
          totalsJson: {
            reportBucketsCents: parsed.reportBucketsCents,
            reportTotalCents: parsed.reportTotalCents,
            columnSumsCents: parsed.columnSumsCents,
            totalSumCents: parsed.totalSumCents,
            rowsWithBucketMismatch: parsed.rowsWithBucketMismatch,
          },
          migrationJobId: job.id,
          importedById: gate.userId,
        },
      });
      await tx.valantInsuranceAgingSnapshot.deleteMany({ where: { organizationId: gate.organizationId, asOf } });
      await tx.valantInsuranceAgingSnapshot.createMany({
        data: parsed.rows.map((r, i) => ({
          organizationId: gate.organizationId,
          asOf,
          rowIndex: i,
          payerName: r.key,
          bucket1Cents: r.bucketsCents[0],
          bucket2Cents: r.bucketsCents[1],
          bucket3Cents: r.bucketsCents[2],
          bucket4Cents: r.bucketsCents[3],
          bucket5Cents: r.bucketsCents[4],
          totalCents: r.totalCents,
          bucketsMatchTotal: r.bucketsMatchTotal,
          importId: imp.id,
        })),
      });
      return { job, status, imp };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_insurance_aging', dryRun: false, jobId: job.id, importId: imp.id, status, ...auditCounts },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, errors: parsed.errors.slice(0, 50), jobId: job.id, importId: imp.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/insurance-aging POST', 'Insurance aging import failed');
  }
}

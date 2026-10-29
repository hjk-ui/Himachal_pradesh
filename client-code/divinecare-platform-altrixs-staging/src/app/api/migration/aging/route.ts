import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { parseAgingReport, PATIENT_AGING_LAYOUT } from '@/lib/migration/valantAging';
import { isoDate } from '@/lib/migration/valantReportCommon';
import {
  badRequest,
  createReferenceJob,
  handleImportError,
  referenceBodySchema,
  requireImportGate,
  valantClientsById,
} from '@/lib/migration/referenceImport';

export const runtime = 'nodejs';

/**
 * POST /api/migration/aging — import the Valant "Patient Aging Summary" export.
 * REFERENCE ONLY: stores a snapshot per patient per as-of date; nothing posts to the ledger.
 * Patients are matched by Valant ID (Client.sourceId). Unmatched rows are kept without a client so
 * the column totals still equal the report. Re-importing the same as-of replaces that snapshot.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('aging balances');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = referenceBodySchema.parse(await req.json());
    const parsed = parseAgingReport(body.records, PATIENT_AGING_LAYOUT);
    if (!parsed.ok || !parsed.asOf) return badRequest(parsed.error ?? 'Could not read the aging report');
    const asOf = parsed.asOf;

    const byId = await valantClientsById(gate.organizationId, parsed.rows.map((r) => r.key));
    const unmatchedIds = parsed.rows.filter((r) => !byId.has(r.key)).map((r) => r.key);
    const clientIds = parsed.rows.map((r) => byId.get(r.key)).filter((v): v is string => Boolean(v));

    const [existingForAsOf, newest] = await Promise.all([
      prisma.valantAgingSnapshot.count({ where: { organizationId: gate.organizationId, asOf } }),
      prisma.valantAgingSnapshot.findFirst({
        where: { organizationId: gate.organizationId },
        orderBy: { asOf: 'desc' },
        select: { asOf: true },
      }),
    ]);

    const summary = {
      asOf: isoDate(asOf),
      rows: parsed.rows.length,
      matched: clientIds.length,
      unmatched: unmatchedIds.length,
      errorRows: parsed.errors.length,
      rowsWithBucketMismatch: parsed.rowsWithBucketMismatch,
      bucketMismatchLines: parsed.rows.filter((r) => !r.bucketsMatchTotal).map((r) => r.line).slice(0, 20),
      reconciles: parsed.reconcile.all,
      reconcile: parsed.reconcile,
      columnSumsCents: parsed.columnSumsCents,
      totalSumCents: parsed.totalSumCents,
      reportBucketsCents: parsed.reportBucketsCents,
      reportTotalCents: parsed.reportTotalCents,
      replacesExistingSnapshot: existingForAsOf,
      becomesCurrent: !newest || newest.asOf <= asOf,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_aging', dryRun: true, ...countsOnly(summary), clientIds: clientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: null });
    }

    const { job, status, imp } = await prisma.$transaction(async (tx) => {
      const { job, status } = await createReferenceJob(gate, 'valant_aging', parsed.rows.length, parsed.rows.length, parsed.errors, tx);
      const imp = await tx.valantReferenceImport.create({
        data: {
          organizationId: gate.organizationId,
          reportType: 'patient_aging',
          asOf,
          rowCount: parsed.rows.length,
          matched: clientIds.length,
          unmatched: unmatchedIds.length,
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
      await tx.valantAgingSnapshot.deleteMany({ where: { organizationId: gate.organizationId, asOf } });
      await tx.valantAgingSnapshot.createMany({
        data: parsed.rows.map((r) => ({
          organizationId: gate.organizationId,
          clientId: byId.get(r.key) ?? null,
          valantPatientId: r.key,
          asOf,
          bucket1Cents: r.bucketsCents[0],
          bucket2Cents: r.bucketsCents[1],
          bucket3Cents: r.bucketsCents[2],
          bucket4Cents: r.bucketsCents[3],
          bucket5Cents: r.bucketsCents[4],
          totalCents: r.totalCents,
          bucketsMatchTotal: r.bucketsMatchTotal,
          importId: imp.id,
          jobId: job.id,
        })),
      });
      return { job, status, imp };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_aging', dryRun: false, jobId: job.id, importId: imp.id, status, ...countsOnly(summary), clientIds: clientIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: job.id, importId: imp.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/aging POST', 'Aging import failed');
  }
}

function countsOnly(s: { asOf: string | null; rows: number; matched: number; unmatched: number; errorRows: number; rowsWithBucketMismatch: number; reconciles: boolean }) {
  return {
    asOf: s.asOf, rows: s.rows, matched: s.matched, unmatched: s.unmatched,
    errorRows: s.errorRows, rowsWithBucketMismatch: s.rowsWithBucketMismatch, reconciles: s.reconciles,
  };
}

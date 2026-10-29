import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { parseCombinedAgingReport } from '@/lib/migration/valantCombinedAging';
import { isoDate } from '@/lib/migration/valantReportCommon';
import {
  badRequest,
  createReferenceJob,
  handleImportError,
  referenceBody,
  requireImportGate,
  valantClientsById,
} from '@/lib/migration/referenceImport';

export const runtime = 'nodejs';

// The export repeats an 8-column responsible-party block ~226 times (1,836 columns)
const bodySchema = referenceBody(4000, 5000);

/**
 * POST /api/migration/combined-aging — import the Valant "Combined Aging" export.
 * REFERENCE ONLY: one row per responsible-party line (patient / primary / secondary payer) per patient
 * per as-of date. Patients are matched by Valant ID; unmatched lines are kept without a client so the
 * totals still equal the report. Phone and address columns are never read or stored.
 * Re-importing the same as-of replaces that snapshot.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('combined aging');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseCombinedAgingReport(body.records);
    if (!parsed.ok || !parsed.asOf) return badRequest(parsed.error ?? 'Could not read the combined aging report');
    const asOf = parsed.asOf;
    const orgId = gate.organizationId;

    const byId = await valantClientsById(orgId, parsed.patients.map((p) => p.valantPatientId));
    const unmatchedIds = parsed.patients.filter((p) => !byId.has(p.valantPatientId)).map((p) => p.valantPatientId);
    const clientIds = parsed.patients.map((p) => byId.get(p.valantPatientId)).filter((v): v is string => Boolean(v));
    const [existingForAsOf, newest] = await Promise.all([
      prisma.valantCombinedAgingRow.count({ where: { organizationId: orgId, asOf } }),
      prisma.valantCombinedAgingRow.findFirst({ where: { organizationId: orgId }, orderBy: { asOf: 'desc' }, select: { asOf: true } }),
    ]);

    const summary = {
      asOf: isoDate(asOf),
      csvRows: body.records.length - 1,
      blocks: parsed.blocks,
      partyRows: parsed.partyRows.length,
      patients: parsed.patients.length,
      partyCounts: parsed.partyCounts,
      matched: clientIds.length,
      unmatched: unmatchedIds.length,
      errorRows: parsed.errors.length,
      partyRowsWithBucketMismatch: parsed.partyRowsWithBucketMismatch,
      patientsWithPartyMismatch: parsed.patientsWithPartyMismatch,
      patientsInconsistent: parsed.patientsInconsistent,
      reconciles: parsed.reconcile.all,
      reconcile: parsed.reconcile,
      patientBucketSumsCents: parsed.patientBucketSumsCents,
      patientTotalSumCents: parsed.patientTotalSumCents,
      partyTotalSumCents: parsed.partyTotalSumCents,
      reportBucketsCents: parsed.reportBucketsCents,
      reportGrandTotalCents: parsed.reportGrandTotalCents,
      replacesExistingRows: existingForAsOf,
      becomesCurrent: !newest || newest.asOf <= asOf,
    };
    const auditCounts = {
      asOf: summary.asOf, partyRows: summary.partyRows, patients: summary.patients, matched: summary.matched,
      unmatched: summary.unmatched, errorRows: summary.errorRows, reconciles: summary.reconciles,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_combined_aging', dryRun: true, ...auditCounts, clientIds: clientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: null });
    }

    const rowIndexByPatient = new Map<string, number>();
    const { job, status, imp } = await prisma.$transaction(async (tx) => {
      const { job, status } = await createReferenceJob(gate, 'valant_combined_aging', parsed.partyRows.length, parsed.partyRows.length, parsed.errors, tx);
      const imp = await tx.valantReferenceImport.create({
        data: {
          organizationId: orgId,
          reportType: 'combined_aging',
          asOf,
          rowCount: parsed.partyRows.length,
          matched: clientIds.length,
          unmatched: unmatchedIds.length,
          reconciles: parsed.reconcile.all,
          totalsJson: {
            reportBucketsCents: parsed.reportBucketsCents,
            reportGrandTotalCents: parsed.reportGrandTotalCents,
            patientBucketSumsCents: parsed.patientBucketSumsCents,
            patientTotalSumCents: parsed.patientTotalSumCents,
            partyTotalSumCents: parsed.partyTotalSumCents,
            patients: parsed.patients.length,
          },
          migrationJobId: job.id,
          importedById: gate.userId,
        },
      });
      await tx.valantCombinedAgingRow.deleteMany({ where: { organizationId: orgId, asOf } });
      await tx.valantCombinedAgingRow.createMany({
        data: parsed.partyRows.map((r) => {
          const rowIndex = rowIndexByPatient.get(r.valantPatientId) ?? 0;
          rowIndexByPatient.set(r.valantPatientId, rowIndex + 1);
          return {
            organizationId: orgId,
            clientId: byId.get(r.valantPatientId) ?? null,
            valantPatientId: r.valantPatientId,
            asOf,
            rowIndex,
            party: r.party,
            payerName: r.payerName,
            lastBilledAt: r.lastBilledAt,
            bucket1Cents: r.bucketsCents[0],
            bucket2Cents: r.bucketsCents[1],
            bucket3Cents: r.bucketsCents[2],
            bucket4Cents: r.bucketsCents[3],
            bucket5Cents: r.bucketsCents[4],
            totalCents: r.totalCents,
            bucketsMatchTotal: r.bucketsMatchTotal,
            importId: imp.id,
          };
        }),
      });
      return { job, status, imp };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_combined_aging', dryRun: false, jobId: job.id, importId: imp.id, status, ...auditCounts, clientIds: clientIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: job.id, importId: imp.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/combined-aging POST', 'Combined aging import failed');
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferenceJob, handleImportError } from '@/lib/migration/referenceImport';
import { groupValantPayers, parseValantPayerRecords, planValantPayerImport, summarizeValantPayers, VALANT_PAYER_HEADER } from '@/lib/billing/valantPayers';
import { applyValantPayerPlan, canEditValantPayers, loadExistingValantPayers } from '@/lib/billing/valantPayersDb';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  records: z.array(z.array(z.string().max(2000)).max(20)).min(2).max(5000),
});

/**
 * POST /api/migration/valant-payers — Valant "Insurance Companies" grid export (Name, Address,
 * Tax IDs, Phone, EDI Payor Id, Active). Rows are grouped by normalized name + EDI payer ID, each
 * payer keeping every distinct address. Dry run reports new / changed / unchanged; the import
 * upserts by that key, so running it again changes nothing. Staff links (registry, confirmed
 * client payer names) are never touched, payers missing from a later file are kept, and nothing
 * is written to the Waystar payer mapping. Leadership + billing. No PHI; audited with counts.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditValantPayers(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can import insurance companies' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseValantPayerRecords(body.records);
    if (!parsed.headerOk) {
      return NextResponse.json(
        { success: false, error: `This is not the Valant insurance companies export (expected header ${VALANT_PAYER_HEADER.join(', ')}).` },
        { status: 400 }
      );
    }
    const orgId = gate.organizationId;
    const payers = groupValantPayers(parsed.rows);
    const plan = planValantPayerImport(await loadExistingValantPayers(orgId), payers);
    const summary = summarizeValantPayers(parsed, payers);
    const report = {
      ...summary,
      errors: parsed.errors,
      newCount: plan.create.length,
      changedCount: plan.update.length,
      unchangedCount: plan.unchanged.length,
      notInFileCount: plan.notInFile.length,
      merged: payers
        .filter((p) => p.sourceRowCount > 1)
        .map((p) => ({ name: p.name, ediPayerId: p.ediPayerId, rows: p.sourceRowCount, addresses: p.addresses.length })),
      duplicateGroups: Object.values(
        payers.reduce<Record<string, { name: string; ediPayerId: string }[]>>((acc, p) => {
          if (p.duplicateGroup) (acc[p.duplicateGroup] ??= []).push({ name: p.name, ediPayerId: p.ediPayerId });
          return acc;
        }, {})
      ),
      flagged: payers.flatMap((p) =>
        p.addresses
          .filter((a) => a.addressStatus === 'suspect' || a.addressStatus === 'unparsed' || a.phoneIssues.length)
          .map((a) => ({ name: p.name, lines: a.sourceLines, issues: [...a.addressIssues, ...a.phoneIssues] }))
      ),
    };
    const auditCounts = {
      rows: summary.rows, payers: summary.payers, withEdiId: summary.withEdiId, newCount: report.newCount,
      changedCount: report.changedCount, unchangedCount: report.unchangedCount, notInFileCount: report.notInFileCount,
      errorRows: parsed.errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'valantPayer', metadata: { importType: 'valant_payers', dryRun: true, ...auditCounts } });
      return NextResponse.json({ success: true, dryRun: true, ...report, jobId: null });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const { job, status } = await createReferenceJob(
          gate,
          'valant_payers',
          parsed.rows.length + parsed.errors.length,
          plan.create.length + plan.update.length + plan.unchanged.length,
          parsed.errors,
          tx
        );
        const imported = await applyValantPayerPlan(tx, orgId, plan, job.id);
        return { job, status, imported };
      },
      { timeout: 60_000 }
    );

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'valantPayer', resourceId: result.job.id,
      outcome: result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_payers', dryRun: false, jobId: result.job.id, ...auditCounts, written: result.imported },
    });
    return NextResponse.json({ success: true, dryRun: false, ...report, imported: result.imported, jobId: result.job.id, status: result.status });
  } catch (err) {
    return handleImportError(err, 'migration/valant-payers POST', 'Insurance company import failed');
  }
}

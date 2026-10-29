import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  checkPatientSubtotals,
  isTransactionHeader,
  matchProviderCode,
  parseTransactionRow,
  type ValantTxnRow,
} from '@/lib/migration/valantTransactions';
import { transactionRowHash } from '@/lib/migration/valantTransactionsHash';
import { reportMoneyToCents } from '@/lib/migration/valantReportCommon';
import { handleImportError, requireImportGate, valantClientsById } from '@/lib/migration/referenceImport';
import { isJournalHeader } from '@/lib/migration/valantTransactionJournal';
import { importJournalChunk } from '@/lib/migration/valantJournalImport';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  header: z.array(z.string().max(200)).max(80),
  rows: z.array(z.array(z.string().max(2000)).max(80)).min(1).max(5000),
  /** occurrence of each row among identical rows in the whole file (computed by the browser) */
  occurrences: z.array(z.number().int().min(1).max(100000)),
  rowOffset: z.number().int().min(0).default(0),
  jobId: z.string().min(1).max(64).optional(),
  importId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/migration/transactions — import one chunk of the Valant "Transactions" report.
 * REFERENCE ONLY: rows are stored for lookup; nothing posts to the Altrixs ledger. The browser sends
 * chunks that never split a patient, so each chunk cross-checks its patients' printed subtotals.
 * Each row is identified by a hash of its content plus its occurrence in the file, so importing the
 * same file again skips rows already stored. Patients are matched by Valant ID (ChartNumber).
 * The "Transaction Journal" export (detected by its header) is merged instead: see valantJournalImport.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('transactions');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const journal = isJournalHeader(body.header);
    if (!journal && !isTransactionHeader(body.header)) {
      return NextResponse.json({ success: false, error: 'This is not the Valant Transactions or Transaction Journal export (the header row does not match).' }, { status: 400 });
    }
    if (body.occurrences.length !== body.rows.length) {
      return NextResponse.json({ success: false, error: 'Row and occurrence counts differ' }, { status: 400 });
    }
    // Transaction Journal: merged into the stored rows (enrich matches, insert the rest)
    if (journal) return await importJournalChunk(gate, req, body);
    const orgId = gate.organizationId;
    const errors: { line: number; error: string }[] = [];
    const parsed: { row: ValantTxnRow; occurrence: number }[] = [];
    body.rows.forEach((cells, i) => {
      if (!cells.some((c) => c.trim())) return;
      const r = parseTransactionRow(cells);
      if (r.row) parsed.push({ row: r.row, occurrence: body.occurrences[i] });
      else errors.push({ line: body.rowOffset + i + 2, error: r.error ?? 'Unreadable row' });
    });
    const reportLabel = body.rows[0]?.[0]?.trim() || null;
    const reportTotalCents = reportMoneyToCents(body.rows[0]?.[7] ?? '');

    const byId = await valantClientsById(orgId, parsed.map((p) => p.row.valantPatientId));
    const staff = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
    const providerIds = new Map<string, string | null>();
    for (const p of parsed) {
      const code = p.row.providerCode ?? '';
      if (!providerIds.has(code)) providerIds.set(code, matchProviderCode(code, staff));
    }
    const subtotals = checkPatientSubtotals(parsed.map((p) => p.row));
    const patientIds = [...new Set(parsed.map((p) => p.row.valantPatientId))];
    const unmatchedIds = patientIds.filter((id) => !byId.has(id));
    const byCategory: Record<string, { rows: number; cents: number }> = {};
    let sumCents = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const { row } of parsed) {
      sumCents += row.amountCents;
      const c = (byCategory[row.category] ??= { rows: 0, cents: 0 });
      c.rows += 1;
      c.cents += row.amountCents;
      const d = row.serviceDate?.toISOString().slice(0, 10) ?? null;
      if (d && (!minDate || d < minDate)) minDate = d;
      if (d && (!maxDate || d > maxDate)) maxDate = d;
    }
    const data = parsed.map(({ row, occurrence }) => ({
      organizationId: orgId,
      clientId: byId.get(row.valantPatientId) ?? null,
      valantPatientId: row.valantPatientId,
      billingId: row.billingId,
      serviceDate: row.serviceDate,
      providerCode: row.providerCode,
      providerUserId: providerIds.get(row.providerCode ?? '') ?? null,
      pos: row.pos,
      diagnosis: row.diagnosis,
      code: row.code,
      codeBase: row.codeBase,
      codeSuffix: row.codeSuffix,
      category: row.category,
      amountCents: row.amountCents,
      note: row.note,
      reportLabel,
      sourceLayout: 'transactions',
      rowHash: transactionRowHash(row, occurrence),
    }));
    const existing = await prisma.valantTransaction.count({ where: { organizationId: orgId, rowHash: { in: data.map((d) => d.rowHash) } } });

    const summary = {
      rows: body.rows.length,
      parsed: parsed.length,
      patients: patientIds.length,
      matchedPatients: patientIds.length - unmatchedIds.length,
      unmatchedPatients: unmatchedIds.length,
      matchedRows: data.filter((d) => d.clientId).length,
      providerCodesLinked: [...providerIds.values()].filter(Boolean).length,
      providerCodes: providerIds.size,
      alreadyImported: existing,
      sumCents,
      reportTotalCents,
      reportLabel,
      minServiceDate: minDate,
      maxServiceDate: maxDate,
      subtotalPatients: subtotals.patients,
      subtotalMismatches: subtotals.mismatched.length,
      subtotalInconsistent: subtotals.inconsistent.length,
      byCategory,
      errorRows: errors.length,
    };
    const auditCounts = {
      rows: summary.rows, patients: summary.patients, matchedPatients: summary.matchedPatients,
      unmatchedPatients: summary.unmatchedPatients, alreadyImported: existing, errorRows: errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_transactions', dryRun: true, rowOffset: body.rowOffset, ...auditCounts, clientIds: [...new Set(data.map((d) => d.clientId).filter(Boolean))].slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, wouldInsert: data.length - existing, unmatchedIds, subtotalMismatchIds: subtotals.mismatched.slice(0, 50), errors: errors.slice(0, 50), jobId: null });
    }

    const result = await prisma.$transaction(async (tx) => {
      const prior = body.jobId
        ? await tx.migrationJob.findFirst({ where: { id: body.jobId, organizationId: orgId, type: 'valant_transactions' } })
        : null;
      const imp =
        (body.importId
          ? await tx.valantReferenceImport.findFirst({ where: { id: body.importId, organizationId: orgId, reportType: 'transactions' } })
          : null) ??
        (await tx.valantReferenceImport.create({
          data: { organizationId: orgId, reportType: 'transactions', importedById: gate.userId, totalsJson: { reportLabel, reportTotalCents } },
        }));
      const created = await tx.valantTransaction.createMany({
        data: data.map((d) => ({ ...d, importId: imp.id })),
        skipDuplicates: true,
      });
      const status = errors.length === 0 ? 'success' : created.count > 0 ? 'partial' : 'failed';
      const job = prior
        ? await tx.migrationJob.update({
            where: { id: prior.id },
            data: {
              total: { increment: body.rows.length },
              imported: { increment: created.count },
              errors: { increment: errors.length },
              status: prior.status === 'success' && status === 'success' ? 'success' : prior.imported + created.count > 0 ? 'partial' : 'failed',
              errorJson: errors.length
                ? ([...(Array.isArray(prior.errorJson) ? prior.errorJson : []), ...errors].slice(0, 100) as Prisma.InputJsonValue[])
                : undefined,
            },
          })
        : await tx.migrationJob.create({
            data: {
              organizationId: orgId, type: 'valant_transactions', platform: 'valant', total: body.rows.length,
              imported: created.count, errors: errors.length, status, createdById: gate.userId,
              errorJson: errors.length ? (errors.slice(0, 100) as Prisma.InputJsonValue[]) : undefined,
            },
          });
      await tx.valantReferenceImport.update({
        where: { id: imp.id },
        data: {
          rowCount: { increment: created.count },
          matched: { increment: data.filter((d) => d.clientId).length },
          unmatched: { increment: data.filter((d) => !d.clientId).length },
          migrationJobId: job.id,
        },
      });
      return { job, imp, inserted: created.count, status: job.status };
    }, { timeout: 60000 });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: result.job.id,
      outcome: result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_transactions', dryRun: false, rowOffset: body.rowOffset, jobId: result.job.id, importId: result.imp.id, inserted: result.inserted, ...auditCounts, clientIds: [...new Set(data.map((d) => d.clientId).filter(Boolean))].slice(0, 50) },
    });
    return NextResponse.json({
      success: true, dryRun: false, ...summary, inserted: result.inserted, skippedExisting: parsed.length - result.inserted,
      unmatchedIds, subtotalMismatchIds: subtotals.mismatched.slice(0, 50), errors: errors.slice(0, 50),
      jobId: result.job.id, importId: result.imp.id, status: result.status,
    });
  } catch (err) {
    return handleImportError(err, 'migration/transactions POST', 'Transaction import failed');
  }
}

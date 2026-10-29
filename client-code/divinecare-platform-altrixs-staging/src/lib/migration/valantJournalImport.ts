import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { matchProviderCode } from '@/lib/migration/valantTransactions';
import {
  chunked,
  parseJournalBasis,
  parseJournalRow,
  planJournalMerge,
  type ExistingTxn,
  type ValantJournalRow,
} from '@/lib/migration/valantTransactionJournal';
import { journalRowHash } from '@/lib/migration/valantTransactionsHash';
import { valantClientsById, type OrgGate } from '@/lib/migration/referenceImport';

/**
 * One chunk of the Valant "Transaction Journal" (server side of POST /api/migration/transactions when the
 * journal header is detected). REFERENCE ONLY. The browser chunks by patient, so every stored row of the
 * chunk's patients is loaded and matched here: matches gain facility / insurance (and provider when blank),
 * the rest are inserted with sourceLayout 'journal'. Re-running the same journal changes nothing.
 */

export type JournalChunkBody = {
  dryRun: boolean;
  rows: string[][];
  occurrences: number[];
  rowOffset: number;
  jobId?: string;
  importId?: string;
};

const SELECT_EXISTING = {
  id: true, valantPatientId: true, billingId: true, serviceDate: true, code: true, amountCents: true, rowHash: true,
  sourceLayout: true, facility: true, insurance: true, providerCode: true,
} as const;

async function loadExisting(db: Prisma.TransactionClient | typeof prisma, organizationId: string, patientIds: string[]): Promise<ExistingTxn[]> {
  const out: ExistingTxn[] = [];
  for (const ids of chunked(patientIds, 1000)) {
    out.push(...(await db.valantTransaction.findMany({ where: { organizationId, valantPatientId: { in: ids } }, select: SELECT_EXISTING })));
  }
  return out;
}

const yearOf = (d: Date | null) => (d ? String(d.getUTCFullYear()) : 'none');

export async function importJournalChunk(gate: OrgGate, req: Request, body: JournalChunkBody) {
  const orgId = gate.organizationId;
  const errors: { line: number; error: string }[] = [];
  const parsed: { row: ValantJournalRow; rowHash: string }[] = [];
  body.rows.forEach((cells, i) => {
    if (!cells.some((c) => c.trim())) return;
    const r = parseJournalRow(cells);
    if (r.row) parsed.push({ row: r.row, rowHash: journalRowHash(r.row, body.occurrences[i]) });
    else errors.push({ line: body.rowOffset + i + 2, error: r.error ?? 'Unreadable row' });
  });
  const basis = parseJournalBasis(body.rows[0]?.[1]);
  const patientIds = [...new Set(parsed.map((p) => p.row.valantPatientId))];
  const byId = await valantClientsById(orgId, patientIds);
  const staff = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const providerIds = new Map<string, string | null>();
  for (const p of parsed) {
    const code = p.row.providerCode ?? '';
    if (!providerIds.has(code)) providerIds.set(code, matchProviderCode(code, staff));
  }

  const summarize = (plan: ReturnType<typeof planJournalMerge>) => {
    const newByYearCategory: Record<string, { rows: number; cents: number }> = {};
    for (const i of plan.inserts) {
      const r = parsed[i].row;
      const c = (newByYearCategory[`${yearOf(r.serviceDate)}|${r.category}`] ??= { rows: 0, cents: 0 });
      c.rows += 1;
      c.cents += r.amountCents;
    }
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
    const unmatchedIds = patientIds.filter((id) => !byId.has(id));
    return {
      layout: 'journal' as const,
      rows: body.rows.length,
      parsed: parsed.length,
      patients: patientIds.length,
      matchedPatients: patientIds.length - unmatchedIds.length,
      unmatchedPatients: unmatchedIds.length,
      matchedRows: parsed.filter((p) => byId.has(p.row.valantPatientId)).length,
      providerCodesLinked: [...providerIds.values()].filter(Boolean).length,
      providerCodes: providerIds.size,
      journalMatched: plan.matched.length,
      journalEnrich: plan.matched.filter((m) => m.changed).length,
      journalAlreadyEnriched: plan.matched.filter((m) => !m.changed).length,
      alreadyImported: plan.alreadyImported.length,
      wouldInsert: plan.inserts.length,
      existingNotInJournal: plan.untouchedExisting,
      newByYearCategory,
      sumCents,
      reportTotalCents: null,
      reportLabel: basis.text,
      minServiceDate: minDate,
      maxServiceDate: maxDate,
      subtotalPatients: 0,
      subtotalMismatches: 0,
      subtotalInconsistent: 0,
      byCategory,
      errorRows: errors.length,
      unmatchedIds,
    };
  };
  const auditCounts = (s: ReturnType<typeof summarize>) => ({
    rows: s.rows, patients: s.patients, matchedPatients: s.matchedPatients, unmatchedPatients: s.unmatchedPatients,
    journalMatched: s.journalMatched, journalEnrich: s.journalEnrich, wouldInsert: s.wouldInsert, alreadyImported: s.alreadyImported,
    existingNotInJournal: s.existingNotInJournal, errorRows: errors.length,
  });
  const clientIds = [...new Set(parsed.map((p) => byId.get(p.row.valantPatientId)).filter(Boolean))].slice(0, 50);

  if (body.dryRun) {
    const plan = planJournalMerge(parsed, await loadExisting(prisma, orgId, patientIds));
    const s = summarize(plan);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'migrationJob',
      metadata: { importType: 'valant_transaction_journal', dryRun: true, rowOffset: body.rowOffset, ...auditCounts(s), clientIds },
    });
    return NextResponse.json({ success: true, dryRun: true, ...s, errors: errors.slice(0, 50), jobId: null });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Plan inside the transaction so it reflects what is stored right now
    const plan = planJournalMerge(parsed, await loadExisting(tx, orgId, patientIds));
    const prior = body.jobId
      ? await tx.migrationJob.findFirst({ where: { id: body.jobId, organizationId: orgId, type: 'valant_transaction_journal' } })
      : null;
    const imp =
      (body.importId
        ? await tx.valantReferenceImport.findFirst({ where: { id: body.importId, organizationId: orgId, reportType: 'transaction_journal' } })
        : null) ??
      (await tx.valantReferenceImport.create({
        data: {
          organizationId: orgId, reportType: 'transaction_journal', importedById: gate.userId, periodStart: basis.start, periodEnd: basis.end,
          totalsJson: { reportBasis: basis.text, layout: 'journal' },
        },
      }));

    // Enrich matched rows: one updateMany per distinct set of new values
    const groups = new Map<string, { ids: string[]; data: Prisma.ValantTransactionUpdateManyMutationInput }>();
    for (const m of plan.matched) {
      if (!m.changed) continue;
      const r = parsed[m.index].row;
      const data: Prisma.ValantTransactionUpdateManyMutationInput = { facility: r.facility, insurance: r.insurance };
      if (m.fillProvider) {
        data.providerCode = r.providerCode;
        const uid = providerIds.get(r.providerCode ?? '') ?? null;
        if (uid) data.providerUserId = uid;
      }
      const key = JSON.stringify(data);
      const g = groups.get(key) ?? { ids: [], data };
      g.ids.push(m.existingId);
      groups.set(key, g);
    }
    let enriched = 0;
    for (const g of groups.values()) {
      for (const ids of chunked(g.ids, 1000)) {
        enriched += (await tx.valantTransaction.updateMany({ where: { organizationId: orgId, id: { in: ids } }, data: g.data })).count;
      }
    }

    let inserted = 0;
    const data = plan.inserts.map((i) => {
      const { row, rowHash } = parsed[i];
      return {
        organizationId: orgId,
        clientId: byId.get(row.valantPatientId) ?? null,
        valantPatientId: row.valantPatientId,
        billingId: row.billingId,
        serviceDate: row.serviceDate,
        providerCode: row.providerCode,
        providerUserId: providerIds.get(row.providerCode ?? '') ?? null,
        pos: null,
        diagnosis: row.diagnosis,
        code: row.code,
        codeBase: row.codeBase,
        codeSuffix: row.codeSuffix,
        category: row.category,
        amountCents: row.amountCents,
        note: null,
        reportLabel: basis.text,
        facility: row.facility,
        insurance: row.insurance,
        sourceLayout: 'journal',
        rowHash,
        importId: imp.id,
      };
    });
    for (const batch of chunked(data, 1000)) {
      inserted += (await tx.valantTransaction.createMany({ data: batch, skipDuplicates: true })).count;
    }

    const status = errors.length === 0 ? 'success' : inserted + enriched > 0 ? 'partial' : 'failed';
    const job = prior
      ? await tx.migrationJob.update({
          where: { id: prior.id },
          data: {
            total: { increment: body.rows.length },
            imported: { increment: inserted + enriched },
            errors: { increment: errors.length },
            status: prior.status === 'success' && status === 'success' ? 'success' : prior.imported + inserted + enriched > 0 ? 'partial' : 'failed',
            errorJson: errors.length
              ? ([...(Array.isArray(prior.errorJson) ? prior.errorJson : []), ...errors].slice(0, 100) as Prisma.InputJsonValue[])
              : undefined,
          },
        })
      : await tx.migrationJob.create({
          data: {
            organizationId: orgId, type: 'valant_transaction_journal', platform: 'valant', total: body.rows.length,
            imported: inserted + enriched, errors: errors.length, status, createdById: gate.userId,
            errorJson: errors.length ? (errors.slice(0, 100) as Prisma.InputJsonValue[]) : undefined,
          },
        });
    await tx.valantReferenceImport.update({
      where: { id: imp.id },
      data: {
        rowCount: { increment: inserted },
        matched: { increment: data.filter((d) => d.clientId).length },
        unmatched: { increment: data.filter((d) => !d.clientId).length },
        migrationJobId: job.id,
      },
    });
    return { job, imp, plan, inserted, enriched };
  }, { timeout: 120000 });

  const s = summarize(result.plan);
  await auditPhiAccess({
    gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: result.job.id,
    outcome: result.job.status === 'failed' ? 'FAILURE' : 'SUCCESS',
    metadata: {
      importType: 'valant_transaction_journal', dryRun: false, rowOffset: body.rowOffset, jobId: result.job.id, importId: result.imp.id,
      inserted: result.inserted, enriched: result.enriched, ...auditCounts(s), clientIds,
    },
  });
  return NextResponse.json({
    success: true, dryRun: false, ...s, inserted: result.inserted, enriched: result.enriched,
    skippedExisting: s.alreadyImported, errors: errors.slice(0, 50), jobId: result.job.id, importId: result.imp.id, status: result.job.status,
  });
}

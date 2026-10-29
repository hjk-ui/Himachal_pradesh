import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  buildNameIndex,
  matchByName,
  nameKey,
  parsePrepaymentReport,
  prepaymentStanding,
} from '@/lib/migration/valantPrepayments';
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
 * POST /api/migration/prepayments — import the Valant "Prepayments" report.
 * REFERENCE ONLY: transactions are stored to show each patient's remaining prepayment; nothing posts
 * to the ledger. The export has names only, so a row is matched by exact name only when exactly one
 * client has that name (or by Valant ID when a future export includes one). Everything else waits in
 * the Unmatched queue on Billing > Valant Balances.
 *
 * An import REPLACES all of the organization's Valant prepayment rows (confirmReplace required when
 * rows exist), so the owner can re-export from the beginning and re-import cleanly. Staff
 * assignments survive because each row keeps a stable hash.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('prepayments');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = referenceBodySchema.parse(await req.json());
    const parsed = parsePrepaymentReport(body.records);
    if (!parsed.ok || !parsed.periodStart || !parsed.periodEnd) return badRequest(parsed.error ?? 'Could not read the prepayments report');
    const periodStart = parsed.periodStart;
    const periodEnd = parsed.periodEnd;
    const orgId = gate.organizationId;

    const [clients, existing] = await Promise.all([
      prisma.client.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, legalFirstName: true, middleInitial: true, legalLastName: true },
      }),
      prisma.valantPrepaymentTxn.findMany({
        where: { organizationId: orgId },
        select: { rowHash: true, clientId: true, matchMethod: true, assignedById: true, assignedAt: true, date: true },
      }),
    ]);
    const nameIndex = buildNameIndex(clients);
    const orgClientIds = new Set(clients.map((c) => c.id));
    const byValantId = parsed.patientIdCol !== null
      ? await valantClientsById(orgId, parsed.txns.map((t) => t.valantPatientId ?? ''))
      : new Map<string, string>();
    const manual = new Map(
      existing
        .filter((e) => e.matchMethod === 'manual' && e.clientId && orgClientIds.has(e.clientId))
        .map((e) => [e.rowHash, e])
    );

    let matchedById = 0;
    let matchedByName = 0;
    let keptManual = 0;
    let unmatchedNone = 0;
    let unmatchedDuplicate = 0;
    const unmatchedNames = new Set<string>();
    const duplicateNames = new Set<string>();
    const rows = parsed.txns.map((t) => {
      const kept = manual.get(t.rowHash);
      let clientId: string | null = null;
      let matchMethod: string | null = null;
      let unmatchedReason: string | null = null;
      if (kept) {
        clientId = kept.clientId;
        matchMethod = 'manual';
        keptManual += 1;
      } else if (t.valantPatientId && byValantId.has(t.valantPatientId)) {
        clientId = byValantId.get(t.valantPatientId) ?? null;
        matchMethod = 'valant_id';
        matchedById += 1;
      } else {
        const m = matchByName(nameIndex, t.valantName);
        if (m.kind === 'matched') {
          clientId = m.clientId;
          matchMethod = 'name_unique';
          matchedByName += 1;
        } else if (m.kind === 'duplicate') {
          unmatchedReason = 'duplicate';
          unmatchedDuplicate += 1;
          duplicateNames.add(nameKey(t.valantName));
          unmatchedNames.add(nameKey(t.valantName));
        } else {
          unmatchedReason = 'none';
          unmatchedNone += 1;
          unmatchedNames.add(nameKey(t.valantName));
        }
      }
      return { t, clientId, matchMethod, unmatchedReason, kept };
    });

    const netByClient = new Map<string, number>();
    for (const r of rows) if (r.clientId) netByClient.set(r.clientId, (netByClient.get(r.clientId) ?? 0) + r.t.amountCents);
    const standings = [...netByClient.values()].map((n) => prepaymentStanding(n, periodStart));
    const existingOutsidePeriod = existing.filter((e) => e.date < periodStart || e.date > periodEnd).length;

    const summary = {
      periodStart: isoDate(periodStart),
      periodEnd: isoDate(periodEnd),
      rows: parsed.txns.length,
      received: parsed.received,
      applied: parsed.applied,
      sumCents: parsed.sumCents,
      reportNetCents: parsed.reportNetCents,
      reconciles: parsed.reconciles,
      errorRows: parsed.errors.length,
      distinctNames: parsed.distinctNames,
      matchedByValantId: matchedById,
      matchedByUniqueName: matchedByName,
      keptStaffAssignments: keptManual,
      matched: matchedById + matchedByName + keptManual,
      unmatched: unmatchedNone + unmatchedDuplicate,
      unmatchedNoClient: unmatchedNone,
      unmatchedDuplicateName: unmatchedDuplicate,
      unmatchedDistinctNames: unmatchedNames.size,
      duplicateDistinctNames: duplicateNames.size,
      matchedClients: netByClient.size,
      clientsIncomplete: standings.filter((s) => s.incomplete).length,
      patientIdColumn: parsed.patientIdCol !== null,
      existingRowsReplaced: existing.length,
      existingRowsOutsideNewPeriod: existingOutsidePeriod,
    };
    const clientIds = [...netByClient.keys()];

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_prepayments', dryRun: true, ...summary, clientIds: clientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, errors: parsed.errors.slice(0, 50), jobId: null });
    }
    if (existing.length > 0 && !body.confirmReplace) {
      return NextResponse.json(
        { success: false, error: `This replaces the ${existing.length} Valant prepayment rows already imported. Confirm to continue.`, needsConfirm: true },
        { status: 409 }
      );
    }

    const { job, status, imp } = await prisma.$transaction(async (tx) => {
      const { job, status } = await createReferenceJob(gate, 'valant_prepayments', parsed.txns.length, parsed.txns.length, parsed.errors, tx);
      const imp = await tx.valantReferenceImport.create({
        data: {
          organizationId: orgId,
          reportType: 'prepayments',
          periodStart,
          periodEnd,
          rowCount: parsed.txns.length,
          matched: summary.matched,
          unmatched: summary.unmatched,
          reconciles: parsed.reconciles,
          totalsJson: { reportNetCents: parsed.reportNetCents, sumCents: parsed.sumCents, received: parsed.received, applied: parsed.applied },
          migrationJobId: job.id,
          importedById: gate.userId,
        },
      });
      await tx.valantPrepaymentTxn.deleteMany({ where: { organizationId: orgId } });
      await tx.valantPrepaymentTxn.createMany({
        data: rows.map(({ t, clientId, matchMethod, unmatchedReason, kept }) => ({
          organizationId: orgId,
          clientId,
          valantName: t.valantName,
          valantPatientId: t.valantPatientId,
          type: t.type,
          kind: t.kind,
          date: t.date,
          amountCents: t.amountCents,
          reference: t.reference,
          appliedTo: t.appliedTo,
          secondaryDate: t.secondaryDate,
          periodStart,
          periodEnd,
          rowHash: t.rowHash,
          matchMethod,
          unmatchedReason,
          assignedById: kept?.assignedById ?? null,
          assignedAt: kept?.assignedAt ?? null,
          importId: imp.id,
        })),
      });
      return { job, status, imp };
    }, { timeout: 30000 });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_prepayments', dryRun: false, jobId: job.id, importId: imp.id, status, ...summary, clientIds: clientIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, errors: parsed.errors.slice(0, 50), jobId: job.id, importId: imp.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/prepayments POST', 'Prepayment import failed');
  }
}

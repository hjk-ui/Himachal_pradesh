import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { copayRuleKey, parseCopayReport } from '@/lib/migration/valantCopays';
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
 * POST /api/migration/copays — import the Valant "Patient Copays" report as copay SETTINGS
 * (ClientCopayRule, source 'valant'). Patients are matched by Valant ID. Re-importing replaces each
 * matched client's valant rules; rules entered in Altrixs are never touched, and Client.copayAmount
 * (from the client import's Pt. Ins1 Copay) is not changed. Nothing posts to the ledger.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('copays');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = referenceBodySchema.parse(await req.json());
    const parsed = parseCopayReport(body.records);
    if (!parsed.ok) return badRequest(parsed.error ?? 'Could not read the copay report');
    const orgId = gate.organizationId;

    const byId = await valantClientsById(orgId, parsed.rules.map((r) => r.valantPatientId));
    const matchedRules = parsed.rules.filter((r) => byId.has(r.valantPatientId));
    const unmatchedIds = [...new Set(parsed.rules.filter((r) => !byId.has(r.valantPatientId)).map((r) => r.valantPatientId))];
    const clientIds = [...new Set(matchedRules.map((r) => byId.get(r.valantPatientId) as string))];

    const existing = clientIds.length
      ? await prisma.clientCopayRule.findMany({
          where: { organizationId: orgId, clientId: { in: clientIds } },
          select: { clientId: true, source: true, payerName: true, providerType: true, cptRule: true, amountCents: true },
        })
      : [];
    const existingValant = new Map(
      existing.filter((e) => e.source === 'valant').map((e) => [copayRuleKey({ ...e, clientId: e.clientId }), e.amountCents])
    );
    let unchanged = 0;
    let changed = 0;
    let added = 0;
    for (const r of matchedRules) {
      const prior = existingValant.get(copayRuleKey({ ...r, clientId: byId.get(r.valantPatientId) }));
      if (prior === undefined) added += 1;
      else if (prior === r.amountCents) unchanged += 1;
      else changed += 1;
    }
    const newKeys = new Set(matchedRules.map((r) => copayRuleKey({ ...r, clientId: byId.get(r.valantPatientId) })));
    const removed = [...existingValant.keys()].filter((k) => !newKeys.has(k)).length;

    const summary = {
      rows: body.records.length - 1,
      rules: parsed.rules.length,
      patients: parsed.distinctPatients,
      payers: parsed.distinctPayers,
      matchedPatients: clientIds.length,
      unmatchedPatients: unmatchedIds.length,
      matchedRules: matchedRules.length,
      rulesAdded: added,
      rulesChanged: changed,
      rulesUnchanged: unchanged,
      valantRulesRemoved: removed,
      altrixsRulesKept: existing.filter((e) => e.source !== 'valant').length,
      duplicateKeys: parsed.duplicateKeys,
      conflictingDuplicates: parsed.conflictingDuplicates,
      errorRows: parsed.errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_copays', dryRun: true, ...summary, clientIds: clientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, unmatchedIds: unmatchedIds.slice(0, 200), errors: parsed.errors.slice(0, 50), jobId: null });
    }

    const { job, status, imp } = await prisma.$transaction(async (tx) => {
      const { job, status } = await createReferenceJob(gate, 'valant_copays', parsed.rules.length, matchedRules.length, parsed.errors, tx);
      const imp = await tx.valantReferenceImport.create({
        data: {
          organizationId: orgId,
          reportType: 'copays',
          rowCount: parsed.rules.length,
          matched: matchedRules.length,
          unmatched: parsed.rules.length - matchedRules.length,
          reconciles: parsed.errors.length === 0,
          totalsJson: { patients: parsed.distinctPatients, payers: parsed.distinctPayers },
          migrationJobId: job.id,
          importedById: gate.userId,
        },
      });
      for (let i = 0; i < clientIds.length; i += 1000) {
        await tx.clientCopayRule.deleteMany({
          where: { organizationId: orgId, source: 'valant', clientId: { in: clientIds.slice(i, i + 1000) } },
        });
      }
      await tx.clientCopayRule.createMany({
        skipDuplicates: true,
        data: matchedRules.map((r) => ({
          organizationId: orgId,
          clientId: byId.get(r.valantPatientId) as string,
          payerName: r.payerName,
          providerType: r.providerType,
          cptRule: r.cptRule,
          amountCents: r.amountCents,
          valantLimitRaw: r.valantLimitRaw,
          valantLimitCents: r.valantLimitCents,
          source: 'valant',
          importId: imp.id,
        })),
      });
      return { job, status, imp };
    }, { timeout: 60000 });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_copays', dryRun: false, jobId: job.id, importId: imp.id, status, ...summary, clientIds: clientIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, unmatchedIds: unmatchedIds.slice(0, 200), errors: parsed.errors.slice(0, 50), jobId: job.id, importId: imp.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/copays POST', 'Copay import failed');
  }
}

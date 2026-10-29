import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  authIsExpired,
  importedAuthNotes,
  parseAuthorizationReport,
  VALANT_AUTH_EXTERNAL_STATUS,
  VALANT_AUTH_VENDOR,
  valantAuthSubmissionKey,
} from '@/lib/migration/valantAuthorizations';
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

const bodySchema = referenceBody(60, 5000);

/**
 * POST /api/migration/authorizations — import the Valant "Insurance Authorizations" export into
 * PriorAuth (OPERATIONAL: claims use APPROVED auths for REF*G1). Patients are matched by Valant ID.
 * Imported auths carry vendor 'valant', externalStatus 'valant-import' and a 'valant:' submissionKey;
 * re-importing updates them (units, status, dates, notes). Auths created in Altrixs are never touched.
 * cptCodes stay empty (Valant exports none): the auth covers any service for that payer and dates.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('authorizations');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseAuthorizationReport(body.records);
    if (!parsed.ok) return badRequest(parsed.error ?? 'Could not read the authorizations report');
    const orgId = gate.organizationId;
    const today = new Date();

    const byId = await valantClientsById(orgId, parsed.auths.map((a) => a.valantPatientId));
    const matched = parsed.auths.filter((a) => byId.has(a.valantPatientId));
    const unmatchedIds = [...new Set(parsed.auths.filter((a) => !byId.has(a.valantPatientId)).map((a) => a.valantPatientId))];
    const planned = matched.map((a) => {
      const expired = authIsExpired(a, today);
      return {
        a,
        key: valantAuthSubmissionKey(orgId, a),
        clientId: byId.get(a.valantPatientId) as string,
        status: expired ? ('EXPIRED' as const) : ('APPROVED' as const),
      };
    });
    const existing = await prisma.priorAuth.findMany({
      where: { organizationId: orgId, submissionKey: { in: planned.map((p) => p.key) } },
      select: { id: true, submissionKey: true, vendor: true, clientId: true, unitsApproved: true, unitsUsed: true, status: true, startDate: true, endDate: true, notes: true },
    });
    const byKey = new Map(existing.map((e) => [e.submissionKey as string, e]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const p of planned) {
      const e = byKey.get(p.key);
      if (!e) created += 1;
      else if (
        e.unitsApproved === p.a.unitsApproved && e.unitsUsed === p.a.unitsUsed && e.status === p.status &&
        isoDate(e.startDate) === isoDate(p.a.startDate) && isoDate(e.endDate) === isoDate(p.a.endDate) &&
        e.notes === importedAuthNotes(p.a.note, parsed.reportDate)
      ) unchanged += 1;
      else updated += 1;
    }
    const summary = {
      reportDate: isoDate(parsed.reportDate),
      rows: parsed.auths.length,
      patients: parsed.distinctPatients,
      payers: parsed.distinctPayers,
      matchedRows: matched.length,
      matchedPatients: new Set(matched.map((a) => a.valantPatientId)).size,
      unmatchedPatients: unmatchedIds.length,
      created,
      updated,
      unchanged,
      approved: planned.filter((p) => p.status === 'APPROVED').length,
      expired: planned.filter((p) => p.status === 'EXPIRED').length,
      overLimit: planned.filter((p) => p.a.overLimit).length,
      lowVisitsWarning: planned.filter((p) => p.a.remainingWarning).length,
      future: planned.filter((p) => p.a.futureFlag).length,
      sharedAuthNumbers: parsed.sharedAuthKeys,
      errorRows: parsed.errors.length,
    };
    const clientIds = [...new Set(planned.map((p) => p.clientId))];

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'valant_authorizations', dryRun: true, ...summary, clientIds: clientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: null });
    }

    const { job, status } = await prisma.$transaction(async (tx) => {
      const out = await createReferenceJob(gate, 'valant_authorizations', parsed.auths.length, created + updated, parsed.errors, tx);
      const fresh = planned.filter((p) => !byKey.has(p.key));
      if (fresh.length) {
        await tx.priorAuth.createMany({
          data: fresh.map((p) => ({
            organizationId: orgId,
            clientId: p.clientId,
            payer: p.a.payer,
            authNumber: p.a.authNumber,
            cptCodes: [],
            unitsApproved: p.a.unitsApproved,
            unitsUsed: p.a.unitsUsed,
            status: p.status,
            startDate: p.a.startDate,
            endDate: p.a.endDate,
            notes: importedAuthNotes(p.a.note, parsed.reportDate),
            vendor: VALANT_AUTH_VENDOR,
            externalStatus: VALANT_AUTH_EXTERNAL_STATUS,
            submissionKey: p.key,
            createdById: gate.userId,
          })),
          skipDuplicates: true,
        });
      }
      for (const p of planned) {
        const e = byKey.get(p.key);
        if (!e || e.vendor !== VALANT_AUTH_VENDOR) continue;
        await tx.priorAuth.update({
          where: { id: e.id },
          data: {
            clientId: p.clientId,
            payer: p.a.payer,
            authNumber: p.a.authNumber,
            unitsApproved: p.a.unitsApproved,
            unitsUsed: p.a.unitsUsed,
            status: p.status,
            startDate: p.a.startDate,
            endDate: p.a.endDate,
            notes: importedAuthNotes(p.a.note, parsed.reportDate),
            externalStatus: VALANT_AUTH_EXTERNAL_STATUS,
          },
        });
      }
      return out;
    }, { timeout: 120000 });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'priorAuth', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_authorizations', dryRun: false, jobId: job.id, status, ...summary, clientIds: clientIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, dryRun: false, ...summary, unmatchedIds, errors: parsed.errors.slice(0, 50), jobId: job.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/authorizations POST', 'Authorization import failed');
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { groupPatientDiagnoses, parseValantDiagnosisRow } from '@/lib/migration/valantDiagnoses';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { mergeImportedDiagnoses } from '@/lib/diagnoses/store';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  // Raw CSV cells; the page keeps each patient's rows in the same chunk
  rows: z.array(z.array(z.string().max(2000)).max(40)).min(1).max(3000),
  rowOffset: z.number().int().min(0).optional().default(0),
  jobId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/migration/diagnoses — import Valant's "Diagnoses - Patient" report.
 * Patients are matched by Valant Pt. ID (Client.sourceId), so clients must be imported first.
 * Clients without a diagnosis list yet: the client record is replaced as before (first F code
 * primary, the other codes in secondaryDiagnoses); scripts/backfill-diagnoses.ts turns it into the
 * list. Clients that already have a list (src/lib/diagnoses): codes not on it are added after the
 * existing ones (source "Valant import"); clinician rows are never changed or resolved by a re-import.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import diagnoses' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const errors: { row: number; error: string }[] = [];
    const parsed: { sourcePatientId: string; code: string; description: string }[] = [];
    body.rows.forEach((cells, i) => {
      const r = parseValantDiagnosisRow(cells);
      if (r.ok === false) errors.push({ row: body.rowOffset + i + 1, error: r.error });
      else parsed.push(r);
    });

    const patients = groupPatientDiagnoses(parsed);
    const clients = await prisma.client.findMany({
      where: {
        organizationId: gate.organizationId,
        sourcePlatform: 'valant',
        sourceId: { in: patients.map((p) => p.sourcePatientId) },
      },
      select: { id: true, sourceId: true, primaryDiagnosisCode: true, secondaryDiagnoses: true },
    });
    const bySource = new Map(clients.map((c) => [String(c.sourceId).toUpperCase(), c]));

    let updated = 0;
    let unchanged = 0;
    let replacedExisting = 0;
    let mergedIntoList = 0;
    const notFound: string[] = [];
    const preview: Record<string, unknown>[] = [];
    const touchedClientIds: string[] = [];

    for (const p of patients) {
      const client = bySource.get(p.sourcePatientId);
      if (!client) {
        notFound.push(p.sourcePatientId);
        continue;
      }
      const secondary = p.secondaryCodes.join(', ') || null;
      if (client.primaryDiagnosisCode === p.primary.code && (client.secondaryDiagnoses || null) === secondary) {
        unchanged += 1;
        continue;
      }
      if (client.primaryDiagnosisCode) replacedExisting += 1;
      if (preview.length < 10) {
        preview.push({ primary: p.primary.code, secondary: p.secondaryCodes.length, hadDiagnosis: !!client.primaryDiagnosisCode });
      }
      if (!body.dryRun) {
        const merged = await mergeImportedDiagnoses(
          { organizationId: gate.organizationId, userId: gate.userId, name: null },
          client.id,
          [p.primary, ...p.secondaryCodes.map((code) => ({ code, description: p.descriptions?.[code] ?? '' }))],
          { source: 'VALANT_IMPORT', sourceRef: body.jobId ?? null, context: 'valant_import', createList: false }
        );
        if (merged.ok && merged.listExisted) {
          mergedIntoList += merged.added ? 1 : 0;
          updated += 1;
          touchedClientIds.push(client.id);
          continue;
        }
        await prisma.client.update({
          where: { id: client.id },
          data: {
            primaryDiagnosisCode: p.primary.code,
            primaryDiagnosis: p.primary.description.slice(0, 250) || null,
            secondaryDiagnoses: secondary,
          },
        });
      }
      updated += 1;
      touchedClientIds.push(client.id);
    }

    for (const id of notFound) errors.push({ row: 0, error: `Patient ${id} not found — import Valant clients first` });

    const summary = {
      totalRows: body.rows.length,
      diagnoses: parsed.length,
      patients: patients.length,
      updated: body.dryRun ? 0 : updated,
      wouldUpdate: body.dryRun ? updated : undefined,
      unchanged,
      replacedExisting,
      mergedIntoList,
      patientsNotFound: notFound.length,
      errorRows: errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'diagnoses', platform: body.platform, dryRun: true, ...summary, clientIds: touchedClientIds.slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, preview, errors: errors.slice(0, 50), jobId: null });
    }

    const status = errors.length === 0 ? 'success' : updated > 0 ? 'partial' : 'failed';
    const prior = body.jobId
      ? await prisma.migrationJob.findFirst({
          where: { id: body.jobId, organizationId: gate.organizationId, type: 'diagnoses' },
        })
      : null;
    const job = prior
      ? await prisma.migrationJob.update({
          where: { id: prior.id },
          data: {
            total: { increment: body.rows.length },
            imported: { increment: updated },
            errors: { increment: errors.length },
            status: prior.status === 'success' && status === 'success' ? 'success'
              : prior.imported + updated > 0 ? 'partial' : 'failed',
            errorJson: errors.length
              ? ([...(Array.isArray(prior.errorJson) ? prior.errorJson : []), ...errors].slice(0, 100) as Prisma.InputJsonValue[])
              : undefined,
          },
        })
      : await prisma.migrationJob.create({
          data: {
            organizationId: gate.organizationId,
            type: 'diagnoses',
            platform: 'valant',
            total: body.rows.length,
            imported: updated,
            errors: errors.length,
            status,
            createdById: gate.userId,
            errorJson: errors.length ? errors.slice(0, 100) : undefined,
          },
        });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'diagnoses', platform: body.platform, dryRun: false, jobId: job.id, status, ...summary, clientIds: touchedClientIds.slice(0, 50) },
    });

    return NextResponse.json({ success: true, dryRun: false, ...summary, preview, errors: errors.slice(0, 50), jobId: job.id, status });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/diagnoses POST]', err);
    return NextResponse.json({ success: false, error: 'Diagnosis import failed' }, { status: 500 });
  }
}

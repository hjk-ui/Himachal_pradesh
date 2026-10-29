import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferenceJob, handleImportError, requireImportGate } from '@/lib/migration/referenceImport';
import {
  MEASUREMENT_TYPES_HEADER,
  parseMeasurementTypeRecords,
  planMeasurementTypeImport,
  summarizeMeasurementTypes,
} from '@/lib/migration/valantMeasurementTypes';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  records: z.array(z.array(z.string().max(500)).max(20)).min(2).max(5000),
});

/**
 * POST /api/migration/measurement-types — Valant "Measurement Types" export (DataGrid .xlsx,
 * header Name, Documentation Code, Category, Data Type, Default Units, Status). The browser reads
 * the workbook with xlsx and sends the rows; the server re-parses them. Dry run reports new /
 * changed / unchanged, duplicates, instrument groups and mappings; the import upserts by
 * (name, documentation code, data type, units). Re-import is idempotent: rows already present are
 * unchanged, and the practice's active toggle is never overwritten. No PHI; audited with counts.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('measurement types');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseMeasurementTypeRecords(body.records);
    if (!parsed.headerOk) {
      return NextResponse.json(
        { success: false, error: `This is not the Valant Measurement Types export (expected header ${MEASUREMENT_TYPES_HEADER.join(', ')}).` },
        { status: 400 }
      );
    }
    const orgId = gate.organizationId;
    const existing = await prisma.measurementType.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, documentationCode: true, dataType: true, defaultUnits: true, category: true, sourceName: true,
        sourceCategory: true, sourceDataType: true, sourceUnits: true, parentInstrument: true, isSubscore: true,
        instrumentKey: true, vitalField: true, source: true,
      },
    });
    const plan = planMeasurementTypeImport(existing, parsed.types);
    const summary = summarizeMeasurementTypes(parsed.types);
    const report = {
      rows: parsed.rows,
      ...summary,
      duplicates: parsed.duplicates,
      errors: parsed.errors,
      newCount: plan.create.length,
      changedCount: plan.update.length,
      unchangedCount: plan.unchanged.length,
      notInFileCount: plan.notInFile.length,
      changed: plan.update.map((u) => ({ name: u.name, fields: u.changed })),
      notInFile: plan.notInFile,
    };
    const auditCounts = {
      rows: report.rows, types: summary.types, duplicates: parsed.duplicates.length, newCount: report.newCount,
      changedCount: report.changedCount, unchangedCount: report.unchangedCount, instruments: summary.instruments.length,
      mappedRows: summary.mappedRows, vitalsMapped: summary.vitalsMapped.length, errorRows: parsed.errors.length,
    };

    if (body.dryRun) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'measurementType', metadata: { importType: 'valant_measurement_types', dryRun: true, ...auditCounts } });
      return NextResponse.json({ success: true, dryRun: true, ...report, jobId: null });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      if (plan.create.length) {
        await tx.measurementType.createMany({
          data: plan.create.map((t) => ({ ...t, organizationId: orgId, source: 'valant', importedAt: now, updatedById: gate.userId })),
          skipDuplicates: true,
        });
      }
      for (const u of plan.update) {
        await tx.measurementType.update({ where: { id: u.id }, data: { ...u.data, importedAt: now, updatedById: gate.userId } });
      }
      const imported = plan.create.length + plan.update.length;
      // Unrecognized units are warnings (row kept), so they are not counted as failed rows
      const hardErrors = parsed.errors.filter((e) => !e.error.startsWith('Unrecognized units'));
      const { job, status } = await createReferenceJob(gate, 'valant_measurement_types', parsed.rows, imported, hardErrors, tx);
      return { job, status, imported };
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'measurementType', resourceId: result.job.id,
      outcome: result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_measurement_types', dryRun: false, jobId: result.job.id, ...auditCounts },
    });
    return NextResponse.json({ success: true, dryRun: false, ...report, imported: result.imported, jobId: result.job.id, status: result.status });
  } catch (err) {
    return handleImportError(err, 'migration/measurement-types POST', 'Measurement types import failed');
  }
}

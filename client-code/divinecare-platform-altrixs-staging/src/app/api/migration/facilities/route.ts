import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createReferenceJob, handleImportError, requireImportGate } from '@/lib/migration/referenceImport';
import { importValantFacilityList } from '@/lib/locations/server';
import { FACILITY_LIST_HEADER, parseFacilityListRecords } from '@/lib/locations/valantFacilities';

export const runtime = 'nodejs';

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  records: z.array(z.array(z.string().max(300)).max(20)).min(2).max(500),
});

/**
 * POST /api/migration/facilities — Valant facility list (Setup › Facilities DataGrid .xlsx: Facility Id, Name,
 * Local Time Zone, Active). The browser reads the workbook and sends the rows; the server re-parses them.
 * Dry run shows each facility's action and mapping; the import upserts FacilityLocationMap rows with the
 * billing entity name, time zone and active flag and the suggested mapping (owner-edited mappings are kept).
 * Idempotent. Practice Director / Admin only; no PHI; audited with counts.
 */
export async function POST(req: Request) {
  const g = await requireImportGate('facilities');
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = parseFacilityListRecords(body.records);
    if (!parsed.headerOk) {
      return NextResponse.json(
        { success: false, error: `This is not the Valant facility list (expected header ${FACILITY_LIST_HEADER.join(', ')}).` },
        { status: 400 }
      );
    }
    const result = await importValantFacilityList(gate.organizationId, gate.userId, parsed.rows, body.dryRun);
    const report = { rows: parsed.rows.length, duplicates: parsed.duplicates, errors: parsed.errors, counts: result.counts, facilities: result.rows };
    const auditCounts = { rows: parsed.rows.length, duplicates: parsed.duplicates.length, errorRows: parsed.errors.length, ...result.counts };

    if (body.dryRun) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'FacilityLocationMap', metadata: { importType: 'valant_facilities', dryRun: true, ...auditCounts } });
      return NextResponse.json({ success: true, dryRun: true, ...report, jobId: null });
    }
    const imported = result.counts.create + result.counts.update;
    const hardErrors = parsed.errors.filter((e) => e.error.startsWith('Facility Id'));
    const { job, status } = await createReferenceJob(gate, 'valant_facilities', parsed.rows.length, imported, hardErrors);
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'FacilityLocationMap', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'valant_facilities', dryRun: false, jobId: job.id, ...auditCounts },
    });
    return NextResponse.json({ success: true, dryRun: false, ...report, imported, jobId: job.id, status });
  } catch (err) {
    return handleImportError(err, 'migration/facilities POST', 'Facility list import failed');
  }
}

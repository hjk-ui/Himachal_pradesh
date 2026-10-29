import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { validateMappingRow } from '@/lib/locations/facilityMapping';
import {
  applySuggestedMapping,
  loadFacilityMapping,
  requireLeadership,
  saveFacilityMapping,
} from '@/lib/locations/server';

export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  facilityName: z.string().trim().min(1).max(200),
  kind: z.enum(['location', 'program', 'ignore']),
  locationId: z.string().max(64).nullable().optional(),
  programKey: z.string().max(40).nullable().optional(),
  needsConfirmation: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Valant facility -> location / program mapping, with suggestions for unmapped facilities. */
export async function GET() {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  try {
    return NextResponse.json({ success: true, ...(await loadFacilityMapping(gate.organizationId)) });
  } catch (err) {
    console.error('[api/locations/facility-map] GET failed', err instanceof Error ? err.message : err);
    return fail('Could not load the facility mapping', 500);
  }
}

/** Save one mapping row (owner edit). */
export async function PUT(req: Request) {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  const parsed = rowSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid mapping', 400);
  const body = parsed.data;
  const locations = await prisma.location.findMany({ where: { organizationId: gate.organizationId }, select: { id: true } });
  const row = { kind: body.kind, locationId: body.locationId ?? null, programKey: body.programKey ?? null };
  const error = validateMappingRow(row, new Set(locations.map((l) => l.id)));
  if (error) return fail(error, 400);
  const saved = await saveFacilityMapping(gate.organizationId, gate.userId, {
    facilityName: body.facilityName,
    ...row,
    needsConfirmation: body.needsConfirmation ?? false,
    note: body.note ?? null,
  });
  await auditPhiAccess({
    gate,
    req,
    action: 'FACILITY_LOCATION_MAP_SAVE',
    resourceType: 'FacilityLocationMap',
    resourceId: saved.id,
    metadata: { kind: saved.kind, locationId: saved.locationId, programKey: saved.programKey, needsConfirmation: saved.needsConfirmation },
  });
  return NextResponse.json({ success: true, mapping: saved });
}

/** { action: 'apply_suggested' }: save every suggestion that names a location or program (saved rows untouched). */
export async function POST(req: Request) {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== 'apply_suggested') return fail('Unknown action', 400);
  const result = await applySuggestedMapping(gate.organizationId, gate.userId);
  await auditPhiAccess({
    gate,
    req,
    action: 'FACILITY_LOCATION_MAP_APPLY_SUGGESTED',
    resourceType: 'FacilityLocationMap',
    resourceId: gate.organizationId,
    metadata: result,
  });
  return NextResponse.json({ success: true, ...result });
}

/** ?facilityName= removes one mapping row. */
export async function DELETE(req: Request) {
  const gate = await requireLeadership();
  if (!gate.ok) return fail(gate.error, gate.status);
  const facilityName = new URL(req.url).searchParams.get('facilityName')?.trim();
  if (!facilityName) return fail('facilityName is required', 400);
  const res = await prisma.facilityLocationMap.deleteMany({
    where: { organizationId: gate.organizationId, sourceSystem: 'valant', facilityName },
  });
  await auditPhiAccess({
    gate,
    req,
    action: 'FACILITY_LOCATION_MAP_DELETE',
    resourceType: 'FacilityLocationMap',
    resourceId: gate.organizationId,
    metadata: { deleted: res.count },
  });
  return NextResponse.json({ success: true, deleted: res.count });
}

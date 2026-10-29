import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
import { MEASUREMENT_TYPE_EDIT_ROLES, MEASUREMENT_TYPES_PATH } from '@/lib/clinical/measurementTypeAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/measurement-types — the org's measurement type catalog (Admin › Clinical content ›
 * Measurement types). Leadership and licensed clinicians read; leadership edits. Definitions only,
 * no patient data, so reads are not audited (edits are, in [id]).
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, MEASUREMENT_TYPES_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const rows = await prisma.measurementType.findMany({
    where: { organizationId: gate.organizationId },
    orderBy: [{ parentInstrument: 'asc' }, { isSubscore: 'asc' }, { name: 'asc' }],
  });
  const names = new Map(ASSESSMENT_CATALOG.map((i) => [i.id, i.name]));
  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    documentationCode: r.documentationCode || null,
    category: r.category,
    dataType: r.dataType,
    defaultUnits: r.defaultUnits || null,
    active: r.active,
    source: r.source,
    parentInstrument: r.parentInstrument,
    isSubscore: r.isSubscore,
    instrumentKey: r.instrumentKey,
    instrumentName: r.instrumentKey ? names.get(r.instrumentKey) ?? r.instrumentKey : null,
    vitalField: r.vitalField,
    updatedAt: r.updatedAt.toISOString(),
  }));
  return NextResponse.json({ success: true, data, canEdit: MEASUREMENT_TYPE_EDIT_ROLES.has(String(gate.role).toUpperCase()) });
}

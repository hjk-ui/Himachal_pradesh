import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  buildCaseloadCounts,
  canViewCaseloadCounts,
  caseloadClientWhere,
  caseloadUpcomingWhere,
  clinicalPrimaryWhere,
} from '@/lib/clients/caseloadCounts';
import { unassignedWhere } from '@/lib/clients/listQuery';

/**
 * GET /api/clients/caseload-counts?locationId= — per-clinician caseload counts over every active
 * client in scope (src/lib/clients/caseloadCounts.ts). Counts only: no client names or PHI fields.
 * Leadership, Office Manager and Front Desk (who assign clinicians); an admin in Role Preview keeps access.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  let role: Role = gate.role;
  if (!canViewCaseloadCounts(role)) {
    const adminBase = await verifiedAdminBaseRole(gate.userId);
    if (!adminBase) {
      return NextResponse.json({ success: false, error: 'Not allowed to view caseload counts' }, { status: 403 });
    }
    role = adminBase as Role;
  }

  try {
    const url = new URL(req.url);
    const locationId = url.searchParams.get('locationId')?.trim() || null;
    const scope = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: role });
    const base = caseloadClientWhere(scope, locationId);
    const now = new Date();
    const [primaryByRisk, primaryUpcoming, teamRows, unassigned, activeTotal] = await Promise.all([
      prisma.client.groupBy({
        by: ['assignedToId', 'riskLevel'],
        where: { AND: [base, clinicalPrimaryWhere()] },
        _count: { _all: true },
      }),
      prisma.client.groupBy({ by: ['assignedToId'], where: caseloadUpcomingWhere(base, now), _count: { _all: true } }),
      prisma.clientTreatmentTeamMember.findMany({
        where: { providerId: { not: null }, client: base },
        select: { providerId: true, clientId: true, client: { select: { assignedToId: true, riskLevel: true } } },
      }),
      prisma.client.count({ where: { AND: [base, unassignedWhere()] } }),
      prisma.client.count({ where: base }),
    ]);
    const result = buildCaseloadCounts({ primaryByRisk, primaryUpcoming, teamRows, unassigned, activeTotal });
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'patient',
      metadata: { view: 'caseload_counts', staff: Object.keys(result.counts).length, activeTotal, locationId },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[clients caseload-counts GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load caseload counts' }, { status: 500 });
  }
}

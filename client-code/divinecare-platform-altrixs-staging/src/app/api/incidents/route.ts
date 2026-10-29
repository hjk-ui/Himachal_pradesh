import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { createIncident, IncidentInputError, listIncidents } from '@/lib/incidents/store';

export const runtime = 'nodejs';

/**
 * GET /api/incidents: reviewers (leadership, Office Manager, verified Medical Director) get the
 * practice's reports; everyone else who files incidents only the reports they filed, that name
 * them as involved staff or that are assigned to them (src/lib/incidents/access.ts).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/incidents', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await listIncidents({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role });
    await writeAuditLog({
      action: 'incident_list',
      actorUserId: gate.userId,
      actorRole: gate.role ?? null,
      organizationId: gate.organizationId,
      resourceType: 'IncidentReport',
      metadata: { count: result.incidents.length, scope: result.reviewer ? 'org' : 'own' },
      ...auditRequestMeta(req),
    });
    return NextResponse.json(
      { success: true, reviewer: result.reviewer, incidents: result.incidents },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[incidents GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load incidents' }, { status: 500 });
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(120),
  chartCategory: z.string().max(60).optional().nullable(),
  severity: z.enum(['critical', 'serious', 'minor']),
  clientInitials: z.string().max(20).optional().nullable(),
  clientId: z.string().max(64).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  description: z.string().trim().min(1).max(10_000),
  immediateAction: z.string().max(5_000).optional().nullable(),
  carfCategory: z.string().max(120).optional().nullable(),
  dueFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  occurredAt: z.string().datetime().optional().nullable(),
  assignedToUserId: z.string().max(64).optional().nullable().or(z.literal('')),
  involvedStaffIds: z.array(z.string().max(64)).max(50).optional(),
});

/** POST /api/incidents: file a report (every incidents page role). The reporter is the caller. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/incidents', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Title, type, severity and description are required' }, { status: 400 });
  try {
    const incident = await createIncident(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      { ...parsed.data, assignedToUserId: parsed.data.assignedToUserId || null, dueFollowUp: parsed.data.dueFollowUp || null },
    );
    await writeAuditLog({
      action: 'incident_create',
      actorUserId: gate.userId,
      actorRole: gate.role ?? null,
      organizationId: gate.organizationId,
      resourceType: 'IncidentReport',
      resourceId: incident.recordId,
      metadata: { incidentNumber: incident.id, severity: incident.severity, involved: incident.involvedStaffIds.length },
      ...auditRequestMeta(req),
    });
    return NextResponse.json({ success: true, incident }, { status: 201 });
  } catch (err) {
    if (err instanceof IncidentInputError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[incidents POST]', err);
    return NextResponse.json({ success: false, error: 'Could not file the incident' }, { status: 500 });
  }
}

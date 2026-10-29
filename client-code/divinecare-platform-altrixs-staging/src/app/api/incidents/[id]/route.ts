import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { INCIDENT_STATUSES } from '@/lib/incidents/access';
import { IncidentInputError, updateIncident } from '@/lib/incidents/store';

export const runtime = 'nodejs';

// Scenario — Deletion attempt:
// Given an incident was filed by mistake (wrong client selected)
// When DELETE /api/incidents/:id is called
// Then API returns 405 Method Not Allowed; only PATCH to status='filed_in_error' is permitted
export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      error: 'Incidents cannot be deleted. Once created, the record is permanent. Mark as filed_in_error with explanation.',
    },
    {
      status: 405,
      headers: { Allow: 'GET, PATCH' },
    }
  );
}

const patchSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  investigationNotes: z.string().max(20_000).optional(),
  rootCause: z.string().max(5_000).optional(),
  correctiveActions: z.array(z.string().max(1_000)).max(50).optional(),
  errorExplanation: z.string().max(5_000).optional(),
  assignedToUserId: z.string().max(64).nullable().optional(),
  involvedStaffIds: z.array(z.string().max(64)).max(50).optional(),
  dueFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
});

/**
 * PATCH /api/incidents/[id] (IncidentReport id): reviewers (leadership, Office Manager, verified
 * Medical Director) or the assigned investigator; assignment / involved staff are reviewer-only.
 * Not visible to the caller -> 404 (no existence leak).
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/incidents', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid update' }, { status: 400 });

  try {
    const incident = await updateIncident({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id, parsed.data);
    await writeAuditLog({
      action: 'incident_update',
      actorUserId: gate.userId,
      actorRole: gate.role ?? null,
      organizationId: gate.organizationId,
      resourceType: 'IncidentReport',
      resourceId: id,
      metadata: { fields: Object.keys(parsed.data), status: parsed.data.status ?? null },
      ...auditRequestMeta(req),
    });
    return NextResponse.json({ success: true, incident });
  } catch (err) {
    if (err instanceof IncidentInputError) {
      if (err.status === 403) {
        await writeAuditLog({
          action: 'incident_update',
          actorUserId: gate.userId,
          actorRole: gate.role ?? null,
          organizationId: gate.organizationId,
          resourceType: 'IncidentReport',
          resourceId: id,
          outcome: 'DENIED',
          metadata: { fields: Object.keys(parsed.data) },
          ...auditRequestMeta(req),
        });
      }
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[incidents PATCH]', err);
    return NextResponse.json({ success: false, error: 'Could not update the incident' }, { status: 500 });
  }
}

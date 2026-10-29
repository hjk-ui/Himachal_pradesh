import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess, auditRequestMeta } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canChangePcp, pcpDisplayName, PCP_STATUS_LABEL } from '@/lib/medical/pcpAssignment';
import {
  evidenceAuditDetail,
  loadPcpContext,
  loadPcpDecisions,
  pcpChoices,
  setPrimaryCareProvider,
} from '@/lib/medical/pcpAssignmentDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clients/[id]/pcp — the chart's primary care provider (PCP), what the visits say
 * (src/lib/medical/pcpAssignment.ts), and the picker choices (active physicians / medical NPs).
 * PUT { providerId } — set the PCP (care team "Primary Care Provider" member; mirrors
 * MedicalPatient.assignedPcp; audited). Never changes the behavioral health clinician (assignedToId).
 * Both require chart access (org, role, care team / caseload, Part 2 lock).
 */
async function gateFor(req: Request, id: string, action: 'READ' | 'UPDATE') {
  const gate = await requireOrgContext();
  if (!gate.ok) return { error: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id, `/api/clients/${id}/pcp`);
  if (access.ok === false) {
    await auditPhiAccess({ gate, req, action, resourceType: 'primaryCareProvider', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: access.reason } });
    return { error: NextResponse.json({ success: false, error: access.status === 404 ? 'Client not found' : 'Forbidden' }, { status: access.status }) };
  }
  return { gate };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateFor(req, id, 'READ');
  if (g.error) return g.error;
  const { gate } = g;
  try {
    const pcpCtx = await loadPcpContext(gate.organizationId);
    const d = (await loadPcpDecisions(pcpCtx, [id])).get(id);
    if (!d) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    const label = (userId: string | null, code: string | null) => {
      if (userId) {
        const s = pcpCtx.staff.get(userId);
        return s ? pcpDisplayName(s) : 'Staff member';
      }
      return code ? `Valant code ${code} (not mapped)` : 'Unknown';
    };
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'primaryCareProvider', resourceId: id, patientId: id, metadata: { status: d.decision.status } });
    return NextResponse.json(
      {
        success: true,
        current: d.decision.current,
        status: d.decision.status,
        statusLabel: PCP_STATUS_LABEL[d.decision.status],
        suggested: d.decision.proposedUserId ? { id: d.decision.proposedUserId, name: label(d.decision.proposedUserId, null) } : null,
        evidence: d.decision.contenders.length
          ? d.decision.contenders.map((t) => ({ userId: t.userId, name: label(t.userId, t.code), last12Months: t.inWindow, total: t.total, lastDate: t.lastDate }))
          : d.decision.evidence
            ? [{ userId: d.decision.evidence.userId, name: label(d.decision.evidence.userId, d.decision.evidence.code), last12Months: d.decision.evidence.inWindow, total: d.decision.evidence.total, lastDate: d.decision.evidence.lastDate }]
            : [],
        canEdit: canChangePcp(gate.role),
        choices: canChangePcp(gate.role) ? pcpChoices(pcpCtx) : [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[api/clients/[id]/pcp GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the primary care provider' }, { status: 500 });
  }
}

const putSchema = z.object({
  providerId: z.string().trim().min(1).max(64),
  /** where the change came from (chart picker, or the suggestion after signing a visit) */
  via: z.enum(['chart', 'visit-suggestion']).optional().default('chart'),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateFor(req, id, 'UPDATE');
  if (g.error) return g.error;
  const { gate } = g;
  if (!canChangePcp(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'primaryCareProvider', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Your role cannot change the primary care provider' }, { status: 403 });
  }
  try {
    const body = putSchema.parse(await req.json());
    const pcpCtx = await loadPcpContext(gate.organizationId);
    const before = (await loadPcpDecisions(pcpCtx, [id])).get(id);
    const res = await setPrimaryCareProvider({
      organizationId: gate.organizationId,
      clientId: id,
      newUserId: body.providerId,
      actor: { userId: gate.userId, role: gate.role, via: body.via },
      auditDetail: before ? evidenceAuditDetail(before) : undefined,
      requestMeta: auditRequestMeta(req),
    });
    if (res.ok === false) {
      const msg = res.error === 'not_medical_provider' ? 'Choose an active physician or medical NP' : 'Client not found';
      return NextResponse.json({ success: false, error: msg }, { status: res.error === 'not_medical_provider' ? 400 : 404 });
    }
    return NextResponse.json({ success: true, changed: res.changed, pcp: { id: body.providerId, name: res.displayName } });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Choose a provider' }, { status: 400 });
    console.error('[api/clients/[id]/pcp PUT]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not set the primary care provider' }, { status: 500 });
  }
}

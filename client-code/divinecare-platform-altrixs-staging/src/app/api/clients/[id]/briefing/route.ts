import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getPreVisitBrief } from '@/lib/ai/previsit/service';
import { prismaPreVisitDeps } from '@/lib/ai/previsit/prismaSource';
import { canRequestClientBriefing } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * POST /api/clients/[id]/briefing — legacy pre-session briefing, now backed by the pre-visit
 * brief (src/lib/ai/previsit): structured chart facts (no note bodies, no names) → grounded AI
 * bullets, or the rule-based brief when AI is not allowed / configured / grounded.
 * Kept for older clients; the chart uses /api/clients/[id]/previsit-brief.
 * Same gates and audit (AI_ACCESS per model call, READ otherwise) as that route.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  // Licensed clinicians / prescribers / primary care providers / leadership only (orgScope.canRequestClientBriefing)
  if (!canRequestClientBriefing(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientBriefing', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  try {
    const result = await getPreVisitBrief(prismaPreVisitDeps({ gate: viewer, req, path: `/api/clients/${id}/briefing` }), viewer, id, { refresh: true });
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const b = result.brief;
    return NextResponse.json({
      success: true,
      briefing: b.bullets.map((x) => `• ${x}`).join('\n'),
      source: b.source,
      provider: b.source === 'ai' ? 'aws-bedrock' : 'rules',
      model: b.model,
      fallbackReason: b.fallbackReason,
      generatedAt: b.generatedAt,
      brief: b,
    });
  } catch (err) {
    console.error('[clients/briefing] failed for client', id, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Briefing is temporarily unavailable. Review the chart directly.' }, { status: 503 });
  }
}

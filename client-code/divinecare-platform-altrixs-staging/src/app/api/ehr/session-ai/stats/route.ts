import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * GET /api/ehr/session-ai/stats — counts of AI-drafted progress notes (ProgressNote.aiDrafted)
 * for the clients the caller may see (caseload roles: their caseload). Draft = no workflow row or
 * DRAFT; signed = SIGNED or LOCKED. Counts only.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  // Shown on AI Scribe (the AI Session Notes page it served was folded into the scribe)
  if (!canAccessPath(gate.role, '/dashboard/scribe')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const where = {
      aiDrafted: true,
      client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
    };
    const [total, signed] = await Promise.all([
      prisma.progressNote.count({ where }),
      prisma.progressNote.count({ where: { ...where, workflow: { is: { status: { in: ['SIGNED', 'LOCKED'] } } } } }),
    ]);
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'aiDraftedNoteStats', metadata: { countsOnly: true } });
    return NextResponse.json(
      { success: true, data: { total, signed, draft: total - signed } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[ehr/session-ai/stats]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load AI note counts' }, { status: 500 });
  }
}

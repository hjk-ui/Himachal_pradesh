import { NextResponse } from 'next/server';
import { cancelChecklist } from '@/lib/hr/checklists';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** DELETE /api/hr/checklists/[id]: cancel an onboarding / offboarding checklist (kept for the record). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const result = await cancelChecklist(g.ctx, id);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrChecklist', id, { status: 'cancelled', kind: result.kind, staffUserId: result.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('checklist cancel', err);
  }
}

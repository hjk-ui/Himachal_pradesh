import { NextResponse } from 'next/server';
import { acknowledgePolicy, retirePolicy } from '@/lib/hr/policies';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** PATCH: the signed-in staff member acknowledges the current version (e-acknowledgment). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const result = await acknowledgePolicy(g.ctx, id);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrPolicyAcknowledgment', id, { version: result.version });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('policy ack', err);
  }
}

/** DELETE: retire a policy (acknowledgments are kept). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const result = await retirePolicy(g.ctx, id);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrPolicyDocument', id, { active: false });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('policy retire', err);
  }
}

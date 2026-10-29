import { NextResponse } from 'next/server';
import { z } from 'zod';
import { acknowledgeDiscipline } from '@/lib/hr/performance';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const bodySchema = z.object({ comment: z.string().trim().max(4000).optional().nullable() });

/** PATCH: the employee acknowledges a corrective action shared with them (optional comment). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid request', 400);
  }
  try {
    const result = await acknowledgeDiscipline(g.ctx, id, body.comment);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrDiscipline', id, { acknowledged: true });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('discipline ack', err);
  }
}

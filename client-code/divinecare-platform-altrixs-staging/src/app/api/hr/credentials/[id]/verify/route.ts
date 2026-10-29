import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyStaffCredential } from '@/lib/hr/credentials';
import { VERIFICATION_METHODS } from '@/lib/hr/standard';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  method: z.enum(VERIFICATION_METHODS.map((m) => m.key) as [string, ...string[]]),
  verifiedOn: z.string().trim().max(10).optional().nullable(),
  reference: z.string().trim().max(200).optional().nullable(),
});

/** POST /api/hr/credentials/[id]/verify: record primary source verification (HR, leadership, OM). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json());
    const result = await verifyStaffCredential(
      { organizationId: g.ctx.organizationId, actorUserId: g.ctx.userId, actorRole: g.ctx.role as never, actorName: g.ctx.name },
      id,
      body,
    );
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'staffCredentialVerification', id, { staffUserId: result.credential.userId, method: body.method });
    return NextResponse.json({ success: true, credential: result.credential });
  } catch (err) {
    if (err instanceof z.ZodError) return hrJsonError('Invalid verification', 400);
    return hrServerError('credential verify', err);
  }
}

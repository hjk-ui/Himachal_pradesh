import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { recordVerification } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

const schema = z.object({
  authStatus: z.enum(['pending', 'approved', 'not_required', 'denied']),
  authorizedSessions: z.number().int().min(1).max(200).nullish(),
  billingNote: z.string().max(500).nullish(),
});

/** PATCH — step 4: billing records the verification and authorization (Authorizations page roles). */
export async function PATCH(req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const g = await tmsGate('billing');
  if (g.ok === false) return g.res;
  const { courseId } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  try {
    const { clientId } = await recordVerification(g.actor, courseId, parsed.data);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'UPDATE',
      resourceType: 'tmsCaseWorkflow',
      resourceId: courseId,
      patientId: clientId,
      metadata: { fields: Object.keys(parsed.data), authStatus: parsed.data.authStatus },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return tmsError(err, 'Could not record the verification');
  }
}

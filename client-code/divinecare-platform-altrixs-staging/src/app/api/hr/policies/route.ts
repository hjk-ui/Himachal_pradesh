import { NextResponse } from 'next/server';
import { z } from 'zod';
import { POLICY_KINDS, listPolicies, savePolicy } from '@/lib/hr/policies';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET /api/hr/policies: active practice policies with the viewer's acknowledgment status. */
export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    return NextResponse.json({ success: true, policies: await listPolicies(g.ctx.organizationId, g.ctx.userId), kinds: POLICY_KINDS });
  } catch (err) {
    return hrServerError('policies', err);
  }
}

const bodySchema = z.object({
  kind: z.enum(POLICY_KINDS.map((k) => k.key) as unknown as [string, ...string[]]),
  title: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(20),
  effectiveOn: z.string().trim().max(10).optional().nullable(),
  text: z.string().min(20).max(400_000),
  requiresAck: z.boolean().default(true),
});

/** POST: HR publishes a policy (or a new version). Text is split into sections for Q&A citations. */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return hrJsonError('Add a title, version and the policy text', 400);
  }
  try {
    const result = await savePolicy(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrPolicyDocument', result.id, { kind: body.kind, sections: result.sectionCount });
    return NextResponse.json({ success: true, id: result.id, sectionCount: result.sectionCount }, { status: 201 });
  } catch (err) {
    return hrServerError('policy save', err);
  }
}

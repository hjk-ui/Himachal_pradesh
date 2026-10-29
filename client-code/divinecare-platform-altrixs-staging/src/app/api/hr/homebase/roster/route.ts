import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { loadRosterMatch, updateEmployeeLink } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

/** GET /api/hr/homebase/roster: Homebase roster vs. Altrixs staff (onboarding / offboarding review). */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const data = await loadRosterMatch(g.ctx.organizationId);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_ROSTER_VIEW', 'HomebaseEmployee', null, { ...data.counts });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return homebaseServerError('roster', err);
  }
}

const postSchema = z.object({
  homebaseId: z.string().min(1).max(100),
  action: z.enum(['confirm', 'reject', 'link', 'unlink']),
  userId: z.string().min(1).max(100).nullable().optional(),
});

/** POST /api/hr/homebase/roster: confirm / reject a name suggestion, link manually, or unlink. */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return hrJsonError('Invalid request', 400);
  try {
    const out = await updateEmployeeLink(g.ctx.organizationId, g.ctx.userId, parsed.data.homebaseId, parsed.data.action, parsed.data.userId ?? null);
    if (out.ok === false) return hrJsonError(out.error, out.status);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_LINK_UPDATE', 'HomebaseEmployee', parsed.data.homebaseId, {
      linkAction: parsed.data.action,
      linkedUserId: out.link.linkedUserId,
      linkStatus: out.link.linkStatus,
    });
    return NextResponse.json({ success: true, link: out.link });
  } catch (err) {
    return homebaseServerError('roster link', err);
  }
}

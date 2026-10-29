import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessWaitlist } from '@/lib/waitlist/manage';
import { canManageWaitlist } from '@/lib/waitlist/standard';
import { convertWaitlistToIntake } from '@/lib/intake/manage';

export const runtime = 'nodejs';

const bodySchema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(50) });

/**
 * Bulk "send intake" for selected entries: one intake link per entry (an open link is reused).
 * Links are not emailed automatically (email / SMS delivery of intake links is not set up):
 * staff copy them from the result.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessWaitlist(gate.role) || !canManageWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { ids } = bodySchema.parse(await req.json());
    const results: { id: string; ok: boolean; token?: string; reused?: boolean; error?: string }[] = [];
    for (const id of [...new Set(ids)]) {
      const r = await convertWaitlistToIntake(gate.organizationId, id, gate.userId);
      if (r.ok === false) results.push({ id, ok: false, error: r.error });
      else results.push({ id, ok: true, token: r.invite.token, reused: 'reused' in r ? Boolean(r.reused) : false });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'intake_invite',
      metadata: {
        source: 'waitlist_bulk',
        count: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        waitlistEntryIds: results.map((r) => r.id),
      },
    });
    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? 'Select 1 to 50 entries' : err.message || 'Could not send intake' },
      { status: 400 }
    );
  }
}

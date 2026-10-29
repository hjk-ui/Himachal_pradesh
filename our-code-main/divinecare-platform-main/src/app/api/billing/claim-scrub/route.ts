import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessClaimScrubber,
  getClaimScrubSnapshot,
  reScrubAllClaims,
} from '@/lib/billing/claimScrubber';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessClaimScrubber(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/billing/claim-scrubber')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await getClaimScrubSnapshot(actorFrom(gate));
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[billing claim-scrub GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load claim scrubber' }, { status: 500 });
  }
}

const postSchema = z.object({
  action: z.enum(['re_scrub_all']).default('re_scrub_all'),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessClaimScrubber(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/billing/claim-scrubber')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = postSchema.parse(await req.json().catch(() => ({})));
    if (body.action !== 're_scrub_all') {
      return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
    }
    const data = await reScrubAllClaims(actorFrom(gate));
    return NextResponse.json({ success: true, ...data });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid scrub request' : (err as Error).message;
    console.error('[billing claim-scrub POST]', err);
    return NextResponse.json({ success: false, error: message || 'Could not re-scrub claims' }, { status: 400 });
  }
}

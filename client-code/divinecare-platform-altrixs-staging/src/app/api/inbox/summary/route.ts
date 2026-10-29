import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { summarizeInbox } from '@/lib/inbox/core';
import { inboxDepsWithTiming, loadAllSections } from '@/lib/inbox/service';
import { serverTiming } from '@/lib/perf/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/inbox/summary — item count per inbox section the caller's role may see.
 * Counts are computed from the same rows GET /api/inbox/items returns. The rows include
 * client names, so the read is audited (counts only, no clientId or names in metadata).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/inbox')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const now = new Date();
    const actor = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
    const timing = serverTiming();
    const deps = inboxDepsWithTiming((key, ms, outcome) => timing.record(`inbox_${key}`, ms, outcome));
    const summary = summarizeInbox(await loadAllSections(actor, deps, now), now);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'inbox',
      metadata: {
        view: 'summary',
        total: summary.total,
        counts: Object.fromEntries(summary.sections.map((s) => [s.key, s.count])),
      },
    });
    return NextResponse.json({ success: true, summary }, { headers: { 'Server-Timing': timing.header(), 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/inbox/summary GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load inbox' }, { status: 500 });
  }
}

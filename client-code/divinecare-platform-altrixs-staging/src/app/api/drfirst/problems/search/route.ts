import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { searchProblems } from '@/lib/services/drfirstCommands';
import { requireDrFirstCaller } from '../../_lib/access';
import { knownEnabled, recordOutcome } from '../../_lib/features';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/problems/search?q= — ICD-10 search through Rcopia
 * (search_problem) for the diagnosis picker. Prescriber or ADMIN (DrFirst caller
 * gate). Returns only ICD-10-CM codes DrFirst itself returned; never a guessed
 * code. When DrFirst is not configured, or refuses the command for this login
 * (not_permitted, cached for a few hours), answers 200 with enabled:false and
 * no results so the picker silently keeps its local list.
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  const c = g.caller;

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2 || q.length > 80) return NextResponse.json({ error: 'q must be 2-80 characters' }, { status: 400 });
  if (DEMO_MODE) return NextResponse.json({ success: true, enabled: false, reason: 'not_configured', results: [] });
  if (knownEnabled('search_problem') === false) {
    return NextResponse.json({ success: true, enabled: false, reason: 'not_permitted', results: [] });
  }

  const res = await searchProblems(q, c.rcopiaUsername || undefined);
  recordOutcome('search_problem', res);
  await writeAuditLog({
    action: 'DRFIRST_PROBLEM_SEARCH',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'diagnosis_search',
    resourceId: 'search_problem',
    outcome: res.ok ? 'SUCCESS' : 'FAILURE',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: { queryLength: q.length, results: res.results.length, errorCode: res.error?.code ?? null },
  });

  if (res.error?.code === 'not_permitted') {
    return NextResponse.json({ success: true, enabled: false, reason: 'not_permitted', results: [] });
  }
  if (!res.ok) return NextResponse.json({ error: 'DrFirst problem search failed', code: res.error?.code }, { status: 502 });
  return NextResponse.json({ success: true, enabled: true, results: res.results.slice(0, 25) });
}

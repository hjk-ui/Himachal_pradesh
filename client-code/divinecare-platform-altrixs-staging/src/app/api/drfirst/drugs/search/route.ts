import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { searchDrugDetail } from '@/lib/services/drfirstCommands';
import { requireDrFirstCaller } from '../../_lib/access';
import { knownEnabled, recordOutcome } from '../../_lib/features';

export const dynamic = 'force-dynamic';

const NOT_ENABLED = "Drug search isn't enabled for this DrFirst account";

/**
 * GET /api/drfirst/drugs/search?q= — search_drug_detail. DrFirst refuses this
 * command for the Altrixs login (not_permitted, Oct 2026): the first refusal is
 * cached and the route answers 403 with a clear message. No screen uses it; a
 * caller can feature-detect with it before showing any drug search.
 * The raw DrFirst response is not parsed or returned (layout unverified);
 * success only reports that the command is enabled.
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  const c = g.caller;

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2 || q.length > 80) return NextResponse.json({ error: 'q must be 2-80 characters' }, { status: 400 });
  if (DEMO_MODE) return NextResponse.json({ error: 'DrFirst is not configured on this server.', enabled: false }, { status: 503 });
  if (knownEnabled('search_drug_detail') === false) {
    return NextResponse.json({ error: NOT_ENABLED, enabled: false, code: 'not_permitted' }, { status: 403 });
  }

  const res = await searchDrugDetail(q, c.rcopiaUsername || undefined);
  recordOutcome('search_drug_detail', res);
  await writeAuditLog({
    action: 'DRFIRST_DRUG_SEARCH',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'drug_search',
    resourceId: 'search_drug_detail',
    outcome: res.ok ? 'SUCCESS' : 'FAILURE',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: { queryLength: q.length, errorCode: res.error?.code ?? null },
  });

  if (res.error?.code === 'not_permitted') {
    return NextResponse.json({ error: NOT_ENABLED, enabled: false, code: 'not_permitted' }, { status: 403 });
  }
  if (!res.ok) return NextResponse.json({ error: 'DrFirst drug search failed', code: res.error?.code }, { status: 502 });
  return NextResponse.json({ success: true, enabled: true });
}

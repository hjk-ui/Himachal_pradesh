import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadDashboardHome, type DashboardHome } from '@/lib/dashboard/homeData';
import { registerCaseloadScopedCache, scopedKey, serverTiming, TtlCache } from '@/lib/perf/cache';

/** Whole home per viewer (org + user + role + location) for 30s: back/forward and redirects do not recompute */
const HOME_CACHE_TTL_MS = 30_000;
const homeCache = registerCaseloadScopedCache(new TtlCache<DashboardHome>(HOME_CACHE_TTL_MS, 500));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/home?location=<Location id|all>
 * One aggregated read for the signed-in user's role home: Caseload Health (caseload roles: their
 * assigned clients; leadership: organization or one location), today's schedule on the practice
 * clock, and the role's counters. Org scoped; locked Part 2 / protected clients are left out of
 * counts and shown by alias on the schedule. The schedule rows carry client names (PHI), so the
 * read is audited with counts only (no client ids or names in metadata).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const location = (new URL(req.url).searchParams.get('location') ?? '').trim() || null;
  try {
    const timing = serverTiming();
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
    const key = scopedKey({ ...viewer, role: String(gate.role) }, 'dashboard-home', location ?? 'all');
    const fresh = new URL(req.url).searchParams.get('fresh') === '1';
    let computed = false;
    const home = await homeCache.getOrCompute(
      key,
      () => {
        computed = true;
        return loadDashboardHome(viewer, { location, onTiming: (part, ms) => timing.record(`home_${part}`, ms) });
      },
      { fresh }
    );
    if (!computed) timing.mark('cache', 'hit');
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'dashboardHome',
      metadata: {
        scope: home.scope,
        locationFilter: Boolean(home.location.applied),
        caseloadClients: home.caseloadHealth?.activeClients ?? null,
        hiddenSensitiveClients: home.caseloadHealth?.hiddenSensitiveClients ?? null,
        scheduleRows: home.schedule?.rows.length ?? null,
        tiles: home.caseloadHealth?.tiles.length ?? 0,
        counters: Object.keys(home.counters).length,
      },
    });
    return NextResponse.json({ success: true, home }, { headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing.header() } });
  } catch (err) {
    console.error('[api/dashboard/home GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the home dashboard' }, { status: 500 });
  }
}

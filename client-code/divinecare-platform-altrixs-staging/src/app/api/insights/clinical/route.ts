import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { isBedrockConfigured } from '@/lib/ai/bedrockService';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { dayOf } from '@/lib/clinical/sessionFrequency';
import { serverTiming } from '@/lib/perf/cache';
import { weekStart } from '@/lib/insights/clinical/load';
import { buildPopulationView, CARE_GAPS, EMPTY_FILTERS, filterOptions, tileCounts } from '@/lib/insights/clinical/population';
import { TIER_RULES } from '@/lib/insights/clinical/rules';
import { InsightsBusyError, loadInsightRows, runAndStoreInsights, type StoredInsights } from '@/lib/insights/clinical/snapshot';
import { INSIGHTS_PATH, insightsScopeFor, viewerClientWhere, viewerLockedIds } from '@/lib/insights/clinical/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/insights/clinical — Clinical Insights for the viewer's scope (org-wide for leadership;
 * assigned / care-team clients for caseload roles), read from the snapshot (nightly:
 * scripts/clinical-insights-scan.ts). ?refresh=1 re-evaluates the viewer's scope now (one scan per
 * org at a time — Postgres advisory lock; a busy scan returns the current snapshot with scanBusy).
 * The first visit before any snapshot exists scans once. Protected records the viewer cannot open
 * are dropped before any clinical data is read and only counted. Audited (counts only).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, INSIGHTS_PATH, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const timing = serverTiming();
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
    const refresh = new URL(req.url).searchParams.get('refresh') === '1';
    const clientWhere = viewerClientWhere(viewer);
    const lockedIds = viewerLockedIds(viewer);
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const scope = insightsScopeFor(gate.role, gate);

    const hasSnapshot = refresh
      ? true
      : Boolean(await prisma.clinicalInsightSnapshot.findFirst({ where: { organizationId: gate.organizationId }, select: { clientId: true } }));
    let stored: StoredInsights | null = null;
    let scanBusy = false;
    if (refresh || !hasSnapshot) {
      try {
        stored = await timing.time('scan', () =>
          runAndStoreInsights({
            organizationId: gate.organizationId, clientWhere, lockedIds,
            trigger: refresh ? 'manual' : 'first-visit', scope,
            actor: { userId: gate.userId, role: gate.role }, timeZone,
          })
        );
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'clinicalInsightsScan', resourceId: stored.runId,
          metadata: { trigger: refresh ? 'manual' : 'first-visit', scope, durationMs: stored.durationMs, clientsScanned: stored.clientsScanned, sensitiveHidden: stored.sensitiveHidden },
        });
      } catch (err) {
        if (!(err instanceof InsightsBusyError)) throw err;
        scanBusy = true;
      }
    }

    const read = await timing.time('read', () => loadInsightRows({ organizationId: gate.organizationId, clientWhere, lockedIds }));
    const now = new Date();
    const today = dayOf(now, timeZone);
    const t0 = performance.now();
    const view = buildPopulationView(read.rows, read.histories, weekStart(today), today.slice(0, 7));
    const tiles = tileCounts(read.rows, EMPTY_FILTERS, gate.userId);
    timing.record('aggregate', performance.now() - t0);

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'clinicalInsights',
      metadata: {
        source: stored ? 'scan' : 'snapshot', scope, clientsInScope: read.clientsInScope, clientsReturned: read.rows.length,
        notScanned: read.notScanned, sensitiveHidden: read.sensitiveHidden, tiers: JSON.stringify(tiles.tiers),
      },
    });

    return NextResponse.json(
      {
        success: true,
        generatedAt: read.scannedAt,
        today,
        lastRun: read.lastRun,
        scanBusy,
        scope,
        viewerId: gate.userId,
        clientsInScope: read.clientsInScope,
        notScanned: read.notScanned,
        sensitiveHidden: read.sensitiveHidden,
        truncated: stored?.truncated ?? false,
        aiConfigured: isBedrockConfigured(),
        rows: read.rows,
        tiles,
        view,
        options: filterOptions(read.rows),
        rules: TIER_RULES.map((r) => ({ id: r.id, tier: r.tier, text: r.text })),
        careGaps: CARE_GAPS,
      },
      { headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': timing.header() } }
    );
  } catch (err) {
    console.error('[insights/clinical GET] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load clinical insights' }, { status: 500 });
  }
}

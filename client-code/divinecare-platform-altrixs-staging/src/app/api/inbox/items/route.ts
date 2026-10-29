import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { dedupeAcrossSections, paginate, parsePaging } from '@/lib/inbox/core';
import { isInboxSectionKey, sectionsForRole } from '@/lib/inbox/sections';
import { inboxDepsWithTiming, loadAllSections, loadSection } from '@/lib/inbox/service';
import { serverTiming } from '@/lib/perf/cache';
import type { InboxGroup, InboxItem } from '@/lib/inbox/types';

/** Rows returned per collapsed group (the group header shows the full count) */
const GROUP_ROW_CAP = 500;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/inbox/items?section=all|<key>&page=&pageSize= — inbox rows sorted by priority then age.
 * Each row carries a client display (protected records the caller cannot open read "Protected record"
 * with no details), its age, priority and a link to act. `total` equals the section's summary count.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/inbox')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const section = url.searchParams.get('section') || 'all';
  const { page, pageSize } = parsePaging(url.searchParams.get('page'), url.searchParams.get('pageSize'));
  const role = String(gate.role);

  if (section !== 'all' && !isInboxSectionKey(section)) {
    return NextResponse.json({ success: false, error: 'Unknown section' }, { status: 400 });
  }
  if (section !== 'all' && !sectionsForRole(role).some((s) => s.key === section)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'inbox', outcome: 'DENIED', metadata: { section } });
    return NextResponse.json({ success: false, error: 'This section is not available for your role' }, { status: 403 });
  }

  try {
    const now = new Date();
    const actor = { organizationId: gate.organizationId, userId: gate.userId, role };
    const timing = serverTiming();
    const INBOX_DEPS = inboxDepsWithTiming((key, ms, outcome) => timing.record(`inbox_${key}`, ms, outcome));
    let rows: InboxItem[];
    let notice: string | null = null;
    let errors: string[] = [];
    let groups: (Omit<InboxGroup, 'items'> & { total: number; items: InboxItem[] })[] = [];
    if (section === 'all') {
      const results = await loadAllSections(actor, INBOX_DEPS, now);
      rows = dedupeAcrossSections(results.flatMap((r) => r.items));
      errors = results.filter((r) => r.error).map((r) => r.key);
    } else {
      const result = await loadSection(actor, section, INBOX_DEPS, now);
      rows = result.items;
      notice = result.notice;
      if (result.error) errors = [section];
      groups = (result.groups ?? []).map((g) => ({ key: g.key, label: g.label, total: g.items.length, items: g.items.slice(0, GROUP_ROW_CAP) }));
    }
    const pageData = paginate(rows, page, pageSize);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'inbox',
      metadata: {
        view: 'items',
        section,
        page,
        total: pageData.total,
        returned: pageData.items.length,
        protectedRows: pageData.items.filter((i) => i.protected).length,
        groups: Object.fromEntries(groups.map((g) => [g.key, g.total])),
      },
    });
    return NextResponse.json(
      { success: true, section, ...pageData, groups, notice, failedSections: errors },
      { headers: { 'Server-Timing': timing.header(), 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[api/inbox/items GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load inbox items' }, { status: 500 });
  }
}

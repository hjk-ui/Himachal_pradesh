import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { canPickHuddleProvider, canViewHuddle, HUDDLE_RESOURCE, parseHuddleDate, resolveHuddleProvider } from '@/lib/huddle/core';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { addDaysYmd } from '@/lib/dashboard/practiceDay';
import { listHuddleProviders, loadHuddleSheet } from '@/lib/huddle/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/huddle?date=YYYY-MM-DD|today|tomorrow&providerId=&compact=1 — the huddle sheet: one
 * provider's visits for a practice day with a one-line digest summary (no AI call) and
 * deterministic flags. Providers get their own schedule only; leadership may pass providerId
 * (and gets the provider list). compact=1 (Today page entry) skips the summaries.
 * Every view is audited with counts only (no names or ids in metadata).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canViewHuddle(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: HUDDLE_RESOURCE, outcome: 'DENIED', metadata: { reason: 'role' } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Your role cannot view the huddle sheet' }, { status: 403 });
  }
  const url = new URL(req.url);
  const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const date = parseHuddleDate(url.searchParams.get('date'), now, timeZone);
    const providerId = resolveHuddleProvider({ userId: gate.userId, role: String(gate.role) }, url.searchParams.get('providerId'));
    const compact = url.searchParams.get('compact') === '1';
    const picker = canPickHuddleProvider(gate.role);
    const [sheet, providers] = await Promise.all([
      loadHuddleSheet(viewer, { providerId, date, compact }, now),
      picker && !compact ? listHuddleProviders(gate.organizationId) : Promise.resolve(null),
    ]);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: HUDDLE_RESOURCE,
      metadata: {
        date,
        ownSchedule: providerId === gate.userId,
        compact,
        visits: sheet.counts.visits,
        flagged: sheet.counts.flagged,
        flags: sheet.counts.flags,
        summaries: sheet.visits.filter((v) => v.summary).length,
      },
    });
    const today = toPracticeWallTime(now, timeZone).date;
    return NextResponse.json({ success: true, sheet, providers, canPickProvider: picker, dates: { today, tomorrow: addDaysYmd(today, 1) } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[api/huddle GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the huddle sheet' }, { status: 500 });
  }
}

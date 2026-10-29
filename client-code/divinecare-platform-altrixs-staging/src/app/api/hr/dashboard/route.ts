import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { computeExpirations, expiredLicenseFlags, summarizeExpirations, syncHrReminders } from '@/lib/hr/expirations';
import { listChecklists } from '@/lib/hr/checklists';
import { listChangeRequests } from '@/lib/hr/people';
import { workforceAnalytics } from '@/lib/hr/orgChart';
import { auditHr, hrGate, hrServerError, isMissingTable, loadRoster } from '@/lib/hr/server';
import { ymd } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/dashboard: HR + leadership home (expirations, reminders, workflows, approvals). */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { organizationId } = g.ctx;
  try {
    const refresh = new URL(req.url).searchParams.get('refresh') === '1';
    await syncHrReminders(organizationId, { force: refresh }).catch((err) => console.error('[hr reminders]', err));
    const roster = await loadRoster(organizationId);
    const { items, today, settings } = await computeExpirations(organizationId, { attentionOnly: true, roster });
    const [checklists, changeRequests, licenseFlags, workforce] = await Promise.all([
      listChecklists(organizationId, { status: 'active', today }),
      listChangeRequests(organizationId, { status: 'pending' }),
      expiredLicenseFlags(organizationId),
      workforceAnalytics(organizationId),
    ]);
    let tasks: Awaited<ReturnType<typeof prisma.hrTask.findMany>> = [];
    let pendingTimeOff = 0;
    let reviewsDue = 0;
    try {
      [tasks, pendingTimeOff, reviewsDue] = await Promise.all([
        prisma.hrTask.findMany({
          where: { organizationId, audience: 'hr', status: 'open' },
          orderBy: [{ dueOn: 'asc' }],
          take: 150,
        }),
        prisma.hrTimeOffRequest.count({ where: { organizationId, status: 'pending' } }),
        prisma.hrPerformanceReview.count({ where: { organizationId, status: { not: 'complete' }, dueOn: { lte: new Date(`${today}T12:00:00.000Z`) } } }),
      ]);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
    const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
    await auditHr(g.ctx, req, 'LIST', 'hrDashboard', null, { items: items.length });
    return NextResponse.json({
      success: true,
      today,
      settings: { blockSchedulingWhenLicenseExpired: settings.blockSchedulingWhenLicenseExpired, aiDigest: settings.aiDigest, dueSoonDays: settings.dueSoonDays, urgentDays: settings.urgentDays },
      summary: summarizeExpirations(items),
      items: items.slice(0, 300),
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        detail: t.detail,
        dueOn: ymd(t.dueOn),
        severity: t.severity,
        href: t.href,
        subjectUserId: t.subjectUserId,
        subjectName: t.subjectUserId ? nameOf.get(t.subjectUserId) ?? null : null,
      })),
      onboarding: checklists.filter((c) => c.kind === 'onboarding').map((c) => ({ ...c, tasks: [] })),
      offboarding: checklists.filter((c) => c.kind === 'offboarding').map((c) => ({ ...c, tasks: [] })),
      changeRequests: changeRequests.map((r) => ({ ...r, name: nameOf.get(r.userId) ?? 'Staff' })),
      pendingTimeOff,
      reviewsDue,
      licenseFlags,
      workforce: { headcount: workforce.headcount, hires12m: workforce.hires12m, separations12m: workforce.separations12m, turnover12mPct: workforce.turnover12mPct },
    });
  } catch (err) {
    return hrServerError('dashboard', err);
  }
}

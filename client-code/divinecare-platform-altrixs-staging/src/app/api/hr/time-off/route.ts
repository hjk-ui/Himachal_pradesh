import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SCHEDULE_INTEGRATION, balancesFor, listTimeOff, requestTimeOff } from '@/lib/hr/timeOff';
import { auditHr, hrGate, hrJsonError, hrServerError, loadHrSettings, loadRoster } from '@/lib/hr/server';
import { TIME_OFF_TYPES, isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/**
 * GET /api/hr/time-off?from=&to=: HR / leadership see everyone; a supervisor sees their direct
 * reports and themself; everyone else sees their own requests.
 */
export async function GET(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const sp = new URL(req.url).searchParams;
    const admin = isHrAdminRole(g.ctx.role);
    const roster = await loadRoster(g.ctx.organizationId);
    const team = roster.filter((p) => p.managerUserId === g.ctx.userId).map((p) => p.userId);
    const userIds = admin ? undefined : [g.ctx.userId, ...team];
    const [requests, settings] = await Promise.all([
      listTimeOff(g.ctx, { userIds, from: sp.get('from') || undefined, to: sp.get('to') || undefined }),
      loadHrSettings(g.ctx.organizationId),
    ]);
    const visibleIds = admin ? roster.map((p) => p.userId) : (userIds as string[]);
    const balances = await balancesFor(g.ctx.organizationId, visibleIds);
    if (admin) await auditHr(g.ctx, req, 'LIST', 'hrTimeOff', null, { count: requests.length });
    return NextResponse.json({
      success: true,
      viewer: { userId: g.ctx.userId, admin, teamSize: team.length },
      requests,
      balances,
      people: roster.filter((p) => visibleIds.includes(p.userId)).map((p) => ({ userId: p.userId, name: p.name, role: p.role, fte: null })),
      types: TIME_OFF_TYPES,
      policy: {
        sickAccrualHoursWorked: settings.sickAccrualHoursWorked,
        sickAnnualAccrualCap: settings.sickAnnualAccrualCap,
        sickBalanceCap: settings.sickBalanceCap,
        ptoPolicy: settings.ptoPolicy,
        confirmed: Boolean(settings.policyConfirmedAt),
      },
      scheduleIntegration: SCHEDULE_INTEGRATION,
    });
  } catch (err) {
    return hrServerError('time off', err);
  }
}

const requestSchema = z.object({
  userId: z.string().max(128).optional(),
  type: z.enum(TIME_OFF_TYPES.map((t) => t.key) as unknown as [string, ...string[]]),
  startDate: z.string().trim().length(10),
  endDate: z.string().trim().length(10),
  hours: z.number().min(0.25).max(2000),
  note: z.string().trim().max(300).optional().nullable(),
});

/** POST /api/hr/time-off: request time off (HR can enter one for someone else). */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the dates and hours', 400);
  }
  try {
    const onBehalf = Boolean(body.userId && body.userId !== g.ctx.userId);
    if (onBehalf && !isHrAdminRole(g.ctx.role)) return hrJsonError('You can only request your own time off', 403);
    const result = await requestTimeOff(g.ctx, body, { onBehalf });
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrTimeOffRequest', result.id, { staffUserId: result.userId, type: body.type, onBehalf });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('time off request', err);
  }
}

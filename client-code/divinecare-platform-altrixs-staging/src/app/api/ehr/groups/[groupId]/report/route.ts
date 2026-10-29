import { groupAttendanceReport } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateGroup, json } from '../../_shared';

export const runtime = 'nodejs';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (default last 90 days): per-member attendance, sessions held, notes, claims. */
export async function GET(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const url = new URL(req.url);
  const toRaw = url.searchParams.get('to') ?? '';
  const fromRaw = url.searchParams.get('from') ?? '';
  const to = YMD.test(toRaw) ? new Date(`${toRaw}T00:00:00Z`) : new Date();
  const from = YMD.test(fromRaw) ? new Date(`${fromRaw}T00:00:00Z`) : new Date(to.getTime() - 90 * 86_400_000);
  const r = await groupAttendanceReport(g.actor, groupId, g.kind, { from, to: new Date(to.getTime() + 86_400_000) });
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'READ', resourceType: 'clinicalGroupReport', resourceId: groupId, patientIds: r.patientIds });
  return json(200, { success: true, summary: r.summary, members: r.members });
}

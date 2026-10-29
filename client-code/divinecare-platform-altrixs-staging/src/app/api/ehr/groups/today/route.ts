import { listTodaySessions } from '@/lib/groups/store';
import { auditPhiAccessGroup, gateKind, json } from '../_shared';

export const runtime = 'nodejs';

/** GET ?kind=&mine=1&date=YYYY-MM-DD: the day's sessions of one kind (counts only, no member names). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const g = await gateKind(url.searchParams.get('kind'));
  if (g.ok === false) return g.res;
  const date = url.searchParams.get('date');
  const r = await listTodaySessions(g.actor, g.kind, {
    mine: url.searchParams.get('mine') === '1',
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  });
  await auditPhiAccessGroup(g, req, { action: 'LIST', resourceType: 'clinicalGroupSession', metadata: { sessions: r.sessions.length } });
  return json(200, { success: true, ...r });
}

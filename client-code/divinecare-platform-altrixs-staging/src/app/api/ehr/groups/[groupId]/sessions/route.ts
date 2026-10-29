import { z } from 'zod';
import { createSession, generateSessions } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateGroup, json, readJson } from '../../_shared';

export const runtime = 'nodejs';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate'), count: z.number().int().min(1).max(26), fromDate: z.string().regex(YMD).nullable().optional() }),
  z.object({
    mode: z.literal('single'),
    date: z.string().regex(YMD),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    durationMinutes: z.number().int().min(15).max(480).nullable().optional(),
  }),
]);

/** POST: schedule sessions from the group's repeat rule (series helpers) or one ad hoc session. */
export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params;
  const g = await gateGroup(groupId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const data = body.data;
  if (data.mode === 'generate') {
    const r = await generateSessions(g.actor, groupId, { count: data.count, fromDate: data.fromDate });
    if (r.ok === false) return failJson(r);
    await auditPhiAccessGroup(g, req, { action: 'GROUP_SESSIONS_CREATE', resourceType: 'clinicalGroup', resourceId: groupId, metadata: { created: r.created.length } });
    return json(201, { success: true, created: r.created });
  }
  const r = await createSession(g.actor, groupId, { date: data.date, startTime: data.startTime, durationMinutes: data.durationMinutes });
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'GROUP_SESSIONS_CREATE', resourceType: 'clinicalGroup', resourceId: groupId, metadata: { created: 1 } });
  return json(201, { success: true, created: [r.session] });
}

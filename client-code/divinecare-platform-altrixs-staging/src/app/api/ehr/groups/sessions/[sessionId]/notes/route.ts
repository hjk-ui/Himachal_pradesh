import { z } from 'zod';
import { saveNotes } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateSession, json, noteValuesSchema, readJson } from '../../../_shared';

export const runtime = 'nodejs';

const schema = z.object({
  topic: z.string().max(300).nullable().optional(),
  shared: noteValuesSchema.nullable().optional(),
  individuals: z.array(z.object({ clientId: z.string().min(1).max(64), values: noteValuesSchema })).max(60).optional(),
});

/** PUT: save the shared and individual sections; writes a draft progress note in each attendee's own chart. */
export async function PUT(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await saveNotes(g.actor, sessionId, body.data);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'WRITE', resourceType: 'progressNote', resourceId: sessionId, patientIds: r.patientIds, metadata: { source: 'group_session', notes: r.notes.length } });
  return json(200, { success: true, notes: r.notes });
}

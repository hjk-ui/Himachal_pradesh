import { z } from 'zod';
import { saveAttendance } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateSession, json, readJson } from '../../../_shared';

export const runtime = 'nodejs';

const schema = z.object({
  marks: z
    .array(
      z.object({
        clientId: z.string().min(1).max(64),
        status: z.enum(['unmarked', 'present', 'late', 'left_early', 'absent', 'excused']),
        minutesAttended: z.number().int().min(0).max(480).nullable().optional(),
        patientLocationType: z.enum(['home', 'other']).nullable().optional(),
      })
    )
    .min(1)
    .max(60),
});

/** PUT: attendance marks for the session (also mirrors each member's group visit status). */
export async function PUT(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await saveAttendance(g.actor, sessionId, body.data.marks);
  if (r.ok === false) return failJson(r);
  await auditPhiAccessGroup(g, req, { action: 'WRITE', resourceType: 'clinicalGroupAttendance', resourceId: sessionId, patientIds: r.patientIds });
  return json(200, { success: true, saved: r.saved, problems: r.problems });
}

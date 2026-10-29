import { z } from 'zod';
import { signNotes } from '@/lib/groups/store';
import { auditPhiAccessGroup, failJson, gateSession, json, readJson } from '../../../_shared';

export const runtime = 'nodejs';

const schema = z.object({
  attested: z.boolean(),
  /** Omit to sign every attendee's note */
  clientIds: z.array(z.string().min(1).max(64)).max(60).nullable().optional(),
  /** Late entry (signed after the practice deadline): the facilitator's reason, min 10 characters */
  lateEntryReason: z.string().trim().max(500).optional(),
});

/** POST: sign one, several or all attendees' notes (attestation required); signed notes go to the claim builder. */
export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const g = await gateSession(sessionId);
  if (g.ok === false) return g.res;
  const body = await readJson(req, schema);
  if (body.ok === false) return body.res;
  const r = await signNotes(g.actor, sessionId, body.data);
  if (r.ok === false) return failJson(r);
  const signed = r.results.filter((x) => x.ok).map((x) => x.clientId);
  await auditPhiAccessGroup(g, req, {
    action: 'NOTE_SIGN',
    resourceType: 'progressNote',
    resourceId: sessionId,
    patientIds: signed,
    metadata: {
      source: 'group_session',
      signed: signed.length,
      failed: r.results.length - signed.length,
      claims: r.results.filter((x) => x.claim?.created).length,
    },
  });
  return json(200, { success: true, results: r.results });
}

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { notifyPacket, NOTIFY_CHANNELS } from '@/lib/consents/library/delivery';
import { scopedClient } from '@/lib/consents/library/store';
import { chartGate, consentGate, json } from '../../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ channels: z.array(z.enum(NOTIFY_CHANNELS)).min(1).max(3) });

/**
 * POST — notify the client again about an unsigned portal packet (portal / email / SMS; SMS goes
 * through the SMS consent gate, no PHI in texts or emails). Records the resend. Audited NOTIFY.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!id || id.length > 128) return json({ success: false, error: 'Invalid packet' }, 400);
  const p = await prisma.consentPacket.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { clientId: true } });
  if (!p || !(await scopedClient(g.actor, p.clientId))) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, p.clientId, `/api/consents/library/packets/${id}/resend`, 'consentPacket');
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: 'Choose how to notify the client.' }, 400);
  const r = await notifyPacket({ organizationId: g.gate.organizationId, packetId: id, channels: parsed.data.channels, actor: { userId: g.gate.userId, role: g.gate.role } });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'NOTIFY',
    resourceType: 'consentPacket',
    resourceId: id,
    patientId: p.clientId,
    outcome: r.ok ? undefined : 'DENIED',
    metadata: r.ok === true ? { channels: r.results.map((x) => `${x.channel}:${x.ok ? 'sent' : 'not_sent'}`) } : { status: r.status },
  });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  return json({ success: true, results: r.results });
}

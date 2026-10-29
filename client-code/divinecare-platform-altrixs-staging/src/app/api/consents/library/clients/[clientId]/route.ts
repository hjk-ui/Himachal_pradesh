import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { createPacket, loadClientConsents } from '@/lib/consents/library/store';
import { notifyPacket, NOTIFY_CHANNELS, type NotifyResult } from '@/lib/consents/library/delivery';
import { chartGate, consentGate, json } from '../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ clientId: string }> };

/** GET — the client's consent status (required / signed / expired / revoked / re-sign) and packets. */
export async function GET(req: Request, ctx: Ctx) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { clientId } = await ctx.params;
  const denied = await chartGate(g.gate, req, clientId, `/api/consents/library/clients/${clientId}`, 'clientConsents');
  if (denied) return denied;
  try {
    const r = await loadClientConsents(g.actor, clientId);
    if (r.ok === false) return json({ success: false, error: r.error }, r.status);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'clientConsents', resourceId: clientId, patientId: clientId, metadata: { items: r.view.items.length, needsAction: r.view.items.filter((i) => i.needsAction).length } });
    return json({ success: true, ...r.view });
  } catch (err) {
    console.error('[consents/library/clients GET]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not load consents' }, 500);
  }
}

const value = z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)]);
const sendSchema = z.object({
  method: z.enum(['portal', 'in_office']),
  keys: z.array(z.string().min(1).max(80)).max(40).optional(),
  prefill: z.record(z.string(), z.record(z.string(), value)).optional(),
  /** Portal packets: how to tell the client (portal always; email / SMS optional) */
  notify: z.array(z.enum(NOTIFY_CHANNELS)).max(3).optional(),
});

/** POST — send the composed new-client packet (or chosen templates) to the portal, or open it to sign in office. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { clientId } = await ctx.params;
  const denied = await chartGate(g.gate, req, clientId, `/api/consents/library/clients/${clientId}`, 'consentPacket');
  if (denied) return denied;
  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  const r = await createPacket(g.actor, clientId, parsed.data);
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'CREATE',
    resourceType: 'consentPacket',
    resourceId: r.ok ? r.packetId : null,
    patientId: clientId,
    outcome: r.ok ? undefined : 'DENIED',
    metadata: { method: parsed.data.method, keys: parsed.data.keys ?? 'composed', ...(r.ok ? { items: r.itemCount } : { status: r.status }) },
  });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  let notify: NotifyResult[] = [];
  if (parsed.data.method === 'portal') {
    const n = await notifyPacket({ organizationId: g.gate.organizationId, packetId: r.packetId, channels: parsed.data.notify?.length ? parsed.data.notify : ['portal'], actor: { userId: g.gate.userId, role: g.gate.role } });
    if (n.ok) notify = n.results;
    await auditPhiAccess({ gate: g.gate, req, action: 'NOTIFY', resourceType: 'consentPacket', resourceId: r.packetId, patientId: clientId, metadata: { channels: notify.map((x) => `${x.channel}:${x.ok ? 'sent' : 'not_sent'}`) } });
  }
  invalidateInboxForOrg(g.gate.organizationId);
  return json({ success: true, packetId: r.packetId, itemCount: r.itemCount, carelonAttestation: r.carelonAttestation, notify }, 201);
}

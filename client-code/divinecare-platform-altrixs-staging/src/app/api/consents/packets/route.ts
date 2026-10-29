import type { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { consentGate, json } from '../library/_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ status: z.enum(['SENT', 'SIGNED', 'VOIDED', 'all']).optional() });

/**
 * GET /api/consents/packets — consent packets for the hub's Packets tab: sent / opened / signed /
 * cancelled, with resend count and channels. Org + caseload scoped; locked sensitive charts left
 * out. Last 180 days, newest first, 300 max. Audited LIST (ids only).
 */
export async function GET(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ status: url.searchParams.get('status') || undefined });
  if (!parsed.success) return json({ success: false, error: 'Invalid status' }, 400);
  const status = parsed.data.status ?? 'SENT';
  try {
    const since = new Date(Date.now() - 180 * 86_400_000);
    const scope = clientAccessWhere({ organizationId: g.gate.organizationId, actorUserId: g.gate.userId, actorRole: g.gate.role as Role }) as Prisma.ClientWhereInput;
    const clients = await prisma.client.findMany({ where: { AND: [scope, { organizationId: g.gate.organizationId }] }, select: { id: true, name: true, mrn: true }, take: 20_000 });
    const byId = new Map(clients.map((c) => [c.id, c]));
    const packets = byId.size
      ? await prisma.consentPacket.findMany({
          where: { organizationId: g.gate.organizationId, clientId: { in: [...byId.keys()] }, sentAt: { gte: since }, ...(status === 'all' ? {} : { status }) },
          orderBy: { sentAt: 'desc' },
          take: 300,
          select: { id: true, clientId: true, status: true, method: true, items: true, sentAt: true, viewedAt: true, signedAt: true, lastSentAt: true, sendCount: true, deliveryChannels: true, signerName: true, voidedAt: true },
        })
      : [];
    const locked = packets.length ? await lockedSensitiveClientIds({ organizationId: g.gate.organizationId, userId: g.gate.userId, role: g.gate.role, clientIds: [...new Set(packets.map((p) => p.clientId))] }) : new Set<string>();
    const visible = packets.filter((p) => !locked.has(p.clientId));
    const rows = visible.map((p) => ({
      id: p.id,
      clientId: p.clientId,
      clientName: byId.get(p.clientId)?.name ?? 'Client',
      mrn: byId.get(p.clientId)?.mrn ?? null,
      status: p.status,
      method: p.method,
      itemCount: Array.isArray(p.items) ? p.items.length : 0,
      sentAt: p.sentAt.toISOString(),
      viewedAt: p.viewedAt?.toISOString() ?? null,
      signedAt: p.signedAt?.toISOString() ?? null,
      lastSentAt: p.lastSentAt?.toISOString() ?? null,
      sendCount: p.sendCount,
      channels: p.deliveryChannels,
      signerName: p.signerName,
      voidedAt: p.voidedAt?.toISOString() ?? null,
    }));
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'consentPacket', metadata: { count: rows.length, status, hiddenSensitive: locked.size, packetIds: rows.slice(0, 50).map((r) => r.id) } });
    return json({ success: true, packets: rows, hiddenSensitiveClients: locked.size });
  } catch (err) {
    console.error('[consents/packets GET]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not load packets' }, 500);
  }
}

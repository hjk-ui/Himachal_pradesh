import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { bulkSendPackets, loadWorklist } from '@/lib/consents/library/worklist';
import { WORKLIST_PROGRAMS, type WorklistFilters } from '@/lib/consents/library/worklistCore';
import { NOTIFY_CHANNELS } from '@/lib/consents/library/delivery';
import { consentGate, json } from '../library/_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS = ['needs_attention', 'all', 'complete', 'missing', 'expiring', 'expired', 'revoked'] as const;
const filterSchema = z.object({
  locationId: z.string().max(128).optional(),
  clinicianId: z.string().max(128).optional(),
  program: z.enum(WORKLIST_PROGRAMS).optional(),
  templateKey: z.string().max(80).optional(),
  status: z.enum(STATUS).optional(),
  dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(80).optional(),
  /** counts only (home tiles) */
  summary: z.enum(['1']).optional(),
});

/**
 * GET /api/consents/worklist — required consents that are missing / expiring / expired / revoked,
 * by client (org + caseload scoped; locked Part 2 / sensitive charts left out), with counts and
 * filter options. Audited LIST (counts and client ids only).
 */
export async function GET(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const raw = Object.fromEntries([...url.searchParams].filter(([, v]) => v !== ''));
  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid filter' }, 400);
  try {
    const { summary, ...filters }: WorklistFilters & { summary?: '1' } = parsed.data;
    const w = await loadWorklist(g.actor, filters);
    if (summary) {
      await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'consentWorklist', metadata: { summary: true, needsAttention: w.counts.needsAttention } });
      return json({ success: true, counts: w.counts });
    }
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'consentWorklist',
      metadata: { count: w.clients.length, needsAttention: w.counts.needsAttention, filters: parsed.data, clientIds: w.clients.slice(0, 50).map((c) => c.clientId) },
    });
    return json({ success: true, ...w });
  } catch (err) {
    console.error('[consents/worklist GET]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not load the consents worklist' }, 500);
  }
}

const sendSchema = z.object({
  clientIds: z.array(z.string().min(1).max(128)).min(1).max(200),
  channels: z.array(z.enum(NOTIFY_CHANNELS)).min(1).max(3),
});

/**
 * POST /api/consents/worklist — bulk "send packet": each selected client gets a portal packet with
 * only the consents they still need (or a reminder for the packet already out), notified on the
 * chosen channels (SMS through the SMS consent gate; no PHI in texts or emails). Audited per client.
 */
export async function POST(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  try {
    const results = await bulkSendPackets(g.actor, parsed.data.clientIds, parsed.data.channels);
    for (const r of results) {
      await auditPhiAccess({
        gate: g.gate,
        req,
        action: r.outcome === 'sent' ? 'CREATE' : 'NOTIFY',
        resourceType: 'consentPacket',
        resourceId: r.packetId,
        patientId: r.outcome === 'not_found' ? null : r.clientId,
        outcome: r.outcome === 'not_found' ? 'DENIED' : r.outcome === 'failed' ? 'FAILURE' : undefined,
        metadata: { bulk: true, outcome: r.outcome, items: r.items, channels: r.notify.map((n) => `${n.channel}:${n.ok ? 'sent' : 'not_sent'}`) },
      });
    }
    invalidateInboxForOrg(g.gate.organizationId);
    return json({ success: true, results });
  } catch (err) {
    console.error('[consents/worklist POST]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not send the packets' }, 500);
  }
}

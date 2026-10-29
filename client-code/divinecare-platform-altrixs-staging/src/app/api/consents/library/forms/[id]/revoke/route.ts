import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { revokeConsent } from '@/lib/consents/library/store2';
import { revocationSchema } from '@/lib/consents/library/schema';
import { chartGate, consentGate, json } from '../../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — record a revocation (date received, verbal / written, how received). Altrixs stops relying
 * on the consent immediately: texts / emails stop, AI drafting and the AI Scribe are blocked,
 * disclosures under an ROI / Part 2 consent are blocked, autopay is turned off.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const row = await prisma.consentForm.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { clientId: true } });
  if (!row) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, row.clientId, `/api/consents/library/forms/${id}/revoke`, 'consentRevocation');
  if (denied) return denied;
  const parsed = revocationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  const r = await revokeConsent(g.actor, id, parsed.data);
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'UPDATE',
    resourceType: 'consentRevocation',
    resourceId: id,
    patientId: row.clientId,
    outcome: r.ok ? undefined : 'DENIED',
    metadata: r.ok ? { method: parsed.data.method, receivedVia: parsed.data.receivedVia, effects: r.effects, partial: r.partial } : { status: r.status },
  });
  if (r.ok === false) return json({ success: false, error: r.error, errors: 'errors' in r ? r.errors : undefined }, r.status);
  invalidateInboxForOrg(g.gate.organizationId);
  return json({ success: true, effects: r.effects, partial: r.partial, writtenConfirmationNeeded: r.writtenConfirmationNeeded });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { completeCardSetup, startCardSetup } from '@/lib/patientPayments/service';
import { patientPaymentsDeps, removeSavedCard } from '@/lib/patientPayments/server';
import { autopayGate, scopedClientId } from '../_gate';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), clientId: z.string().min(1).max(128) }),
  z.object({ action: z.literal('complete'), clientId: z.string().min(1).max(128), setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]+$/) }),
  z.object({ action: z.literal('remove'), clientId: z.string().min(1).max(128) }),
]);

/**
 * In-office card capture with the patient present: a SetupIntent (usage off_session) the browser
 * confirms with Stripe Elements. The card number goes from the browser to Stripe only; this route
 * sees the SetupIntent id, then stores brand / last 4 / expiry and sends the Card-on-File
 * Authorization for the patient to sign in the office.
 */
export async function POST(req: Request) {
  const g = await autopayGate('desk');
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const clientId = await scopedClientId(g.gate, body.clientId);
  if (!clientId) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'CardOnFile', patientId: body.clientId, outcome: 'DENIED', metadata: { op: body.action, reason: 'client_not_found' } });
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }
  const deps = patientPaymentsDeps();
  try {
    if (body.action === 'start') {
      const r = await startCardSetup(deps, { organizationId: g.gate.organizationId, clientId, via: 'in_office', actor: g.actor });
      if (r.ok === false) return NextResponse.json({ success: false, error: r.error, code: r.code ?? null }, { status: r.status });
      return NextResponse.json({ success: true, clientSecret: r.clientSecret, publishableKey: r.publishableKey, stripeAccount: r.stripeAccount, mode: r.mode });
    }
    if (body.action === 'complete') {
      const r = await completeCardSetup(deps, { organizationId: g.gate.organizationId, clientId, setupIntentId: body.setupIntentId, via: 'in_office', actor: g.actor });
      if (r.ok === false) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
      return NextResponse.json({
        success: true,
        card: { brand: r.card.brand, last4: r.card.last4, expiry: r.card.expiry },
        packetId: r.packetId,
        signUrl: r.packetId ? `/dashboard/ehr/consents/packet/${r.packetId}` : null,
        authorizationError: r.authorizationError,
      });
    }
    const removed = await removeSavedCard(g.gate.organizationId, clientId);
    await auditPhiAccess({ gate: g.gate, req, action: 'DELETE', resourceType: 'CardOnFile', patientId: clientId, metadata: { op: 'remove', removed } });
    return NextResponse.json({ success: true, removed });
  } catch (err) {
    console.error('[autopay card-setup]', body.action, err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Stripe card setup failed. Try again.' }, { status: 502 });
  }
}

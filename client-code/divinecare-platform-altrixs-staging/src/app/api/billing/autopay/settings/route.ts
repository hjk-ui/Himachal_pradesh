import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditPatientPaymentSettings, patientPaymentsStatus, savePatientPaymentSettings } from '@/lib/patientPayments/server';
import { autopayGate } from '../_gate';

export const runtime = 'nodejs';

/** GET: patient payments status (master switch, Stripe mode, env set / not set, authorization template). */
export async function GET() {
  const g = await autopayGate('read');
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  try {
    const status = await patientPaymentsStatus(g.gate.organizationId);
    return NextResponse.json({ success: true, ...status, canEdit: canEditPatientPaymentSettings(String(g.gate.role)) });
  } catch (err) {
    console.error('[autopay settings GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load AutoPay settings' }, { status: 500 });
  }
}

const cents = z.number().int().min(100).max(10_000_00).nullable();
const putSchema = z.object({
  enabled: z.boolean().optional(),
  chargeCopays: z.boolean().optional(),
  chargeAfterEra: z.boolean().optional(),
  chargeSelfPay: z.boolean().optional(),
  chargeMissedVisitFees: z.boolean().optional(),
  maxPerChargeCents: cents.optional(),
  maxPerMonthCents: cents.optional(),
  statementDescriptorSuffix: z.string().max(22).nullable().optional(),
  receiptSenderName: z.string().max(60).nullable().optional(),
  stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable().optional(),
});

/** PUT: practice leadership changes the master switch, charge rules and caps. Audited. */
export async function PUT(req: Request) {
  const g = await autopayGate('read');
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  if (!canEditPatientPaymentSettings(String(g.gate.role))) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'PatientPaymentSettings', outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Only practice leadership can change AutoPay settings' }, { status: 403 });
  }
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid settings' }, { status: 400 });
  }
  try {
    const settings = await savePatientPaymentSettings(g.gate.organizationId, body, { userId: g.gate.userId, role: String(g.gate.role) });
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error('[autopay settings PUT]', err);
    return NextResponse.json({ success: false, error: 'Could not save AutoPay settings (is the 20261021_patient_autopay migration applied?)' }, { status: 500 });
  }
}

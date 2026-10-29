import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canViewCopayRules, copayFor } from '@/lib/billing/valantBalances';

export const runtime = 'nodejs';

/**
 * GET /api/billing/valant-balances/copay-for?appointmentId=...[&cpt=H2018]
 * Patient copay for an appointment from the client's copay rules: payer = the appointment's payer
 * (else the client's), provider type from the clinician's role, most specific rule wins.
 * Display only; does not change Client.copayAmount or post anything.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canViewCopayRules(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const appointmentId = url.searchParams.get('appointmentId') ?? '';
  const cpt = (url.searchParams.get('cpt') ?? '').trim().slice(0, 10) || null;
  if (!appointmentId) return NextResponse.json({ success: false, error: 'appointmentId is required' }, { status: 400 });
  try {
    const appt = await prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId: gate.organizationId },
      select: {
        id: true, clientId: true, insurancePayer: true,
        client: { select: { insurancePayer: true } },
        clinician: { select: { role: true } },
      },
    });
    if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    const payerName = appt.insurancePayer || appt.client?.insurancePayer || null;
    const pick = await copayFor(gate.organizationId, appt.clientId, { payerName, providerRole: appt.clinician?.role ?? null, cpt });
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'clientCopayRule', resourceId: appt.id, patientId: appt.clientId,
      metadata: { view: 'copay_for_appointment', found: pick.ok },
    });
    return NextResponse.json({
      success: true,
      payerName,
      copay: pick.ok
        ? {
            amountCents: pick.amountCents, specificity: pick.specificity, ambiguous: pick.ambiguous, source: pick.rule.source,
            payerName: pick.rule.payerName, providerType: pick.rule.providerType || null, cptRule: pick.rule.cptRule || null,
          }
        : null,
      reason: pick.reason ?? null,
    });
  } catch (err) {
    console.error('[valant-balances copay-for GET]', err);
    return NextResponse.json({ success: false, error: 'Could not look up the copay' }, { status: 500 });
  }
}

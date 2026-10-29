import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import {
  PATIENT_PAYMENT_ROLES,
  isMissingSchema,
  pickCopayRule,
  providerTypeForRole,
} from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!PATIENT_PAYMENT_ROLES.has(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const appointmentId = (url.searchParams.get('appointmentId') || '').trim();
  if (!appointmentId) {
    return NextResponse.json({ success: false, error: 'appointmentId is required' }, { status: 400 });
  }
  const cpt = (url.searchParams.get('cpt') || '').trim();
  if (cpt.length > 10) {
    return NextResponse.json({ success: false, error: 'cpt is too long' }, { status: 400 });
  }
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId: gate.organizationId },
    select: {
      insurancePayer: true,
      clientId: true,
      client: { select: { insurancePayer: true } },
      clinician: { select: { role: true } },
    },
  });
  if (!appointment) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
  const payerName = (appointment.insurancePayer || appointment.client.insurancePayer || '').trim();
  try {
    const rules = await prisma.clientCopayRule.findMany({
      where: { organizationId: gate.organizationId, clientId: appointment.clientId },
      select: { payerName: true, providerType: true, cptRule: true, amountCents: true, source: true },
    });
    const picked = pickCopayRule(rules, payerName, providerTypeForRole(appointment.clinician?.role), cpt || null);
    return NextResponse.json({ success: true, payerName, copay: picked.copay, reason: picked.reason });
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[copay-for]', err);
      return NextResponse.json({ success: false, error: 'Could not load copay' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      payerName,
      copay: null,
      reason: payerName ? 'no-rules' : 'payer-unknown',
    });
  }
}

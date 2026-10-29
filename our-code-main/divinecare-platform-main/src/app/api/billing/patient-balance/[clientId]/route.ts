import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';
import {
  PATIENT_PAYMENT_ROLES,
  claimCountsTowardPatient,
  claimPatientCents,
  isMissingSchema,
  latestAsOf,
  sumKind,
  type ClaimPatientSlice,
} from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

const emptyBalance = {
  balanceCents: 0,
  openingBalanceCents: 0,
  openingBalanceAsOf: null as string | null,
  prepaymentCreditCents: 0,
  prepaymentAsOf: null as string | null,
  adjustmentsCents: 0,
  claimsPatientCents: 0,
  claimCount: 0,
  patientPaymentsCents: 0,
  paymentCount: 0,
};

export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!PATIENT_PAYMENT_ROLES.has(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { clientId } = await ctx.params;
  const client = await prisma.client.findFirst({
    where: {
      AND: [
        clientAccessWhere({
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role as Role,
        }),
        { id: clientId },
      ],
    },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

  try {
    const [entries, claims, payments] = await Promise.all([
      prisma.patientLedgerEntry.findMany({
        where: { organizationId: gate.organizationId, clientId, supersededAt: null },
        select: { kind: true, amountCents: true, asOf: true },
      }),
      prisma.claim.findMany({
        where: { organizationId: gate.organizationId, clientId },
        select: {
          id: true,
          status: true,
          payer: true,
          amountCents: true,
          patientResponsibility: true,
          frequencyCode: true,
          primaryClaimId: true,
          eraProcessedAt: true,
        },
      }),
      prisma.payment.findMany({
        where: { organizationId: gate.organizationId, clientId, method: { not: 'INSURANCE' } },
        select: { amountCents: true },
      }),
    ]);
    const slices = claims as ClaimPatientSlice[];
    const claimsPatientCents = slices.reduce((sum, claim) => sum + claimPatientCents(claim, slices), 0);
    const claimCount = slices.filter((claim) => claimCountsTowardPatient(claim, slices)).length;
    const patientPaymentsCents = payments.reduce((sum, row) => sum + row.amountCents, 0);
    const ledgerCents = entries.reduce((sum, row) => sum + row.amountCents, 0);
    return NextResponse.json({
      success: true,
      schemaReady: true,
      entries,
      balance: {
        balanceCents: ledgerCents + claimsPatientCents - patientPaymentsCents,
        openingBalanceCents: sumKind(entries, 'opening_balance'),
        openingBalanceAsOf: latestAsOf(entries, 'opening_balance'),
        prepaymentCreditCents: sumKind(entries, 'prepayment_credit'),
        prepaymentAsOf: latestAsOf(entries, 'prepayment_credit'),
        adjustmentsCents: sumKind(entries, 'manual_adjustment'),
        claimsPatientCents,
        claimCount,
        patientPaymentsCents,
        paymentCount: payments.length,
      },
    });
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[patient-balance]', err);
      return NextResponse.json({ success: false, error: 'Could not load patient balance' }, { status: 500 });
    }
    return NextResponse.json({ success: true, schemaReady: false, entries: [], balance: emptyBalance });
  }
}

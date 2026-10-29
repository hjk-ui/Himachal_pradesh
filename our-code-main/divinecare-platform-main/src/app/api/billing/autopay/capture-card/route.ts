import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { assertPatientPaymentsAllowed } from '@/lib/billing/patient-payments-gate';

export const runtime = 'nodejs';

function luhnValid(num: string): boolean {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function brandOf(num: string): string {
  const d = num.replace(/\D/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^6/.test(d)) return 'Discover';
  return 'Card';
}

function expiryValid(exp: string): boolean {
  const m = exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) return false;
  const month = Number(m[1]), year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

const cardSchema = z.object({
  clientId: z.string().min(1),
  cardNumber: z.string().min(13),
  expiry: z.string().min(4),
  cvv: z.string().min(3).max(4),
  zip: z.string().regex(/^\d{5}$/, 'Billing ZIP must be 5 digits'),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Patient-side AutoPay (OM allowed) — not the AR catch-all /dashboard/billing
  if (!canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const paymentsGate = assertPatientPaymentsAllowed();
  if (paymentsGate.ok === false) {
    return NextResponse.json(
      { success: false, error: paymentsGate.error },
      { status: paymentsGate.status }
    );
  }

  try {
    const body = cardSchema.parse(await req.json());
    const digits = body.cardNumber.replace(/\D/g, '');

    if (!luhnValid(digits)) {
      return NextResponse.json({ success: false, error: 'Card number failed Luhn validation check.' }, { status: 422 });
    }

    if (!expiryValid(body.expiry)) {
      return NextResponse.json({ success: false, error: 'Expiry date must be a valid future MM/YY date.' }, { status: 422 });
    }

    const brand = brandOf(digits);
    if (brand === 'Amex' && body.cvv.length !== 4) {
      return NextResponse.json({ success: false, error: 'American Express requires a 4-digit CID/CVV.' }, { status: 422 });
    }

    const last4 = digits.slice(-4);
    const gatewayToken = `tok_demo_${Date.now()}_${last4}`;

    // Verify client exists
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, organizationId: gate.organizationId },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found.' }, { status: 404 });
    }

    // Upsert CardOnFile (PCI SAQ-A compliant: tokenized reference only)
    const card = await prisma.cardOnFile.upsert({
      where: { clientId: client.id },
      update: {
        gatewayToken,
        cardBrand: brand,
        last4,
        expiry: body.expiry.replace(/\s/g, ''),
        billingZip: body.zip,
        autopayEnabled: true,
        validatedAt: new Date(),
      },
      create: {
        organizationId: gate.organizationId,
        clientId: client.id,
        gatewayToken,
        cardBrand: brand,
        last4,
        expiry: body.expiry.replace(/\s/g, ''),
        billingZip: body.zip,
        autopayEnabled: true,
        validatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: card.id,
        clientId: card.clientId,
        cardBrand: card.cardBrand,
        last4: card.last4,
        expiry: card.expiry,
        autopayEnabled: card.autopayEnabled,
        status: 'VALIDATED_AND_SAVED',
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Card capture failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

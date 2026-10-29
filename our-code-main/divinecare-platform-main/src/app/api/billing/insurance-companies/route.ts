import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { isMissingSchema } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const rows = await prisma.valantPayer.findMany({
      where: { organizationId: gate.organizationId },
      include: {
        addresses: { orderBy: { position: 'asc' } },
        payerRegistry: { select: { id: true, payerId: true, name: true, clearinghouse: true } },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({
      success: true,
      canEdit: true,
      rows: rows.map((row) => ({ ...row, waystar: null })),
    });
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[insurance-companies]', err);
      return NextResponse.json({ success: false, error: 'Could not load insurance companies' }, { status: 500 });
    }
    return NextResponse.json({ success: true, canEdit: true, rows: [] });
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();
    const { providerUserId, documentLabel, completed } = body;

    if (!providerUserId || !documentLabel) {
      return NextResponse.json(
        { success: false, error: 'providerUserId and documentLabel are required' },
        { status: 400 }
      );
    }

    // Update in ProviderPayerEnrollment checklist JSON if payer specified, or generic
    const payers = ['Optum MD (Medicaid BH)', 'Medicare', 'CareFirst', 'Aetna', 'UHC/Optum', 'Cigna'];
    for (const payer of payers) {
      const existing = await prisma.providerPayerEnrollment.findUnique({
        where: {
          providerUserId_payerName: {
            providerUserId,
            payerName: payer,
          },
        },
      });

      if (existing) {
        const list = Array.isArray(existing.checklist)
          ? (existing.checklist as Array<{ documentName: string; completed: boolean }>)
          : [];
        const updatedList = list.map((item) =>
          item.documentName === documentLabel ? { ...item, completed: Boolean(completed) } : item
        );
        if (!updatedList.some((i) => i.documentName === documentLabel)) {
          updatedList.push({ documentName: documentLabel, completed: Boolean(completed) });
        }
        await prisma.providerPayerEnrollment.update({
          where: { id: existing.id },
          data: { checklist: updatedList },
        });
      }
    }

    return NextResponse.json({
      success: true,
      providerUserId,
      documentLabel,
      completed: Boolean(completed),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not toggle document' },
      { status: 500 }
    );
  }
}

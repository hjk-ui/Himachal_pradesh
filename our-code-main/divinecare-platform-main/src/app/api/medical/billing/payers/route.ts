import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import type { PayerSetting } from '@/features/medical/types';

export const runtime = 'nodejs';

const MODULE_KEY = 'medical:payer_settings';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/payer-settings')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const row = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
    });

    let payers: PayerSetting[] = [];
    const rawData = row?.data as Record<string, unknown> | null;
    if (rawData && Array.isArray(rawData.payers)) {
      payers = rawData.payers as PayerSetting[];
    }

    return NextResponse.json({
      success: true,
      payers,
    });
  } catch (err: unknown) {
    console.error('Error loading payer settings from database:', err);
    return NextResponse.json({ success: true, payers: [] });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/payer-settings')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();

    let existingPayers: PayerSetting[] = [];
    const row = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
    });
    const rawData = row?.data as Record<string, unknown> | null;
    if (rawData && Array.isArray(rawData.payers)) {
      existingPayers = rawData.payers as PayerSetting[];
    } else {
      existingPayers = [];
    }

    let updatedPayers: PayerSetting[] = [];
    if (Array.isArray(body.payers)) {
      updatedPayers = body.payers;
    } else if (body.payer) {
      const idx = existingPayers.findIndex((p) => p.id === body.payer.id || p.payerId === body.payer.payerId);
      if (idx >= 0) {
        existingPayers[idx] = { ...existingPayers[idx], ...body.payer };
      } else {
        existingPayers.push(body.payer);
      }
      updatedPayers = existingPayers;
    } else if (body.payerId) {
      const idx = existingPayers.findIndex((p) => p.payerId === body.payerId || p.id === body.id);
      if (idx >= 0) {
        existingPayers[idx] = { ...existingPayers[idx], ...body };
      } else {
        existingPayers.push(body);
      }
      updatedPayers = existingPayers;
    } else {
      updatedPayers = existingPayers;
    }

    await prisma.clinicModuleState.upsert({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
      create: {
        organizationId: gate.organizationId,
        module: MODULE_KEY,
        data: { payers: updatedPayers } as any,
      },
      update: {
        data: { payers: updatedPayers } as any,
      },
    });

    return NextResponse.json({ success: true, payers: updatedPayers });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save payer settings' },
      { status: 400 }
    );
  }
}

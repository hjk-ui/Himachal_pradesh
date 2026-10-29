import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

/**
 * DrFirst notification counts for Waiting panel / header badge.
 * Counts are practice-local cache until vendor download sync is certified.
 */
export async function GET() {
  try {
    const gate = await requireOrgContext();
    if (!gate.ok) {
      return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
    }
    assertDrFirstPrescriber(gate);

    const module = `drfirst:notification-counts:${gate.userId}`;
    const row = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module,
        },
      },
    });
    const data = (row?.data || {}) as Record<string, unknown>;
    const counts = {
      pending_prescription: Number(data.pending_prescription) || 0,
      need_signing: Number(data.need_signing) || 0,
      refill: Number(data.refill) || 0,
      rx_change: Number(data.rx_change) || 0,
    };
    const lastSyncAt = typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null;

    return NextResponse.json({
      success: true,
      counts,
      lastSyncAt,
      lastSyncLabel: lastSyncAt
        ? (() => {
            const mins = Math.max(0, Math.round((Date.now() - new Date(lastSyncAt).getTime()) / 60_000));
            return mins < 1 ? 'just now' : `${mins} min ago`;
          })()
        : 'not yet',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forbidden';
    const status = message.includes('prescriber') || message.includes('Only') ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

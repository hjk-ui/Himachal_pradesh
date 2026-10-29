import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath, canAccessPayerBilling } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/residential-crisis')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const residents = await prisma.residentialResident.findMany({
      where: { active: true },
      orderBy: { room: 'asc' },
    });

    const nowTime = Date.now();
    const perDiems = residents.map((r) => {
      const isCsrOverdue = r.nextCsrDate ? r.nextCsrDate.getTime() < nowTime : false;
      const isPaMissing = !r.paNumber;
      const isPaExhausted = r.paUnitsRemaining <= 0;

      let block: 'csr_overdue' | 'pa_missing' | 'pa_exhausted' | null = null;
      if (isCsrOverdue) block = 'csr_overdue';
      else if (isPaMissing) block = 'pa_missing';
      else if (isPaExhausted) block = 'pa_exhausted';

      return {
        id: r.id,
        resident: r.name,
        program: r.program === '3.5' ? '3.5' : '3.1',
        room: r.room,
        payer: 'Maryland Medicaid',
        csrStatus: isCsrOverdue ? 'overdue' : 'current',
        csrDetail: r.nextCsrDate
          ? `Review due ${r.nextCsrDate.toISOString().slice(0, 10)}`
          : 'Current review on file',
        paUnitsLeft: r.paUnitsRemaining ?? 14,
        block,
        charged: false,
      };
    });

    const episodes = await prisma.crisisEpisode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const crisisCharges = episodes.map((ep) => {
      const mode = ep.location?.toLowerCase().includes('telehealth') ? 'telehealth' : 'mobile';
      let status: 'in_progress' | 'held' | 'ready' | 'routed' = 'ready';
      if (ep.status === 'dispatched') status = 'in_progress';
      else if (!ep.docComplete) status = 'held';
      else if (ep.status === 'resolved') status = 'ready';

      return {
        id: ep.id,
        episode: ep.episodeNumber,
        client: ep.clientName,
        date: ep.createdAt.toISOString().slice(0, 10),
        mode,
        minutes: ep.status === 'resolved' || ep.status === 'onscene' ? 90 : 0,
        payer: 'Maryland Medicaid',
        docComplete: Boolean(ep.docComplete),
        clinicianNotified: Boolean(ep.notificationsSent),
        status,
      };
    });

    return NextResponse.json({
      success: true,
      perDiems,
      crisisCharges,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch billing queues' },
      { status: 500 }
    );
  }
}

const approveSchema = z.object({
  action: z.literal('approve_charges'),
  chargeIds: z.array(z.string().min(1)).max(500),
});
const episodeSchema = z.object({ episodeId: z.string().min(1) });

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const approve = approveSchema.safeParse(body);
  if (approve.success) {
    const result = await prisma.specializedBillingCharge.updateMany({
      where: {
        id: { in: approve.data.chargeIds },
        organizationId: gate.organizationId,
        category: 'residential_per_diem',
        status: 'ready',
        claimId: null,
      },
      data: { status: 'approved' },
    });
    return NextResponse.json({ success: true, approved: result.count });
  }
  const episode = episodeSchema.safeParse(body);
  if (!episode.success) {
    return NextResponse.json({ success: false, error: 'Invalid billing update' }, { status: 400 });
  }
  const row = await prisma.crisisEpisode.findFirst({
    where: { id: episode.data.episodeId, organizationId: gate.organizationId },
  });
  if (!row) return NextResponse.json({ success: false, error: 'Episode not found' }, { status: 404 });
  const stillOpen = row.status === 'dispatched' || row.status === 'enroute' || row.status === 'onscene';
  if (!row.docComplete || !row.notificationsSent || !row.dispatchedAt || !row.resolvedAt || stillOpen) {
    return NextResponse.json({ success: false, error: 'Episode is not ready to route' }, { status: 409 });
  }
  await prisma.crisisEpisode.update({
    where: { id: row.id },
    data: { chargeRouted: true },
  });
  return NextResponse.json({ success: true, episodeId: row.id });
}

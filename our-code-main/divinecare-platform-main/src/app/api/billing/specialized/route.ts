import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { auditChargeForBilling } from '@/services/chargeScrubber';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    let charges = await prisma.specializedBillingCharge.findMany({
      where: {
        ...(category && category !== 'all' ? { category } : {}),
        ...(status && status !== 'all' ? { status } : {}),
      },
      orderBy: { serviceDate: 'desc' },
    });

    return NextResponse.json({ success: true, charges });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch specialized billing charges' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action = body.action || 'create';

    // Action 1: Generate Daily Per Diems from Active Census
    if (action === 'generate_per_diems') {
      const activeResidents = await prisma.residentialResident.findMany({
        where: { active: true },
      });

      const now = new Date();
      let createdCount = 0;
      let blockedCount = 0;

      for (const res of activeResidents) {
        const code = res.program === '3.5' ? 'H0018' : 'H0019';
        const rate = res.program === '3.5' ? 385.0 : 245.0;

        const csrStatus = res.nextCsrDate && res.nextCsrDate < now ? 'OVERDUE' : 'CURRENT';
        const priorAuth = res.paNumber ? { remainingUnits: res.paUnitsRemaining, isActive: true } : null;

        const audit = await auditChargeForBilling({
          cptCode: code,
          clientId: res.id,
          dos: now,
          csrStatus,
          priorAuth,
        });

        const status = audit.status === 'READY' ? 'ready' : 'held';
        const blockReason = audit.reason;

        if (audit.status === 'READY') {
          // Decrement PA unit on successful generation
          await prisma.residentialResident.update({
            where: { id: res.id },
            data: { paUnitsRemaining: Math.max(0, res.paUnitsRemaining - 1) },
          });
          createdCount++;
        } else {
          blockedCount++;
        }

        await prisma.specializedBillingCharge.create({
          data: {
            category: 'residential_per_diem',
            referenceId: res.id,
            clientName: res.name,
            serviceDate: now,
            code,
            units: 1,
            rate,
            totalAmount: rate,
            pos: '55',
            payer: 'Optum Maryland (OMDBH)',
            status,
            blockReason,
          },
        });
      }

      return NextResponse.json({
        success: true,
        message: `Generated per diems for ${activeResidents.length} residents (${createdCount} ready, ${blockedCount} blocked by revenue gates)`,
        createdCount,
        blockedCount,
      });
    }

    // Action 2: Route Ready Charges to Clearinghouse
    if (action === 'route_charges') {
      const updated = await prisma.specializedBillingCharge.updateMany({
        where: { status: 'ready' },
        data: { status: 'routed' },
      });

      return NextResponse.json({
        success: true,
        message: `Routed ${updated.count} clean charges to Optum Maryland / Incedo 837P EDI stream.`,
        routedCount: updated.count,
      });
    }

    // Action 3: Route Mobile Crisis Episode Minutes to Billing
    if (action === 'route_crisis_episode') {
      const { episodeNumber, clientName, minutes = 60, rate = 34.0 } = body;
      const units = Math.ceil(minutes / 15);
      const totalAmount = units * rate;

      const ep = await prisma.crisisEpisode.findFirst({
        where: { episodeNumber, organizationId: gate.organizationId },
      });

      if (!ep) {
        return NextResponse.json(
          { success: false, error: 'Crisis episode not found in this organization' },
          { status: 404 }
        );
      }

      const audit = await auditChargeForBilling({
        cptCode: 'H2011',
        clientId: episodeNumber,
        dos: new Date(),
        crisisDocComplete: ep.docComplete,
        crisisNotified: ep.notificationsSent,
      });

      const status = audit.status === 'READY' ? 'ready' : 'held';

      const charge = await prisma.specializedBillingCharge.create({
        data: {
          category: 'mobile_crisis',
          referenceId: episodeNumber,
          clientName,
          serviceDate: new Date(),
          code: 'H2011',
          units,
          rate,
          totalAmount,
          pos: '15',
          payer: 'Optum Maryland (OMDBH)',
          status,
          blockReason: audit.reason,
        },
      });

      // Mark episode chargeRouted = true if ready
      if (status === 'ready') {
        await prisma.crisisEpisode.update({
          where: { id: ep.id },
          data: { chargeRouted: true },
        }).catch(() => {});
      }

      return NextResponse.json({ success: true, charge, audit }, { status: 201 });
    }

    // Standard manual charge creation
    const created = await prisma.specializedBillingCharge.create({
      data: {
        category: body.category || 'residential_per_diem',
        referenceId: body.referenceId || 'manual',
        clientName: body.clientName,
        serviceDate: body.serviceDate ? new Date(body.serviceDate) : new Date(),
        code: body.code || 'H0018',
        units: body.units ? Number(body.units) : 1,
        rate: body.rate ? Number(body.rate) : 385.0,
        totalAmount: (body.units || 1) * (body.rate || 385.0),
        pos: body.pos || '55',
        payer: body.payer || 'Optum Maryland (OMDBH)',
        status: body.status || 'ready',
        blockReason: body.blockReason || null,
      },
    });

    return NextResponse.json({ success: true, charge: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Specialized billing action failed' },
      { status: 500 }
    );
  }
}

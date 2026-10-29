import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { cptByCode } from '@/lib/constants/cpt';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditChargeForBilling } from '@/services/chargeScrubber';
import { canReadBillingQueue, isBillingCore } from '@/lib/billing/billingAccess';
import {
  PER_DIEM_CATEGORY,
  approvePerDiemCharges,
  generatePerDiems,
  serviceDay,
} from '@/lib/billing/residentialPerDiem';

export const runtime = 'nodejs';

/**
 * Specialized (residential per-diem / mobile crisis) charges. Every read and
 * write is scoped to the caller's organization; rows without organizationId
 * predate org scoping and are never returned.
 */

const CATEGORIES = ['residential_per_diem', 'mobile_crisis'] as const;
const STATUSES = ['held', 'ready', 'approved', 'routed', 'in_progress'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function notFuture(date: string) {
  const d = serviceDay(date);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date && d.getTime() <= Date.now() + 86_400_000;
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Org-wide charge queue: billing core (Office Manager removed 2026-10-22)
  if (!canReadBillingQueue(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/residential-crisis')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const status = searchParams.get('status');
  if (category && category !== 'all' && !(CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
  }
  if (status && status !== 'all' && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }

  try {
    const charges = await prisma.specializedBillingCharge.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(category && category !== 'all' ? { category } : {}),
        ...(status && status !== 'all' ? { status } : {}),
      },
      orderBy: { serviceDate: 'desc' },
      take: 500,
    });

    return NextResponse.json({ success: true, charges });
  } catch (err: unknown) {
    console.error('[billing specialized GET]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch specialized billing charges' },
      { status: 500 }
    );
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate_per_diems'),
    serviceDate: z.string().regex(DATE_RE).optional(),
  }),
  z.object({ action: z.literal('route_charges') }),
  z.object({
    action: z.literal('route_crisis_episode'),
    episodeNumber: z.string().trim().min(1).max(64),
    minutes: z.number().int().min(1).max(1440),
  }),
  z.object({
    action: z.literal('create'),
    category: z.enum(CATEGORIES),
    clientId: z.string().min(1).max(128),
    referenceId: z.string().trim().min(1).max(128).optional(),
    serviceDate: z.string().regex(DATE_RE),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5}$/),
    units: z.number().int().min(1).max(99).default(1),
    rate: z.number().min(0).max(100000).optional(),
    pos: z.string().regex(/^\d{2}$/).default('55'),
    payer: z.string().trim().max(200).optional(),
  }),
]);

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Creating / approving charges: billing core only
  if (!isBillingCore(gate.role) || !canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(
    raw && typeof raw === 'object' ? { action: 'create', ...(raw as Record<string, unknown>) } : raw
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const organizationId = gate.organizationId;

  try {
    if (body.action === 'generate_per_diems') {
      const date = body.serviceDate ?? today();
      if (!notFuture(date)) {
        return NextResponse.json({ success: false, error: 'Date of service cannot be in the future' }, { status: 400 });
      }
      const result = await generatePerDiems(organizationId, date);
      await writeAuditLog({
        action: 'billing.per_diems_generated',
        actorUserId: gate.userId,
        organizationId,
        resourceType: 'SpecializedBillingCharge',
        metadata: { category: PER_DIEM_CATEGORY, ...result },
      });
      return NextResponse.json({
        success: true,
        message: `Per-diems for ${result.residents} residents: ${result.created} created, ${result.released} released, ${result.held} held by compliance gates, ${result.alreadyCharged} already charged.`,
        ...result,
      });
    }

    if (body.action === 'route_charges') {
      // Approves this organization's ready per-diem charges. Nothing is sent to a payer here.
      const ready = await prisma.specializedBillingCharge.findMany({
        where: { organizationId, category: PER_DIEM_CATEGORY, status: 'ready', claimId: null },
        select: { id: true },
        take: 500,
      });
      const approved = ready.length ? await approvePerDiemCharges(organizationId, ready.map((r) => r.id)) : 0;
      await writeAuditLog({
        action: 'billing.per_diem_charges_approved',
        actorUserId: gate.userId,
        organizationId,
        resourceType: 'SpecializedBillingCharge',
        metadata: { approved },
      });
      return NextResponse.json({
        success: true,
        message: `Approved ${approved} ready per-diem charge(s) for billing. Create claims from them on Residential & Crisis Billing.`,
        routedCount: approved,
      });
    }

    if (body.action === 'route_crisis_episode') {
      const ep = await prisma.crisisEpisode.findFirst({
        where: { episodeNumber: body.episodeNumber, organizationId },
      });
      if (!ep) {
        return NextResponse.json(
          { success: false, error: 'Crisis episode not found in this organization' },
          { status: 404 }
        );
      }
      const client = ep.clientId
        ? await prisma.client.findFirst({
            where: { AND: [{ id: ep.clientId }, clientOrgFilter(organizationId)] },
            select: { id: true, insurancePayer: true },
          })
        : null;
      if (!client) {
        return NextResponse.json(
          { success: false, error: 'Link the crisis episode to a client before creating a charge' },
          { status: 409 }
        );
      }

      // One charge per episode
      const existing = await prisma.specializedBillingCharge.findFirst({
        where: { organizationId, category: 'mobile_crisis', referenceId: ep.episodeNumber },
      });
      if (existing) {
        return NextResponse.json({ success: true, charge: existing, alreadyExisted: true });
      }

      const rate = cptByCode('H2011')?.rate ?? 0;
      const units = Math.ceil(body.minutes / 15);
      const audit = await auditChargeForBilling({
        cptCode: 'H2011',
        clientId: client.id,
        dos: ep.createdAt,
        crisisDocComplete: ep.docComplete,
        crisisNotified: ep.notificationsSent,
      });

      const charge = await prisma.specializedBillingCharge.create({
        data: {
          organizationId,
          clientId: client.id,
          category: 'mobile_crisis',
          referenceId: ep.episodeNumber,
          clientName: ep.clientName,
          serviceDate: serviceDay(ep.createdAt.toISOString().slice(0, 10)),
          code: 'H2011',
          units,
          rate,
          totalAmount: units * rate,
          pos: '15',
          payer: client.insurancePayer?.trim() || '',
          status: audit.status === 'READY' ? 'ready' : 'held',
          blockReason: audit.reason,
        },
      });
      await writeAuditLog({
        action: 'billing.crisis_charge_created',
        actorUserId: gate.userId,
        organizationId,
        resourceType: 'SpecializedBillingCharge',
        resourceId: charge.id,
        patientId: client.id,
        metadata: { units, status: charge.status },
      });
      return NextResponse.json({ success: true, charge, audit }, { status: 201 });
    }

    // Manual charge
    if (!notFuture(body.serviceDate)) {
      return NextResponse.json({ success: false, error: 'Date of service cannot be in the future' }, { status: 400 });
    }
    const client = await prisma.client.findFirst({
      where: { AND: [{ id: body.clientId }, clientOrgFilter(organizationId)] },
      select: { id: true, name: true, insurancePayer: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const rate = body.rate ?? cptByCode(body.code)?.rate;
    if (rate == null) {
      return NextResponse.json({ success: false, error: `Enter a rate for ${body.code}` }, { status: 400 });
    }
    const created = await prisma.specializedBillingCharge.create({
      data: {
        organizationId,
        clientId: client.id,
        category: body.category,
        referenceId: body.referenceId || 'manual',
        clientName: client.name,
        serviceDate: serviceDay(body.serviceDate),
        code: body.code,
        units: body.units,
        rate,
        totalAmount: Math.round(body.units * rate * 100) / 100,
        pos: body.pos,
        payer: body.payer || client.insurancePayer?.trim() || '',
        status: 'ready',
        blockReason: null,
      },
    });
    await writeAuditLog({
      action: 'billing.specialized_charge_created',
      actorUserId: gate.userId,
      organizationId,
      resourceType: 'SpecializedBillingCharge',
      resourceId: created.id,
      patientId: client.id,
      metadata: { category: body.category, code: body.code, units: body.units },
    });
    return NextResponse.json({ success: true, charge: created }, { status: 201 });
  } catch (err: unknown) {
    console.error('[billing specialized POST]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Specialized billing action failed' }, { status: 500 });
  }
}

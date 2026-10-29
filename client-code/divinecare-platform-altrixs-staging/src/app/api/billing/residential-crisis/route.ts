import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { claimEditorSchema } from '@/lib/billing/claimLines';
import { canReadBillingQueue, isBillingCore } from '@/lib/billing/billingAccess';
import {
  ChargeClaimError,
  PER_DIEM_CATEGORY,
  approvePerDiemCharges,
  createClaimFromCharge,
  generatePerDiems,
  listPerDiemCharges,
  orgResidents,
  perDiemBlock,
  serviceDay,
} from '@/lib/billing/residentialPerDiem';

export const runtime = 'nodejs';

// Minutes between the documented "HH:MM" dispatch and resolved times (both entered in the
// same local clock, so no timezone math). Returns 0 when either is missing, so no duration
// is invented.
function documentedMinutes(dispatchedAt: string | null, resolvedAt: string | null): number {
  const toMinutes = (v: string | null) => {
    const m = v ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = toMinutes(dispatchedAt);
  const end = toMinutes(resolvedAt);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : end + 24 * 60 - start;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A date of service must be a real calendar day and not in the future (1-day timezone slack). */
function validServiceDate(value: string | null | undefined) {
  if (!value || !DATE_RE.test(value)) return null;
  const d = serviceDay(value);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  if (d.getTime() > Date.now() + 86_400_000) return null;
  return value;
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Org-wide billing queue (residents, payers, crisis episodes): billing core (Office Manager removed 2026-10-22)
  // (read-only). Providers and crisis responders route charges from their own workflows.
  if (!canReadBillingQueue(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/residential-crisis')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    // ResidentialResident has no organization column, so residents are scoped through
    // their linked client. Residents without a client link can't be attributed and are not listed.
    const dateParam = new URL(req.url).searchParams.get('date');
    const date = validServiceDate(dateParam) ?? new Date().toISOString().slice(0, 10);
    const day = serviceDay(date);
    const { residents, payerByClient } = await orgResidents(gate.organizationId);

    const charges = await listPerDiemCharges(gate.organizationId);
    const chargeByResident = new Map(
      charges.filter((c) => c.serviceDate === date).map((c) => [c.residentId, c])
    );

    const perDiems = residents.map((r) => {
      const block = perDiemBlock(r, day);
      const charge = chargeByResident.get(r.id);
      return {
        id: r.id,
        resident: r.name,
        program: r.program === '3.5' ? '3.5' : '3.1',
        room: r.room,
        payer: (r.clientId && payerByClient.get(r.clientId)) || 'Payer not on file',
        csrStatus: block === 'csr_overdue' ? 'overdue' : 'current',
        csrDetail: r.nextCsrDate
          ? `Review due ${r.nextCsrDate.toISOString().slice(0, 10)}`
          : 'Current review on file',
        paUnitsLeft: r.paNumber ? r.paUnitsRemaining : null,
        block,
        charged: Boolean(charge && charge.status !== 'held'),
        chargeStatus: charge?.status ?? null,
      };
    });

    const episodes = await prisma.crisisEpisode.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const crisisCharges = episodes.map((ep) => {
      const mode = ep.location?.toLowerCase().includes('telehealth') ? 'telehealth' : 'mobile';
      let status: 'in_progress' | 'held' | 'ready' | 'routed' = 'ready';
      if (ep.chargeRouted) status = 'routed';
      else if (ep.status === 'dispatched' || ep.status === 'enroute' || ep.status === 'onscene') status = 'in_progress';
      else if (!ep.docComplete || !ep.notificationsSent) status = 'held';

      return {
        id: ep.id,
        episode: ep.episodeNumber,
        client: ep.clientName,
        date: ep.createdAt.toISOString().slice(0, 10),
        mode,
        minutes: documentedMinutes(ep.dispatchedAt, ep.resolvedAt),
        payer: (ep.clientId && payerByClient.get(ep.clientId)) || 'Payer not on file',
        docComplete: Boolean(ep.docComplete),
        clinicianNotified: Boolean(ep.notificationsSent),
        status,
      };
    });

    return NextResponse.json({
      success: true,
      date,
      perDiems,
      crisisCharges,
      charges,
      canBill: isBillingCore(gate.role),
    });
  } catch (err: unknown) {
    console.error('[residential-crisis GET]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch billing queues' },
      { status: 500 }
    );
  }
}

const approveSchema = z.union([
  z.object({ episodeId: z.string().min(1).max(128) }),
  z.object({
    action: z.literal('approve_charges'),
    chargeIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  }),
]);

// Marks a completed crisis episode's charge as approved for billing (CrisisEpisode.chargeRouted).
// This records the approval only — it does not create a claim or superbill.
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Approving a charge for billing is a billing decision: billing core only.
  if (!isBillingCore(gate.role) || !canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json(
      { success: false, error: 'Only billing staff can approve crisis charges' },
      { status: 403 }
    );
  }

  const parsed = approveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'episodeId or chargeIds is required' }, { status: 400 });
  }

  if ('action' in parsed.data) {
    try {
      const approved = await approvePerDiemCharges(gate.organizationId, parsed.data.chargeIds);
      await writeAuditLog({
        action: 'billing.per_diem_charges_approved',
        actorUserId: gate.userId,
        organizationId: gate.organizationId,
        resourceType: 'SpecializedBillingCharge',
        metadata: { requested: parsed.data.chargeIds.length, approved },
      });
      return NextResponse.json({ success: true, approved });
    } catch (err: unknown) {
      console.error('[residential-crisis PATCH charges]', err instanceof Error ? err.message : 'unknown error');
      return NextResponse.json({ success: false, error: 'Could not approve the charges' }, { status: 500 });
    }
  }
  const episodeId = parsed.data.episodeId;

  try {
    const episode = await prisma.crisisEpisode.findFirst({
      where: { id: episodeId, organizationId: gate.organizationId },
      select: {
        id: true,
        status: true,
        docComplete: true,
        notificationsSent: true,
        dispatchedAt: true,
        resolvedAt: true,
      },
    });
    if (!episode) {
      return NextResponse.json({ success: false, error: 'Episode not found' }, { status: 404 });
    }
    if (!episode.docComplete || !episode.notificationsSent) {
      return NextResponse.json(
        { success: false, error: 'Episode documentation and clinician notification must be complete first' },
        { status: 409 }
      );
    }
    if (['dispatched', 'enroute', 'onscene'].includes(episode.status)) {
      return NextResponse.json({ success: false, error: 'Episode is still active' }, { status: 409 });
    }
    const minutes = documentedMinutes(episode.dispatchedAt, episode.resolvedAt);
    if (minutes === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispatch and resolved times must be documented before billing' },
        { status: 409 }
      );
    }

    await prisma.crisisEpisode.update({
      where: { id: episode.id },
      data: { chargeRouted: true },
    });
    // No chargeRoutedAt/By columns exist, so the approver and time live in the audit trail.
    await writeAuditLog({
      action: 'billing.crisis_charge_approved',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'CrisisEpisode',
      resourceId: episode.id,
      metadata: { documentedMinutes: minutes },
    });
    return NextResponse.json({ success: true, episodeId: episode.id });
  } catch (err: unknown) {
    console.error('[residential-crisis PATCH]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not approve the charge' }, { status: 500 });
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate_per_diems'),
    serviceDate: z.string().regex(DATE_RE),
  }),
  z.object({
    action: z.literal('create_claim'),
    chargeId: z.string().min(1).max(128),
    claim: claimEditorSchema,
  }),
]);

/**
 * generate_per_diems: create per-diem charges from the census for one date of service.
 * create_claim: create a claim from an approved per-diem charge (claim editor values).
 * Billing roles only.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!isBillingCore(gate.role) || !canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json(
      { success: false, error: 'Only billing staff can generate charges or claims' },
      { status: 403 }
    );
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  if (parsed.data.action === 'generate_per_diems') {
    const date = validServiceDate(parsed.data.serviceDate);
    if (!date) {
      return NextResponse.json(
        { success: false, error: 'Choose a valid date of service that is not in the future' },
        { status: 400 }
      );
    }
    try {
      const result = await generatePerDiems(gate.organizationId, date);
      await writeAuditLog({
        action: 'billing.per_diems_generated',
        actorUserId: gate.userId,
        organizationId: gate.organizationId,
        resourceType: 'SpecializedBillingCharge',
        metadata: { category: PER_DIEM_CATEGORY, ...result },
      });
      return NextResponse.json({ success: true, result });
    } catch (err: unknown) {
      console.error('[residential-crisis POST generate]', err instanceof Error ? err.message : 'unknown error');
      return NextResponse.json({ success: false, error: 'Could not generate per-diem charges' }, { status: 500 });
    }
  }

  try {
    const created = await createClaimFromCharge(
      { organizationId: gate.organizationId, userId: gate.userId },
      parsed.data.chargeId,
      parsed.data.claim
    );
    await writeAuditLog({
      action: 'billing.claim_created_from_charge',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'Claim',
      resourceId: created.claimId,
      metadata: { chargeId: created.chargeId, amountCents: created.amountCents },
    });
    return NextResponse.json({ success: true, ...created }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof ChargeClaimError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[residential-crisis POST claim]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not create the claim' }, { status: 500 });
  }
}

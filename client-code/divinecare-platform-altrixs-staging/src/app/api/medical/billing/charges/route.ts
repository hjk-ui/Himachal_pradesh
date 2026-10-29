import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAdjudicateCharges } from '@/features/medical/roles';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import {
  canUpdateMedicalChargeStatus,
  encounterKey,
  encounterKeysFromVisits,
  medicalChargeCreateScope,
  medicalChargeReadScope,
  onOwnEncounter,
} from '@/lib/billing/billingAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

export const runtime = 'nodejs';

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/**
 * Full chart access check for one client's charge (roster role, caseload / primary care care
 * team, 42 CFR Part 2). Returns a ready 403/404 response (audited as DENIED) or null when allowed.
 */
async function denyChargeClient(gate: Gate, req: Request, action: string, clientId: string, resourceId: string | null) {
  const access = await resolveChartAccess(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    clientId,
    new URL(req.url).pathname
  );
  if (access.ok !== false) return null;
  await auditPhiAccess({ gate, req, action, resourceType: 'medicalCharge', resourceId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
  if (access.reason === 'sensitive_record') {
    return NextResponse.json({ error: 'SENSITIVE_RECORD', canRequestBreakGlass: true }, { status: 403 });
  }
  return NextResponse.json({ success: false, error: access.status === 404 ? 'Patient not found' : 'Forbidden' }, { status: access.status });
}

/** Org session plus access to the medical billing page; charges carry patient names. */
async function requireMedicalBilling() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/billing')) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, gate };
}

/** Refused by role (billing / primary care provider rules in billingAccess.ts); audited as DENIED. */
async function denyRole(gate: Gate, req: Request, action: string, reason: string, resourceId: string | null = null) {
  await auditPhiAccess({ gate, req, action, resourceType: 'medicalCharge', resourceId, outcome: 'DENIED', metadata: { reason } });
  return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
}

/** A primary care provider's own encounters (visits where they are the provider), as client|date keys. */
async function ownEncounterKeys(gate: Gate, where: { clientId?: string; from?: Date; to?: Date } = {}) {
  const visits = await prisma.medicalVisit.findMany({
    where: {
      providerId: gate.userId,
      client: clientOrgFilter(gate.organizationId),
      ...(where.clientId ? { clientId: where.clientId } : {}),
      ...(where.from || where.to ? { visitDate: { ...(where.from ? { gte: where.from } : {}), ...(where.to ? { lt: where.to } : {}) } } : {}),
    },
    select: { clientId: true, visitDate: true },
    orderBy: { visitDate: 'desc' },
    take: 2000,
  });
  return encounterKeysFromVisits(visits, await getPracticeTimeZone(gate.organizationId));
}

function failure(err: unknown, fallback: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ success: false, error: err.issues[0]?.message || fallback }, { status: 400 });
  }
  console.error('[medical/billing/charges]', fallback, err instanceof Error ? err.name : 'error');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

export async function GET(req: Request) {
  const access = await requireMedicalBilling();
  if (!access.ok) return access.response;
  const { gate } = access;
  // Worklist: billing core. Physician / Medical NP: charges on their
  // own encounters only. Front desk, case managers and medical assistants: none.
  const scope = medicalChargeReadScope(gate.role);
  if (!scope) return denyRole(gate, req, 'LIST', 'role_not_permitted');

  try {
    const ownKeys = scope === 'own_encounters' ? await ownEncounterKeys(gate) : null;
    const ownClientIds = ownKeys ? [...new Set([...ownKeys].map((k) => k.split('|')[0]))] : null;
    // Caseload / primary care roles: only clients on their caseload or care team (same rule as the inbox)
    const rows = await prisma.medicalCharge.findMany({
      where: {
        organizationId: gate.organizationId,
        client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
        ...(ownClientIds ? { clientId: { in: ownClientIds } } : {}),
      },
      include: { client: { select: { name: true, mrn: true } } },
      orderBy: { dos: 'desc' },
      // Newest charges first; the worklist never needs the whole history in one response
      take: 1000,
    });
    const charges = ownKeys ? rows.filter((c) => onOwnEncounter(c, ownKeys)) : rows;

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'medicalCharge',
      metadata: {
        count: charges.length,
        scope,
        ids: charges.slice(0, 50).map((c) => c.id),
        patientIds: [...new Set(charges.map((c) => c.clientId))].slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      charges: charges.map((c) => ({
        id: c.id,
        patientId: c.clientId,
        patientName: c.client?.name || 'Unknown Patient',
        mrn: c.client?.mrn || '',
        dos: c.dos.toISOString().split('T')[0],
        dateOfService: c.dos.toISOString().split('T')[0],
        cptCode: c.cptCode,
        modifier: c.modifier || '',
        modifiers: c.modifier ? c.modifier.split(',').map((s) => s.trim()) : [],
        units: c.units,
        chargeAmount: c.amountCents / 100,
        billedAmount: c.amountCents / 100,
        // Allowed / paid amounts are not stored on MedicalCharge (no ERA posting yet); never estimate them.
        allowedAmount: 0,
        paidAmount: 0,
        balance: c.status === 'Paid' ? 0 : c.amountCents / 100,
        primaryIcd10: c.primaryIcd,
        secondaryIcd10: c.secondaryIcd || '',
        icd10Pointers: [c.primaryIcd, ...(c.secondaryIcd ? c.secondaryIcd.split(',').map((s) => s.trim()) : [])],
        renderingNpi: c.providerName,
        renderingProvider: c.providerName,
        payer: c.payerName || 'Payer not recorded',
        payerName: c.payerName || 'Payer not recorded',
        payerId: c.payerId || '',
        status: c.status as 'Draft' | 'Ready' | 'Submitted' | 'Paid' | 'Denied',
        denialCode: c.denialCode || undefined,
        denialReason: c.denialReason || undefined,
      })),
    });
  } catch (err: unknown) {
    return failure(err, 'Could not fetch medical charges');
  }
}

const newChargeSchema = z.object({
  clientId: z.string().optional(),
  patientName: z.string().optional(),
  mrn: z.string().optional(),
  dateOfService: z.string(),
  cptCode: z.string().min(1),
  modifier: z.string().optional(),
  units: z.number().int().min(1).default(1),
  chargeAmount: z.number().positive(),
  primaryIcd10: z.string().min(1),
  secondaryIcd10: z.string().optional(),
  renderingProvider: z.string().min(1),
  payer: z.string().optional(),
  payerId: z.string().trim().max(40).optional(),
  // New charges start unsubmitted; submission/payment are recorded via PATCH.
  status: z.enum(['Draft', 'Ready']).default('Ready'),
});

export async function POST(req: Request) {
  const access = await requireMedicalBilling();
  if (!access.ok) return access.response;
  const { gate } = access;
  // Billing core: any visit. Physician / Medical NP: their own encounter only. Office Manager,
  // front desk, case managers and medical assistants do not create charges.
  const createScope = medicalChargeCreateScope(gate.role);
  if (!createScope) return denyRole(gate, req, 'CREATE', 'role_not_permitted');

  try {
    const body = newChargeSchema.parse(await req.json());

    // The charge must attach to an existing client in this organization; never create one here.
    const client = body.clientId
      ? await prisma.client.findFirst({
          where: { id: body.clientId, organizationId: gate.organizationId },
          select: { id: true },
        })
      : body.mrn
        ? await prisma.client.findFirst({
            where: { mrn: body.mrn, organizationId: gate.organizationId },
            select: { id: true },
          })
        : null;

    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Patient is not linked to a client record in this organization.' },
        { status: 404 }
      );
    }
    const denied = await denyChargeClient(gate, req, 'CREATE', client.id, null);
    if (denied) return denied;
    if (createScope === 'own_encounter') {
      const dosYmd = body.dateOfService.trim().slice(0, 10);
      const day = new Date(`${dosYmd}T00:00:00Z`);
      if (Number.isNaN(day.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid date of service' }, { status: 400 });
      }
      // +/- one day of UTC slack; the practice-date comparison decides
      const keys = await ownEncounterKeys(gate, {
        clientId: client.id,
        from: new Date(day.getTime() - 86_400_000),
        to: new Date(day.getTime() + 2 * 86_400_000),
      });
      if (!keys.has(encounterKey(client.id, dosYmd))) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'medicalCharge', patientId: client.id, outcome: 'DENIED',
          metadata: { reason: 'not_own_encounter', dateOfService: dosYmd },
        });
        return NextResponse.json(
          { success: false, error: 'You can create a charge only for your own visit with this patient on that date of service.' },
          { status: 403 }
        );
      }
    }

    const created = await prisma.medicalCharge.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        dos: new Date(body.dateOfService),
        cptCode: body.cptCode,
        modifier: body.modifier || null,
        units: body.units,
        amountCents: Math.round(body.chargeAmount * 100),
        primaryIcd: body.primaryIcd10,
        secondaryIcd: body.secondaryIcd10 || null,
        providerName: body.renderingProvider,
        payerName: body.payer || null,
        payerId: body.payerId || null,
        status: body.status,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalCharge',
      resourceId: created.id,
      patientId: client.id,
      metadata: { status: created.status, fields: Object.keys(body) },
    });

    return NextResponse.json({
      success: true,
      chargeId: created.id,
      charge: created,
    }, { status: 201 });
  } catch (err: unknown) {
    return failure(err, 'Could not create charge');
  }
}

const updateChargeSchema = z.object({
  id: z.string().optional(),
  chargeId: z.string().optional(),
  status: z.enum(['Draft', 'Ready', 'Submitted', 'Paid', 'Denied']),
  denialCode: z.string().optional(),
  denialReason: z.string().optional(),
});

export async function PATCH(req: Request) {
  const access = await requireMedicalBilling();
  if (!access.ok) return access.response;
  const { gate } = access;
  // Status changes (Submitted / Paid / Denied / back to Draft): billing core only
  if (!canUpdateMedicalChargeStatus(gate.role)) return denyRole(gate, req, 'WRITE', 'cannot_update_charge_status');

  try {
    const body = updateChargeSchema.parse(await req.json());
    const targetId = body.id || body.chargeId;
    if (!targetId) {
      return NextResponse.json({ success: false, error: 'Charge id or chargeId is required' }, { status: 400 });
    }
    if ((body.status === 'Paid' || body.status === 'Denied') && !canAdjudicateCharges(gate.role)) {
      await auditPhiAccess({
        gate,
        req,
        action: 'WRITE',
        outcome: 'DENIED',
        resourceType: 'medicalCharge',
        resourceId: targetId,
        metadata: { status: body.status, reason: 'cannot_adjudicate' },
      });
      return NextResponse.json(
        { success: false, error: 'Only billing staff or practice leadership can mark a charge Paid or Denied.' },
        { status: 403 }
      );
    }

    const existing = await prisma.medicalCharge.findFirst({
      where: { id: targetId, organizationId: gate.organizationId },
      select: { id: true, clientId: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Charge not found' }, { status: 404 });
    }
    const denied = await denyChargeClient(gate, req, 'WRITE', existing.clientId, existing.id);
    if (denied) return denied;

    // Records a status change only; nothing is transmitted to a clearinghouse from here.
    const updated = await prisma.medicalCharge.update({
      where: { id: existing.id },
      data: {
        status: body.status,
        denialCode: body.denialCode || null,
        denialReason: body.denialReason || null,
        submittedAt: body.status === 'Submitted' ? new Date() : undefined,
        paidAt: body.status === 'Paid' ? new Date() : undefined,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'medicalCharge',
      resourceId: updated.id,
      patientId: existing.clientId,
      metadata: {
        status: body.status,
        fields: ['status', 'denialCode', 'denialReason', ...(body.status === 'Submitted' ? ['submittedAt'] : []), ...(body.status === 'Paid' ? ['paidAt'] : [])],
      },
    });

    return NextResponse.json({ success: true, charge: updated });
  } catch (err: unknown) {
    return failure(err, 'Could not update charge status');
  }
}

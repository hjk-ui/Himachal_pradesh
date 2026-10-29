import type { Prisma, Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { CLAIM_STATUSES, canAccessClaims, canMutateClaims, readyBlockers, updateClaimStatus } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canReadBillingQueue } from '@/lib/billing/billingAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  claimEditorSchema,
  editorLines,
  parseIcd10List,
  readLineMeta,
  renderingNpiFrom,
  type LineMeta,
} from '@/lib/billing/claimLines';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const updateClaimSchema = claimEditorSchema;

const EDITABLE: Array<'DRAFT' | 'READY' | 'DENIED'> = ['DRAFT', 'READY', 'DENIED'];

function sortById<T extends { id: string }>(rows: T[]) {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function accessFor(gate: { organizationId: string; userId: string; role: unknown }) {
  return clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role as Role,
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Claim detail for the editor (A/R Control, Claim Scrubber, Residential & Crisis): billing core
  // (Office Manager removed 2026-10-22; PUT / PATCH stay billing core)
  if (!(canAccessClaims(gate.role) || canReadBillingQueue(gate.role)) || !canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ success: false, error: 'Invalid claim id' }, { status: 400 });
  }
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: parsedParams.data.id, organizationId: gate.organizationId, client: accessFor(gate) },
      include: {
        client: {
          select: { id: true, name: true, insurancePayer: true, insuranceMemberId: true, insuranceGroupNumber: true },
        },
        appointment: { select: { startsAt: true } },
        serviceLines: true,
      },
    });

    if (!claim) {
      return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { ...claim, serviceLines: sortById(claim.serviceLines) } });
  } catch (error: unknown) {
    console.error('[billing claim GET]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Failed to fetch claim' }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  // Editing claim lines / diagnoses / payer / NPIs: billing core only (as PATCH)
  if (!canMutateClaims(gate.role) || !canAccessPath(gate.role, '/dashboard/billing')) {
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'claim', resourceId: parsedParams.success ? parsedParams.data.id : null,
      outcome: 'DENIED', metadata: { reason: 'cannot_mutate_claims', view: 'claim_editor' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  if (!parsedParams.success) {
    return NextResponse.json({ success: false, error: 'Invalid claim id' }, { status: 400 });
  }
  const id = parsedParams.data.id;

  const parsed = updateClaimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid claim update' },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const dxParsed = parseIcd10List(body.icd10);
  if (!dxParsed.ok) {
    return NextResponse.json({ success: false, error: dxParsed.error }, { status: 400 });
  }
  const icd10List = dxParsed.codes;

  try {
    const existing = await prisma.claim.findFirst({
      where: { id, organizationId: gate.organizationId, client: accessFor(gate) },
      include: { serviceLines: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    }
    if (!EDITABLE.includes(existing.status as (typeof EDITABLE)[number]) || existing.submissionInProgress) {
      return NextResponse.json(
        { success: false, error: 'Submitted or paid claims cannot be edited' },
        { status: 409 }
      );
    }

    const lines = editorLines(body.lines);
    // Saving from the editor marks the claim READY: same gates as a status change
    const blockers = await readyBlockers(existing, lines.map((l) => l.cpt));
    if (blockers.length) return NextResponse.json({ success: false, error: blockers.join(' ') }, { status: 400 });
    const totalCents = lines.reduce((s, l) => s + l.lineCents, 0);
    const first = lines[0];
    const cptCode = first.mods[0] ? `${first.cpt}-${first.mods[0]}` : first.cpt;

    const prevData =
      existing.submissionData && typeof existing.submissionData === 'object' && !Array.isArray(existing.submissionData)
        ? (existing.submissionData as Record<string, unknown>)
        : {};
    const prevMeta = readLineMeta(prevData);
    const prevLines = sortById(existing.serviceLines);
    const dxCount =
      icd10List.length || (Array.isArray(prevData.diagnosisCodes) ? prevData.diagnosisCodes.length : 1);
    const pos = body.pos || existing.placeOfService || '11';

    const updated = await prisma.$transaction(async (tx) => {
      // Guard against a concurrent submission between the read and this write.
      const guard = await tx.claim.updateMany({
        where: { id, organizationId: gate.organizationId, status: { in: EDITABLE }, submissionInProgress: false },
        data: {
          ...(body.payer !== undefined ? { payer: body.payer || null } : {}),
          ...(body.renderingProvider !== undefined ? { renderingNpi: renderingNpiFrom(body.renderingProvider) } : {}),
          ...(body.billingProvider !== undefined ? { billingNpi: body.billingProvider || null } : {}),
          ...(body.authNumber !== undefined ? { priorAuthNumber: body.authNumber || null } : {}),
          placeOfService: pos,
          ...(icd10List.length ? { icd10Codes: icd10List } : {}),
          cptCode,
          units: first.units,
          amountCents: totalCents,
          status: 'READY',
        },
      });
      if (!guard.count) throw new Error('CLAIM_LOCKED');

      await tx.claimServiceLine.deleteMany({ where: { claimId: id } });

      const lineMeta: Record<string, LineMeta> = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const created = await tx.claimServiceLine.create({
          data: {
            claimId: id,
            cptCode: line.cpt,
            modifier: line.mods.length ? line.mods.join(':') : null,
            units: line.units,
            unitCharge: line.unitCharge,
            totalCharge: line.totalCharge,
          },
        });
        // Keep diagnosis pointers from the same position when the code is unchanged.
        const prev = prevLines[i];
        const prevPointers = prev && prev.cptCode === line.cpt ? prevMeta[prev.id]?.diagnosisPointers : undefined;
        const pointers = (prevPointers || [1]).filter((p) => p >= 1 && p <= Math.max(1, dxCount));
        lineMeta[created.id] = {
          serviceDate: body.dos || (prev ? prevMeta[prev.id]?.serviceDate : null) || null,
          diagnosisPointers: pointers.length ? pointers : [1],
        };
      }

      const submissionData = {
        ...prevData,
        ...(icd10List.length ? { diagnosisCodes: icd10List } : {}),
        placeOfService: pos,
        modifiers: first.mods,
        ...(body.dos ? { serviceDate: body.dos } : {}),
        lineMeta,
      } as Prisma.InputJsonValue;

      return tx.claim.update({
        where: { id },
        data: { submissionData },
        include: { serviceLines: true },
      });
    });

    await writeAuditLog({
      action: 'billing.claim_edited',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'Claim',
      resourceId: id,
      patientId: existing.clientId,
      metadata: { lineCount: lines.length, amountCents: totalCents },
    });

    return NextResponse.json({
      success: true,
      data: { ...updated, serviceLines: sortById(updated.serviceLines) },
      message: 'Claim saved.',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'CLAIM_LOCKED') {
      return NextResponse.json(
        { success: false, error: 'Claim was submitted or changed while you were editing. Reload and try again.' },
        { status: 409 }
      );
    }
    console.error('[billing claim PUT]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Claim update failed' }, { status: 500 });
  }
}

const patchSchema = z.object({
  status: z.enum(CLAIM_STATUSES),
  denialReason: z.string().trim().max(500).optional().nullable(),
});

/** Status transitions from the Claims page (the client calls PATCH /api/billing/claims/[id]). */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canMutateClaims(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsedParams = paramsSchema.safeParse(await ctx.params);
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsedParams.success || !body.success) {
    return NextResponse.json({ success: false, error: 'Invalid claim update' }, { status: 400 });
  }
  try {
    const result = await updateClaimStatus(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role as Role,
      },
      parsedParams.data.id,
      body.data.status,
      body.data.denialReason
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, claim: result.claim });
  } catch (err: unknown) {
    console.error('[billing claim PATCH]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not update claim' }, { status: 500 });
  }
}

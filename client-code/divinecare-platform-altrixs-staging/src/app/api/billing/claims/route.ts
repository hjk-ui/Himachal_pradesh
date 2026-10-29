import type { ClaimStatus, Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  CLAIM_STATUSES,
  canAccessClaims,
  canGenerateDraftClaim,
  canMutateClaims,
  createManualClaim,
  generateClaimFromNote,
  listClaims,
} from '@/lib/billing/claims';
import { cptByCode } from '@/lib/constants/cpt';
import { claimLineInputSchema } from '@/lib/billing/claimLines';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { feeScheduleHasCpt } from '@/lib/billing/feeScheduleDb';
import { claimFromNoteDecision } from '@/lib/billing/billingAccess';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  };
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClaims(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || undefined;
  const statusRaw = url.searchParams.get('status')?.trim();
  const status =
    statusRaw && (CLAIM_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as ClaimStatus)
      : undefined;
  if (statusRaw && !status) {
    return NextResponse.json({ success: false, error: 'Invalid status filter' }, { status: 400 });
  }

  try {
    const claims = await listClaims(actorFrom(gate), { status, q });
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'claim',
      metadata: { count: claims.length, status: status ?? null, searched: Boolean(q) },
    });
    return NextResponse.json({ success: true, claims });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    console.error('[billing claims GET]', err);
    if (code === 'P1001') {
      return NextResponse.json(
        {
          success: false,
          error: 'Database connection is temporarily unavailable. Please try again.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ success: false, error: 'Could not load claims' }, { status: 500 });
  }
}

const manualClaimSchema = z.object({
  clientId: z.string().min(1),
  cptCode: z.string().min(3),
  diagnosisCodes: z.array(z.string().min(1)).min(1).max(4),
  placeOfService: z.string().regex(/^\d{2}$/).optional().default('11'),
  units: z.number().int().min(1).max(99).optional().default(1),
  modifiers: z.array(z.string()).optional(),
  telehealth: z.boolean().optional(),
  payer: z.string().optional().nullable(),
  memberId: z.string().optional().nullable(),
  serviceDate: z.string().optional().nullable(),
  clinicianLabel: z.string().optional().nullable(),
  renderingUserId: z.string().trim().min(1).max(128).optional().nullable(),
  groupNumber: z.string().trim().max(80).optional().nullable(),
  markReady: z.boolean().optional(),
  lines: z.array(claimLineInputSchema).min(1).max(50).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    // Manual New Claim modal (clientId + CPT + diagnoses — no note required)
    if (body.clientId && !body.noteId && !body.progressNoteId) {
      if (!canMutateClaims(gate.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      const parsed = manualClaimSchema.safeParse({
        ...body,
        diagnosisCodes: Array.isArray(body.diagnosisCodes)
          ? body.diagnosisCodes
          : String(body.diagnosisCodes || body.diagnosis || '')
              .split(/[,;\s]+/)
              .map((s: string) => s.trim())
              .filter(Boolean),
        units: body.units != null ? Number(body.units) : 1,
      });
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: parsed.error.issues[0]?.message || 'Invalid claim payload' },
          { status: 400 }
        );
      }
      // Built-in codes plus every base CPT in the org fee schedule (e.g. 99212, 99204, 99205)
      if (!cptByCode(parsed.data.cptCode) && !(await feeScheduleHasCpt(gate.organizationId, parsed.data.cptCode))) {
        return NextResponse.json(
          { success: false, error: `Unknown CPT/HCPCS: ${parsed.data.cptCode}` },
          { status: 400 }
        );
      }

      const result = await createManualClaim(actorFrom(gate), parsed.data);
      if (!result.ok) {
        if (result.status === 404) {
          await auditPhiAccess({
            gate, req, action: 'CREATE', resourceType: 'claim', patientId: parsed.data.clientId,
            outcome: 'DENIED', metadata: { source: 'manual', reason: 'patient_not_found' },
          });
        }
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'claim',
        resourceId: result.claim.id, patientId: result.claim.clientId,
        metadata: {
          source: 'manual',
          fields: Object.keys(parsed.data).filter((k) => (parsed.data as Record<string, unknown>)[k] != null),
          lineCount: parsed.data.lines?.length ?? 1,
        },
      });
      return NextResponse.json({ success: true, claim: result.claim }, { status: 201 });
    }

    if (!canGenerateDraftClaim(gate.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const noteId = (body.noteId || body.progressNoteId || '').trim();

    // Critical Rule: Never submit a claim without a signed progress note (note path).
    if (!noteId) {
      return NextResponse.json(
        { success: false, error: 'A signed note is required to create a billing claim' },
        { status: 400 }
      );
    }

    let cptCode = (body.cptCode || body.CPT || body.cpt || '').trim().toUpperCase();
    const isTelehealth =
      body.modality === 'telehealth' ||
      body.placeOfService === '02' ||
      body.placeOfService === '10' ||
      body.modifier === 'GT';

    if (isTelehealth && cptCode && !cptCode.includes('-GT')) {
      cptCode = `${cptCode}-GT`;
    }

    // Non-billing callers: their own note only, never READY, no CPT change on an existing claim
    const note = await prisma.progressNote.findFirst({
      where: { id: noteId, client: clientOrgFilter(gate.organizationId) },
      select: { clientId: true, clinicianId: true, claims: { select: { cptCode: true }, take: 1 } },
    });
    let markReady = body.markReady === true;
    let markReadyDropped = false;
    if (note) {
      const decision = claimFromNoteDecision({
        role: gate.role,
        actorUserId: gate.userId,
        noteClinicianId: note.clinicianId,
        existingClaimCpt: note.claims[0]?.cptCode ?? null,
        requestedCpt: cptCode || null,
        markReady,
      });
      if ('reason' in decision) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'claim', outcome: 'DENIED', patientId: note.clientId,
          metadata: { source: 'note', noteId, reason: decision.reason },
        });
        return NextResponse.json({ success: false, error: decision.error }, { status: decision.status });
      }
      cptCode = decision.cptCode ?? '';
      markReady = decision.markReady;
      markReadyDropped = decision.markReadyDropped;
    }

    const result = await generateClaimFromNote(actorFrom(gate), noteId, {
      cptCode: cptCode || undefined,
      markReady,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'claim', outcome: 'DENIED',
          metadata: { source: 'note', noteId, reason: 'note_not_found' },
        });
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    await auditPhiAccess({
      gate, req, action: result.alreadyExisted ? 'READ' : 'CREATE', resourceType: 'claim',
      resourceId: result.claim.id, patientId: result.claim.clientId,
      metadata: { source: 'note', noteId, alreadyExisted: result.alreadyExisted, markReady, markReadyDropped },
    });

    return NextResponse.json(
      {
        success: true,
        claim: result.claim,
        modifier: isTelehealth ? 'GT' : undefined,
        alreadyExisted: result.alreadyExisted,
        ...(markReadyDropped ? { markReadyDropped: true } : {}),
      },
      { status: result.alreadyExisted ? 200 : 201 }
    );
  } catch (err: unknown) {
    console.error('[billing claims POST]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create claim' },
      { status: 500 }
    );
  }
}

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
  markReady: z.boolean().optional(),
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
      if (!cptByCode(parsed.data.cptCode)) {
        return NextResponse.json(
          { success: false, error: `Unknown CPT/HCPCS: ${parsed.data.cptCode}` },
          { status: 400 }
        );
      }

      const result = await createManualClaim(actorFrom(gate), parsed.data);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
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

    const result = await generateClaimFromNote(actorFrom(gate), noteId, {
      cptCode: cptCode || undefined,
      markReady: false,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        claim: result.claim,
        modifier: isTelehealth ? 'GT' : undefined,
        alreadyExisted: result.alreadyExisted,
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

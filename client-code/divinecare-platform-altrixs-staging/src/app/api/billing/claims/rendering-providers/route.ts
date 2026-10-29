import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canEditBillingProviders } from '@/lib/billing/waystarConfig';
import { isTaxonomyCode } from '@/lib/billing/claimRules';
import { claimsGate, errorJson } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLINICAL_ROLES: Role[] = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP'];

/** What a rendering provider still needs before claims can be sent under them (837P 2310B). */
function problemsOf(u: { npi: string | null; legalFirstName: string | null; legalLastName: string | null; taxonomyCode: string | null }) {
  const p: string[] = [];
  if (!u.npi) p.push('NPI missing');
  if (!u.legalFirstName?.trim() || !u.legalLastName?.trim()) p.push('legal first / last name missing');
  if (!u.taxonomyCode) p.push('taxonomy missing (required by Medicaid / PBHS)');
  else if (!isTaxonomyCode(u.taxonomyCode)) p.push('taxonomy is not a NUCC code');
  return p;
}

/**
 * GET: clinicians as billed on claims (legal name, credentials, NPI, taxonomy) with what is missing.
 * Staff identifiers only (no PHI).
 */
export async function GET() {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  try {
    const staff = await prisma.user.findMany({
      where: { organizationId: g.actor.organizationId, status: 'ACTIVE', OR: [{ role: { in: CLINICAL_ROLES } }, { npi: { not: null } }] },
      select: { id: true, name: true, role: true, npi: true, legalFirstName: true, legalLastName: true, credentials: true, taxonomyCode: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return NextResponse.json({
      success: true,
      canEdit: canEditBillingProviders(g.actor.actorRole),
      staff: staff.map((u) => ({ ...u, problems: problemsOf(u) })),
    });
  } catch (error) {
    return errorJson(error, 'Could not load rendering providers (has the 20261019_rcm_blockers migration run?)');
  }
}

const putSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  legalFirstName: z.string().trim().min(1).max(35).nullable(),
  legalLastName: z.string().trim().min(1).max(60).nullable(),
  credentials: z.string().trim().max(40).optional().nullable(),
  taxonomyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || isTaxonomyCode(v), 'Taxonomy is a 10-character NUCC code ending in X (e.g. 101YP2500X)')
    .optional()
    .nullable(),
});

/** PUT: set a clinician's legal name / credentials / taxonomy as enrolled with NPPES and payers (practice admins). */
export async function PUT(request: Request) {
  const g = await claimsGate('/dashboard/billing/payer-settings');
  if (!g.ok) return g.response;
  if (!canEditBillingProviders(g.actor.actorRole)) {
    return NextResponse.json({ success: false, error: 'Only practice admins can edit rendering providers' }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const body = parsed.data;
  try {
    const r = await prisma.user.updateMany({
      where: { id: body.userId, organizationId: g.actor.organizationId },
      data: {
        legalFirstName: body.legalFirstName,
        legalLastName: body.legalLastName,
        ...(body.credentials !== undefined ? { credentials: body.credentials || null } : {}),
        ...(body.taxonomyCode !== undefined ? { taxonomyCode: body.taxonomyCode || null } : {}),
      },
    });
    if (!r.count) return NextResponse.json({ success: false, error: 'Staff member not found' }, { status: 404 });
    await writeAuditLog({
      action: 'rendering_provider_saved',
      actorUserId: g.actor.actorUserId,
      organizationId: g.actor.organizationId,
      resourceType: 'User',
      resourceId: body.userId,
      metadata: { fields: Object.keys(body).filter((k) => k !== 'userId') },
    });
    return GET();
  } catch (error) {
    return errorJson(error, 'Could not save the rendering provider');
  }
}

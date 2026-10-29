import { randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { PRP_DX_CODES, PRP_DOMAINS } from '@/lib/prp/dxCodes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { promptCarelonForProgram } from '@/lib/consents/carelon/trigger';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import { PRP_REFERRER_CREDENTIALS, referralIssues } from '@/lib/prp/standard';

export const runtime = 'nodejs';

/**
 * Who may refer to PRP: licensed mental health professionals (Maryland allows psychiatrists, NPs,
 * psychologists and licensed therapists such as LCSW-C / LCPC; owner widened to therapists
 * 2026-10-21) plus leadership. The referrer's credential and license are recorded on the referral.
 */
const REFERRAL_ROLES = new Set([
  'PSYCHIATRIST',
  'NP',
  'THERAPIST',
  'CLINICIAN',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
  'ADMIN',
]);
/** Roles that work the PRP referral queue program-wide (intake); everyone else sees their own / caseload referrals. */
const REFERRAL_QUEUE_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PRP_SPECIALIST']);

const DX_SET = new Set(PRP_DX_CODES.map((d) => d.code));

function generateDisplayId(): string {
  return `PRP-${String(randomInt(1000, 10000))}`;
}

const createSchema = z.object({
  clientId: z.string().cuid().optional().nullable(),
  clientName: z.string().trim().min(2).max(160),
  dateOfBirth: z.string().trim().min(8).max(32),
  medicaidId: z.string().trim().min(1).max(80),
  diagnosisCode: z.string().trim().min(2).max(20),
  diagnosisNarrative: z.string().trim().min(2).max(2000),
  impairmentJson: z.unknown().optional().nullable(),
  recommendedDomains: z.array(z.string().trim().max(80)).min(2).max(20),
  hospitalizations: z.string().trim().max(2000).optional().nullable(),
  functionalNarrative: z.string().trim().min(10).max(5000),
  prpJustification: z.string().trim().min(10).max(5000),
  prescriberName: z.string().trim().min(2).max(160),
  prescriberNpi: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'NPI must be exactly 10 digits'),
  licenseNumber: z.string().trim().max(80).optional().nullable(),
  // Referring licensed mental health professional (COMAR 10.63 PRP referral)
  referrerCredential: z.enum(PRP_REFERRER_CREDENTIALS.map((c) => c.value) as [string, ...string[]]),
  referrerLicenseState: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'License state must be a 2-letter code'),
  referrerIsTreating: z.literal(true),
  signature: z.string().trim().min(1).max(200),
  referralDate: z.string().datetime().optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!REFERRAL_ROLES.has(gate.role) && gate.role !== 'PRP_SPECIALIST') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const scoped = REFERRAL_QUEUE_ROLES.has(gate.role)
      ? {}
      : {
          OR: [
            { createdById: gate.userId },
            { client: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role }) },
          ],
        };
    const referrals = await prisma.prpReferral.findMany({
      where: { organizationId: gate.organizationId, ...scoped },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        client: { select: { id: true, name: true, mrn: true } },
      },
    });
    // Referrals linked to a protected chart follow the same break-glass rule as the chart.
    const linkedIds = [...new Set(referrals.map((r) => r.clientId).filter((v): v is string => !!v))];
    const locked = linkedIds.length
      ? await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: linkedIds })
      : new Set<string>();
    const visible = referrals.filter((r) => !r.clientId || !locked.has(r.clientId));

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'prpReferral',
      metadata: {
        count: visible.length,
        ids: visible.slice(0, 50).map((r) => r.id),
        patientIds: [...new Set(visible.map((r) => r.clientId).filter(Boolean))].slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      referrals: visible.map((r) => ({
        id: r.id,
        displayId: r.displayId,
        clientId: r.clientId,
        clientName: r.clientName,
        client: r.client,
        dateOfBirth: r.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        medicaidId: r.medicaidId,
        diagnosisCode: r.diagnosisCode,
        diagnosisNarrative: r.diagnosisNarrative,
        impairmentJson: r.impairmentJson,
        recommendedDomains: r.recommendedDomains,
        hospitalizations: r.hospitalizations,
        functionalNarrative: r.functionalNarrative,
        prpJustification: r.prpJustification,
        prescriberName: r.prescriberName,
        prescriberNpi: r.prescriberNpi,
        licenseNumber: r.licenseNumber,
        referrerCredential: r.referrerCredential,
        referrerLicenseState: r.referrerLicenseState,
        referrerIsTreating: r.referrerIsTreating,
        signature: r.signature,
        referralDate: r.referralDate.toISOString(),
        createdById: r.createdById,
        createdAt: r.createdAt.toISOString(),
      })),
      dxCodes: PRP_DX_CODES,
      domains: PRP_DOMAINS,
    });
  } catch (err) {
    console.error('[prp/referrals GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load PRP referrals' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!REFERRAL_ROLES.has(gate.role)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Only licensed clinicians (psychiatrist, NP, therapist) or leadership can submit PRP referrals',
      },
      { status: 403 }
    );
  }

  try {
    const body = createSchema.parse(await req.json());
    const missing = referralIssues(body);
    if (missing.length) {
      return NextResponse.json({ success: false, error: `Referral incomplete: ${missing.join(', ')}` }, { status: 400 });
    }

    if (!DX_SET.has(body.diagnosisCode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Diagnosis ${body.diagnosisCode} is not a COMAR-qualifying PRP code`,
        },
        { status: 400 }
      );
    }

    if (body.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: body.clientId, organizationId: gate.organizationId },
        select: { id: true },
      });
      if (!client) {
        return NextResponse.json(
          { success: false, error: 'Client not found in your organization' },
          { status: 404 }
        );
      }
    }

    let dateOfBirth: Date | null = null;
    const d = new Date(body.dateOfBirth);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date of birth' },
        { status: 400 }
      );
    }
    dateOfBirth = d;

    const displayId = generateDisplayId();
    const referral = await prisma.prpReferral.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId || null,
        clientName: body.clientName,
        dateOfBirth,
        medicaidId: body.medicaidId || null,
        diagnosisCode: body.diagnosisCode,
        diagnosisNarrative: body.diagnosisNarrative,
        impairmentJson:
          body.impairmentJson == null
            ? undefined
            : (body.impairmentJson as Prisma.InputJsonValue),
        recommendedDomains: body.recommendedDomains ?? [],
        hospitalizations: body.hospitalizations || null,
        functionalNarrative: body.functionalNarrative,
        prpJustification: body.prpJustification,
        prescriberName: body.prescriberName,
        prescriberNpi: body.prescriberNpi,
        licenseNumber: body.licenseNumber || null,
        referrerCredential: body.referrerCredential,
        referrerLicenseState: body.referrerLicenseState,
        referrerIsTreating: body.referrerIsTreating,
        signature: body.signature,
        referralDate: body.referralDate ? new Date(body.referralDate) : new Date(),
        displayId,
        createdById: gate.userId,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'prpReferral',
      resourceId: referral.id,
      patientId: referral.clientId,
      metadata: { linkedToClient: Boolean(referral.clientId), fields: Object.keys(body) },
    });
    // Maryland Medicaid: a PRP referral prompts a new Carelon non-overlap attestation
    await promptCarelonForProgram({ gate, req, clientId: referral.clientId, program: 'prp', trigger: 'prp_referral' });

    return NextResponse.json(
      {
        success: true,
        referral: {
          id: referral.id,
          displayId: referral.displayId,
          clientId: referral.clientId,
          clientName: referral.clientName,
          diagnosisCode: referral.diagnosisCode,
          referralDate: referral.referralDate.toISOString(),
          createdAt: referral.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid referral form', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[prp/referrals POST]', err);
    return NextResponse.json(
      { success: false, error: 'Could not create PRP referral' },
      { status: 500 }
    );
  }
}

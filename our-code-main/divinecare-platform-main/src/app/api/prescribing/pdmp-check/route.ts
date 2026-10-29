import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';
import { canPrescribe } from '@/types/roles';

export const runtime = 'nodejs';

const REVIEW_WINDOW_DAYS = 90;
const confirmationValue = 'PDMP_REVIEW_COMPLETED';

const checkPostSchema = z.object({
  clientId: z.string().trim().min(1).max(128),
  confirmation: z.literal(confirmationValue),
}).strict();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
async function requireDatabasePrescriber(gate: {
  userId: string;
  organizationId: string;
  role: Parameters<typeof canPrescribe>[0];
}) {
  if (!canPrescribe(gate.role)) return null;

  const actor = await prisma.user.findFirst({
    where: {
      id: gate.userId,
      organizationId: gate.organizationId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      npi: true,
      primaryLocationId: true,
      role: true,
      roles: true,
    },
  });

  if (!actor || ![actor.role, ...actor.roles].some(canPrescribe)) return null;
  return actor;
}

async function canAccessPatient(clientId: string, gate: {
  userId: string;
  organizationId: string;
  role: Parameters<typeof clientAccessWhere>[0]['actorRole'];
}) {
  return prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [clientAccessWhere({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      })],
    },
    select: { id: true },
  });
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status);

  try {
    const actor = await requireDatabasePrescriber(gate);
    if (!actor) return json({ success: false, error: 'Licensed prescriber access required' }, 403);

    const clientId = new URL(req.url).searchParams.get('clientId')?.trim();
    if (!clientId || clientId.length > 128) {
      return json({ success: false, error: 'Valid clientId is required' }, 400);
    }

    if (!await canAccessPatient(clientId, gate)) {
      return json({ success: false, error: 'Patient not found' }, 404);
    }

    const audit = await prisma.marylandPdmpAudit.findFirst({
      where: { clientId },
      orderBy: { consultationTimestamp: 'desc' },
      select: {
        consultationTimestamp: true,
        status: true,
      },
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - REVIEW_WINDOW_DAYS);
    const reviewedWithinWindow = Boolean(
      audit && audit.status === 'attested' && audit.consultationTimestamp >= cutoff,
    );

    return json({
      success: true,
      data: {
        reviewedWithinWindow,
        lastConsultation: audit?.consultationTimestamp.toISOString() ?? null,
        status: audit?.status ?? 'never_checked',
        reviewWindowDays: REVIEW_WINDOW_DAYS,
        source: 'local_prescriber_attestation',
        externalQueryVerified: false,
      },
    });
  } catch {
    return json({
      success: false,
      error: 'PDMP review status is temporarily unavailable',
    }, 503);
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status);

  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return json({ success: false, error: 'Invalid request origin' }, 403);
  }

  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ success: false, error: 'Content-Type must be application/json' }, 415);
  }

  try {
    const actor = await requireDatabasePrescriber(gate);
    if (!actor) return json({ success: false, error: 'Licensed prescriber access required' }, 403);
    if (!/^\d{10}$/.test(actor.npi ?? '')) {
      return json({ success: false, error: 'A valid prescriber NPI is required' }, 422);
    }

    const parsed = checkPostSchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({
        success: false,
        error: `clientId and confirmation="${confirmationValue}" are required`,
      }, 400);
    }

    if (!await canAccessPatient(parsed.data.clientId, gate)) {
      return json({ success: false, error: 'Patient not found' }, 404);
    }

    const consultationTimestamp = new Date();
    const audit = await prisma.marylandPdmpAudit.create({
      data: {
        clientId: parsed.data.clientId,
        reviewerUsername: actor.id,
        reviewerNpi: actor.npi!,
        locationId: actor.primaryLocationId,
        consultationTimestamp,
        status: 'attested',
      },
      select: {
        id: true,
        consultationTimestamp: true,
        status: true,
      },
    });

    return json({
      success: true,
      message: 'PDMP review attestation recorded',
      data: {
        auditId: audit.id,
        clientId: parsed.data.clientId,
        consultationTimestamp: audit.consultationTimestamp.toISOString(),
        status: audit.status,
        source: 'local_prescriber_attestation',
        externalQueryVerified: false,
      },
    }, 201);
  } catch {
    return json({
      success: false,
      error: 'Unable to record PDMP review attestation',
    }, 503);
  }
}

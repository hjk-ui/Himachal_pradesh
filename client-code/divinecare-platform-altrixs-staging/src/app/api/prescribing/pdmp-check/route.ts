import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { canPrescribe } from '@/types/roles';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { canViewPrescriptions } from '@/lib/prescriptions/access';

/** Role rule, then the chart rule (org, caseload / care team, 42 CFR Part 2 / sensitive lock). */
function pdmpGate(gate: { organizationId: string; userId: string; role: string }, clientId: string, roleAllowed: boolean) {
  return gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: String(gate.role),
    clientId,
    path: '/api/prescribing/pdmp-check',
    roleAllowed,
  });
}

export const runtime = 'nodejs';

/**
 * Maryland PDMP Regulatory Checkpoint (/api/prescribing/pdmp-check)
 *
 * State Regulations & Clinical Rationale:
 * - Under Maryland Health-General § 21-2A-04.1 (confirmed by the practice owner 2026-10-21; same
 *   citation as the Visit Guide requirement md_pdmp), prescribers query the Prescription Drug
 *   Monitoring Program (PDMP) before starting a course of treatment with an opioid or a
 *   benzodiazepine, and at least every 90 days while the course of treatment continues.
 * - Integration Architecture: CRISP (Chesapeake Regional Information System for our Patients)
 *   is Maryland's state-designated HIE and PDMP data delivery utility.
 *
 * Records here are evidence. Nothing is ever defaulted: the reviewer is the
 * signed-in prescriber with the NPI on their own staff profile, and a failed
 * lookup reports an error, never "compliant".
 */

const checkPostSchema = z.object({
  clientId: z.string().min(1),
  locationId: z.string().optional(),
  notes: z.string().optional(),
});

const REGULATORY = {
  hieUtility: 'CRISP Maryland',
  deliveryMethod: 'Discrete In-EHR Delivery',
  statutoryAuthority: 'Maryland Health-General § 21-2A-04.1',
  regulatoryWindowDays: 90,
};

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  }

  try {
    // PDMP status and the reviewer's NPI: prescription viewers only, for a chart they may open
    const access = await pdmpGate(gate, clientId, canViewPrescriptions(String(gate.role)));
    if (access.ok === false) {
      await writeAuditLog({
        action: 'READ', actorUserId: gate.userId, actorRole: String(gate.role), organizationId: gate.organizationId,
        resourceType: 'pdmp_audit', resourceId: clientId, patientId: access.status === 404 ? null : clientId,
        outcome: 'DENIED', ...auditRequestMeta(req), metadata: { reason: access.reason },
      });
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const client = await prisma.client.findFirst({ where: clientByIdWhere(clientId, gate.organizationId), select: { id: true } });
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const audit = await prisma.marylandPdmpAudit.findFirst({
      where: { clientId: client.id },
      orderBy: { consultationTimestamp: 'desc' },
      select: { reviewerUsername: true, reviewerNpi: true, consultationTimestamp: true, status: true },
    });

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const isCompliant = audit ? audit.consultationTimestamp >= ninetyDaysAgo : false;

    return NextResponse.json({
      success: true,
      data: {
        compliant: isCompliant,
        lastConsultation: audit ? audit.consultationTimestamp : null,
        reviewerNpi: audit ? audit.reviewerNpi : null,
        reviewerUsername: audit ? audit.reviewerUsername : null,
        status: audit ? audit.status : 'never_checked',
        ...REGULATORY,
      },
    });
  } catch (err: unknown) {
    console.error('[pdmp-check GET] error:', err instanceof Error ? err.name : 'unknown');
    // Unknown is not compliant: the prescriber must check the PDMP
    return NextResponse.json(
      { success: false, error: 'Could not load the PDMP review record', data: { compliant: false, status: 'unknown', ...REGULATORY } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Only prescriber roles may perform/attest PDMP checks
  if (!canPrescribe(String(gate.role))) {
    return NextResponse.json(
      { success: false, error: 'Only licensed prescribers may attest to Maryland PDMP queries' },
      { status: 403 }
    );
  }

  const parsed = checkPostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Validation failed' }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const access = await pdmpGate(gate, body.clientId, true);
    if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    const [client, me] = await Promise.all([
      prisma.client.findFirst({ where: clientByIdWhere(body.clientId, gate.organizationId), select: { id: true } }),
      prisma.user.findUnique({ where: { id: gate.userId }, select: { npi: true, rcopiaUsername: true } }),
    ]);
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const reviewerNpi = me?.npi?.trim();
    if (!reviewerNpi) {
      return NextResponse.json(
        { success: false, error: 'Your NPI is not set on your staff profile. Ask an administrator to add it before attesting.' },
        { status: 409 },
      );
    }
    const reviewerUsername = me?.rcopiaUsername?.trim() || gate.userId;

    let locationId: string | null = null;
    if (body.locationId) {
      const loc = await prisma.location.findFirst({ where: { id: body.locationId, organizationId: gate.organizationId }, select: { id: true } });
      if (!loc) return NextResponse.json({ success: false, error: 'Location not found' }, { status: 404 });
      locationId = loc.id;
    }

    const now = new Date();
    const row = await prisma.marylandPdmpAudit.create({
      data: { clientId: client.id, reviewerUsername, reviewerNpi, locationId, consultationTimestamp: now, status: 'reviewed' },
      select: { id: true },
    });

    await writeAuditLog({
      action: 'PDMP_REVIEW_ATTESTED',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'pdmp_audit',
      resourceId: row.id,
      patientId: client.id,
      ...auditRequestMeta(req),
      metadata: { locationId },
    });

    return NextResponse.json({
      success: true,
      message: 'Maryland PDMP consultation recorded',
      data: {
        id: row.id,
        clientId: client.id,
        reviewerUsername,
        reviewerNpi,
        locationId,
        consultationTimestamp: now.toISOString(),
        status: 'reviewed',
      },
    });
  } catch (err: unknown) {
    console.error('[pdmp-check POST] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Failed to record PDMP audit' }, { status: 500 });
  }
}

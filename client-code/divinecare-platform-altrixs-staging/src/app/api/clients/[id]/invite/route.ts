import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile, clientByIdWhere } from '@/lib/clients/orgScope';
import { invitePatientForClient } from '@/patient';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

/**
 * POST /api/clients/[id]/invite
 * Allows clinic staff to explicitly send or resend a portal invitation email/SMS.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canEditClientProfile(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(id, gate.organizationId),
    select: { id: true, name: true, email: true, patientAccount: true },
  });

  if (!client) {
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'portalInvitation', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  const email = client.email?.trim();
  if (!email) {
    return NextResponse.json(
      { success: false, error: 'Client has no email address on file. Please edit the client profile and add an email first.' },
      { status: 400 }
    );
  }

  try {
    const result = await invitePatientForClient(client.id, { force: true });
    if (!result.invited) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'portalInvitation', resourceId: client.id, patientId: client.id, outcome: 'FAILURE' });
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to send invitation' },
        { status: 400 }
      );
    }

    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'portalInvitation', resourceId: client.id, patientId: client.id, metadata: { emailMode: result.emailMode ?? null, resend: Boolean(client.patientAccount) } });

    return NextResponse.json({
      success: true,
      message: `Portal invitation sent to ${email}${result.sms ? `. Text: ${result.sms.sent ? 'sent' : result.sms.message}` : ''}`,
      email,
      emailMode: result.emailMode,
      sms: result.sms ?? null,
    });
  } catch (err: any) {
    console.error('[POST /api/clients/:id/invite]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clients/[id]/invite
 * Checks portal invitation status and whether PatientAccount matches Client email.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(id, gate.organizationId),
    select: {
      id: true,
      email: true,
      patientAccount: {
        select: {
          id: true,
          email: true,
          status: true,
          inviteExpiresAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!client) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'portalInvitation', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  const patientAccount = client.patientAccount;
  await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'portalInvitation', resourceId: client.id, patientId: client.id, metadata: { enrolled: Boolean(patientAccount) } });
  return NextResponse.json({
    success: true,
    portal: patientAccount
      ? {
          status: patientAccount.status,
          email: patientAccount.email,
          clientEmail: client.email,
          isInSync: patientAccount.email.toLowerCase() === (client.email?.toLowerCase() ?? ''),
          inviteExpiresAt: patientAccount.inviteExpiresAt,
          isExpired: patientAccount.inviteExpiresAt ? new Date(patientAccount.inviteExpiresAt).getTime() < Date.now() : false,
          updatedAt: patientAccount.updatedAt,
        }
      : {
          status: 'NOT_ENROLLED',
          clientEmail: client.email,
        },
  });
}

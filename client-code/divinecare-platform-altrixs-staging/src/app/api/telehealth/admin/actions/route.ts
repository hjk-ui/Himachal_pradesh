import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { isClinicalStaff } from '@/lib/auth/roles';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { telehealthReadySms } from '@/lib/sms/templates';
import { sendTelehealthJoinEmail } from '@/lib/telehealth/email';
import { createTelehealthJoinToken } from '@/lib/telehealth/join-token';
import { sessionDateYmd } from '@/lib/telehealth/practiceTiming';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canAdministerTelehealthSession, isTelehealthAdmin } from '@/lib/telehealth/staffAccess';
import type { Role } from '@prisma/client';

export const runtime = 'nodejs';

function getAppBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

const adminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('resend-link'),
    sessionId: z.string().min(1),
    mode: z.enum(['SMS', 'EMAIL']),
    // SMS: must match the charted, consented number (patientSms refuses any other).
    // Email: always the client's charted email; there is no free-form address.
    targetPhone: z.string().optional(),
  }),
  z.object({
    action: z.literal('transfer-room'),
    sessionId: z.string().min(1),
    targetProviderId: z.string().min(1),
    targetProviderName: z.string().min(1),
  }),
  z.object({
    action: z.literal('audit-logs'),
    sessionId: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
]);

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Room admin actions are for clinical/admin staff only
  if (!isClinicalStaff(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // Sessions are reachable only for clients the caller can see (org + caseload / care team)
  const clientScope = clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role as Role,
  });
  const notYours = () =>
    NextResponse.json(
      { success: false, error: 'Only leadership, the Office Manager or the session clinician can do this' },
      { status: 403 }
    );
  try {
    const body = adminActionSchema.parse(await req.json());

    if (body.action === 'resend-link') {
      const session = await prisma.telehealthSession.findFirst({
        where: { id: body.sessionId, organizationId: gate.organizationId, client: clientScope },
        include: { client: { select: { name: true, phone: true, email: true } } },
      });

      if (!session) {
        return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
      }
      if (!canAdministerTelehealthSession(gate.role, gate.userId, session.clinicianId)) return notYours();

      // The join route no longer accepts a bare session id: mint a signed token when none is stored
      const joinToken =
        session.joinToken ||
        createTelehealthJoinToken({
          appointmentId: session.appointmentId || session.id,
          clientId: session.clientId,
          expiresInMinutes: 180,
        });
      const joinUrl = `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(joinToken)}`;
      // Charted client email only (the link and client name must not go to an address typed in by staff)
      const email = session.client.email?.trim() || null;

      let sent = false;
      let detailMsg = '';

      if (body.mode === 'SMS') {
        // Consent-gated (src/lib/sms/patientSms.ts): consent, no STOP / revoked consent, and only to the
        // charted number the client consented on (a typed-in other number is refused, not texted).
        const text = await sendPatientSms({
          clientId: session.clientId,
          organizationId: gate.organizationId,
          purpose: 'telehealth_join_link',
          to: body.targetPhone?.trim() || null,
          actor: { userId: gate.userId, role: gate.role },
          build: ({ sender }) => telehealthReadySms({ sender, joinUrl }),
        });
        if (!text.sent) {
          const reason = 'reason' in text ? text.reason : 'send_error';
          const consentSkip = ['no_sms_consent', 'sms_opted_out', 'number_not_on_file', 'no_phone', 'invalid_phone', 'content_blocked'].includes(reason);
          return NextResponse.json(
            { success: false, sent: false, reason, error: `${text.message} Share the join link another way.`, joinUrl },
            { status: consentSkip ? 422 : 503 }
          );
        }
        sent = true;
        detailMsg = `Dispatched SMS join link to ***${String(body.targetPhone || session.client.phone || '').slice(-4)}`;
      } else {
        if (!email) {
          return NextResponse.json(
            { success: false, error: 'The client has no email on the chart. Add one to the chart or share the link through the patient portal.', joinUrl },
            { status: 422 }
          );
        }
        await sendTelehealthJoinEmail({
          to: email,
          clientName: session.client.name,
          clinicianName: session.clinicianName || 'Clinical staff',
          sessionDate: sessionDateYmd(session.sessionDate),
          startTime: session.startTime,
          timeZone: await getPracticeTimeZone(gate.organizationId),
          platform: 'chime',
          joinUrl,
          extraNotes: 'Admin resend: Your clinician is preparing for your virtual visit.',
        });
        sent = true;
        detailMsg = `Dispatched email join link to ${email}`;
      }

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: body.mode === 'SMS' ? 'RESEND_SMS' : 'RESEND_EMAIL',
          performedBy: 'ADMIN',
          details: detailMsg,
        },
      });

      await auditPhiAccess({
        gate,
        req,
        action: 'TELEHEALTH_LINK_RESENT',
        resourceType: 'telehealthSession',
        resourceId: session.id,
        patientId: session.clientId,
        metadata: {
          channel: body.mode,
          overrideDestination: body.mode === 'SMS' ? Boolean(body.targetPhone) : false,
        },
      });

      return NextResponse.json({ success: true, sent, detail: detailMsg, joinUrl });
    }

    if (body.action === 'transfer-room') {
      const owned = await prisma.telehealthSession.findFirst({
        where: { id: body.sessionId, organizationId: gate.organizationId, client: clientScope },
        select: { id: true, clinicianId: true },
      });
      if (!owned) {
        return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
      }
      if (!canAdministerTelehealthSession(gate.role, gate.userId, owned.clinicianId)) return notYours();
      // The receiving provider must be a clinical staff member of this organization
      const target = await prisma.user.findFirst({
        where: { id: body.targetProviderId, organizationId: gate.organizationId },
        select: { id: true, name: true, role: true },
      });
      if (!target || !isClinicalStaff(target.role)) {
        return NextResponse.json(
          { success: false, error: 'Target provider must be a clinical staff member of this organization' },
          { status: 404 }
        );
      }
      const targetName = target.name || body.targetProviderName;
      const session = await prisma.telehealthSession.update({
        where: { id: owned.id },
        data: {
          clinicianId: target.id,
          clinicianName: targetName,
        },
      });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: 'ROOM_TRANSFERRED',
          performedBy: 'ADMIN',
          details: `Transferred patient room to clinician: ${targetName} (${target.id})`,
        },
      });

      await auditPhiAccess({
        gate,
        req,
        action: 'WRITE',
        resourceType: 'telehealthSession',
        resourceId: session.id,
        patientId: session.clientId,
        metadata: { operation: 'transfer-room', fields: ['clinicianId', 'clinicianName'], targetProviderId: target.id },
      });

      return NextResponse.json({
        success: true,
        session,
        message: `Transferred to ${targetName}`,
      });
    }

    if (body.action === 'audit-logs') {
      // Leadership / Office Manager: every session they can see; anyone else: only their own sessions
      const logs = await prisma.telehealthAuditLog.findMany({
        where: {
          session: {
            organizationId: gate.organizationId,
            client: clientScope,
            ...(isTelehealthAdmin(gate.role) ? {} : { clinicianId: gate.userId }),
          },
          ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: body.limit,
      });

      await auditPhiAccess({
        gate,
        req,
        action: 'LIST',
        resourceType: 'telehealthAuditLog',
        resourceId: body.sessionId ?? null,
        metadata: { sessionFilter: Boolean(body.sessionId), ownSessionsOnly: !isTelehealthAdmin(gate.role), limit: body.limit, count: logs.length },
      });

      return NextResponse.json({ success: true, logs });
    }

    return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid payload', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Admin action failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

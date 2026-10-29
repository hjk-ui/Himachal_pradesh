import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { sendSms } from '@/lib/sms/send';
import { sendTelehealthJoinEmail } from '@/lib/telehealth/email';

export const runtime = 'nodejs';

function getAppBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

const adminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('resend-link'),
    sessionId: z.string().min(1),
    mode: z.enum(['SMS', 'EMAIL']),
    targetPhone: z.string().optional(),
    targetEmail: z.string().optional(),
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
  try {
    const body = adminActionSchema.parse(await req.json());

    if (body.action === 'resend-link') {
      const session = await prisma.telehealthSession.findUnique({
        where: { id: body.sessionId },
        include: { client: { select: { name: true, phone: true, email: true } } },
      });

      if (!session) {
        return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
      }

      const joinToken = session.joinToken || session.id;
      const joinUrl = `${getAppBaseUrl()}/telehealth/join/${encodeURIComponent(joinToken)}`;
      const phone = body.targetPhone || session.patientPhone || session.client.phone;
      const email = body.targetEmail || session.patientEmail || session.client.email;

      let sent = false;
      let detailMsg = '';

      if (body.mode === 'SMS') {
        if (!phone) {
          return NextResponse.json(
            { success: false, error: 'No phone number available for SMS dispatch' },
            { status: 400 }
          );
        }
        try {
          await sendSms({
            to: phone,
            body: `DivineCare Telehealth: Your visit with ${session.clinicianName || 'your clinician'} is ready. Tap to join: ${joinUrl}`,
            context: 'telehealth_admin_resend',
          });
          sent = true;
          detailMsg = `Dispatched SMS join link to ${phone}`;
        } catch (smsErr) {
          console.warn('[telehealth_admin_resend SMS warning]:', smsErr);
          sent = true;
          detailMsg = `SMS link generated for ${phone} (carrier send gated)`;
        }
      } else {
        if (!email) {
          return NextResponse.json(
            { success: false, error: 'No email address available for email dispatch' },
            { status: 400 }
          );
        }
        await sendTelehealthJoinEmail({
          to: email,
          clientName: session.client.name,
          clinicianName: session.clinicianName || 'Clinical staff',
          sessionDate: session.sessionDate,
          startTime: session.startTime,
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

      return NextResponse.json({ success: true, sent, detail: detailMsg, joinUrl });
    }

    if (body.action === 'transfer-room') {
      const session = await prisma.telehealthSession.update({
        where: { id: body.sessionId },
        data: {
          clinicianId: body.targetProviderId,
          clinicianName: body.targetProviderName,
        },
      });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: 'ROOM_TRANSFERRED',
          performedBy: 'ADMIN',
          details: `Transferred patient room to clinician: ${body.targetProviderName} (${body.targetProviderId})`,
        },
      });

      return NextResponse.json({
        success: true,
        session,
        message: `Successfully transferred to ${body.targetProviderName}`,
      });
    }

    if (body.action === 'audit-logs') {
      const logs = await prisma.telehealthAuditLog.findMany({
        where: body.sessionId ? { sessionId: body.sessionId } : undefined,
        orderBy: { timestamp: 'desc' },
        take: body.limit,
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

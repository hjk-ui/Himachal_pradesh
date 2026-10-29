import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readTelehealthJoinToken } from '@/lib/telehealth/join-token';

export const runtime = 'nodejs';

const checkInSchema = z.object({
  consentSigned: z.boolean(),
  locationState: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await ctx.params;
    const token = decodeURIComponent(rawToken || '');
    const body = checkInSchema.parse(await req.json());

    if (!body.consentSigned) {
      return NextResponse.json(
        { success: false, error: 'Informed consent is required before checking into telehealth lobby' },
        { status: 400 }
      );
    }

    // 1. Try finding by direct joinToken or id
    let session = await prisma.telehealthSession.findFirst({
      where: {
        OR: [{ joinToken: token }, { id: token }, { appointmentId: token }],
      },
      include: { client: { select: { name: true, phone: true } } },
    });

    if (!session) {
      // 2. Decode JWT payload if signed token
      const payload = readTelehealthJoinToken(token);
      if (payload) {
        session = await prisma.telehealthSession.findFirst({
          where: {
            OR: [{ id: payload.appointmentId }, { appointmentId: payload.appointmentId }],
          },
          include: { client: { select: { name: true, phone: true } } },
        });
      }
    }

    if (!session) {
      return NextResponse.json({ success: false, error: 'Invalid or expired visit link' }, { status: 404 });
    }

    const updated = await prisma.telehealthSession.update({
      where: { id: session.id },
      data: {
        clientConsentSigned: true,
        clientLocationState: body.locationState || 'Maryland',
        patientCheckedIn: true,
        patientCheckedInAt: new Date(),
        status: 'CHECKED_IN',
      },
    });

    await prisma.telehealthAuditLog.create({
      data: {
        sessionId: session.id,
        eventType: 'PATIENT_JOINED_LOBBY',
        performedBy: 'PATIENT',
        details: `Patient checked into virtual waiting lobby from ${body.locationState || 'Maryland'}. Informed consent signed.`,
      },
    });

    return NextResponse.json({
      success: true,
      session: updated,
      message: 'Checked into waiting lobby',
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Check-in failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

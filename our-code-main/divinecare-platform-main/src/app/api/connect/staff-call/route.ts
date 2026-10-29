import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const staffCallSchema = z.object({
  calleeName: z.string().min(1),
  calleePhone: z.string().regex(/^\+1\d{10}$/, 'calleePhone must be E.164 format, e.g. +12025551234'),
  target: z.enum(['agent', 'queue']),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = staffCallSchema.parse(await req.json());

    const contactId = `staff-${Date.now()}`;

    // Operational call: audit-logged in PostgreSQL with patientId: "none"
    const callLog = await prisma.operationalCallLog.create({
      data: {
        organizationId: gate.organizationId,
        callerUserId: gate.userId,
        callType: body.target === 'agent' ? 'AGENT' : 'QUEUE',
        calleeName: body.calleeName,
        destinationPhone: body.calleePhone,
        purpose: `Staff operational call to ${body.target}: ${body.calleeName}`,
        contactId,
        status: 'INITIATED',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        contactId,
        callLogId: callLog.id,
        status: 'INITIATED',
        audit: 'Operational call logged with zero client linkage.',
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Staff call failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

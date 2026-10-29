import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const externalCallSchema = z.object({
  destinationPhone: z.string().regex(/^\+1\d{10}$/, 'destinationPhone must be E.164 format, e.g. +12025551234'),
  calleeName: z.string().max(120).optional(),
  purpose: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = externalCallSchema.parse(await req.json());

    const contactId = `ext-${Date.now()}`;

    // Operational call: audit-logged in PostgreSQL with zero patient linkage
    const callLog = await prisma.operationalCallLog.create({
      data: {
        organizationId: gate.organizationId,
        callerUserId: gate.userId,
        callType: 'EXTERNAL',
        calleeName: body.calleeName || 'Outside Contact',
        destinationPhone: body.destinationPhone,
        purpose: body.purpose || 'External business / vendor inquiry',
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
    const msg = error instanceof Error ? error.message : 'External call failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

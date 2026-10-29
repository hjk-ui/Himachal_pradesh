import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { sendConnectSms, isUsE164 } from '@/lib/connect/service';
import { sendSms } from '@/lib/sms/send';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { normalizeToE164 } from '@/lib/sms/phone';

const schema = z.object({
  clientId: z.string().min(1),
  body: z.string().min(1).max(1600),
  toPhone: z.string().optional(),
});

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/communications')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, AND: [clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] },
      select: { id: true, name: true, phone: true },
    });
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const toPhone = normalizeToE164(body.toPhone) || normalizeToE164(client.phone);
    if (!toPhone || !isUsE164(toPhone)) {
      return NextResponse.json(
        { success: false, error: 'Client phone must be US E.164 (+1XXXXXXXXXX)' },
        { status: 400 }
      );
    }

    try {
      const gated = await sendSms({
        to: toPhone,
        body: body.body,
        clientId: client.id,
        context: 'connect',
      });
      if (gated.mode === 'skipped') {
        return NextResponse.json({ success: false, sent: false, error: 'SMS was not sent.' }, { status: 409 });
      }
    } catch (smsError) {
      const message = smsError instanceof Error ? smsError.message : 'SMS was not sent.';
      return NextResponse.json({ success: false, sent: false, error: message }, { status: 400 });
    }

    const { message, demoMode } = await sendConnectSms({
      organizationId: gate.organizationId,
      clientId: client.id,
      toPhone,
      body: body.body,
      createdById: gate.userId,
    });

    await writeAuditLog({
      action: 'CONNECT_SMS_SENT',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ConnectMessage',
      resourceId: message.id,
      metadata: { clientId: client.id, demoMode, status: message.status },
    });

    return NextResponse.json({ success: true, message, demoMode }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid SMS payload' }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'SMS could not be sent';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

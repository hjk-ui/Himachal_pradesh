import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { upsertContactNote } from '@/lib/connect/service';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

const schema = z.object({
  clientId: z.string().min(1),
  note: z.string().min(1).max(2000).optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
});

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (
    !canAccessPath(gate.role, '/dashboard/communications') &&
    !canAccessPath(gate.role, '/dashboard/telehealth')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, AND: [clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] },
      select: { id: true },
    });
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const note =
      body.note?.trim() ||
      [
        'Contact logged',
        body.clientName ? `· ${body.clientName}` : '',
        body.clientPhone ? '· phone on file' : '',
      ]
        .filter(Boolean)
        .join(' ');

    const message = await upsertContactNote({
      organizationId: gate.organizationId,
      clientId: client.id,
      note,
      createdById: gate.userId,
    });

    await writeAuditLog({
      action: 'connect.contact',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ConnectMessage',
      resourceId: message.id,
      metadata: { clientId: client.id },
    });

    return NextResponse.json({ success: true, message }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid contact payload' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Could not log contact' }, { status: 500 });
  }
}

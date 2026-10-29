import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  ConnectNotConfiguredError,
  isConnectLive,
  isUsE164,
  placeOutboundCall,
  updateCallStatus,
} from '@/lib/connect/service';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { normalizeToE164 } from '@/lib/sms/phone';

const schema = z.object({
  clientId: z.string().min(1),
  clientPhone: z.string().min(8),
  clinicianPhone: z.string().optional().nullable(),
  callDevice: z.enum(['laptop', 'phone']).optional().default('laptop'),
  updateClientPhone: z.boolean().optional(),
});

const endSchema = z.object({
  callId: z.string().optional(),
  contactId: z.string().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  status: z.string().optional().default('COMPLETED'),
});

function requireUsPhone(raw: string | null | undefined, label: string): string | null {
  const phone = normalizeToE164(raw);
  if (!phone) return null;
  if (!isUsE164(phone)) {
    throw new Error(`${label} must be US E.164 (+1XXXXXXXXXX)`);
  }
  return phone;
}

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/communications') &&
    !canAccessPath(gate.role, '/dashboard/telehealth') &&
    !canAccessPath(gate.role, '/dashboard/clients/waitlist')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const client = await prisma.client.findFirst({
      where: {
        id: body.clientId,
        AND: [
          clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          }),
        ],
      },
      select: { id: true, name: true, phone: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    let phone: string;
    let clinicianPhone: string;
    try {
      const resolved =
        requireUsPhone(body.clientPhone, 'Client phone') ||
        requireUsPhone(client.phone, 'Client phone');
      if (!resolved) {
        return NextResponse.json(
          { success: false, error: 'Valid client phone (+1XXXXXXXXXX) is required' },
          { status: 400 }
        );
      }
      phone = resolved;
    } catch (phoneErr) {
      return NextResponse.json(
        {
          success: false,
          error: phoneErr instanceof Error ? phoneErr.message : 'Invalid client phone',
        },
        { status: 400 }
      );
    }

    // Optionally update client phone in DB if changed or requested
    if (phone && phone !== client.phone) {
      await prisma.client
        .update({
          where: { id: client.id },
          data: { phone },
        })
        .catch(() => undefined);
    }

    if (!isConnectLive()) {
      return NextResponse.json(
        { success: false, error: new ConnectNotConfiguredError().message, code: 'CONNECT_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const clinician = await prisma.user.findUnique({
      where: { id: gate.userId },
      select: { id: true, phone: true, name: true },
    });

    if (body.callDevice === 'laptop') {
      // In laptop mode, doctor uses laptop mic/speakers via browser softphone
      const source = requireUsPhone(process.env.CONNECT_SOURCE_PHONE_NUMBER, 'Source phone');
      if (!source) {
        return NextResponse.json(
          { success: false, error: 'Amazon Connect source number is not configured', code: 'CONNECT_NOT_CONFIGURED' },
          { status: 503 }
        );
      }
      clinicianPhone = source;
    } else {
      try {
        const resolvedClinician =
          requireUsPhone(body.clinicianPhone, 'Clinician phone') ||
          requireUsPhone(clinician?.phone, 'Clinician phone');
        if (!resolvedClinician) {
          return NextResponse.json(
            {
              success: false,
              error: 'Add your phone in profile before placing an Amazon Connect call',
            },
            { status: 400 }
          );
        } else {
          clinicianPhone = resolvedClinician;
          // Persist clinician phone to user profile if user didn't have one
          if (!clinician?.phone && clinicianPhone) {
            await prisma.user
              .update({
                where: { id: gate.userId },
                data: { phone: clinicianPhone },
              })
              .catch(() => undefined);
          }
        }
      } catch (phoneErr) {
        return NextResponse.json(
          {
            success: false,
            error: phoneErr instanceof Error ? phoneErr.message : 'Invalid clinician phone',
          },
          { status: 400 }
        );
      }
    }

    const { call, demoMode, contactId, quotaNotice } = await placeOutboundCall({
      organizationId: gate.organizationId,
      clientId: client.id,
      clientPhone: phone,
      clinicianId: clinician?.id || gate.userId,
      clinicianPhone,
      createdById: gate.userId,
    });

    await writeAuditLog({
      action: 'CONNECT_OUTBOUND_CALL',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'ConnectCall',
      resourceId: call.id,
      metadata: {
        clientId: client.id,
        contactId,
        demoMode,
        status: call.status,
      },
    });

    return NextResponse.json(
      {
        success: true,
        contactId,
        status: call.status || 'INITIATED',
        call,
        demoMode,
        quotaNotice,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid call payload' }, { status: 400 });
    }
    if (err instanceof ConnectNotConfiguredError) {
      return NextResponse.json({ success: false, error: err.message, code: 'CONNECT_NOT_CONFIGURED' }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Call could not be started';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/communications') &&
    !canAccessPath(gate.role, '/dashboard/telehealth') &&
    !canAccessPath(gate.role, '/dashboard/clients/waitlist')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = endSchema.parse(await request.json());
    const updated = await updateCallStatus({
      organizationId: gate.organizationId,
      callId: body.callId,
      contactId: body.contactId,
      status: body.status,
      durationSec: body.durationSec,
    });
    return NextResponse.json({ success: true, call: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update call status';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

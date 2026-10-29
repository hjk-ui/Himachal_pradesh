import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SensitiveReason } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveAccess';
import { clientByIdWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const REASONS = ['employee', 'vip', 'legal', 'other'] as const;

const setSchema = z.object({
  reason: z.enum(REASONS),
  reasonNote: z.string().trim().max(500).optional().nullable(),
  alias: z.string().trim().max(120).optional().nullable(),
  noteClassification: z.string().trim().max(80).optional().nullable(),
  accessWhitelist: z.array(z.string().min(1).max(128)).max(100).optional(),
});

/** POST /api/sensitive-records/[clientId] — set / update protection (PD/ADMIN) */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!isSensitivePrivilegedRole(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { clientId } = await ctx.params;
    const body = setSchema.parse(await req.json());

    const client = await prisma.client.findFirst({
      where: clientByIdWhere(clientId, gate.organizationId),
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    if (body.accessWhitelist?.length) {
      const staff = await prisma.user.findMany({
        where: {
          id: { in: body.accessWhitelist },
          organizationId: gate.organizationId,
        },
        select: { id: true },
      });
      if (staff.length !== body.accessWhitelist.length) {
        return NextResponse.json(
          { success: false, error: 'Whitelist contains users outside this organization' },
          { status: 400 }
        );
      }
    }

    const record = await prisma.sensitiveRecord.upsert({
      where: { clientId },
      create: {
        organizationId: gate.organizationId,
        clientId,
        reason: body.reason as SensitiveReason,
        reasonNote: body.reasonNote?.trim() || null,
        alias: body.alias?.trim() || null,
        noteClassification: body.noteClassification?.trim() || null,
        accessWhitelist: body.accessWhitelist ?? [],
        setById: gate.userId,
      },
      update: {
        reason: body.reason as SensitiveReason,
        reasonNote: body.reasonNote === undefined ? undefined : body.reasonNote?.trim() || null,
        alias: body.alias === undefined ? undefined : body.alias?.trim() || null,
        noteClassification:
          body.noteClassification === undefined
            ? undefined
            : body.noteClassification?.trim() || null,
        ...(body.accessWhitelist !== undefined
          ? { accessWhitelist: body.accessWhitelist }
          : {}),
        setById: gate.userId,
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      success: true,
      record: {
        id: record.id,
        clientId: record.clientId,
        clientName: record.client.name,
        reason: record.reason,
        reasonNote: record.reasonNote,
        alias: record.alias,
        noteClassification: record.noteClassification,
        accessWhitelist: record.accessWhitelist,
        setAt: record.setAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    console.error('[sensitive-records POST]', err);
    return NextResponse.json(
      { success: false, error: 'Could not set protection' },
      { status: 500 }
    );
  }
}

/** DELETE /api/sensitive-records/[clientId] — remove protection (PD/ADMIN) */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!isSensitivePrivilegedRole(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { clientId } = await ctx.params;
    const existing = await prisma.sensitiveRecord.findFirst({
      where: { clientId, organizationId: gate.organizationId },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Protection not found' }, { status: 404 });
    }

    await prisma.sensitiveRecord.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[sensitive-records DELETE]', err);
    return NextResponse.json(
      { success: false, error: 'Could not remove protection' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { findResidentInOrg, orgClientIdSet, residentRowsInOrg } from '../_scope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get('residentId');
    const shift = searchParams.get('shift');

    if (residentId && !(await findResidentInOrg(residentId, gate.organizationId))) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }

    const rows = await prisma.residentialShiftNote.findMany({
      where: {
        ...(residentId ? { residentId } : {}),
        ...(shift ? { shift } : {}),
      },
      include: {
        resident: { select: { name: true, room: true, program: true, clientId: true } },
      },
      orderBy: { shiftDate: 'desc' },
      take: 50,
    });

    // Same tenant scope as the residents list: ResidentialResident has no organizationId, so keep
    // only notes whose resident is linked to a client in this org. Unlinked residents' notes are
    // dropped (tenant cannot be verified; needs an organizationId column, future migration).
    const inOrg = await orgClientIdSet(rows.map((n) => n.resident.clientId), gate.organizationId);
    const scoped = residentRowsInOrg(rows, inOrg, (n) => n.resident.clientId)
      .map((n) => ({ ...n, clientId: n.resident.clientId }));
    // Peer Support / Case Manager / PRP: only residents linked to their own caseload
    const visible = filterRowsToCaseload(
      scoped,
      await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) })
    );

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'residentialShiftNote',
      metadata: {
        count: visible.length,
        ids: visible.slice(0, 50).map((n) => n.id),
        patientIds: visible.map((n) => n.clientId).filter(Boolean).slice(0, 50),
        filters: { residentId: residentId || null, shift: shift || null },
      },
    });

    const notes = visible.map(({ clientId: _clientId, resident: { clientId: _rc, ...resident }, ...n }) => ({ ...n, resident }));
    return NextResponse.json({ success: true, notes });
  } catch (err: unknown) {
    console.error('[api/residential/shift-notes GET] error:', err);
    return NextResponse.json({ success: false, error: 'Could not fetch shift notes' }, { status: 500 });
  }
}

const shiftNoteSchema = z.object({
  residentId: z.string().min(1).max(64),
  shift: z.string().trim().min(1).max(60),
  shiftDate: z.string().trim().min(8).max(40).optional(),
  milieu: z.string().trim().min(1).max(200),
  adherence: z.string().trim().min(1).max(200),
  sleep: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().min(1).max(20000),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const parsed = shiftNoteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'residentId, shift, milieu, adherence and notes are required' }, { status: 400 });
    }
    const body = parsed.data;
    if (!(await findResidentInOrg(body.residentId, gate.organizationId))) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }

    // Author is the signed-in user; observations are never defaulted — a note records only what staff entered.
    const created = await prisma.residentialShiftNote.create({
      data: {
        residentId: body.residentId,
        shift: body.shift,
        author: gate.session.user.name || gate.session.user.email || gate.userId,
        shiftDate: body.shiftDate ? new Date(body.shiftDate) : new Date(),
        milieu: body.milieu,
        adherence: body.adherence,
        sleep: body.sleep || null,
        notes: body.notes,
      },
    });

    return NextResponse.json({
      success: true,
      note: created,
      locked: true,
      signedAt: created.createdAt.toISOString(),
      compliance: 'CARF-Accredited 42 CFR Part 2 Locked Shift Note',
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/residential/shift-notes POST] error:', err);
    return NextResponse.json({ success: false, error: 'Could not create shift note' }, { status: 500 });
  }
}

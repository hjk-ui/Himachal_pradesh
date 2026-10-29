import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientRoster, clientAccessWhere } from '@/lib/clients/orgScope';

export const dynamic = 'force-dynamic';

type OrgGate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;
type Ctx = { params: Promise<{ id: string }> };

const noteSchema = z.object({
  category: z.enum(['Scheduling', 'Billing', 'Contact Preference', 'Transportation', 'General']),
  noteText: z.string().min(1, 'Note text cannot be empty'),
  authorName: z.string().min(1),
  authorRole: z.string().min(1),
  isPinned: z.boolean().optional(),
});

const patchSchema = z.object({
  noteId: z.string().min(1),
  isPinned: z.boolean().optional(),
  noteText: z.string().min(1).optional(),
  category: noteSchema.shape.category.optional(),
});

/**
 * Org gate + roster role + client scope (caseload roles: assigned clients only).
 * Returns the gate and client id, or a ready error response (404 audited as DENIED).
 */
async function gateClient(
  req: NextRequest,
  ctx: Ctx,
  action: string
  // Exactly one of res / (gate + clientId) is set (the repo compiles with strict: false, so no discriminated union).
): Promise<{ gate?: OrgGate; clientId?: string; res?: NextResponse }> {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { res: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  }
  const { id } = await ctx.params;
  if (!canAccessClientRoster(gate.role)) {
    await auditPhiAccess({
      gate, req, action, resourceType: 'officeNote', patientId: id,
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const client = await prisma.client.findFirst({
    where: {
      id,
      ...clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
    },
    select: { id: true },
  });
  if (!client) {
    await auditPhiAccess({
      gate, req, action, resourceType: 'officeNote', patientId: id,
      outcome: 'DENIED', metadata: { reason: 'client_not_found' },
    });
    return { res: NextResponse.json({ error: 'Client not found' }, { status: 404 }) };
  }
  return { gate, clientId: client.id };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const g = await gateClient(req, ctx, 'LIST');
    if (g.res) return g.res;
    const { gate, clientId } = g;

    const notes = await prisma.clientOfficeNote.findMany({
      where: { clientId },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'officeNote', resourceId: clientId, patientId: clientId,
      metadata: { count: notes.length },
    });

    return NextResponse.json({ success: true, data: notes });
  } catch (err: unknown) {
    console.error('[office-notes-get] error:', err);
    return NextResponse.json({ error: 'Failed to fetch office notes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const g = await gateClient(req, ctx, 'CREATE');
    if (g.res) return g.res;
    const { gate, clientId } = g;

    const body = await req.json().catch(() => null);
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const note = await prisma.clientOfficeNote.create({
      data: {
        clientId,
        category: parsed.data.category,
        noteText: parsed.data.noteText,
        // Attribution comes from the signed-in user when available, not only the request body.
        authorName: gate.session.user?.name?.trim() || parsed.data.authorName,
        authorRole: String(gate.role),
        isPinned: parsed.data.isPinned || false,
      },
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'officeNote', resourceId: note.id, patientId: clientId,
      metadata: { category: parsed.data.category, isPinned: parsed.data.isPinned || false },
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (err: unknown) {
    console.error('[office-notes-post] error:', err);
    return NextResponse.json({ error: 'Failed to create office note' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const g = await gateClient(req, ctx, 'WRITE');
    if (g.res) return g.res;
    const { gate, clientId } = g;

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'noteId is required' }, { status: 400 });
    }
    const { noteId, isPinned, noteText, category } = parsed.data;

    const existing = await prisma.clientOfficeNote.findFirst({
      where: { id: noteId, clientId },
      select: { id: true },
    });
    if (!existing) {
      await auditPhiAccess({
        gate, req, action: 'WRITE', resourceType: 'officeNote', resourceId: noteId, patientId: clientId,
        outcome: 'DENIED', metadata: { reason: 'note_not_found' },
      });
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    const updated = await prisma.clientOfficeNote.update({
      where: { id: existing.id },
      data: {
        ...(typeof isPinned === 'boolean' ? { isPinned } : {}),
        ...(noteText ? { noteText } : {}),
        ...(category ? { category } : {}),
      },
    });

    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'officeNote', resourceId: noteId, patientId: clientId,
      metadata: {
        fields: [
          ...(typeof isPinned === 'boolean' ? ['isPinned'] : []),
          ...(noteText ? ['noteText'] : []),
          ...(category ? ['category'] : []),
        ],
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    console.error('[office-notes-patch] error:', err);
    return NextResponse.json({ error: 'Failed to update office note' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const g = await gateClient(req, ctx, 'DELETE');
    if (g.res) return g.res;
    const { gate, clientId } = g;

    const noteId = new URL(req.url).searchParams.get('noteId');
    if (!noteId) {
      return NextResponse.json({ error: 'noteId query param required' }, { status: 400 });
    }

    const removed = await prisma.clientOfficeNote.deleteMany({
      where: { id: noteId, clientId },
    });
    if (removed.count === 0) {
      await auditPhiAccess({
        gate, req, action: 'DELETE', resourceType: 'officeNote', resourceId: noteId, patientId: clientId,
        outcome: 'DENIED', metadata: { reason: 'note_not_found' },
      });
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    await auditPhiAccess({
      gate, req, action: 'DELETE', resourceType: 'officeNote', resourceId: noteId, patientId: clientId,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[office-notes-delete] error:', err);
    return NextResponse.json({ error: 'Failed to delete office note' }, { status: 500 });
  }
}

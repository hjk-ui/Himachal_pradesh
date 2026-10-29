import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { loadWorkflowStatuses, updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';
import { generateClaimFromNote } from '@/lib/billing/claims';

export const runtime = 'nodejs';

const patchSchema = z.object({
  content: z.string().optional(),
  body: z.string().optional(),
  status: z.enum(['draft', 'signed', 'locked', 'Draft', 'Signed', 'Locked']).optional(),
  signedAt: z.string().optional(),
  signedBy: z.string().optional(),
  cptCode: z.string().optional(),
  modality: z.string().optional(),
  addendum: z
    .object({
      text: z.string().min(1),
      reason: z.string().min(1),
      author: z.string().optional(),
    })
    .optional(),
  cosign: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.progressNote.findFirst({
    where: {
      id,
      client: clientAccessWhere({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      }),
    },
    include: {
      client: { select: { id: true, name: true, image: true, insurancePayer: true } },
      clinician: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!note) {
    return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  }

  const { isPsychotherapyNote } = await import('@/lib/clients/chartVisibility');
  const { parseNoteMeta } = await import('@/lib/ehr/noteTemplates');
  const { recordPhiAudit } = await import('@/lib/audit/phiAudit');
  const meta = parseNoteMeta(note.body);
  if (isPsychotherapyNote(meta.noteType, note.body) && note.clinicianId !== gate.userId) {
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'progressNote.read',
      resourceType: 'clinicalNote',
      resourceId: note.id,
      patientId: note.clientId,
      outcome: 'DENIED',
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const workflowMap = await loadWorkflowStatuses([note.id]);
  const wf = workflowMap.get(note.id);

  return NextResponse.json({
    success: true,
    note: {
      id: note.id,
      clientId: note.clientId,
      clientName: note.client.name,
      clinicianName: wf?.clinicianName || note.clinician?.name || null,
      body: note.body,
      status: wf?.status?.toLowerCase() || 'draft',
      signedAt: wf?.signedAt || null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = patchSchema.parse(await req.json());
  const note = await prisma.progressNote.findFirst({
    where: {
      id,
      client: body.cosign
        ? clientOrgFilter(gate.organizationId)
        : clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          }),
    },
    include: {
      client: { select: { id: true, name: true, image: true, insurancePayer: true } },
      clinician: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!note) {
    return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  }

  const workflowMap = await loadWorkflowStatuses([note.id]);
  const currentWf = workflowMap.get(note.id);
  const currentStatus = currentWf?.status?.toLowerCase() || 'draft';
  const isSignedOrLocked = currentStatus === 'signed' || currentStatus === 'locked';

  if (body.cosign) {
    const leadership = gate.role === 'ADMIN' || gate.role === 'DIRECTOR' || gate.role === 'PRACTICE_DIRECTOR';
    const track = note.clinicianId
      ? await prisma.supervisionTrack.findFirst({
          where: { organizationId: gate.organizationId, superviseeId: note.clinicianId, supervisorId: gate.userId },
          select: { id: true },
        })
      : null;
    if (!leadership && !track) {
      const { recordPhiAudit } = await import('@/lib/audit/phiAudit');
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'progressNote.cosign',
        resourceType: 'clinicalNote',
        resourceId: note.id,
        patientId: note.clientId,
        outcome: 'DENIED',
      });
      return NextResponse.json(
        { success: false, error: 'Only this note’s supervisor, or leadership reviewing the practice, can co-sign.' },
        { status: 403 }
      );
    }
    await prisma.clinicModuleState.upsert({
      where: { organizationId_module: { organizationId: gate.organizationId, module: `note-cosign:${note.id}` } },
      create: {
        organizationId: gate.organizationId,
        module: `note-cosign:${note.id}`,
        data: { noteId: note.id, by: gate.userId, role: gate.role, at: new Date().toISOString() },
      },
      update: { data: { noteId: note.id, by: gate.userId, role: gate.role, at: new Date().toISOString() } },
    });
    return NextResponse.json({ success: true, cosigned: true });
  }

  const newContent = body.content ?? body.body;

  // RULE: Signed notes are legally immutable.
  // Scenario 1 — Immutability: If status = 'signed' and content is modified, return 403 Forbidden.
  if (isSignedOrLocked && newContent !== undefined && newContent.trim() !== note.body.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'A signed note is legally immutable. Content cannot be modified. Use addenda for corrections.',
      },
      { status: 403 }
    );
  }

  // Handle Addendum if note is signed
  if (body.addendum) {
    const authorName = body.addendum.author || gate.userId;
    const timestamp = new Date().toISOString();
    const addendumBlock = `\n\n--- ADDENDUM (${timestamp} by ${authorName}) ---\nReason: ${body.addendum.reason}\n${body.addendum.text}`;
    const updatedBody = note.body + addendumBlock;

    await prisma.progressNote.update({
      where: { id: note.id },
      data: { body: updatedBody },
    });

    return NextResponse.json({
      success: true,
      message: 'Addendum attached successfully',
      addendum: {
        text: body.addendum.text,
        reason: body.addendum.reason,
        author: authorName,
        timestamp,
      },
    });
  }

  // Handle Autosave Draft
  const requestedStatus = body.status?.toLowerCase();
  if (requestedStatus === 'draft' || (!requestedStatus && newContent !== undefined && !isSignedOrLocked)) {
    if (newContent !== undefined) {
      await prisma.progressNote.update({
        where: { id: note.id },
        data: { body: newContent },
      });
    }
    return NextResponse.json({ success: true, status: 'draft' });
  }

  // Handle Signing
  if (requestedStatus === 'signed' || requestedStatus === 'locked') {
    if (newContent !== undefined && !isSignedOrLocked) {
      await prisma.progressNote.update({
        where: { id: note.id },
        data: { body: newContent },
      });
    }

    // Check for late entry (>24h since session/creation)
    const isLateEntry = Date.now() - note.createdAt.getTime() > 24 * 60 * 60 * 1000;

    // Update workflow status to Signed/Locked
    const wfRes = await updateProgressNoteWorkflow({
      noteId: note.id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      status: requestedStatus === 'locked' ? 'Locked' : 'Signed',
    });

    if (!wfRes.ok) {
      const errorResult = wfRes as { ok: false; status: number; error: string };
      return NextResponse.json({ success: false, error: errorResult.error }, { status: errorResult.status });
    }

    // PDF Rule: Note signing automatically triggers draft claim creation in billing
    let claimResult: unknown = null;
    try {
      claimResult = await generateClaimFromNote(
        {
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        },
        note.id,
        { cptCode: body.cptCode }
      );
    } catch (claimErr) {
      console.error('[note sign claim generation error]', claimErr);
    }

    return NextResponse.json({
      success: true,
      status: 'signed',
      signedAt: new Date().toISOString(),
      signedBy: gate.userId,
      lateEntry: isLateEntry,
      claim: claimResult,
    });
  }

  return NextResponse.json({ success: true });
}

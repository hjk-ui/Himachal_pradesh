import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { loadWorkflowStatuses, updateProgressNoteWorkflow } from '@/lib/notes/workflow-store';
import { generateClaimFromNote } from '@/lib/billing/claims';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  addNoteAddendum,
  addendumSchema,
  isElevatedNoteActor,
  noteMetaColumns,
  noteMetaSchema,
  resolveNoteMeta,
  serializeAddendum,
} from '@/lib/clients/notes';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';
import { isNoteTypeChange, noteTypeChangeError } from '@/lib/notes/typeChange';
import { canUndoDismiss } from '@/lib/notes/dismiss';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';

export const runtime = 'nodejs';

const patchSchema = noteMetaSchema.extend({
  content: z.string().max(12000, 'Note is too long').optional(),
  body: z.string().max(12000, 'Note is too long').optional(),
  status: z.enum(['draft', 'signed', 'locked', 'Draft', 'Signed', 'Locked']).optional(),
  /** Signing requires the clinician to confirm the attestation */
  attested: z.boolean().optional(),
  /** Late entry (signed after the practice deadline): the clinician's reason, min 10 characters */
  lateEntryReason: z.string().trim().max(500).optional(),
  /** AI Scribe transcript risk: why no further risk assessment is indicated (min 15 characters) */
  riskAttestation: z.string().trim().max(1000).optional(),
  modality: z.string().optional(),
  /** Deprecated: use POST /api/notes/[id]/addenda. Creates an addendum row; never edits the body. */
  addendum: addendumSchema.optional(),
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function GET(
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
      addenda: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, reason: true, text: true, authorName: true, createdAt: true },
      },
    },
  });

  if (!note) {
    return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  }

  const workflowMap = await loadWorkflowStatuses([note.id]);
  const wf = workflowMap.get(note.id);
  await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId });
  const meta = resolveNoteMeta(note);
  const baseRole = note.dismissedAt ? await verifiedAdminBaseRole(gate.userId) : null;

  return NextResponse.json({
    success: true,
    note: {
      id: note.id,
      clientId: note.clientId,
      clientName: note.client.name,
      clinicianId: note.clinicianId,
      clinicianName: wf?.clinicianName || note.clinician?.name || null,
      body: meta.displayBody,
      status: wf?.status?.toLowerCase() || 'draft',
      signedAt: wf?.signedAt || null,
      planPendingUntil: wf?.planPendingUntil ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      noteType: meta.noteType,
      dateOfService: meta.dateOfService,
      durationMinutes: meta.durationMinutes,
      cptCode: meta.cptCode,
      placeOfService: meta.placeOfService,
      telehealth: meta.telehealth,
      part2: meta.part2,
      aiDrafted: meta.aiDrafted,
      addenda: note.addenda.map(serializeAddendum),
      appointmentId: note.appointmentId,
      // Dismissed (unsigned, not needed): read-only; undo by the author within 30 days
      dismissedAt: note.dismissedAt?.toISOString() ?? null,
      dismissedByName: note.dismissedByName,
      dismissReason: note.dismissReason,
      canUndoDismiss: note.dismissedAt
        ? canUndoDismiss({ dismissedAt: note.dismissedAt, now: new Date(), isAuthor: note.clinicianId === gate.userId, elevated: isElevatedNoteActor(gate.role, baseRole) })
        : false,
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
  const note = await prisma.progressNote.findFirst({
    where: {
      id,
      client: clientAccessWhere({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      }),
    },
  });

  if (!note) {
    return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }
  const body = parsed.data;
  // Admin base role from the DB (cached), never the JWT's baseRole claim (stale after a demotion).
  const baseRole = await verifiedAdminBaseRole(gate.userId);

  // Addendum (deprecated request shape): stored as its own row; the signed body is untouched.
  if (body.addendum) {
    const result = await addNoteAddendum({
      noteId: note.id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      actorBaseRole: baseRole,
      reason: body.addendum.reason,
      text: body.addendum.text,
    });
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({ gate, req, action: 'NOTE_ADDENDUM', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, metadata: { addendumId: result.addendum.id } });
    return NextResponse.json({ success: true, addendum: result.addendum });
  }

  const workflowMap = await loadWorkflowStatuses([note.id]);
  const currentStatus = workflowMap.get(note.id)?.status?.toLowerCase() || 'draft';
  const isSignedOrLocked = currentStatus === 'signed' || currentStatus === 'locked';
  const currentDisplayBody = resolveNoteMeta(note).displayBody;

  const newContent = body.content ?? body.body;
  const { noteType, dateOfService, durationMinutes, cptCode, placeOfService, telehealth, audioOnly, addOnCptCode, psychotherapyMinutes, part2, aiDrafted } = body;
  const metaInput = { noteType, dateOfService, durationMinutes, cptCode, placeOfService, telehealth, audioOnly, addOnCptCode, psychotherapyMinutes, part2, aiDrafted };
  const metaSent = Object.values(metaInput).some((v) => v !== undefined);
  const contentChanged = newContent !== undefined && newContent.trim() !== currentDisplayBody.trim();

  // Signed notes are legally immutable: content and metadata.
  if (isSignedOrLocked && (contentChanged || metaSent)) {
    return NextResponse.json(
      {
        success: false,
        error: 'A signed note is legally immutable. Content cannot be modified. Use addenda for corrections.',
      },
      { status: 403 }
    );
  }

  const requestedStatus = body.status?.toLowerCase();

  // Dismissed notes are read-only (no edit, no signature) until the dismissal is undone
  if (note.dismissedAt && (contentChanged || metaSent || requestedStatus === 'signed' || requestedStatus === 'locked')) {
    return NextResponse.json(
      { success: false, error: 'This note was dismissed. Undo the dismissal before editing or signing it.' },
      { status: 409 }
    );
  }

  // Note type change (e.g. intake -> progress note during the visit): a known template, unsigned only
  const typeChange = noteType != null && noteType !== '' && isNoteTypeChange(resolveNoteMeta(note).noteType, noteType)
    ? { from: resolveNoteMeta(note).noteType, to: normalizeNoteType(noteType) }
    : null;
  if (typeChange) {
    const typeError = noteTypeChangeError({ toType: typeChange.to, status: currentStatus, dismissed: Boolean(note.dismissedAt) });
    if (typeError) return NextResponse.json({ success: false, error: typeError }, { status: isSignedOrLocked ? 403 : 400 });
  }

  // Draft edits: only the author, or an admin / director.
  const wantsEdit = !isSignedOrLocked && (newContent !== undefined || metaSent);
  if (wantsEdit && note.clinicianId !== gate.userId && !isElevatedNoteActor(gate.role, baseRole)) {
    return NextResponse.json(
      { success: false, error: 'Only the note author or an administrator can edit this draft.' },
      { status: 403 }
    );
  }

  const applyDraftEdit = async () => {
    if (!wantsEdit) return;
    const text = newContent !== undefined ? newContent.trim() : undefined;
    if (text !== undefined && !text) throw new HttpError(400, 'Note is required');
    await prisma.progressNote.update({
      where: { id: note.id },
      data: {
        ...(text !== undefined ? { body: text } : {}),
        // Sent values win; legacy comment values carry over when an old note is edited.
        ...noteMetaColumns(metaInput, note, note.body),
      },
    });
  };

  const fail = (err: unknown) =>
    NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save note' },
      { status: err instanceof HttpError ? err.status : 500 }
    );

  // Draft save / autosave
  if (requestedStatus === 'draft' || (!requestedStatus && !isSignedOrLocked)) {
    try {
      await applyDraftEdit();
    } catch (err) {
      return fail(err);
    }
    if (wantsEdit) {
      await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, metadata: { status: 'draft' } });
    }
    // Type names only (old -> new), never note text
    if (typeChange) {
      await auditPhiAccess({ gate, req, action: 'NOTE_TYPE_CHANGE', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, metadata: { fromType: typeChange.from, toType: typeChange.to } });
    }
    return NextResponse.json({ success: true, status: 'draft' });
  }

  // Signing / locking
  if (requestedStatus === 'signed' || requestedStatus === 'locked') {
    if (!isSignedOrLocked) {
      if (body.attested !== true) {
        return NextResponse.json(
          { success: false, error: 'Confirm the clinical attestation before signing.' },
          { status: 400 }
        );
      }
      const finalBody = newContent !== undefined ? newContent : currentDisplayBody;
      const blanks = findUnfilledBlanks(finalBody);
      if (blanks > 0) {
        return NextResponse.json(
          { success: false, error: `Fill the ${blanks} remaining [___] blank${blanks === 1 ? '' : 's'} before signing.` },
          { status: 400 }
        );
      }
      try {
        await applyDraftEdit();
      } catch (err) {
        return fail(err);
      }
      if (typeChange) {
        await auditPhiAccess({ gate, req, action: 'NOTE_TYPE_CHANGE', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, metadata: { fromType: typeChange.from, toType: typeChange.to } });
      }
    }

    const wfRes = await updateProgressNoteWorkflow({
      noteId: note.id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      status: requestedStatus === 'locked' ? 'Locked' : 'Signed',
      // Checked above for a new signature; locking an already-signed note needs none
      attested: body.attested === true,
      lateEntryReason: body.lateEntryReason ?? null,
      riskAttestation: body.riskAttestation ?? null,
    });

    if (!wfRes.ok) {
      const errorResult = wfRes as { ok: false; status: number; error: string };
      return NextResponse.json({ success: false, error: errorResult.error }, { status: errorResult.status });
    }

    // Signing creates a draft claim in billing, coded from the note (CPT column, else the code in an
    // older note's metadata). No code is passed: an explicit code would drop the note's
    // psychotherapy add-on line (90833 / 90836 / 90838), and an existing claim keeps its code.
    let claimResult: unknown = null;
    try {
      claimResult = await generateClaimFromNote(
        {
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        },
        note.id
      );
    } catch (claimErr) {
      console.error('[note sign claim generation error]', claimErr);
    }

    // Late entry = signed after the practice deadline (stamped by the workflow), not "created > 24 h ago"
    const isLateEntry = wfRes.signed
      ? Boolean((await prisma.progressNoteTimeliness.findUnique({ where: { noteId: note.id }, select: { lateEntry: true } }).catch(() => null))?.lateEntry)
      : false;
    // Signed: leaves the inbox "Unsigned notes" section right away (section cache)
    invalidateInboxForOrg(gate.organizationId);
    await auditPhiAccess({ gate, req, action: requestedStatus === 'locked' ? 'NOTE_LOCK' : 'NOTE_SIGN', resourceType: 'progressNote', resourceId: note.id, patientId: note.clientId, metadata: { lateEntry: isLateEntry, planGateOverride: wfRes.planTransition ? wfRes.planTransition.reason : null } });
    return NextResponse.json({
      success: true,
      status: wfRes.status.toLowerCase(),
      signedAt: new Date().toISOString(),
      signedBy: gate.userId,
      lateEntry: isLateEntry,
      planTransition: wfRes.planTransition ?? null,
      claim: claimResult,
      riskWatch: await watchProgressNote({ noteId: note.id, organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
    });
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { NOTE_SECTIONS, normalizeNoteType, type NoteType } from '@/lib/ehr/noteTemplates';
import { latestQualityReview } from '@/lib/ai/noteQuality/reviewStore';
import { loadNotePolicy } from '@/lib/notes/policy';
import { getServiceDetail } from '@/lib/notes/serviceDetail';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';
import { loadDiagnosisList, loadReviewState } from '@/lib/diagnoses/store';
import { diagnosisNoteWarnings } from '@/lib/diagnoses/model';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { formatElementsGate } from '@/lib/notes/formatElements';
import {
  billingElementIssues,
  isLikelyClone,
  LATE_REASON_MIN_CHARS,
  noteSimilarityPercent,
  noteTimeliness,
  noteTypeIssues,
  prpContactIssues,
} from '@/lib/notes/standard';
import { getPrpNoteDetail, loadPrpNoteContext } from '@/lib/prp/progressNoteDb';
import { irpWarnings } from '@/lib/prp/progressNote';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/standard — documentation-standard facts for the note view: timeliness /
 * late entry, required billing elements still missing, cloned-note similarity, return-for-correction
 * status, amendment requests, and links (chart, appointment, claim, treatment plan). No note text.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  const orgId = access.gate.organizationId;

  const note = await prisma.progressNote.findUnique({
    where: { id: access.note.id },
    select: {
      id: true,
      body: true,
      noteType: true,
      dateOfService: true,
      durationMinutes: true,
      cptCode: true,
      placeOfService: true,
      telehealth: true,
      audioOnly: true,
      part2: true,
      aiDrafted: true,
      clientId: true,
      clinicianId: true,
      createdAt: true,
      appointment: { select: { id: true, startsAt: true, patientLocationState: true, status: true } },
      clinician: { select: { credentials: true } },
      workflow: { select: { status: true, signedAt: true, cosignRequired: true, cosignedAt: true, cosignedByName: true, supervisorComment: true } },
      claims: { select: { id: true, status: true }, take: 1 },
    },
  });
  if (!note) return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });

  const meta = resolveNoteMeta(note);
  const [policy, detail, stamp, review, plan, prior, amendments, privateNote] = await Promise.all([
    loadNotePolicy(orgId),
    getServiceDetail(note.id),
    prisma.progressNoteTimeliness.findUnique({ where: { noteId: note.id } }).catch(() => null),
    latestQualityReview(orgId, note.id),
    prisma.treatmentPlan
      .findFirst({ where: { organizationId: orgId, clientId: note.clientId, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } }, select: { id: true, status: true, title: true }, orderBy: { updatedAt: 'desc' } })
      .catch(() => null),
    prisma.progressNote.findMany({
      where: { clientId: note.clientId, id: { not: note.id }, createdAt: { lt: note.createdAt } },
      select: { id: true, body: true, noteType: true, dateOfService: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.noteAmendmentRequest.findMany({ where: { organizationId: orgId, noteId: note.id }, orderBy: { createdAt: 'desc' } }).catch(() => []),
    prisma.progressNotePsychotherapyNote.findUnique({ where: { noteId: note.id }, select: { noteId: true } }).catch(() => null),
  ]);

  const status = note.workflow?.status === 'LOCKED' ? 'Locked' : note.workflow?.status === 'SIGNED' ? 'Signed' : 'Draft';
  const dos = meta.dateOfService || note.createdAt.toISOString().slice(0, 10);
  const timeliness = noteTimeliness({
    dateOfService: dos,
    endTime: detail?.endTime ?? null,
    signedAt: status === 'Draft' ? null : note.workflow?.signedAt ?? null,
    now: new Date(),
    deadlineHours: policy.deadlineHours,
    timeZone: policy.timeZone,
  });

  // Group-session notes: required fields are enforced by the group session when it signs them
  const groupNote = await prisma.clinicalGroupAttendance
    .findFirst({ where: { progressNoteId: note.id }, select: { id: true } })
    .catch(() => null);
  const issues =
    status === 'Draft' && !groupNote
      ? [
          ...billingElementIssues({
            noteType: meta.noteType,
            body: meta.displayBody,
            cptCode: meta.cptCode,
            dateOfService: meta.dateOfService,
            durationMinutes: meta.durationMinutes,
            telehealth: meta.telehealth || note.audioOnly,
            audioOnly: note.audioOnly,
            placeOfService: meta.placeOfService,
            detail,
            appointmentPatientState: note.appointment?.patientLocationState ?? null,
            renderingCredentials: note.clinician?.credentials ?? null,
            requireDiagnosisToSign: policy.requireDiagnosisToSign,
            clientId: note.clientId,
          }),
          ...noteTypeIssues({ noteType: meta.noteType, body: meta.displayBody, part2: meta.part2, formatElements: formatElementsGate(policy) }),
          ...(normalizeNoteType(meta.noteType || '') === 'PRP'
            ? prpContactIssues({
                noteType: meta.noteType,
                body: meta.displayBody,
                detail: await getPrpNoteDetail(note.id),
                dateOfService: meta.dateOfService,
                startTime: detail?.startTime ?? null,
                endTime: detail?.endTime ?? null,
                durationMinutes: meta.durationMinutes,
                formatElements: formatElementsGate(policy),
              })
            : []),
        ]
      : [];
  // PRP: no finalized IRP / IRP review overdue are warnings only (never block signing)
  if (status === 'Draft' && !groupNote && normalizeNoteType(meta.noteType || '') === 'PRP') {
    const prp = await loadPrpNoteContext({ organizationId: orgId, actorUserId: access.gate.userId, actorRole: access.gate.role, clientId: note.clientId, noteId: note.id }).catch(() => null);
    if (prp) for (const [i, message] of irpWarnings(prp.irp).entries()) issues.push({ id: `prp.irp.${i}`, message, severity: 'warn' });
  }
  // Diagnosis list reminders (never block signing): linked codes no longer current, provisional
  // first pointer, list review due
  if (status === 'Draft' && !groupNote && canSeeBhDiagnoses(access.gate.role)) {
    try {
      const [list, dxReview] = await Promise.all([loadDiagnosisList(orgId, note.clientId), loadReviewState(orgId, note.clientId)]);
      issues.push(...diagnosisNoteWarnings({ linkedCodes: detail?.diagnosisCodes ?? [], rows: list.rows, review: meta.cptCode ? dxReview : null, clientId: note.clientId }));
    } catch (err) {
      console.error('[notes/[id]/standard] diagnosis reminders', err instanceof Error ? err.message : err);
    }
  }

  // Cloned-note check against the client's previous note (same type preferred). Percent only.
  const type = meta.noteType ? normalizeNoteType(meta.noteType) : '';
  const priorSame = prior.find((p) => normalizeNoteType(resolveNoteMeta(p).noteType || '') === type) ?? prior[0] ?? null;
  let clone: { percent: number; likely: boolean; priorNoteId: string; priorDate: string } | null = null;
  if (priorSame) {
    const headings = (NOTE_SECTIONS as Record<string, readonly string[]>)[type as NoteType] ?? [];
    const pm = resolveNoteMeta(priorSame);
    const percent = noteSimilarityPercent(meta.displayBody, pm.displayBody, headings);
    clone = {
      percent,
      likely: isLikelyClone(percent, policy.cloneWarnPercent),
      priorNoteId: priorSame.id,
      priorDate: pm.dateOfService || priorSame.createdAt.toISOString().slice(0, 10),
    };
  }

  const returned =
    review && review.action === 'RETURNED' && !note.workflow?.cosignedAt
      ? { reviewerName: review.reviewerName, comment: review.comment, createdAt: review.createdAt, answered: review.addendaSince > 0 }
      : null;

  await auditPhiAccess({
    gate: access.gate,
    req,
    action: 'READ',
    resourceType: 'progressNote',
    resourceId: note.id,
    patientId: note.clientId,
    metadata: { view: 'notesStandard', clonePercent: clone?.percent ?? null },
  });

  return NextResponse.json({
    success: true,
    status,
    policy: { deadlineHours: policy.deadlineHours, cloneWarnPercent: policy.cloneWarnPercent, timeZone: policy.timeZone },
    timeliness: {
      ...timeliness,
      lateEntryLabel: stamp?.lateEntry ? stamp.label : null,
      lateEntryReason: stamp?.lateEntry ? stamp.lateReason ?? null : null,
      // Signing now would be a late entry: the sign form asks for the reason
      lateReasonRequired: status === 'Draft' && timeliness.state === 'overdue',
      lateReasonMinChars: LATE_REASON_MIN_CHARS,
    },
    issues,
    clone,
    serviceDetail: detail,
    returned,
    cosign: note.workflow
      ? { required: note.workflow.cosignRequired, cosignedAt: note.workflow.cosignedAt?.toISOString() ?? null, cosignedByName: note.workflow.cosignedByName, comment: note.workflow.supervisorComment }
      : null,
    psychotherapyNotes: { exists: Boolean(privateNote), canOpen: Boolean(note.clinicianId && note.clinicianId === access.gate.userId) },
    amendments: amendments.map((a) => ({
      id: a.id,
      status: a.status,
      requestedBy: a.requestedBy,
      requestedOn: a.requestedOn.toISOString().slice(0, 10),
      requestText: a.requestText,
      dueOn: a.dueOn.toISOString().slice(0, 10),
      decisionReason: a.decisionReason,
      decidedByName: a.decidedByName,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      disagreementStatement: a.disagreementStatement,
    })),
    links: {
      clientId: note.clientId,
      appointment: note.appointment ? { id: note.appointment.id, startsAt: note.appointment.startsAt.toISOString(), status: note.appointment.status } : null,
      claim: note.claims[0] ? { id: note.claims[0].id, status: note.claims[0].status } : null,
      treatmentPlan: plan ? { id: plan.id, status: plan.status, title: plan.title } : null,
    },
  });
}

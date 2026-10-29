import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { createClientNote } from '@/lib/clients/notes';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { GOAL_PROGRESS } from '@/lib/ehr/therapy/widgets';
import { PLAN_PROGRESS } from '@/lib/ehr/therapy/planHierarchy';
import { TS } from '@/lib/ehr/therapy/sections';
import { SCRIBE_FORMATS } from '@/lib/scribe/settings';
import { composeBody, formatSpec } from '@/lib/scribe/templateFields';
import { planGoalLines } from '@/lib/scribe/draft';
import { findCapture } from '@/lib/scribe/store';
import { afterCaptureLinked, captureClock } from '@/lib/scribe/noteLink';
import { sessionTimeLines } from '@/lib/scribe/sessionClock';
import { FORMAT_CODING } from '@/lib/scribe/formatCatalog';
import { psychotherapyAddOnForMinutes } from '@/lib/telehealth/inCallCoding';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  draftId: z.string().min(1).max(128),
  format: z.enum(SCRIBE_FORMATS),
  /** Section texts as the clinician reviewed / edited them on the scribe page */
  texts: z.record(z.string().max(60), z.string().max(12000)),
  /** Plan linkage the clinician confirmed */
  planLinks: z
    .array(z.object({ goalIndex: z.number().int().min(0).max(50), goalText: z.string().max(500), status: z.enum(GOAL_PROGRESS), level: z.enum(['', ...PLAN_PROGRESS]) }))
    .max(20)
    .default([]),
  durationMinutes: z.number().int().min(1).max(600).optional().nullable(),
  /** The clinician confirmed the client name + date of birth in the review header ("Right client?") */
  clientConfirmed: z.literal(true),
  /** Prescriber formats: the E/M level the clinician chose (never suggested by AI) */
  emCode: z.enum(['99212', '99213', '99214', '99215']).optional().nullable(),
  /** Prescriber formats: psychotherapy minutes separate from the E/M (90833 / 90836 / 90838) */
  psychotherapyMinutes: z.number().int().min(1).max(600).optional().nullable(),
});

/**
 * POST /api/scribe/captures/[id]/note — "Create draft note": a DRAFT ProgressNote (workflow DRAFT)
 * linked to the capture's appointment, marked aiDrafted (and part2 for SUD sessions). Never signed:
 * the clinician opens it in Notes, accepts each AI section after review, picks the codes and
 * signs. Risk Watch scans the saved draft like any other note.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Invalid note. Confirm the client (name and date of birth) before creating the note.');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician can create the note');
  if (cap.progressNoteId) {
    return NextResponse.json({ success: true, noteId: cap.progressNoteId, existing: true, href: `/dashboard/ehr/notes?openNote=${encodeURIComponent(cap.progressNoteId)}` });
  }
  const draft = await prisma.scribeDraft.findFirst({ where: { id: body.draftId, sessionId: cap.id }, select: { id: true } });
  if (!draft) return jsonError(404, 'Draft not found for this capture');
  const spec = formatSpec(body.format);
  if (spec.kind === 'plan' || !spec.noteType) return jsonError(400, 'Treatment plan updates are applied on the treatment plan, not as a note.');

  const texts: Record<string, string> = {};
  for (const h of spec.headings) texts[h] = (body.texts[h] || '').trim();
  const goalLines = planGoalLines(body.planLinks);
  if (goalLines) {
    const target = spec.kind === 'template' && spec.headings.includes(TS.planGoals) ? TS.planGoals : spec.headings.includes('Goals') ? 'Goals' : 'Plan';
    texts[target] = [texts[target], spec.kind === 'template' ? goalLines : `Treatment plan goals addressed:\n${goalLines}`].filter(Boolean).join('\n');
  }
  // Session clock from the capture (pauses removed): therapist templates restore "Start time / End time"
  const clock = await captureClock(cap);
  if (clock && spec.kind === 'template' && spec.headings.includes(TS.session) && !/^Start time:/m.test(texts[TS.session] || '')) {
    texts[TS.session] = [texts[TS.session], sessionTimeLines(clock)].filter(Boolean).join('\n');
  }
  const noteBody = composeBody(spec, texts);
  const prescriber = FORMAT_CODING[body.format] === 'em';
  const addOn = prescriber && body.emCode ? psychotherapyAddOnForMinutes(body.psychotherapyMinutes ?? null) : null;
  if (!Object.values(texts).some((t) => t.trim())) return jsonError(400, 'The note is empty.');

  // The visit this capture documents: its date is the date of service (a draft created the next
  // morning is still for yesterday's session) and its modality carries over (no re-entry in Notes)
  const appt = cap.appointmentId
    ? await prisma.appointment
        .findFirst({ where: { id: cap.appointmentId, clientId: cap.clientId }, select: { startsAt: true, isVirtual: true, audioOnly: true } })
        .catch(() => null)
    : null;
  const tz = appt ? await getPracticeTimeZone(actor.organizationId).catch(() => DEFAULT_PRACTICE_TIME_ZONE) : DEFAULT_PRACTICE_TIME_ZONE;
  const dateOfService = appt ? toPracticeWallTime(appt.startsAt, tz).date : practiceToday(tz);
  const telehealth = cap.mode === 'telehealth' || Boolean(appt?.isVirtual || appt?.audioOnly);

  const created = await createClientNote({
    clientId: cap.clientId,
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRole: actor.role as Role,
    actorBaseRole: await verifiedAdminBaseRole(actor.userId),
    body: noteBody,
    appointmentId: cap.appointmentId,
    meta: {
      noteType: spec.noteType,
      dateOfService,
      durationMinutes: body.durationMinutes ?? (clock && clock.minutes > 0 ? clock.minutes : null),
      ...(prescriber && body.emCode ? { cptCode: body.emCode } : {}),
      ...(prescriber && body.psychotherapyMinutes ? { psychotherapyMinutes: body.psychotherapyMinutes } : {}),
      ...(addOn ? { addOnCptCode: addOn as '90833' | '90836' | '90838' } : {}),
      telehealth,
      ...(appt?.audioOnly ? { audioOnly: true } : {}),
      part2: cap.part2 || spec.part2,
      aiDrafted: true,
    },
  });
  if (created.ok === false) return jsonError(created.status, created.error);

  // Link once (a concurrent click that lost the race removes its duplicate draft)
  const linked = await prisma.scribeCapture.updateMany({ where: { id: cap.id, progressNoteId: null }, data: { progressNoteId: created.note.id, status: 'note_created' } });
  if (linked.count === 0) {
    await prisma.progressNote.delete({ where: { id: created.note.id } }).catch(() => undefined);
    const winner = await prisma.scribeCapture.findUnique({ where: { id: cap.id }, select: { progressNoteId: true } });
    return NextResponse.json({ success: true, noteId: winner?.progressNoteId, existing: true, href: `/dashboard/ehr/notes?openNote=${encodeURIComponent(winner?.progressNoteId || '')}` });
  }
  await auditPhiAccess({
    gate,
    req,
    action: 'WRITE',
    resourceType: 'clientNote',
    resourceId: created.note.id,
    patientId: cap.clientId,
    metadata: { source: 'ai_scribe', captureId: cap.id, draftId: draft.id, format: body.format, planLinks: body.planLinks.length, part2: cap.part2, clientConfirmed: true, emCode: body.emCode ?? null },
  });
  // Transcript risk findings on the capture (gate signing) and the capture clock as the service start / end time
  await afterCaptureLinked(cap, created.note.id, actor.userId);
  const risk = await watchProgressNote({ noteId: created.note.id, organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }).catch(() => null);
  return NextResponse.json(
    { success: true, noteId: created.note.id, href: `/dashboard/ehr/notes?openNote=${encodeURIComponent(created.note.id)}`, riskWatch: risk },
    { status: 201 }
  );
}

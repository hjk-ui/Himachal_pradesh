/**
 * "Delete transcript when the note is signed" (practice setting, default ON). Server only.
 *
 * Called from the note sign path (updateProgressNoteWorkflow, after a new signature) for every
 * signed note, including group notes:
 *  - individual capture linked to the note (scribe_captures.progress_note_id): transcript segments,
 *    AI drafts (with their citation line ids; the signed note does not display grounding) and the
 *    client summary text are deleted at once; the capture row stays as metadata (ids, times, counts,
 *    consent attestation) with transcriptPurgedAt and noteSignedAt set.
 *  - group capture: purged once every included member's note for that session is signed.
 * With the setting OFF, only noteSignedAt / transcriptPurgeAfter are recorded and the day-based
 * retention job purges later. Every purge writes SCRIBE_TRANSCRIPT_PURGE (counts only). Never throws:
 * the signature is already committed; the retention job is the safety net.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { loadScribeSettings } from './store';
import { DAY_MS } from './retention';
import { isAttended } from '@/lib/groups/types';
import type { GroupMember } from './group';

export async function purgeCaptureNow(captureId: string): Promise<{ segments: number; drafts: number }> {
  const now = new Date();
  const [segments, drafts] = await prisma.$transaction([
    prisma.scribeSegment.deleteMany({ where: { sessionId: captureId } }),
    prisma.scribeDraft.deleteMany({ where: { sessionId: captureId } }),
    prisma.scribeCapture.update({ where: { id: captureId }, data: { transcriptPurgedAt: now, clientSummary: null } }),
  ]);
  return { segments: segments.count, drafts: drafts.count };
}

export async function purgeGroupCaptureNow(captureId: string): Promise<{ segments: number }> {
  const [segments] = await prisma.$transaction([
    prisma.scribeGroupSegment.deleteMany({ where: { captureId } }),
    prisma.scribeGroupCapture.update({ where: { id: captureId }, data: { transcriptPurgedAt: new Date(), draft: Prisma.DbNull } }),
  ]);
  return { segments: segments.count };
}

const audit = (organizationId: string, captureId: string, metadata: Record<string, unknown>) =>
  writeAuditLog({ action: 'SCRIBE_TRANSCRIPT_PURGE', actorUserId: null, actorRole: 'system', organizationId, resourceType: 'scribeCapture', resourceId: captureId, metadata });

export async function purgeScribeForSignedNote(input: { noteId: string; organizationId: string; signedAt?: Date | null }): Promise<{ purged: number }> {
  let purged = 0;
  try {
    const settings = await loadScribeSettings(input.organizationId);
    const signedAt = input.signedAt ?? new Date();
    const caps = await prisma.scribeCapture.findMany({
      where: { organizationId: input.organizationId, progressNoteId: input.noteId, transcriptPurgedAt: null },
      select: { id: true },
    });
    for (const c of caps) {
      if (settings.deleteTranscriptOnSign) {
        await prisma.scribeCapture.update({ where: { id: c.id }, data: { noteSignedAt: signedAt, transcriptPurgeAfter: signedAt } });
        const res = await purgeCaptureNow(c.id);
        purged++;
        await audit(input.organizationId, c.id, { ...res, reason: 'note_signed' });
      } else {
        await prisma.scribeCapture.update({
          where: { id: c.id },
          data: { noteSignedAt: signedAt, transcriptPurgeAfter: new Date(signedAt.getTime() + settings.transcriptRetentionDays * DAY_MS) },
        });
      }
    }
    // Group note: purge that session's group capture once every included member's note is signed
    const att = await prisma.clinicalGroupAttendance.findFirst({ where: { progressNoteId: input.noteId, organizationId: input.organizationId }, select: { sessionId: true } }).catch(() => null);
    if (att && settings.deleteTranscriptOnSign) purged += await purgeGroupIfAllSigned(input.organizationId, att.sessionId);
  } catch (err) {
    console.error('[scribe:sign-purge]', err instanceof Error ? err.name : 'unknown');
  }
  return { purged };
}

/** Every attending, included member's note for the session is signed → purge the group capture(s). */
export async function purgeGroupIfAllSigned(organizationId: string, sessionId: string): Promise<number> {
  const caps = await prisma.scribeGroupCapture.findMany({ where: { organizationId, groupSessionId: sessionId, transcriptPurgedAt: null }, select: { id: true, members: true } });
  if (!caps.length) return 0;
  const rows = await prisma.clinicalGroupAttendance.findMany({ where: { sessionId, organizationId }, select: { clientId: true, status: true, progressNoteId: true } });
  const noteIds = rows.map((r) => r.progressNoteId).filter((x): x is string => Boolean(x));
  const wf = noteIds.length ? await prisma.progressNoteWorkflow.findMany({ where: { noteId: { in: noteIds } }, select: { noteId: true, signedAt: true } }) : [];
  const signed = new Set(wf.filter((w) => w.signedAt).map((w) => w.noteId));
  let n = 0;
  for (const cap of caps) {
    const included = new Set(((cap.members as GroupMember[] | null) ?? []).filter((m) => m.included).map((m) => m.clientId));
    const pending = rows.filter((r) => included.has(r.clientId) && isAttended(r.status) && !(r.progressNoteId && signed.has(r.progressNoteId)));
    if (pending.length) continue;
    const res = await purgeGroupCaptureNow(cap.id);
    n++;
    await writeAuditLog({ action: 'SCRIBE_TRANSCRIPT_PURGE', actorUserId: null, actorRole: 'system', organizationId, resourceType: 'scribeGroupCapture', resourceId: cap.id, metadata: { ...res, reason: 'group_notes_signed' } });
  }
  return n;
}

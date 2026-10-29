/**
 * After a capture becomes a note (server only): the risk findings exist on the capture (scanned
 * now if the capture was never drafted) and the note's service details carry the capture clock
 * (start / end time) unless the clinician already entered them. Never throws: a failure leaves
 * the note as it is (the sign gate still re-reads the capture).
 */
import { prisma } from '@/lib/db/prisma';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { loadLines } from './store';
import { clinicianNarrates, scanTranscriptRisk } from './risk';
import { persistableFindings } from './riskGate';
import { sessionClockFromCapture, type SessionClock } from './sessionClock';

type LinkedCapture = {
  id: string;
  organizationId: string;
  mode: string;
  engine: string;
  source: string;
  speakerMap: unknown;
  telehealthSessionId: string | null;
  consentParticipants: unknown;
  startedAt: Date | null;
  stoppedAt: Date | null;
  pausedAt: Date | null;
  pausedSeconds: number;
  riskFindings: unknown;
  transcriptPurgedAt: Date | null;
};

export async function captureClock(cap: Pick<LinkedCapture, 'organizationId' | 'startedAt' | 'stoppedAt' | 'pausedAt' | 'pausedSeconds'>): Promise<SessionClock | null> {
  const tz = await getPracticeTimeZone(cap.organizationId).catch(() => DEFAULT_PRACTICE_TIME_ZONE);
  return sessionClockFromCapture(cap, tz);
}

export async function afterCaptureLinked(cap: LinkedCapture, noteId: string, actorUserId: string): Promise<{ clock: SessionClock | null }> {
  let clock: SessionClock | null = null;
  try {
    if (cap.riskFindings == null && !cap.transcriptPurgedAt) {
      const { lines } = await loadLines(cap);
      const risk = scanTranscriptRisk(lines, { scanClinician: clinicianNarrates(cap) });
      await prisma.scribeCapture.update({ where: { id: cap.id }, data: { riskFindings: JSON.parse(JSON.stringify(persistableFindings(risk))) } });
    }
    clock = await captureClock(cap);
    if (clock) {
      const existing = await prisma.progressNoteServiceDetail.findUnique({ where: { noteId }, select: { startTime: true, endTime: true } }).catch(() => null);
      if (!existing?.startTime && !existing?.endTime) {
        await prisma.progressNoteServiceDetail.upsert({
          where: { noteId },
          create: { noteId, startTime: clock.startTime, endTime: clock.endTime, updatedById: actorUserId },
          update: { startTime: clock.startTime, endTime: clock.endTime, updatedById: actorUserId },
        });
      }
    }
  } catch (err) {
    console.error('[scribe link] follow-up failed', err instanceof Error ? err.name : 'unknown');
  }
  return { clock };
}

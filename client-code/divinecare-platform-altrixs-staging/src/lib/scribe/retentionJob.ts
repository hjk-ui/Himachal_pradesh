/** Prisma wiring for the transcript retention job (see retention.ts for the policy). Server only. */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DAY_MS, runRetention, sweepClosedCaptures, type RetentionDeps, type ClosedSweepDeps } from './retention';
import { purgeGroupCaptureNow, purgeGroupIfAllSigned } from './signPurge';
import { loadScribeSettings } from './store';

export function prismaRetentionDeps(): RetentionDeps {
  return {
    candidates: () =>
      prisma.scribeCapture.findMany({
        where: { transcriptPurgedAt: null, status: { not: 'ready' } },
        select: { id: true, organizationId: true, progressNoteId: true, noteSignedAt: true, stoppedAt: true, updatedAt: true, transcriptPurgeAfter: true, transcriptPurgedAt: true },
        orderBy: { updatedAt: 'asc' },
        take: 500,
      }),
    retentionDays: async (orgId) => (await loadScribeSettings(orgId)).transcriptRetentionDays,
    deleteOnSign: async (orgId) => (await loadScribeSettings(orgId)).deleteTranscriptOnSign,
    noteSignedAt: async (noteId) => {
      const wf = await prisma.progressNoteWorkflow.findUnique({ where: { noteId }, select: { signedAt: true, status: true } });
      return wf?.signedAt ?? null;
    },
    markSigned: async (id, signedAt, purgeAt) => {
      await prisma.scribeCapture.update({ where: { id }, data: { noteSignedAt: signedAt, transcriptPurgeAfter: purgeAt } });
    },
    purge: async (id) => {
      const [segments] = await prisma.$transaction([
        prisma.scribeSegment.deleteMany({ where: { sessionId: id } }),
        prisma.scribeDraft.deleteMany({ where: { sessionId: id } }),
        prisma.scribeCapture.update({ where: { id }, data: { transcriptPurgedAt: new Date(), clientSummary: null, speakerMap: undefined } }),
      ]);
      return { segments: segments.count };
    },
    audit: ({ organizationId, captureId, segments }) =>
      writeAuditLog({ action: 'SCRIBE_TRANSCRIPT_PURGE', actorUserId: null, actorRole: 'system', organizationId, resourceType: 'scribeCapture', resourceId: captureId, metadata: { segments } }),
  };
}

/** Captures closed by dismiss / consent withdrawal: any segment or draft left behind (any age). */
const CLOSED_CAPTURE: Prisma.ScribeCaptureWhereInput = { OR: [{ status: 'discarded' }, { consentWithdrawnAt: { not: null } }] };

export function prismaClosedSweepDeps(): ClosedSweepDeps {
  return {
    leftovers: async () => {
      const [segs, drafts] = await Promise.all([
        prisma.scribeSegment.findMany({ where: { session: CLOSED_CAPTURE }, select: { sessionId: true, organizationId: true }, distinct: ['sessionId'], take: 500 }),
        prisma.scribeDraft.findMany({ where: { session: CLOSED_CAPTURE }, select: { sessionId: true, organizationId: true }, distinct: ['sessionId'], take: 500 }),
      ]);
      const by = new Map<string, string>();
      for (const r of [...segs, ...drafts]) by.set(r.sessionId, r.organizationId);
      return [...by].map(([captureId, organizationId]) => ({ captureId, organizationId }));
    },
    purge: async (captureId) => {
      const [segments, drafts] = await prisma.$transaction([
        prisma.scribeSegment.deleteMany({ where: { sessionId: captureId, session: CLOSED_CAPTURE } }),
        prisma.scribeDraft.deleteMany({ where: { sessionId: captureId, session: CLOSED_CAPTURE } }),
      ]);
      return { segments: segments.count, drafts: drafts.count };
    },
    audit: ({ organizationId, captureId, segments, drafts }) =>
      writeAuditLog({
        action: 'SCRIBE_TRANSCRIPT_PURGE',
        actorUserId: null,
        actorRole: 'system',
        organizationId,
        resourceType: 'scribeCapture',
        resourceId: captureId,
        metadata: { segments, drafts, reason: 'closed_capture_leftover' },
      }),
  };
}

export async function runScribeRetention(now = new Date()) {
  const result = await runRetention(prismaRetentionDeps(), now);
  const closed = await sweepClosedCaptures(prismaClosedSweepDeps());
  const group = await runGroupRetention(now).catch(() => 0);
  return { ...result, closedSwept: closed.captures, closedSegments: closed.segments, groupPurged: group };
}

/**
 * Group captures: purged when every included member's note is signed (delete-on-sign, also done at
 * signing by signPurge.ts), else N days after capture stopped; discarded / withdrawn at any age.
 */
export async function runGroupRetention(now = new Date()): Promise<number> {
  let purged = 0;
  const caps = await prisma.scribeGroupCapture
    .findMany({
      where: { transcriptPurgedAt: null, status: { not: 'ready' } },
      select: { id: true, organizationId: true, groupSessionId: true, status: true, consentWithdrawnAt: true, stoppedAt: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    })
    .catch(() => []);
  for (const c of caps) {
    const settings = await loadScribeSettings(c.organizationId);
    if (c.status === 'discarded' || c.consentWithdrawnAt) {
      await purgeGroupCaptureNow(c.id);
      purged++;
      continue;
    }
    if (settings.deleteTranscriptOnSign && (await purgeGroupIfAllSigned(c.organizationId, c.groupSessionId))) {
      purged++;
      continue;
    }
    const base = c.stoppedAt ?? c.updatedAt;
    if (base.getTime() + settings.transcriptRetentionDays * DAY_MS <= now.getTime()) {
      const res = await purgeGroupCaptureNow(c.id);
      purged++;
      await writeAuditLog({ action: 'SCRIBE_TRANSCRIPT_PURGE', actorUserId: null, actorRole: 'system', organizationId: c.organizationId, resourceType: 'scribeGroupCapture', resourceId: c.id, metadata: { ...res, reason: 'retention_days' } });
    }
  }
  return purged;
}

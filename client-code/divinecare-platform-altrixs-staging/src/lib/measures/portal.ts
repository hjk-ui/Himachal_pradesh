/**
 * Patient portal "Questionnaires" (server). The signed-in patient sees their open measure requests
 * (sent by email, text or to the portal) and starts one from the portal:
 *  - the raw link token exists only in the original message, so "Start" issues a portal link: an
 *    open portal request for the same measures gets a fresh token, else a portal copy of the request
 *    is made (same measures, assignments, clinician, visit, expiry, saved answers);
 *  - the link still asks for the date of birth; completing either copy cancels the other
 *    (patientLink.ts "other open links for the same measures").
 * Proxies (guardians / representatives) never see measures: self-report is the patient's own.
 * Nothing about the measures is listed here beyond a count (names show after the DOB check).
 * The routes (src/app/api/patient/measures) write the audit entries.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { hashMeasureToken, newMeasureToken } from './token';

export type PortalActor = { organizationId: string; clientId: string; accountId: string; isProxy: boolean };

const OPEN = ['sent', 'opened', 'started'];

const openWhere = (a: PortalActor, now: Date) => ({
  organizationId: a.organizationId,
  clientId: a.clientId,
  status: { in: OPEN },
  completedAt: null,
  lockedAt: null,
  expiresAt: { gt: now },
});

export type PortalMeasureItem = { id: string; formCount: number; sentAt: string | null; expiresAt: string; started: boolean };

/** Open requests, one per measure set (a portal copy and its original show once) */
export async function listPortalMeasures(a: PortalActor, now = new Date()): Promise<PortalMeasureItem[]> {
  if (a.isProxy) return [];
  const rows = await prisma.measureRequest.findMany({
    where: openWhere(a, now),
    select: { id: true, instrumentIds: true, sentAt: true, expiresAt: true, status: true, channel: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const seen = new Set<string>();
  const out: PortalMeasureItem[] = [];
  for (const r of rows) {
    const key = [...r.instrumentIds].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.id, formCount: r.instrumentIds.length, sentAt: r.sentAt?.toISOString() ?? null, expiresAt: r.expiresAt.toISOString(), started: r.status === 'started' });
  }
  return out;
}

export type StartResult = { ok: true; path: string; requestId: string; fromRequestId: string; measureCount: number } | { ok: false; status: number; error: string };

export async function startPortalMeasure(a: PortalActor, requestId: string, now = new Date()): Promise<StartResult> {
  if (a.isProxy) return { ok: false, status: 403, error: 'Questionnaires are only available to the patient.' };
  const row = await prisma.measureRequest.findFirst({
    where: { id: requestId, ...openWhere(a, now) },
    select: { id: true, instrumentIds: true, assignmentIds: true, appointmentId: true, clinicianId: true, part2: true, trigger: true, expiresAt: true, partialAnswers: true, channel: true, startedAt: true, openedAt: true, status: true },
  });
  if (!row) return { ok: false, status: 404, error: 'This questionnaire is no longer open. Contact the office for a new one.' };
  const raw = newMeasureToken();
  const same = (ids: string[]) => ids.length === row.instrumentIds.length && ids.every((id) => row.instrumentIds.includes(id));
  let targetId: string;
  if (row.channel === 'portal') {
    targetId = row.id;
  } else {
    const portalCopy = (await prisma.measureRequest.findMany({ where: { ...openWhere(a, now), channel: 'portal' }, select: { id: true, instrumentIds: true } })).find((r) => same(r.instrumentIds));
    targetId = portalCopy?.id ?? '';
  }
  if (targetId) {
    // Fresh token (the old raw token is unknown); the DOB session restarts
    await prisma.measureRequest.update({ where: { id: targetId }, data: { tokenHash: hashMeasureToken(raw), sessionHash: null, sessionExpiresAt: null } });
  } else {
    const copy = await prisma.measureRequest.create({
      data: {
        organizationId: a.organizationId,
        clientId: a.clientId,
        instrumentIds: row.instrumentIds,
        assignmentIds: row.assignmentIds,
        tokenHash: hashMeasureToken(raw),
        channel: 'portal',
        status: row.status,
        trigger: row.trigger,
        appointmentId: row.appointmentId,
        clinicianId: row.clinicianId,
        part2: row.part2,
        sentAt: now,
        openedAt: row.openedAt,
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        partialAnswers: (row.partialAnswers ?? undefined) as Prisma.InputJsonValue | undefined,
        deliveryResults: [{ channel: 'portal', ok: true, reason: null }],
      },
      select: { id: true },
    });
    targetId = copy.id;
  }
  return { ok: true, path: `/m/${raw}`, requestId: targetId, fromRequestId: row.id, measureCount: row.instrumentIds.length };
}

/**
 * The patient side of a measure link /m/<token> (server). No login: the token plus the date of
 * birth on the chart. Nothing about the patient or the measures is returned before the DOB check.
 *
 *  - open:     first view sets openedAt (audit MEASURE_REQUEST_OPENED)
 *  - verify:   DOB check; 3 wrong tries lock the link (audit MEASURE_LINK_LOCKED); success starts a
 *              2-hour session (httpOnly cookie, sha256 stored)
 *  - save:     partial answers (startedAt + audit MEASURE_REQUEST_STARTED on the first save)
 *  - complete: scores with the instrument's own scoring, creates ClinicalAssessmentRecord(s)
 *              (source patient_portal), marks the request completed, updates the assignments, closes
 *              other open links for the same measures, raises the risk alert on a safety item, and
 *              audits MEASURE_REQUEST_COMPLETED. Audit metadata is ids / counts only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { loadPracticeIdentity } from '@/lib/practice/identity';
import { SOURCE_INSTRUMENTS } from '@/features/ehr/assessments/sourceInstruments';
import { instrumentById } from './instruments';
import { scoreRequest, type Answers } from './scoring';
import { safetyAlertsFor, showCrisisPage } from './safety';
import {
  afterFailedDob,
  dobMatches,
  hashMeasureToken,
  isTokenShape,
  linkState,
  sessionValid,
  SESSION_TTL_MS,
  type LinkState,
} from './token';

type Meta = { ipAddress?: string | null; userAgent?: string | null };

const ROW_SELECT = {
  id: true, organizationId: true, clientId: true, instrumentIds: true, assignmentIds: true, status: true, expiresAt: true,
  lockedAt: true, completedAt: true, openedAt: true, startedAt: true, dobAttempts: true, sessionHash: true, sessionExpiresAt: true,
  partialAnswers: true, appointmentId: true, clinicianId: true,
} as const;

type Row = Prisma.MeasureRequestGetPayload<{ select: typeof ROW_SELECT }>;

async function findRow(raw: string): Promise<Row | null> {
  if (!isTokenShape(raw)) return null;
  return prisma.measureRequest.findUnique({ where: { tokenHash: hashMeasureToken(raw) }, select: ROW_SELECT });
}

const audit = (row: Pick<Row, 'id' | 'organizationId' | 'clientId'>, action: string, outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', meta: Meta, metadata: Record<string, unknown> = {}) =>
  writeAuditLog({
    action, actorUserId: null, actorRole: 'PATIENT', organizationId: row.organizationId, resourceType: 'measureRequest', resourceId: row.id,
    patientId: row.clientId, outcome, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, metadata,
  }).catch(() => {});

/** Expired links flip to status expired the first time anyone looks */
async function settleExpiry(row: Row, now: Date): Promise<Row> {
  if (!row.completedAt && !['expired', 'locked', 'cancelled', 'completed', 'not_sent', 'pending'].includes(row.status) && row.expiresAt.getTime() <= now.getTime()) {
    await prisma.measureRequest.update({ where: { id: row.id }, data: { status: 'expired' } }).catch(() => undefined);
    return { ...row, status: 'expired' };
  }
  return row;
}

export type PublicLinkView = { state: LinkState | 'invalid'; practiceName: string | null; measureCount: number };

/** GET: link state only (no PHI). Marks the link opened the first time. */
export async function openMeasureLink(raw: string, meta: Meta, now = new Date()): Promise<PublicLinkView> {
  const found = await findRow(raw);
  if (!found) return { state: 'invalid', practiceName: null, measureCount: 0 };
  const row = await settleExpiry(found, now);
  const state = linkState(row, now, false);
  if (state === 'verify' && !row.openedAt) {
    const res = await prisma.measureRequest.updateMany({ where: { id: row.id, openedAt: null }, data: { openedAt: now, ...(row.status === 'sent' ? { status: 'opened' } : {}) } });
    if (res.count) await audit(row, 'MEASURE_REQUEST_OPENED', 'SUCCESS', meta);
  }
  const identity = await loadPracticeIdentity(row.organizationId).catch(() => ({ name: null }));
  return { state, practiceName: identity.name, measureCount: row.instrumentIds.length };
}

export type PublicQuestion = { id: string; text: string; options: { label: string; score: number }[] };
export type PublicInstrument = { id: string; title: string; prompt: string | null; questions: PublicQuestion[] };
export type PublicQuestionnaire = { instruments: PublicInstrument[]; answers: Record<string, Answers> };

const SOURCE_PROMPT = new Map(SOURCE_INSTRUMENTS.map((s) => [s.key === 'C-SSRS' ? 'c-ssrs-brief' : s.key.toLowerCase(), s.administrationNote ?? null]));

/** Patient-facing items: the question and option wording only (no clinician notes, no scoring bands) */
export function publicInstruments(ids: string[]): PublicInstrument[] {
  return ids
    .map((id) => instrumentById(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i?.questions?.length))
    .map((i) => ({
      id: i.id,
      title: i.fullName || i.name,
      prompt: SOURCE_PROMPT.get(i.id) ?? null,
      questions: i.questions!.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => ({ label: o.label, score: o.score })) })),
    }));
}

/** Only answers to this request's instruments, real items and real option scores */
export function cleanAnswers(instrumentIds: string[], input: unknown): Record<string, Answers> {
  const out: Record<string, Answers> = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const id of instrumentIds) {
    const i = instrumentById(id);
    const given = src[id];
    if (!i?.questions || !given || typeof given !== 'object') continue;
    const a: Answers = {};
    for (const q of i.questions) {
      const v = (given as Record<string, unknown>)[q.id];
      if (typeof v === 'number' && q.options.some((o) => o.score === v)) a[q.id] = v;
    }
    if (Object.keys(a).length) out[id] = a;
  }
  return out;
}

export type VerifyResult =
  | { ok: true; sessionSecret: string; sessionExpiresAt: Date; questionnaire: PublicQuestionnaire }
  | { ok: false; state: LinkState | 'invalid' | 'wrong_dob'; remaining?: number };

export async function verifyMeasureLink(raw: string, dob: unknown, meta: Meta, now = new Date()): Promise<VerifyResult> {
  const found = await findRow(raw);
  if (!found) return { ok: false, state: 'invalid' };
  const row = await settleExpiry(found, now);
  const state = linkState(row, now, false);
  if (state !== 'verify') return { ok: false, state };
  const client = await prisma.client.findFirst({ where: { id: row.clientId, organizationId: row.organizationId }, select: { dateOfBirth: true } });
  if (!dobMatches(dob, client?.dateOfBirth ?? null)) {
    const next = afterFailedDob(row.dobAttempts);
    // Conditional on the attempt count we read: two quick wrong tries cannot both count as one
    const res = await prisma.measureRequest.updateMany({
      where: { id: row.id, dobAttempts: row.dobAttempts, lockedAt: null },
      data: { dobAttempts: next.attempts, ...(next.locked ? { status: 'locked', lockedAt: now, sessionHash: null } : {}) },
    });
    if (!res.count) return { ok: false, state: 'wrong_dob', remaining: 0 };
    await audit(row, next.locked ? 'MEASURE_LINK_LOCKED' : 'MEASURE_LINK_DOB_FAILED', 'DENIED', meta, { attempts: next.attempts });
    if (next.locked) invalidateInboxForOrg(row.organizationId);
    return next.locked ? { ok: false, state: 'locked' } : { ok: false, state: 'wrong_dob', remaining: next.remaining };
  }
  const secret = randomBytes(32).toString('base64url');
  const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.measureRequest.update({ where: { id: row.id }, data: { sessionHash: hashMeasureToken(secret), sessionExpiresAt, dobAttempts: 0 } });
  await audit(row, 'MEASURE_LINK_VERIFIED', 'SUCCESS', meta);
  return { ok: true, sessionSecret: secret, sessionExpiresAt, questionnaire: { instruments: publicInstruments(row.instrumentIds), answers: cleanAnswers(row.instrumentIds, row.partialAnswers) } };
}

/** Session check for save / complete / reload after verification */
async function sessionRow(raw: string, cookie: string | null | undefined, now: Date): Promise<{ ok: true; row: Row } | { ok: false; state: LinkState | 'invalid' | 'session' }> {
  const found = await findRow(raw);
  if (!found) return { ok: false, state: 'invalid' };
  const row = await settleExpiry(found, now);
  const state = linkState(row, now, true);
  if (state !== 'ready') return { ok: false, state };
  if (!sessionValid(row, cookie, now)) return { ok: false, state: 'session' };
  return { ok: true, row };
}

export async function resumeMeasureLink(raw: string, cookie: string | null | undefined, now = new Date()) {
  const s = await sessionRow(raw, cookie, now);
  if (s.ok === false) return s;
  return { ok: true as const, questionnaire: { instruments: publicInstruments(s.row.instrumentIds), answers: cleanAnswers(s.row.instrumentIds, s.row.partialAnswers) } };
}

export async function saveMeasureLinkAnswers(raw: string, cookie: string | null | undefined, answers: unknown, meta: Meta, now = new Date()) {
  const s = await sessionRow(raw, cookie, now);
  if (s.ok === false) return s;
  const row = s.row;
  const clean = cleanAnswers(row.instrumentIds, answers);
  const first = !row.startedAt;
  await prisma.measureRequest.update({
    where: { id: row.id },
    data: { partialAnswers: clean as Prisma.InputJsonValue, ...(first ? { startedAt: now, status: 'started' } : {}) },
  });
  if (first) {
    await audit(row, 'MEASURE_REQUEST_STARTED', 'SUCCESS', meta);
    invalidateInboxForOrg(row.organizationId);
  }
  return { ok: true as const };
}

export type CompleteResult =
  | { ok: true; crisis: boolean }
  | { ok: false; state: LinkState | 'invalid' | 'session' | 'incomplete'; instrumentId?: string };

export async function completeMeasureLink(raw: string, cookie: string | null | undefined, answers: unknown, meta: Meta, now = new Date()): Promise<CompleteResult> {
  const s = await sessionRow(raw, cookie, now);
  if (s.ok === false) return s;
  const row = s.row;
  const scored = scoreRequest(row.instrumentIds, cleanAnswers(row.instrumentIds, answers));
  if (scored.ok === false) return { ok: false, state: 'incomplete', instrumentId: scored.instrumentId };

  const client = await prisma.client.findFirst({ where: { id: row.clientId, organizationId: row.organizationId }, select: { id: true, name: true, assignedToId: true } });
  if (!client) return { ok: false, state: 'invalid' };
  const alerts = safetyAlertsFor(scored.scored);
  const clinicianId = row.clinicianId ?? client.assignedToId;
  const completedIds = new Set(row.instrumentIds);

  const done = await prisma.$transaction(async (tx) => {
    // Claim the request first: a double submit creates nothing twice
    const claim = await tx.measureRequest.updateMany({
      where: { id: row.id, completedAt: null, status: { in: ['sent', 'opened', 'started'] } },
      data: { status: 'completed', completedAt: now },
    });
    if (!claim.count) return null;
    const recordIds: string[] = [];
    for (const m of scored.scored) {
      const rec = await tx.clinicalAssessmentRecord.create({
        data: {
          organizationId: row.organizationId,
          clientId: client.id,
          instrumentId: m.instrumentId,
          instrumentName: m.instrumentName,
          category: m.category,
          administrationType: 'Digital',
          respondentType: 'Self',
          totalScore: m.totalScore,
          severity: m.severity,
          interpretation: m.interpretation,
          safetyFlagged: m.safetyFlagged,
          safetyNotes: m.safetyNotes,
          notes: 'Completed by the patient from a questionnaire link before the visit.',
          administeredById: null,
          source: 'patient_portal',
          measureRequestId: row.id,
          answers: { create: m.answers.map((a) => ({ itemId: a.itemId, questionText: a.questionText, scoreValue: a.scoreValue, selectedText: a.selectedText, flagged: a.flagged })) },
        },
        select: { id: true, instrumentId: true },
      });
      recordIds.push(rec.id);
    }
    await tx.measureRequest.update({
      where: { id: row.id },
      data: { resultRecordIds: recordIds, safetyFlagged: alerts.length > 0, partialAnswers: Prisma.DbNull, sessionHash: null, sessionExpiresAt: null },
    });
    // Assignments: this measure is done now (a one-time measure ends)
    const assignments = await tx.measureAssignment.findMany({
      where: { organizationId: row.organizationId, clientId: client.id, instrumentId: { in: [...completedIds] }, status: 'active' },
      select: { id: true, schedule: true },
    });
    for (const a of assignments) {
      await tx.measureAssignment.update({
        where: { id: a.id },
        data: { lastCompletedAt: now, ...(a.schedule === 'once' ? { status: 'ended', activeKey: null, endDate: now } : {}) },
      });
    }
    // Other open links for the same measures (the 3-day link once the 1-day reminder is done, and vice versa)
    const open = await tx.measureRequest.findMany({
      where: { organizationId: row.organizationId, clientId: client.id, id: { not: row.id }, status: { in: ['sent', 'opened', 'started'] } },
      select: { id: true, instrumentIds: true },
    });
    const superseded = open.filter((o) => o.instrumentIds.every((id) => completedIds.has(id))).map((o) => o.id);
    if (superseded.length) {
      await tx.measureRequest.updateMany({ where: { id: { in: superseded } }, data: { status: 'cancelled', sessionHash: null } });
    }
    const alertIds: string[] = [];
    for (const a of alerts) {
      const recordId = recordIds[scored.scored.findIndex((m) => m.instrumentId === a.instrumentId)] ?? null;
      const created = await tx.riskAlert.create({
        data: {
          organizationId: row.organizationId,
          clientId: client.id,
          clientName: client.name,
          clinicianId,
          type: a.type,
          severity: a.severity,
          source: 'assessment',
          sourceId: recordId,
          description: a.description,
          reviewed: false,
        },
        select: { id: true },
      });
      alertIds.push(created.id);
    }
    return { recordIds, alertIds, superseded };
  });
  if (!done) return { ok: false, state: 'completed' };

  // Same PHQ-9 >= 20 clinical event as the staff assessment route
  const phq = scored.scored.find((m) => m.instrumentId === 'phq-9' && m.totalScore >= 20);
  if (phq) {
    try {
      const { recordClinicalEvent } = await import('@/lib/clinical/events');
      await recordClinicalEvent({
        organizationId: row.organizationId, eventType: 'phq9-alert', clientId: client.id, clientName: client.name, createdById: null,
        payload: { score: phq.totalScore, threshold: 20, assessmentId: done.recordIds[scored.scored.indexOf(phq)] },
      });
    } catch (err) {
      console.error('[measures] phq9-alert failed', err instanceof Error ? err.message : 'unknown');
    }
  }
  await audit(row, 'MEASURE_REQUEST_COMPLETED', 'SUCCESS', meta, {
    recordIds: done.recordIds, safetyFlagged: alerts.length > 0, riskAlertIds: done.alertIds, supersededRequestIds: done.superseded,
  });
  for (const id of done.alertIds) {
    await writeAuditLog({
      action: 'CREATE', actorUserId: null, actorRole: 'PATIENT', organizationId: row.organizationId, resourceType: 'riskAlert', resourceId: id,
      patientId: client.id, metadata: { feature: 'measure-link', measureRequestId: row.id, severity: 'high' },
    }).catch(() => {});
  }
  invalidateInboxForOrg(row.organizationId);
  return { ok: true, crisis: showCrisisPage(scored.scored) };
}

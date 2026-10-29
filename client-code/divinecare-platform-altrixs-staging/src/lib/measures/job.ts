/**
 * Pre-visit measure job (server; run daily by scripts/measures-send.ts under the advisory lock
 * job:measures-send). Per organization:
 *
 *  1. Rules (Practice settings > Clinical policy > Measurement-based care; every rule default OFF):
 *     a) upcoming therapy / med-management visit (next 14 days): PHQ-9 (PHQ-A under 18) + GAD-7 at
 *        the practice PHQ-9 / GAD-7 intervals; b) admitted intensive program clients: the program's
 *        measures (assignments end when the client is no longer admitted); c) provider-specific
 *        measures for that provider's upcoming visits. Never opens a measure twice (activeKey).
 *  2. Sends (setting "Send measures to patients before visits", default OFF): visits 3 days and
 *     1 day out (practice clock) get the due measures by email / text (send.ts: consent, Part 2,
 *     no PHI). One send per visit and stage (dedupeKey). A measure already in an open link sent in
 *     the last 24 hours is not sent again.
 *  3. Links past 7 days flip to expired.
 * Dry run (apply false) reads only and returns counts.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { clinicDate } from '@/lib/workflows/dates';
import { defaultKindForRole, resolveVisitKind } from '@/lib/visits/resolveKind';
import { activeKeyFor, parseRules, planRuleAssignments, planVisitSend, sendStageFor, type AssignmentLike, type RuleAdd } from './schedule';
import { sendMeasureRequest } from './send';

export type MeasureJobCounts = {
  organizationId: string;
  mode: 'apply' | 'dry-run';
  autoSend: 'on' | 'off';
  rules: { visit: boolean; program: boolean; provider: boolean };
  assignmentsPlanned: number;
  assignmentsAdded: number;
  programAssignmentsEnded: number;
  visitsInWindow: number;
  sendsPlanned: number;
  sent: number;
  notSent: number;
  duplicate: number;
  failed: number;
  expired: number;
};

const DAY = 86_400_000;
const RULE_LOOKAHEAD_DAYS = 14;
const OPEN_STATUSES = ['sent', 'opened', 'started'];

function ageOn(dob: Date | null, now: Date): number | null {
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

const dayStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function runMeasureSends(opts: { organizationId: string; apply: boolean; now?: Date }): Promise<MeasureJobCounts> {
  const now = opts.now ?? new Date();
  const org = opts.organizationId;
  const settings = await prisma.practiceSettings.findUnique({
    where: { organizationId: org },
    select: { mbcAutoSend: true, mbcVisitRule: true, mbcProgramRule: true, mbcProviderRule: true, mbcProgramMeasures: true, mbcProviderMeasures: true, phq9IntervalDays: true, gad7IntervalDays: true },
  });
  const counts: MeasureJobCounts = {
    organizationId: org, mode: opts.apply ? 'apply' : 'dry-run', autoSend: settings?.mbcAutoSend ? 'on' : 'off',
    rules: { visit: Boolean(settings?.mbcVisitRule), program: Boolean(settings?.mbcProgramRule), provider: Boolean(settings?.mbcProviderRule) },
    assignmentsPlanned: 0, assignmentsAdded: 0, programAssignmentsEnded: 0, visitsInWindow: 0, sendsPlanned: 0, sent: 0, notSent: 0, duplicate: 0, failed: 0, expired: 0,
  };
  if (!settings) return counts;
  const tz = await getPracticeTimeZone(org);
  const today = clinicDate(now, tz);

  // ─── 1. Rules ──────────────────────────────────────────────────────────────
  const anyRule = settings.mbcVisitRule || settings.mbcProgramRule || settings.mbcProviderRule;
  const appts = await prisma.appointment.findMany({
    where: { organizationId: org, startsAt: { gte: now, lt: new Date(now.getTime() + RULE_LOOKAHEAD_DAYS * DAY) }, status: { in: ['SCHEDULED', 'CHECKED_IN'] }, client: { status: 'ACTIVE' } },
    select: {
      id: true, clientId: true, clinicianId: true, type: true, notes: true, startsAt: true, groupSessionId: true,
      client: { select: { dateOfBirth: true } }, clinician: { select: { role: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 5000,
  });
  const visits = appts.map((a) => {
    const ageYears = ageOn(a.client.dateOfBirth, now);
    let { kind } = resolveVisitKind({ appointmentType: a.type, notes: a.notes, isGroup: Boolean(a.groupSessionId), clientAgeYears: ageYears, clinicianRole: a.clinician?.role ?? null });
    if (kind === 'other') kind = defaultKindForRole(a.clinician?.role ?? null)?.kind ?? kind;
    return { ...a, ageYears, kind, visitDay: clinicDate(a.startsAt, tz) };
  });

  if (anyRule) {
    const [active, enrollments] = await Promise.all([
      prisma.measureAssignment.findMany({ where: { organizationId: org, status: 'active' }, select: { id: true, clientId: true, instrumentId: true, source: true, sourceRef: true } }),
      settings.mbcProgramRule || opts.apply
        ? prisma.intensiveEnrollment.findMany({ where: { organizationId: org, status: 'admitted' }, select: { clientId: true, programId: true } })
        : Promise.resolve([] as { clientId: string; programId: string }[]),
    ]);
    const adds: RuleAdd[] = planRuleAssignments({
      settings: {
        visitRule: settings.mbcVisitRule,
        programRule: settings.mbcProgramRule,
        providerRule: settings.mbcProviderRule,
        phq9Days: settings.phq9IntervalDays,
        gad7Days: settings.gad7IntervalDays,
        programMeasures: parseRules(settings.mbcProgramMeasures, 'programId'),
        providerMeasures: parseRules(settings.mbcProviderMeasures, 'userId'),
      },
      upcomingVisits: visits.map((v) => ({ clientId: v.clientId, clinicianId: v.clinicianId, kind: v.kind, ageYears: v.ageYears })),
      enrollments,
      existingActiveKeys: new Set(active.map((a) => activeKeyFor(a.clientId, a.instrumentId))),
    });
    counts.assignmentsPlanned = adds.length;
    if (opts.apply && adds.length) {
      const res = await prisma.measureAssignment.createMany({
        data: adds.map((a) => ({
          organizationId: org, clientId: a.clientId, instrumentId: a.instrumentId, schedule: a.schedule, everyDays: a.everyDays,
          startDate: new Date(`${today}T00:00:00Z`), source: a.source, sourceRef: a.sourceRef, status: 'active', activeKey: activeKeyFor(a.clientId, a.instrumentId),
        })),
        skipDuplicates: true,
      });
      counts.assignmentsAdded = res.count;
      const byClient = new Map<string, RuleAdd[]>();
      for (const a of adds) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a]);
      for (const [clientId, list] of byClient) {
        await writeAuditLog({
          action: 'MEASURE_ASSIGNED', actorUserId: null, actorRole: 'SYSTEM', organizationId: org, resourceType: 'measureAssignment', patientId: clientId,
          metadata: { trigger: 'rule', sources: [...new Set(list.map((a) => a.source))], instrumentIds: list.map((a) => a.instrumentId) },
        }).catch(() => {});
      }
    }
    // Program measures end when the client is no longer admitted to that program
    if (opts.apply) {
      const admitted = new Set(enrollments.map((e) => `${e.clientId}|${e.programId}`));
      const stale = active.filter((a) => a.source === 'program' && a.sourceRef && !admitted.has(`${a.clientId}|${a.sourceRef}`)).map((a) => a.id);
      if (stale.length) {
        const res = await prisma.measureAssignment.updateMany({ where: { id: { in: stale } }, data: { status: 'ended', activeKey: null, endDate: new Date(`${today}T00:00:00Z`) } });
        counts.programAssignmentsEnded = res.count;
      }
    }
  }

  // ─── 2. Sends ──────────────────────────────────────────────────────────────
  if (settings.mbcAutoSend) {
    // First visit per client per send day
    const targets = new Map<string, (typeof visits)[number] & { stage: 'visit_3d' | 'visit_1d' }>();
    for (const v of visits) {
      const stage = sendStageFor(today, v.visitDay);
      if (!stage) continue;
      const k = `${v.clientId}|${v.visitDay}`;
      if (!targets.has(k)) targets.set(k, { ...v, stage });
    }
    counts.visitsInWindow = targets.size;
    const clientIds = [...new Set([...targets.values()].map((t) => t.clientId))];
    if (clientIds.length) {
      const [assignments, records, open] = await Promise.all([
        prisma.measureAssignment.findMany({ where: { organizationId: org, clientId: { in: clientIds }, status: 'active' }, orderBy: { createdAt: 'asc' } }),
        prisma.clinicalAssessmentRecord.findMany({
          where: { organizationId: org, clientId: { in: clientIds } },
          select: { clientId: true, instrumentId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.measureRequest.findMany({
          where: { organizationId: org, clientId: { in: clientIds }, status: { in: OPEN_STATUSES }, sentAt: { gte: new Date(now.getTime() - DAY) }, expiresAt: { gt: now } },
          select: { clientId: true, instrumentIds: true, appointmentId: true },
        }),
      ]);
      const latest = new Map<string, Map<string, string>>();
      for (const r of records) {
        const m = latest.get(r.clientId) ?? new Map<string, string>();
        if (!m.has(r.instrumentId)) m.set(r.instrumentId, clinicDate(r.createdAt, tz));
        latest.set(r.clientId, m);
      }
      for (const t of targets.values()) {
        const mine: AssignmentLike[] = assignments
          .filter((a) => a.clientId === t.clientId)
          .map((a) => ({ id: a.id, clientId: a.clientId, instrumentId: a.instrumentId, schedule: a.schedule, everyDays: a.everyDays, startDate: dayStr(a.startDate)!, endDate: dayStr(a.endDate), status: a.status }));
        const plan = planVisitSend({ assignments: mine, visitDay: t.visitDay, latestByInstrument: latest.get(t.clientId) ?? new Map() });
        // Already in a link sent in the last 24 hours (another visit, or a staff "Send now")
        const recent = new Set(open.filter((o) => o.clientId === t.clientId && o.appointmentId !== t.id).flatMap((o) => o.instrumentIds));
        const keep = plan.instrumentIds.map((id, i) => ({ id, a: plan.assignmentIds[i] })).filter((x) => !recent.has(x.id));
        if (!keep.length) continue;
        counts.sendsPlanned++;
        if (!opts.apply) continue;
        try {
          const r = await sendMeasureRequest({
            organizationId: org, clientId: t.clientId, instrumentIds: keep.map((x) => x.id), assignmentIds: keep.map((x) => x.a),
            trigger: t.stage, appointmentId: t.id, clinicianId: t.clinicianId, actor: { userId: null, role: 'SYSTEM' }, now,
          });
          if (r.ok && r.status === 'sent') counts.sent++;
          else if (!r.ok && r.status === 'duplicate') counts.duplicate++;
          else counts.notSent++;
        } catch (err) {
          counts.failed++;
          console.error(`measures-send org=${org} send failed: ${err instanceof Error ? err.message : 'error'}`);
        }
      }
    }
  }

  // ─── 3. Expire old links ───────────────────────────────────────────────────
  const expireWhere: Prisma.MeasureRequestWhereInput = { organizationId: org, status: { in: OPEN_STATUSES }, completedAt: null, expiresAt: { lte: now } };
  if (opts.apply) counts.expired = (await prisma.measureRequest.updateMany({ where: expireWhere, data: { status: 'expired', sessionHash: null } })).count;
  else counts.expired = await prisma.measureRequest.count({ where: expireWhere });
  return counts;
}

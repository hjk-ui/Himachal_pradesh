/**
 * Visit Guide loader (server only). Gate → appointment / client → visit kind → briefing (reuses the
 * pre-visit brief facts) → due items → step statuses → VisitGuide.
 *
 * Access is the same as the pre-visit brief: org, roster role, caseload / care team and the
 * 42 CFR Part 2 / protected-record gate (resolveChartAccess). Part 2 note content never enters the
 * guide: care-team lines name note type / date / author only, and Part 2 notes are skipped.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { prismaPreVisitDeps } from '@/lib/ai/previsit/prismaSource';
import { buildPreVisitFacts, factLines, type PreVisitInputs } from '@/lib/ai/previsit/facts';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { getModuleData } from '@/lib/modules/manage';
import { safetyPlanClientIds, hasFilledJson } from '@/lib/reports/populationHealthQueries';
import { LEGACY_TYPE_TO_KEY, templateKeyOf } from '@/lib/consents/library/catalog';
import { canViewVisitGuide } from './access';
import { intensiveProgramFor } from '@/lib/intensive/visitProgram';
import { canAccessClientChartNotes } from '@/lib/clients/orgScope';
import { loadPrimaryCareGuideFacts, type PrimaryCareGuideFacts } from '@/lib/medical/primaryCareGuide';
import { defaultKindForRole, pickFallbackAppointment, resolveVisitKind } from './resolveKind';
import { practiceTodayBounds } from '@/lib/dashboard/practiceDay';
import { computeDueItems, classifyMed, type DueFacts, type DueMed } from './due';
import { prpVisitCodes } from '@/lib/prp/standard';
import { assembleGuide, audienceForRole, type AutoCheck, type ChecklistMark } from './guide';
import { PRESCRIBER_KINDS, type AutoStepId } from './protocols';
import type { GuideBrief, StepCondition, VisitGuide, VisitKind } from './types';

const DAY_MS = 86_400_000;
export const AIMS_INTERVAL_DAYS = 182;
export const SDOH_INTERVAL_DAYS = 365;
export const PDMP_INTERVAL_DAYS = 90;
const PDMP_ATTEST_TEXT = 'Prescriber attests the Maryland PDMP (CRISP) was reviewed';

export type VisitGuideRequest = {
  organizationId: string;
  userId: string;
  role: string;
  clientId: string;
  appointmentId?: string | null;
  kind?: string | null;
  req?: Request | Headers | null;
  now?: Date;
};

export type VisitGuideResult =
  | { ok: true; guide: VisitGuide }
  | { ok: false; status: 400 | 403 | 404; error: string; reason: string };

const ageOn = (dob: Date | null, now: Date) => (dob ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * DAY_MS)) : null);

function testNames(tests: unknown): string[] {
  if (!Array.isArray(tests)) return [];
  return tests
    .map((t) => (typeof t === 'string' ? t : t && typeof t === 'object' ? (t as { name?: unknown; key?: unknown }).name ?? (t as { key?: unknown }).key : null))
    .filter((n): n is string => typeof n === 'string' && Boolean(n.trim()));
}

const maxDate = (...ds: (Date | null | undefined)[]) =>
  ds.filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

type ConsentRow = { type: string; formKey: string | null; status: string; formStatus: string | null; expiresAt: Date | null; revokedAt: Date | null };

/** Signed, not revoked / expired / superseded consent matching a library key or legacy type text */
export function consentOnFile(rows: ConsentRow[], key: string, typeRe: RegExp, now: Date): boolean {
  return rows.some((r) => {
    const signed = r.status === 'SIGNED' || ['CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED'].includes(String(r.formStatus ?? ''));
    if (!signed || r.revokedAt || ['SUPERSEDED', 'VOIDED'].includes(String(r.formStatus ?? ''))) return false;
    if (r.expiresAt && r.expiresAt.getTime() < now.getTime()) return false;
    const k = templateKeyOf(r.formKey) ?? (r.formKey ? null : LEGACY_TYPE_TO_KEY[r.type] ?? null);
    return k === key || typeRe.test(r.type);
  });
}

export async function loadVisitGuide(input: VisitGuideRequest): Promise<VisitGuideResult> {
  const now = input.now ?? new Date();
  const org = input.organizationId;
  const role = String(input.role);
  if (!canViewVisitGuide(role)) return { ok: false, status: 403, error: 'Your role cannot open the visit guide', reason: 'role_not_permitted' };

  const viewer = { organizationId: org, userId: input.userId, role };
  const deps = prismaPreVisitDeps({ gate: viewer, req: input.req ?? null, path: '/api/visits/guide' });
  const access = await deps.resolveAccess(viewer, input.clientId);
  if (access.ok === false) {
    return {
      ok: false,
      status: access.status,
      error: access.status === 404 ? 'Client not found' : access.reason === 'sensitive_record' ? 'Protected record: no visit guide without access.' : 'Forbidden',
      reason: access.reason,
    };
  }

  // ─── Appointment + client ──────────────────────────────────────────────────
  const timeZone = await getPracticeTimeZone(org);
  const apptOrgScope = { OR: [{ organizationId: org }, { organizationId: null, client: { organizationId: org } }] };
  const apptSelect = {
    id: true, type: true, notes: true, startsAt: true, status: true, isVirtual: true, audioOnly: true, labelId: true, groupSessionId: true, clinicianId: true,
    clinician: { select: { role: true } },
  } as const;
  let appointment = input.appointmentId
    ? await prisma.appointment.findFirst({ where: { id: input.appointmentId, clientId: input.clientId, ...apptOrgScope }, select: apptSelect })
    : null;
  if (input.appointmentId && !appointment) return { ok: false, status: 404, error: 'Appointment not found', reason: 'appointment_not_found' };

  // No appointment given (Scribe / chart): use the client's appointment today (practice clock) when there is one
  let fallbackFrom: string | null = null;
  if (!input.appointmentId && !input.kind) {
    const { start, end } = practiceTodayBounds(timeZone, now);
    const todays = await prisma.appointment.findMany({
      where: { clientId: input.clientId, startsAt: { gte: start, lt: end }, ...apptOrgScope },
      select: apptSelect,
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    const pick = pickFallbackAppointment(todays.map((a) => ({ ...a, status: String(a.status) })), now, input.userId);
    if (pick) {
      appointment = todays.find((a) => a.id === pick.appt.id) ?? null;
      fallbackFrom = `today's ${pick.which} appointment (none was given)`;
    }
  }

  const [client, label, groupSession, prpEnrollment, settings] = await Promise.all([
    prisma.client.findFirst({ where: { id: input.clientId, organizationId: org }, select: { dateOfBirth: true } }),
    appointment?.labelId ? prisma.appointmentLabel.findFirst({ where: { id: appointment.labelId, organizationId: org }, select: { meaning: true } }) : Promise.resolve(null),
    appointment?.groupSessionId
      ? prisma.clinicalGroupSession.findFirst({ where: { id: appointment.groupSessionId, organizationId: org }, select: { part2: true, group: { select: { kind: true, groupType: true } } } })
      : Promise.resolve(null),
    prisma.prpEnrollment.findFirst({ where: { organizationId: org, clientId: input.clientId, status: { in: ['active', 'on_hold', 'transitioning'] } }, select: { id: true } }),
    prisma.practiceSettings.findUnique({ where: { organizationId: org }, select: { phq9IntervalDays: true, gad7IntervalDays: true, prpBillingModel: true } }).catch(() => null),
  ]);
  const ageYears = ageOn(client?.dateOfBirth ?? null, now);
  const missed = appointment && ['NO_SHOW', 'LATE_CANCEL'].includes(String(appointment.status));
  const groupIsSud = Boolean(groupSession && (groupSession.group.kind === 'sud' || groupSession.part2));
  // Admitted to an IOP / PHP program (src/lib/intensive): a program day when nothing else decides the kind
  const intensiveProgram = prpEnrollment ? null : await intensiveProgramFor(org, input.clientId, now);

  const resolved = resolveVisitKind({
    appointmentType: appointment?.type ?? null,
    notes: appointment?.notes ?? null,
    labelMeaning: label?.meaning ?? null,
    isGroup: Boolean(groupSession),
    groupIsSud,
    clientAgeYears: ageYears,
    clinicianRole: appointment?.clinician?.role ? String(appointment.clinician.role) : role,
    clientProgram: prpEnrollment ? 'prp' : intensiveProgram,
    explicitKind: input.kind ?? (missed ? 'no_show' : null),
  });
  if (input.kind && resolved.resolvedFrom !== 'chosen by clinician') {
    return { ok: false, status: 400, error: 'Unknown visit kind', reason: 'invalid_kind' };
  }
  let kind: VisitKind = resolved.kind;
  let resolvedFrom = !input.kind && missed ? `appointment status ${String(appointment!.status).toLowerCase().replace('_', ' ')}` : resolved.resolvedFrom;
  if (!input.appointmentId && !input.kind) {
    // Nothing decided the kind: fall back to a default for the viewer's role (prescriber / therapist / medical)
    const roleDefault = kind === 'other' ? defaultKindForRole(appointment?.clinician?.role ? String(appointment.clinician.role) : role) : null;
    if (roleDefault) {
      kind = roleDefault.kind;
      resolvedFrom = roleDefault.resolvedFrom;
    }
    resolvedFrom = fallbackFrom ? `${resolvedFrom}; ${fallbackFrom}` : `${resolvedFrom}; no appointment today`;
  }

  // ─── Pre-visit facts (shared with the pre-visit brief) ────────────────────
  const medsVisit = PRESCRIBER_KINDS.has(kind) || kind === 'primary_care';
  const audience = medsVisit ? 'prescriber' : 'therapist';
  // Primary care roles (and others without BH chart-note access): no BH note plan text, treatment
  // plan goals or BH PHQ-9 / GAD-7 scores in the briefing (minimum necessary, same as the pre-visit brief)
  const bhChartNotes = canAccessClientChartNotes(role);
  const inputs: PreVisitInputs = await deps.loadInputs(viewer, input.clientId, { now, audience, names: access.names, bhChartNotes });
  const facts = buildPreVisitFacts(inputs, { now, timeZone, audience, bhChartNotes });
  const pc: PrimaryCareGuideFacts | null =
    kind === 'primary_care'
      ? await loadPrimaryCareGuideFacts({ viewer, clientId: input.clientId, appointmentId: appointment?.id ?? null, now, timeZone }).catch((err) => {
          console.error('[visit guide] primary care facts failed', err instanceof Error ? err.name : 'error');
          return null;
        })
      : null;
  const today = toPracticeWallTime(now, timeZone).date;
  const dayOf = (d: Date) => toPracticeWallTime(d, timeZone).date;

  const lastCompleted = inputs.appointments
    .filter((a) => a.status === 'COMPLETED' && dayOf(a.startsAt) < today)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
  const newSince = lastCompleted ? lastCompleted.startsAt : new Date(now.getTime() - 30 * DAY_MS);
  const visitAt = appointment?.startsAt ?? now;

  // ─── Further chart reads ──────────────────────────────────────────────────
  const [assessments, sdoh, labResults, pdmpAudit, pdmpNote, rxRows, refillPending, ehrRefillPending, fills, consents, safetyModule, evalPlans, followUps, nextAppt, careNotes, marks] =
    await Promise.all([
      prisma.clinicalAssessmentRecord.findMany({
        where: { organizationId: org, clientId: input.clientId },
        select: { instrumentId: true, instrumentName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      prisma.sdohScreening.findFirst({ where: { organizationId: org, clientId: input.clientId }, select: { completedAt: true }, orderBy: { completedAt: 'desc' } }),
      prisma.labResult.findMany({
        where: { order: { organizationId: org, clientId: input.clientId, status: { not: 'cancelled' } } },
        select: { testName: true, testKey: true, panelName: true, collectedAt: true, createdAt: true, order: { select: { resultedAt: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      prisma.marylandPdmpAudit.findFirst({ where: { clientId: input.clientId }, select: { consultationTimestamp: true }, orderBy: { consultationTimestamp: 'desc' } }),
      prisma.progressNote.findFirst({
        where: { clientId: input.clientId, client: { organizationId: org }, dismissedAt: null, body: { contains: PDMP_ATTEST_TEXT } },
        select: { dateOfService: true, createdAt: true, appointmentId: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.rcopiaPrescription.findMany({
        where: { clientId: input.clientId, stopDate: null, lifecycleStatus: { notIn: ['cancelled', 'deleted', 'pending'] }, createdAt: { gte: new Date(now.getTime() - 400 * DAY_MS) } },
        select: { drugName: true, schedule: true, signedDate: true, createdDate: true },
        take: 100,
      }),
      prisma.rcopiaRefillNotification.count({ where: { clientId: input.clientId, actionTaken: 'pending' } }),
      prisma.ehrRefillRequest.count({ where: { clientId: input.clientId, status: 'Pending' } }),
      prisma.rcopiaRxfillEvent.findMany({
        where: { clientId: input.clientId, fillDate: { gte: new Date(now.getTime() - 90 * DAY_MS) }, OR: [{ fillStatus: 'not_dispensed' }, { adherenceFlag: { not: 'ok' } }] },
        select: { prescriptionRcopiaId: true, fillDate: true },
        orderBy: { fillDate: 'desc' },
        take: 10,
      }),
      prisma.consentForm.findMany({
        where: { organizationId: org, clientId: input.clientId },
        select: { type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true },
        take: 200,
      }),
      getModuleData<unknown>(org, 'ehr-safety-plans').catch(() => null),
      prisma.clinicalEvaluationRecord.findMany({
        where: { organizationId: org, clientId: input.clientId, status: { in: ['FINALIZED', 'AMENDED'] }, safetyPlanJson: { not: null } },
        select: { safetyPlanJson: true },
        take: 5,
      }),
      prisma.scribeFollowUp.findMany({
        where: { organizationId: org, clientId: input.clientId, status: 'OPEN', OR: [{ sessionId: null }, { session: { part2: false } }] },
        select: { id: true, kind: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.appointment.findFirst({
        where: { clientId: input.clientId, startsAt: { gt: visitAt }, status: { in: ['SCHEDULED', 'CHECKED_IN'] }, ...(appointment ? { id: { not: appointment.id } } : {}) },
        select: { startsAt: true },
        orderBy: { startsAt: 'asc' },
      }),
      prisma.progressNote.findMany({
        where: {
          clientId: input.clientId,
          client: { organizationId: org },
          part2: false,
          clinicianId: { not: input.userId },
          createdAt: { gte: newSince },
          workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
        },
        select: { noteType: true, dateOfService: true, createdAt: true, clinician: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      appointment
        ? prisma.visitChecklistItem.findMany({ where: { organizationId: org, appointmentId: appointment.id, visitKind: { not: 'front_office' } }, select: { stepId: true, status: true, reason: true, markedAt: true } })
        : prisma.visitChecklistItem.findMany({
            where: { organizationId: org, clientId: input.clientId, appointmentId: null, visitKind: kind, markedAt: { gte: new Date(now.getTime() - DAY_MS) } },
            select: { stepId: true, status: true, reason: true, markedAt: true },
          }),
    ]);

  // ─── Assessments: latest dates ────────────────────────────────────────────
  const latestOf = (re: RegExp) => assessments.find((a) => re.test(`${a.instrumentId} ${a.instrumentName}`))?.createdAt ?? null;
  const measurementDate = (key: string) => inputs.measurements.filter((m) => (m.instrumentKey || '').toLowerCase() === key).map((m) => m.measuredAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const latest: DueFacts['latest'] = {
    phq9: maxDate(latestOf(/phq-?9(?!\d)/i), measurementDate('phq-9')),
    gad7: maxDate(latestOf(/gad-?7/i), measurementDate('gad-7')),
    cssrs: maxDate(latestOf(/c-?ssrs|columbia/i)),
    aims: latestOf(/\baims\b|abnormal involuntary/i),
    sdoh: sdoh?.completedAt ?? null,
    auditC: latestOf(/audit|dast|crafft|nida/i),
    glucoseOrA1c: null,
    lipids: null,
    pdmp: maxDate(pdmpAudit?.consultationTimestamp ?? null, pdmpNote ? pdmpNote.dateOfService ?? pdmpNote.createdAt : null),
  };
  for (const r of labResults) {
    const text = `${r.testName} ${r.testKey ?? ''} ${r.panelName ?? ''}`;
    const at = r.collectedAt ?? r.order.resultedAt ?? r.createdAt;
    if (/a1c|hba1c|glucose|\bglu\b/i.test(text)) latest.glucoseOrA1c = maxDate(latest.glucoseOrA1c, at);
    if (/lipid|ldl|hdl|cholesterol|triglycer/i.test(text)) latest.lipids = maxDate(latest.lipids, at);
  }

  // ─── Medications (chart list + DrFirst prescriptions for schedule) ────────
  const activeMeds = inputs.medications.filter((m) => m.active && !/stop|discontinu|inactive|cancel/i.test(m.status || ''));
  const medRows = await prisma.clientMedication.findMany({
    where: { clientId: input.clientId, id: { in: activeMeds.map((m) => m.id) } },
    select: { id: true, schedule: true, isAntipsychotic: true },
  });
  const extra = new Map(medRows.map((m) => [m.id, m]));
  const meds: DueMed[] = [];
  const seenNames = new Set<string>();
  for (const m of activeMeds) {
    const name = m.medicationName || m.drugName || 'Medication';
    const started = m.startDate ?? m.createdAt;
    const flags = classifyMed(`${name} ${m.drugName ?? ''}`, { schedule: extra.get(m.id)?.schedule ?? null, isAntipsychotic: extra.get(m.id)?.isAntipsychotic });
    meds.push({ ...flags, name, startedAt: started, isNew: started.getTime() > newSince.getTime() && started.getTime() <= now.getTime() });
    seenNames.add(name.toLowerCase().split(/\s+/)[0]);
  }
  for (const rx of rxRows) {
    const first = rx.drugName.toLowerCase().split(/\s+/)[0];
    if (seenNames.has(first)) {
      // the chart entry exists: carry the DrFirst schedule onto it
      const m = meds.find((x) => x.name.toLowerCase().startsWith(first));
      if (m && !m.controlled) Object.assign(m, { controlled: classifyMed(rx.drugName, { schedule: rx.schedule }).controlled });
      continue;
    }
    seenNames.add(first);
    const started = rx.signedDate ?? rx.createdDate ?? null;
    meds.push({ ...classifyMed(rx.drugName, { schedule: rx.schedule }), name: rx.drugName, startedAt: started, isNew: Boolean(started && started.getTime() > newSince.getTime()) });
  }
  const rxNames = fills.length
    ? await prisma.rcopiaPrescription.findMany({ where: { clientId: input.clientId, rcopiaId: { in: fills.map((f) => f.prescriptionRcopiaId) } }, select: { rcopiaId: true, drugName: true } })
    : [];
  const rxName = new Map(rxNames.map((r) => [r.rcopiaId, r.drugName]));
  const notPickedUp = fills.map((f) => ({ drug: rxName.get(f.prescriptionRcopiaId) ?? 'a prescription', date: f.fillDate }));

  // ─── Consents, safety plan, risk ──────────────────────────────────────────
  const consentFlags: DueFacts['consents'] = {
    telehealth: consentOnFile(consents, 'telehealth-consent', /telehealth/i, now),
    part2: consentOnFile(consents, 'part2-consent', /part 2|42 cfr/i, now),
    medication: consentOnFile(consents, 'psychiatric-medication-consent', /medication consent|psychotropic|psychiatric medication/i, now),
    minor: consentOnFile(consents, 'minor-consent-treatment', /minor/i, now),
    treatment: consentOnFile(consents, 'informed-consent-treatment', /consent to treat|informed consent/i, now),
  };
  const safetyPlanOnFile = safetyPlanClientIds(safetyModule).ids.has(input.clientId) || evalPlans.some((e) => hasFilledJson(e.safetyPlanJson));
  const riskLevel = facts.risk.level === 'medium' ? 'moderate' : facts.risk.level;
  const elevatedRisk = riskLevel === 'high' || riskLevel === 'moderate' || facts.risk.cssrsSafetyFlagged;
  const isVirtual = Boolean(appointment?.isVirtual || appointment?.audioOnly);
  const pendingRenewals = refillPending + ehrRefillPending;

  // ─── Due items ────────────────────────────────────────────────────────────
  const standingLabs = inputs.standingLabs.map((s) => ({ tests: testNames(s.tests), nextDueAt: s.nextDueAt, active: s.active, endDate: s.endDate }));
  const sharedDue = computeDueItems(
    {
      kind,
      ageYears,
      isVirtual,
      timeZone,
      intervals: {
        phq9Days: settings?.phq9IntervalDays ?? 30,
        gad7Days: settings?.gad7IntervalDays ?? 30,
        aimsDays: AIMS_INTERVAL_DAYS,
        sdohDays: SDOH_INTERVAL_DAYS,
        pdmpDays: PDMP_INTERVAL_DAYS,
      },
      latest,
      meds,
      standingLabs,
      labsAwaitingReview: inputs.labResultsAwaitingReview,
      treatmentPlan: inputs.treatmentPlan ? { status: inputs.treatmentPlan.status, reviewDueAt: inputs.treatmentPlan.reviewDueAt } : null,
      consents: consentFlags,
      safetyPlanOnFile,
      riskLevel,
      pendingRenewals,
      notPickedUp,
    },
    now
  );

  const due = pc ? [...sharedDue, ...pc.due] : sharedDue;

  // ─── Auto checks ──────────────────────────────────────────────────────────
  const isToday = (d: Date | null) => Boolean(d && dayOf(d) === today);
  const within = (d: Date | null, days: number) => Boolean(d && now.getTime() - d.getTime() < days * DAY_MS);
  const iso = (d: Date | null) => (d ? dayOf(d) : 'none on file');
  const phqInt = settings?.phq9IntervalDays ?? 30;
  const gadInt = settings?.gad7IntervalDays ?? 30;
  const controlledActive = meds.filter((m) => m.controlled);
  const pdmpThisVisit = Boolean(pdmpNote && appointment && pdmpNote.appointmentId === appointment.id);
  const consentCheck = (ok: boolean, what: string): AutoCheck => ({ done: ok, detail: ok ? `${what} on file` : `no signed ${what} on file` });
  const autoChecks: Partial<Record<AutoStepId, AutoCheck>> = {
    cssrs: { done: isToday(latest.cssrs), detail: isToday(latest.cssrs) ? 'C-SSRS recorded today' : `last C-SSRS: ${iso(latest.cssrs)}` },
    measures: {
      done: within(latest.phq9, phqInt) && within(latest.gad7, gadInt),
      detail: `PHQ-9 ${iso(latest.phq9)} (every ${phqInt} days); GAD-7 ${iso(latest.gad7)} (every ${gadInt} days)`,
    },
    substance_screen: { done: isToday(latest.auditC), detail: isToday(latest.auditC) ? 'substance screen recorded today' : `last substance screen: ${iso(latest.auditC)}` },
    aims: { done: within(latest.aims, AIMS_INTERVAL_DAYS), detail: `last AIMS: ${iso(latest.aims)}` },
    sdoh: { done: within(latest.sdoh, SDOH_INTERVAL_DAYS), detail: `last SDOH screen: ${iso(latest.sdoh)}` },
    safety_plan: consentCheck(safetyPlanOnFile, 'safety plan'),
    pdmp: {
      done: pdmpThisVisit || isToday(latest.pdmp) || (controlledActive.length > 0 && within(latest.pdmp, PDMP_INTERVAL_DAYS) && !meds.some((m) => m.isNew && m.controlled)),
      detail: pdmpThisVisit ? 'PDMP review attested in this visit\'s note' : `last PDMP query: ${iso(latest.pdmp)}`,
    },
    telehealth_consent: consentCheck(consentFlags.telehealth, 'telehealth consent'),
    part2_consent: consentCheck(consentFlags.part2, 'Part 2 consent'),
    guardian_consent: consentCheck(consentFlags.minor, 'minor treatment consent'),
    treatment_consent: consentCheck(consentFlags.treatment, 'consent to treatment'),
    follow_up_booked: { done: Boolean(nextAppt), detail: nextAppt ? `next visit ${dayOf(nextAppt.startsAt)}` : 'no future visit booked' },
    labs_reviewed: {
      done: inputs.labResultsAwaitingReview === 0,
      detail: inputs.labResultsAwaitingReview ? `${inputs.labResultsAwaitingReview} resulted order(s) awaiting review` : 'no results awaiting review',
    },
    pending_renewals: { done: pendingRenewals === 0, detail: pendingRenewals ? `${pendingRenewals} refill request(s) pending` : 'no pending refill requests' },
    treatment_plan_current: (() => {
      const p = inputs.treatmentPlan;
      if (!p) return { done: false, detail: 'no active treatment plan on file' };
      const overdue = p.reviewDueAt && p.reviewDueAt.getTime() < now.getTime();
      if (overdue) return { done: false, detail: `review was due ${dayOf(p.reviewDueAt!)}` };
      if (p.status !== 'ACTIVE') return { done: false, detail: `plan status ${p.status.toLowerCase()}` };
      return { done: true, detail: p.reviewDueAt ? `active; review due ${dayOf(p.reviewDueAt)}` : 'active' };
    })(),
    ...(pc?.autoChecks ?? {}),
  };

  // ─── Briefing ─────────────────────────────────────────────────────────────
  const CHANGE_SECTIONS = new Set(['Medication started', 'Medication stopped', 'New problem / diagnosis', 'Risk alert', 'Crisis episode', 'Missed / cancelled visit']);
  const lines = factLines(facts);
  const careTeam: string[] = careNotes.map((n) => {
    const who = n.clinician?.name ? `${n.clinician.name}${n.clinician.role ? ` (${String(n.clinician.role).toLowerCase().replace(/_/g, ' ')})` : ''}` : 'another clinician';
    return `${n.noteType || 'Note'} signed ${dayOf(n.dateOfService ?? n.createdAt)} by ${who}`;
  });
  if (pendingRenewals) careTeam.push(`${pendingRenewals} refill request(s) pending`);
  if (inputs.labResultsAwaitingReview) careTeam.push(`${inputs.labResultsAwaitingReview} lab result(s) awaiting review`);
  for (const l of facts.labs?.due ?? []) careTeam.push(`Labs ${l.state === 'overdue' ? 'overdue' : 'due'} ${l.dueDate}: ${l.tests.join(', ') || 'standing order'}`);
  if (notPickedUp.length) careTeam.push(`${notPickedUp.length} prescription(s) reported not dispensed in the last 90 days`);

  const brief: GuideBrief = {
    lastVisit: facts.lastVisit,
    lastPlan: facts.lastNotePlan,
    openFollowUps: followUps.map((f) => ({ id: f.id, kind: f.kind, text: f.title, from: dayOf(f.createdAt) })),
    scores: [...facts.scores.map((s) => ({ instrument: s.instrument, latest: s.latest.score, previous: s.previous?.score ?? null, date: s.latest.date })), ...(pc?.scores ?? [])],
    risk: { level: riskLevel, openAlerts: facts.risk.openAlerts, safetyPlanOnFile },
    meds: meds.map((m) => ({ name: m.name, controlled: m.controlled, startedRecently: m.isNew })),
    changesSinceLastVisit: [...(pc?.briefLines ?? []), ...lines.filter((l) => CHANGE_SECTIONS.has(l.section)).map((l) => `${l.section}: ${l.text}`)],
    careTeam,
  };

  const conditions: Record<StepCondition, boolean> = {
    controlled_meds: controlledActive.length > 0,
    antipsychotic: meds.some((m) => m.antipsychotic),
    minor: ageYears != null && ageYears < 18,
    telehealth: isVirtual,
    new_med: meds.some((m) => m.isNew),
    elevated_risk: elevatedRisk,
    positive_bh_screen: Boolean(pc?.positiveBhScreen),
  };

  const checklist: ChecklistMark[] = marks
    .filter((m) => (appointment ? true : dayOf(m.markedAt) === today))
    .map((m) => ({ stepId: m.stepId, status: m.status as ChecklistMark['status'], reason: m.reason }));

  const guide = assembleGuide({
    kind,
    resolvedFrom,
    appointmentId: appointment?.id ?? null,
    clientId: input.clientId,
    viewerAudience: audienceForRole(role),
    conditions,
    ageYears,
    brief,
    due,
    autoChecks,
    marks: checklist,
    // PRP codes follow the practice-confirmed billing model; none while it is unconfirmed
    ...(kind === 'prp' ? { cpt: prpVisitCodes(settings?.prpBillingModel ?? null) } : {}),
    followUp: {
      medChange: facts.changes.medsStarted.length > 0 || facts.changes.medsStopped.length > 0,
      elevatedRisk,
      nextBooked: nextAppt ? nextAppt.startsAt.toISOString() : null,
    },
  });
  return { ok: true, guide };
}

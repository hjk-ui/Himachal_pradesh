/**
 * Service Eligibility Scanner — set-based chart loader and org-wide scan.
 *
 * Clients are read in id-ordered batches; every other table is read once per batch with
 * `clientId IN (...)` (no per-client queries). Protected (42 CFR Part 2 / sensitive) clients the
 * viewer cannot open are dropped before any of their clinical rows are read. The database and
 * the sensitive-record check are injected so the scan is testable with mocks.
 *
 * Sources per fact:
 *  diagnoses   Client primary / secondary fields (Valant "Diagnoses - Patient" import; no dates) +
 *              active problem list; recency from the latest billed service date per code
 *  PHQ-9       ClinicalAssessmentRecord, MeasurementResult (Valant measurement import), TmsPhq9 —
 *              newest wins
 *  billing     ValantTransaction charges + Altrixs claims (program service codes, diagnosis recency)
 *  medications ClientMedication (the Valant medication import was not loaded: an empty list is
 *              reported as "medication history not available", never as "no trials")
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { SUD_INTAKE, THERAPY_NOTE_ALIASES } from '@/lib/ehr/therapy/sections';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { WINDOWS } from './criteria';
import { ACUTE_QUERY, acuteEventKind, billedProgram, extractIcdCodes, parseAsamFromNote } from './codes';
import { ageAt, evaluateClient, isCurrent, type AcuteEvent, type ChartBilling, type ChartDx, type ClientChart } from './rules';
import { ELIGIBILITY_STATUSES, PROGRAMS, type ProgramCounts, type ProgramKey, type ScannedClient } from './types';
import { clientPriority } from './priority';

export type EligibilityDb = Pick<
  PrismaClient,
  | 'client'
  | 'medicalProblem'
  | 'clientMedication'
  | 'medicalAllergy'
  | 'clinicalAssessmentRecord'
  | 'locusAssessmentRecord'
  | 'progressNote'
  | 'sudRadarSignal'
  | 'crisisEpisode'
  | 'prpEnrollment'
  | 'prpReferral'
  | 'spravatoEnrollment'
  | 'tmsCourse'
  | 'aotParticipant'
  | 'residentialResident'
> &
  Partial<Pick<PrismaClient, 'measurementResult' | 'tmsPhq9' | 'valantTransaction' | 'claim' | 'prpWorkflow' | 'appointment'>>;

export const BATCH_SIZE = 400;
export const MAX_CLIENTS = 5000;
/** Batches whose chart facts load at the same time (each batch runs ~20 queries in parallel) */
export const CHART_CONCURRENCY = 2;
/** Billing look-back: program service codes and diagnosis recency */
export const BILLING_LOOKBACK_DAYS = 365;
const DAY = 86_400_000;
const RESOLVED_PROBLEM = /resolved|inactive|entered\s+in\s+error|deleted|historical|ruled\s+out/i;
const SUD_INTAKE_TYPES = [SUD_INTAKE, ...THERAPY_NOTE_ALIASES[SUD_INTAKE]];
const PHQ9_KEYS = ['phq-9', 'phq9'];

export type ClientRow = {
  id: string;
  name: string;
  mrn: string | null;
  dateOfBirth: Date | null;
  insurancePayer: string | null;
  insuranceType: string | null;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  secondaryDiagnoses: string | null;
  assignedTo: { id: string; name: string | null } | null;
  location: { id: string; name: string } | null;
};

export const CLIENT_ROW_SELECT = {
  id: true, name: true, mrn: true, dateOfBirth: true, insurancePayer: true, insuranceType: true,
  primaryDiagnosis: true, primaryDiagnosisCode: true, secondaryDiagnoses: true,
  assignedTo: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} as const;

function group<T extends { clientId: string | null }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.clientId) continue;
    const list = m.get(r.clientId) ?? [];
    list.push(r);
    m.set(r.clientId, list);
  }
  return m;
}

/** Chart diagnoses: primary + secondary fields and active problem-list codes, one row per code. */
export function chartDiagnoses(
  c: Pick<ClientRow, 'primaryDiagnosis' | 'primaryDiagnosisCode' | 'secondaryDiagnoses'>,
  problems: { icd10Code: string | null; name: string; status: string | null; onsetDate: Date | null; createdAt: Date }[]
): ChartDx[] {
  const out: ChartDx[] = [];
  const seen = new Set<string>();
  const add = (d: ChartDx) => {
    if (seen.has(d.code)) return;
    seen.add(d.code);
    out.push(d);
  };
  const primary = extractIcdCodes(c.primaryDiagnosisCode);
  for (const code of primary) add({ code, label: primary.length === 1 ? c.primaryDiagnosis?.trim() || null : null, source: 'primary', date: null });
  for (const code of extractIcdCodes(c.secondaryDiagnoses)) add({ code, label: null, source: 'secondary', date: null });
  for (const p of problems) {
    if (RESOLVED_PROBLEM.test(p.status || '')) continue;
    for (const code of extractIcdCodes(p.icd10Code)) add({ code, label: p.name?.trim() || null, source: 'problem-list', date: p.onsetDate ?? p.createdAt });
  }
  return out;
}

function pickCurrent<T extends { status: string | null }>(rows: T[] | undefined): T | null {
  if (!rows?.length) return null;
  return rows.find((r) => isCurrent(r.status)) ?? rows[0];
}

const none = async () => [] as never[];

/** Newest PHQ-9 across the three sources. */
export function latestPhq9(
  candidates: ({ score: number; date: Date; source: 'assessment' | 'measurement' | 'tms' } | null | undefined)[]
): ClientChart['phq9'] {
  let best: ClientChart['phq9'] = null;
  for (const c of candidates) {
    if (!c || !Number.isFinite(c.score) || c.score < 0 || c.score > 27) continue;
    if (!best || c.date.getTime() > best.date.getTime()) best = c;
  }
  return best;
}

/** Loads chart facts for one batch of (already scoped, unlocked) clients. */
export async function loadCharts(
  db: EligibilityDb,
  organizationId: string,
  clients: ClientRow[],
  now: Date,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): Promise<ClientChart[]> {
  const ids = clients.map((c) => c.id);
  if (!ids.length) return [];
  const since = (days: number) => new Date(now.getTime() - days * DAY);
  const [
    problems, meds, allergies, assessments, locus, notes, signals, crises,
    prpEnrollments, prpReferrals, spravato, tms, aot, residential,
    measurements, tmsPhq, valantCharges, claims, prpWorkflows, appointments, acuteLines,
  ] = await Promise.all([
    db.medicalProblem.findMany({
      where: { clientId: { in: ids }, resolvedDate: null },
      select: { clientId: true, icd10Code: true, name: true, status: true, onsetDate: true, createdAt: true },
    }),
    db.clientMedication.findMany({
      where: { clientId: { in: ids } },
      select: {
        clientId: true, medicationName: true, drugName: true, genericName: true, brandName: true,
        dose: true, doseUnit: true, dosage: true, dosageText: true,
        startDate: true, endDate: true, stopDate: true, active: true, status: true, stopReason: true,
      },
    }),
    db.medicalAllergy.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, allergen: true, status: true } }),
    db.clinicalAssessmentRecord.findMany({
      where: {
        organizationId,
        clientId: { in: ids },
        createdAt: { gte: since(Math.max(WINDOWS.phq9, WINDOWS.cssrs)) },
        OR: [
          { instrumentId: { in: ['phq-9', 'c-ssrs-brief', 'c-ssrs', 'cssrs'] } },
          { instrumentName: { contains: 'PHQ-9', mode: 'insensitive' } },
          { instrumentName: { contains: 'C-SSRS', mode: 'insensitive' } },
        ],
      },
      select: { clientId: true, instrumentId: true, instrumentName: true, totalScore: true, severity: true, safetyFlagged: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.locusAssessmentRecord.findMany({
      where: { organizationId, clientId: { in: ids }, assessmentDate: { gte: since(WINDOWS.locus) } },
      select: { clientId: true, compositeScore: true, recommendedLevel: true, overrideLevel: true, assessmentDate: true },
      orderBy: { assessmentDate: 'desc' },
    }),
    db.progressNote.findMany({
      where: {
        clientId: { in: ids },
        workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
        createdAt: { gte: since(WINDOWS.sudIntake) },
        OR: [{ noteType: { in: SUD_INTAKE_TYPES } }, { body: { contains: 'ASAM Dimensions' } }],
      },
      select: { id: true, clientId: true, body: true, dateOfService: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.sudRadarSignal.findMany({
      where: { organizationId, clientId: { in: ids }, status: { notIn: ['dismissed', 'resolved'] } },
      select: { clientId: true, detectedCondition: true, routedAction: true, scannedAt: true },
    }),
    db.crisisEpisode.findMany({
      where: { organizationId, clientId: { in: ids }, startedAt: { gte: since(WINDOWS.crisis) } },
      select: { clientId: true, startedAt: true },
      orderBy: { startedAt: 'desc' },
    }),
    db.prpEnrollment.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { clientId: true, status: true, startDate: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.prpReferral.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { clientId: true, referralDate: true },
      orderBy: { referralDate: 'desc' },
    }),
    db.spravatoEnrollment.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { clientId: true, status: true, enrolledAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.tmsCourse.findMany({
      where: { organizationId, clientId: { in: ids } },
      select: { clientId: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    // AOT / residential rows carry no organizationId; clientId is already org-scoped.
    db.aotParticipant.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, status: true } }),
    // Active residents + every admission in the AOT look-back (acute-event history)
    db.residentialResident.findMany({
      where: { clientId: { in: ids }, OR: [{ active: true }, { admitDate: { gte: since(WINDOWS.crisis) } }] },
      select: { clientId: true, program: true, admitDate: true, active: true },
      orderBy: { admitDate: 'desc' },
    }),
    db.measurementResult
      ? db.measurementResult.findMany({
          where: {
            organizationId,
            clientId: { in: ids },
            measuredAt: { gte: since(WINDOWS.phq9) },
            valueNumeric: { not: null },
            measurementType: { instrumentKey: { in: PHQ9_KEYS }, isSubscore: false },
          },
          select: { clientId: true, valueNumeric: true, measuredAt: true },
          orderBy: { measuredAt: 'desc' },
        })
      : none(),
    db.tmsPhq9
      ? db.tmsPhq9.findMany({
          where: { course: { organizationId, clientId: { in: ids } }, instrument: 'phq-9', recordedAt: { gte: since(WINDOWS.phq9) } },
          select: { score: true, recordedAt: true, course: { select: { clientId: true } } },
          orderBy: { recordedAt: 'desc' },
        })
      : none(),
    db.valantTransaction
      ? db.valantTransaction.findMany({
          where: { organizationId, clientId: { in: ids }, category: 'charge', serviceDate: { gte: since(BILLING_LOOKBACK_DAYS) } },
          select: { clientId: true, code: true, codeBase: true, codeSuffix: true, serviceDate: true, diagnosis: true },
          orderBy: { serviceDate: 'desc' },
        })
      : none(),
    db.claim
      ? db.claim.findMany({
          where: { organizationId, clientId: { in: ids }, createdAt: { gte: since(BILLING_LOOKBACK_DAYS) }, status: { not: 'DRAFT' } },
          select: { clientId: true, cptCode: true, icd10Codes: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : none(),
    db.prpWorkflow
      ? db.prpWorkflow.findMany({
          where: { clientId: { in: ids } },
          select: { clientId: true, stage: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        })
      : none(),
    db.appointment
      ? db.appointment.findMany({
          where: { clientId: { in: ids }, startsAt: { gte: since(90), lte: now }, status: { in: ['NO_SHOW', 'COMPLETED', 'LATE_CANCEL'] } },
          select: { clientId: true, status: true, startsAt: true },
        })
      : none(),
    // Acute psychiatric care lines (inpatient / ED POS, hospital / ED / crisis codes), 36 months
    db.valantTransaction
      ? db.valantTransaction.findMany({
          where: {
            organizationId,
            clientId: { in: ids },
            category: 'charge',
            serviceDate: { gte: since(WINDOWS.crisis) },
            OR: [{ pos: { in: [...ACUTE_QUERY.pos] } }, { codeBase: { in: [...ACUTE_QUERY.codes] } }],
          },
          select: { clientId: true, code: true, codeBase: true, pos: true, serviceDate: true },
        })
      : none(),
  ]);

  const byProblems = group(problems);
  const byMeds = group(meds);
  const byAllergies = group(allergies);
  const byAssess = group(assessments);
  const byLocus = group(locus);
  const byNotes = group(notes);
  const bySignals = group(signals);
  const byCrisis = group(crises);
  const byPrp = group(prpEnrollments);
  const byPrpRef = group(prpReferrals);
  const bySpr = group(spravato);
  const byTms = group(tms);
  const byAot = group(aot);
  const byRes = group(residential);
  const byMeasure = group(measurements as { clientId: string; valueNumeric: number | null; measuredAt: Date }[]);
  const byTmsPhq = group((tmsPhq as { score: number; recordedAt: Date; course: { clientId: string } }[]).map((r) => ({ clientId: r.course.clientId, score: r.score, recordedAt: r.recordedAt })));
  const byValant = group(valantCharges as { clientId: string | null; code: string; codeBase: string | null; codeSuffix: string | null; serviceDate: Date | null; diagnosis: string | null }[]);
  const byClaim = group(claims as { clientId: string; cptCode: string; icd10Codes: string[]; createdAt: Date }[]);
  const byWorkflow = group(prpWorkflows as { clientId: string; stage: string; updatedAt: Date }[]);
  const byAppt = group(appointments as { clientId: string; status: string; startsAt: Date }[]);
  const byAcute = group(acuteLines as { clientId: string | null; code: string; codeBase: string | null; pos: string | null; serviceDate: Date | null }[]);

  return clients.map((c): ClientChart => {
    const probs = byProblems.get(c.id) ?? [];
    const a = byAssess.get(c.id) ?? [];
    const phqA = a.find((r) => /phq-?9/i.test(`${r.instrumentId} ${r.instrumentName}`) && typeof r.totalScore === 'number');
    const phqM = (byMeasure.get(c.id) ?? [])[0];
    const phqT = (byTmsPhq.get(c.id) ?? [])[0];
    const cssrs = a.find((r) => /c-?ssrs/i.test(`${r.instrumentId} ${r.instrumentName}`));
    const l = (byLocus.get(c.id) ?? [])[0];
    const intakeNote = (byNotes.get(c.id) ?? [])
      .map((n) => ({ n, asam: parseAsamFromNote(n.body) }))
      .find((x) => Object.keys(x.asam.ratings).length || x.asam.levelOfCare);
    const prp = pickCurrent(byPrp.get(c.id));
    const ref = (byPrpRef.get(c.id) ?? [])[0];
    const spr = pickCurrent(bySpr.get(c.id));
    const course = pickCurrent(byTms.get(c.id));
    const aotRow = pickCurrent(byAot.get(c.id));
    const resRows = (byRes.get(c.id) ?? []) as { program: string; admitDate: Date; active?: boolean }[];
    const res = resRows.find((r) => r.active !== false);
    const acuteEvents: AcuteEvent[] = [];
    for (const t of byAcute.get(c.id) ?? []) {
      const kind = acuteEventKind(t.codeBase ?? t.code, t.pos);
      if (kind && t.serviceDate) acuteEvents.push({ date: t.serviceDate, kind, code: t.codeBase ?? t.code });
    }
    for (const r of resRows) if (r.admitDate) acuteEvents.push({ date: r.admitDate, kind: 'residential', code: null });
    const wf = (byWorkflow.get(c.id) ?? [])[0];

    // Billing: program service codes + latest billed date per diagnosis code
    const billing: ChartBilling[] = [];
    const billedDx: Record<string, Date> = {};
    const noteDx = (codes: string[], date: Date | null) => {
      if (!date) return;
      for (const code of codes) if (!billedDx[code] || billedDx[code] < date) billedDx[code] = date;
    };
    for (const t of byValant.get(c.id) ?? []) {
      const program = billedProgram(t.codeBase ?? t.code, t.codeSuffix);
      if (program) billing.push({ code: t.code, program, date: t.serviceDate, source: 'valant' });
      noteDx(extractIcdCodes(t.diagnosis), t.serviceDate);
    }
    for (const cl of byClaim.get(c.id) ?? []) {
      const base = cl.cptCode.trim().toUpperCase().slice(0, 5);
      const acute = acuteEventKind(base);
      if (acute) acuteEvents.push({ date: cl.createdAt, kind: acute, code: base });
      const program = billedProgram(base, cl.cptCode.slice(5));
      if (program) billing.push({ code: cl.cptCode, program, date: cl.createdAt, source: 'claim' });
      noteDx(cl.icd10Codes.flatMap((x) => extractIcdCodes(x)), cl.createdAt);
    }
    billing.sort((x, y) => (y.date?.getTime() ?? 0) - (x.date?.getTime() ?? 0));
    const appts = byAppt.get(c.id) ?? [];

    return {
      id: c.id,
      dateOfBirth: c.dateOfBirth,
      insurancePayer: c.insurancePayer,
      insuranceType: c.insuranceType,
      diagnoses: chartDiagnoses(c, probs),
      problemCount: probs.filter((p) => !RESOLVED_PROBLEM.test(p.status || '')).length,
      meds: (byMeds.get(c.id) ?? []).map((m) => ({
        name: m.drugName || m.medicationName,
        genericName: m.genericName,
        brandName: m.brandName,
        dose: [m.dose && `${m.dose}${m.doseUnit ? ` ${m.doseUnit}` : ''}`, m.dosageText, m.dosage].filter(Boolean).join(' '),
        startDate: m.startDate,
        endDate: m.stopDate ?? m.endDate,
        active: m.active && !/discontinu|stopped|inactive|completed/i.test(m.status || ''),
        status: m.status,
        stopReason: m.stopReason,
      })),
      allergies: (byAllergies.get(c.id) ?? []).map((x) => ({ allergen: x.allergen, status: x.status })),
      phq9: latestPhq9([
        phqA ? { score: phqA.totalScore as number, date: phqA.createdAt, source: 'assessment' } : null,
        phqM?.valueNumeric != null ? { score: phqM.valueNumeric, date: phqM.measuredAt, source: 'measurement' } : null,
        phqT ? { score: phqT.score, date: phqT.recordedAt, source: 'tms' } : null,
      ]),
      cssrs: cssrs ? { severity: cssrs.severity, safetyFlagged: cssrs.safetyFlagged, date: cssrs.createdAt } : null,
      locus: l ? { composite: l.compositeScore, level: l.overrideLevel || l.recommendedLevel, date: l.assessmentDate } : null,
      sudIntake: intakeNote ? { asam: intakeNote.asam, date: intakeNote.n.dateOfService ?? intakeNote.n.createdAt, noteId: intakeNote.n.id } : null,
      sudSignals: (bySignals.get(c.id) ?? []).map((s) => ({ condition: s.detectedCondition, routedAction: s.routedAction, date: s.scannedAt })),
      crisisEpisodes: (byCrisis.get(c.id) ?? []).map((x) => ({ date: x.startedAt })),
      prpEnrollment: prp ? { status: prp.status, date: prp.startDate ?? prp.createdAt } : null,
      prpReferral: ref ? { date: ref.referralDate } : null,
      prpWorkflow: wf ? { stage: wf.stage, date: wf.updatedAt } : null,
      spravatoEnrollment: spr ? { status: spr.status, date: spr.enrolledAt ?? spr.createdAt } : null,
      tmsCourse: course ? { status: course.status, date: course.createdAt } : null,
      aotParticipant: aotRow ? { status: aotRow.status } : null,
      residentialResident: res ? { program: res.program, date: res.admitDate } : null,
      billing,
      billedDx,
      acuteEvents,
      utilization: {
        noShows90: appts.filter((x) => x.status === 'NO_SHOW' || x.status === 'LATE_CANCEL').length,
        completed90: appts.filter((x) => x.status === 'COMPLETED').length,
      },
      timeZone,
    };
  });
}

export function emptyCounts(): Record<ProgramKey, ProgramCounts> {
  const out = {} as Record<ProgramKey, ProgramCounts>;
  for (const p of PROGRAMS) {
    out[p] = Object.fromEntries(ELIGIBILITY_STATUSES.map((s) => [s, 0])) as ProgramCounts;
  }
  return out;
}

export type ScanResult = {
  clientsScanned: number;
  sensitiveHidden: number;
  truncated: boolean;
  counts: Record<ProgramKey, ProgramCounts>;
  clients: ScannedClient[];
  notIndicatedOnly: number;
};

/** Scanned-client row for one evaluated chart (shared by the live scan and the snapshot writer). */
export function scannedClient(r: ClientRow, chart: ClientChart, results: ScannedClient['results'], now: Date): ScannedClient {
  return {
    id: r.id,
    name: r.name,
    mrn: r.mrn,
    age: ageAt(r.dateOfBirth, now, chart.timeZone),
    primaryDx: chart.diagnoses[0] ? `${chart.diagnoses[0].code}${chart.diagnoses[0].label ? ` ${chart.diagnoses[0].label}` : ''}` : null,
    clinician: r.assignedTo ? { id: r.assignedTo.id, name: r.assignedTo.name || 'Unnamed clinician' } : null,
    location: r.location,
    payer: [r.insuranceType, r.insurancePayer].filter(Boolean).join(' · ') || null,
    priority: clientPriority(chart, results, now),
    results,
  };
}

/**
 * Scan every active client in scope. `lockedIds` returns the protected clients the viewer
 * cannot open (lockedSensitiveClientIds in production). `onBatch` receives every evaluated
 * client (including not-indicated ones) — the snapshot writer uses it.
 */
export async function runServiceEligibilityScan(opts: {
  db: EligibilityDb;
  organizationId: string;
  clientWhere: Prisma.ClientWhereInput;
  lockedIds: (clientIds: string[]) => Promise<Set<string>>;
  now?: Date;
  timeZone?: string;
  batchSize?: number;
  maxClients?: number;
  onBatch?: (rows: ScannedClient[]) => Promise<void>;
}): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, opts.batchSize ?? BATCH_SIZE);
  const maxClients = opts.maxClients ?? MAX_CLIENTS;
  const counts = emptyCounts();
  const out: ScannedClient[] = [];
  let scanned = 0;
  let hidden = 0;
  let notIndicatedOnly = 0;
  let truncated = false;
  let cursor: string | undefined;
  // Pipelined: the next client page is read while up to CHART_CONCURRENCY earlier batches load
  // their chart facts (each batch is already set-based; this only overlaps batches).
  const pending: Promise<void>[] = [];
  const evaluateBatch = async (open: ClientRow[], charts: ClientChart[]) => {
    const rowById = new Map(open.map((r) => [r.id, r]));
    const all: ScannedClient[] = [];
    for (const chart of charts) {
      const r = rowById.get(chart.id)!;
      const results = evaluateClient(chart, now);
      for (const p of PROGRAMS) counts[p][results[p].status] += 1;
      const row = scannedClient(r, chart, results, now);
      all.push(row);
      if (PROGRAMS.every((p) => results[p].status === 'not_indicated')) {
        notIndicatedOnly += 1;
        continue;
      }
      out.push(row);
    }
    if (opts.onBatch) await opts.onBatch(all);
  };

  for (;;) {
    if (scanned + hidden >= maxClients) {
      truncated = true;
      break;
    }
    const take = Math.min(batchSize, maxClients - scanned - hidden);
    const rows: ClientRow[] = await opts.db.client.findMany({
      where: { AND: [opts.clientWhere, { status: 'ACTIVE' }] },
      select: CLIENT_ROW_SELECT,
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    const locked = await opts.lockedIds(rows.map((r) => r.id));
    const open = rows.filter((r) => !locked.has(r.id));
    hidden += rows.length - open.length;
    scanned += open.length;

    const batch = loadCharts(opts.db, opts.organizationId, open, now, opts.timeZone).then((charts) => evaluateBatch(open, charts));
    batch.catch(() => {}); // still rethrown by the await below; avoids an early unhandled rejection
    pending.push(batch);
    if (pending.length >= CHART_CONCURRENCY) await pending.shift();
    if (rows.length < take) break;
  }
  await Promise.all(pending);

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { clientsScanned: scanned, sensitiveHidden: hidden, truncated, counts, clients: out, notIndicatedOnly };
}

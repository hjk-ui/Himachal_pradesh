/**
 * Primary care workflow: database reads / writes (server only). Rules live in
 * primaryCareWorkflow.ts; this file only loads chart facts and stores what staff entered.
 *
 * Minimum necessary: primary care views read primary-care screenings only (assessment records
 * with category PC_SCREENING_CATEGORY); behavioral health scores, notes and Part 2 content are not
 * loaded. The single BH signal is "seen by the practice's behavioral health team" (yes / last date),
 * the same signal the primary care chart already carries.
 */
import 'server-only';
import type { MedicalReferral, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { isMedicalRole } from '@/types/roles';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { primaryCareClinicianWhere } from '@/lib/medical/primaryCareOverview';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { isMedicalDirectorEligibleRole } from '@/lib/auth/medicalDirector';
import {
  bhHandoffDerivedStatus,
  CARE_GAP_KEYS,
  computeCareGaps,
  DEFAULT_RESULTS_NOTIFY_DAYS,
  hasDiabetesCode,
  labGapFor,
  approveStandingOrder,
  canApproveStandingOrders,
  canRetireStandingOrders,
  parsePocStandingOrders,
  retireStandingOrder,
  screeningsDue,
  withDraftStandingOrders,
  type StandingOrderActor,
  type CareGap,
  type CareGapHistory,
  type CareGapKey,
  type PocStandingOrder,
  type ScoreOnFile,
  type ScreeningDue,
  type ScreeningKey,
} from '@/lib/medical/primaryCareWorkflow';

const DAY_MS = 86_400_000;

/** ClinicalAssessmentRecord.category for screenings given in primary care (rooming). */
export const PC_SCREENING_CATEGORY = 'Primary care screening';

export type Viewer = { organizationId: string; userId: string; role: string };

// ─── Settings ────────────────────────────────────────────────────────────────

export type PrimaryCareSettingsView = {
  resultsNotifyDays: number;
  pocStandingOrders: PocStandingOrder[];
  careGapsDisabled: string[];
  /** false = no row saved yet (defaults shown) */
  saved: boolean;
};

export async function loadPrimaryCareSettings(organizationId: string): Promise<PrimaryCareSettingsView> {
  const row = await prisma.primaryCareSettings.findUnique({ where: { organizationId } }).catch(() => null);
  // The draft list (2026-10-21) is always offered: drafts are not usable until a Medical Director approves them
  if (!row) return { resultsNotifyDays: DEFAULT_RESULTS_NOTIFY_DAYS, pocStandingOrders: withDraftStandingOrders([]), careGapsDisabled: [], saved: false };
  return {
    resultsNotifyDays: row.resultsNotifyDays,
    pocStandingOrders: withDraftStandingOrders(parsePocStandingOrders(row.pocStandingOrders)),
    careGapsDisabled: row.careGapsDisabled.filter((k) => (CARE_GAP_KEYS as string[]).includes(k)),
    saved: true,
  };
}

export async function savePrimaryCareSettings(
  organizationId: string,
  userId: string,
  input: { resultsNotifyDays: number; pocStandingOrders: PocStandingOrder[]; careGapsDisabled: string[] }
) {
  const data = {
    resultsNotifyDays: input.resultsNotifyDays,
    pocStandingOrders: input.pocStandingOrders as unknown as Prisma.InputJsonValue,
    careGapsDisabled: input.careGapsDisabled,
    updatedById: userId,
  };
  return prisma.primaryCareSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
}

// ─── Standing orders (approve / retire) ─────────────────────────────────────

/** Medical Director flag from the database row (never from a JWT claim), active staff in this org only. */
export async function standingOrderActor(viewer: Viewer): Promise<StandingOrderActor & { name: string }> {
  const u = await prisma.user.findFirst({
    where: { id: viewer.userId, organizationId: viewer.organizationId },
    select: { name: true, email: true, role: true, isMedicalDirector: true, status: true },
  });
  const active = Boolean(u && String(u.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE');
  return {
    role: viewer.role,
    isMedicalDirector: Boolean(active && u?.isMedicalDirector),
    // The designation applies only while the active role is a prescriber role (medicalDirectorActive)
    roleEligible: Boolean(u) && isMedicalDirectorEligibleRole(viewer.role),
    name: u?.name?.trim() || u?.email || 'Staff',
  };
}

export type StandingOrderAction = { key: string; action: 'approve' | 'retire'; attestation?: string | null; criteria?: string | null };

/** Approve (verified Medical Director) or retire (Medical Director or leadership) one standing order. */
export async function actOnStandingOrder(
  viewer: Viewer,
  input: StandingOrderAction,
  now = new Date()
): Promise<{ ok: true; settings: PrimaryCareSettingsView; order: PocStandingOrder } | { ok: false; status: 400 | 403; error: string }> {
  const actor = await standingOrderActor(viewer);
  if (input.action === 'approve' && !canApproveStandingOrders(actor)) {
    return { ok: false, status: 403, error: 'Only the Medical Director can approve a standing order' };
  }
  if (input.action === 'retire' && !canRetireStandingOrders(actor)) {
    return { ok: false, status: 403, error: 'Only the Medical Director or practice leadership can retire a standing order' };
  }
  const current = await loadPrimaryCareSettings(viewer.organizationId);
  const r =
    input.action === 'approve'
      ? approveStandingOrder(current.pocStandingOrders, { key: input.key, approverId: viewer.userId, approverName: actor.name, attestation: input.attestation ?? '', criteria: input.criteria, now })
      : retireStandingOrder(current.pocStandingOrders, { key: input.key, byId: viewer.userId, byName: actor.name, now });
  if (r.ok === false) return { ok: false, status: 400, error: r.error };
  await savePrimaryCareSettings(viewer.organizationId, viewer.userId, {
    resultsNotifyDays: current.resultsNotifyDays,
    pocStandingOrders: r.list,
    careGapsDisabled: current.careGapsDisabled,
  });
  return { ok: true, settings: await loadPrimaryCareSettings(viewer.organizationId), order: r.order };
}

// ─── Access ──────────────────────────────────────────────────────────────────

export type ClientGate =
  | { ok: true; client: { id: string; name: string; dateOfBirth: Date | null } }
  | { ok: false; status: 403 | 404; reason: string };

/** Org + roster role + care team / caseload + Part 2 / protected record (same check as the chart). */
export async function gateClient(viewer: Viewer, clientId: string, path: string): Promise<ClientGate> {
  const d = await resolveChartAccess(viewer, clientId, path);
  if (d.ok === false) return { ok: false, status: d.status === 404 ? 404 : 403, reason: d.reason };
  return { ok: true, client: { id: d.client.id, name: d.client.name, dateOfBirth: d.client.dateOfBirth } };
}

/** Client ids among `ids` the viewer may NOT open (Part 2 / protected); null = lookup failed (mask all). */
export async function lockedClientIds(viewer: Viewer, ids: string[]): Promise<Set<string> | null> {
  if (!ids.length) return new Set();
  try {
    const map = await resolveSensitiveAccessMap({ organizationId: viewer.organizationId, userId: viewer.userId, role: viewer.role, clientIds: ids });
    const out = new Set<string>();
    for (const [id, info] of map) if (!info.canAccessSensitive) out.add(id);
    return out;
  } catch {
    return null;
  }
}

export function accessWhere(viewer: Viewer): Prisma.ClientWhereInput {
  return clientAccessWhere({ organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role as Role });
}

// ─── Patient facts ──────────────────────────────────────────────────────────

const ageOn = (dob: Date | null, now: Date) => {
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
};

export function sexFrom(sexAtBirth: string | null | undefined, administrativeSex: string | null | undefined): 'F' | 'M' | null {
  for (const v of [sexAtBirth, administrativeSex]) {
    const s = String(v ?? '').trim().toUpperCase();
    if (s === 'F' || s === 'FEMALE') return 'F';
    if (s === 'M' || s === 'MALE') return 'M';
  }
  return null;
}

type GapActionRow = {
  gapKey: string;
  action: string;
  performedOn: Date | null;
  kind: string | null;
  source: string | null;
  reason: string | null;
  method: string | null;
  appointmentId: string | null;
  patientReported: boolean;
  recordedByName: string | null;
  createdAt: Date;
};

const maxHistory = (a: CareGapHistory | null | undefined, b: CareGapHistory | null): CareGapHistory | null => {
  if (!a) return b;
  if (!b) return a;
  return b.date.getTime() > a.date.getTime() ? b : a;
};

/** Fold gap actions + lab results into the computeCareGaps input (provider actions only close gaps). */
export function careGapHistoryFrom(
  actions: GapActionRow[],
  labs: { text: string; at: Date }[]
): {
  last: Partial<Record<CareGapKey, CareGapHistory>>;
  notApplicable: Partial<Record<CareGapKey, string>>;
  patientReported: Partial<Record<CareGapKey, { date: Date | null; source: string }>>;
  lastOutreach: Date | null;
} {
  const last: Partial<Record<CareGapKey, CareGapHistory>> = {};
  const notApplicable: Partial<Record<CareGapKey, string>> = {};
  const patientReported: Partial<Record<CareGapKey, { date: Date | null; source: string }>> = {};
  let lastOutreach: Date | null = null;
  const sorted = [...actions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const a of sorted) {
    const key = a.gapKey as CareGapKey;
    if (!(CARE_GAP_KEYS as string[]).includes(key)) continue;
    switch (a.action) {
      case 'completed':
        last[key] = maxHistory(last[key], { date: a.performedOn ?? a.createdAt, kind: a.kind, source: 'done at visit' }) ?? undefined;
        delete patientReported[key];
        break;
      case 'done_elsewhere':
        if (a.performedOn) last[key] = maxHistory(last[key], { date: a.performedOn, kind: a.kind, source: a.source || 'outside record' }) ?? undefined;
        delete patientReported[key];
        break;
      case 'not_applicable':
        notApplicable[key] = a.reason || 'not applicable';
        break;
      case 'reopened':
        delete notApplicable[key];
        break;
      case 'reported_elsewhere':
        patientReported[key] = { date: a.performedOn, source: a.source || 'patient report' };
        break;
      case 'outreach':
        if (!lastOutreach || a.createdAt > lastOutreach) lastOutreach = a.createdAt;
        break;
      default:
        break;
    }
  }
  for (const l of labs) {
    const key = labGapFor(l.text);
    if (key) last[key] = maxHistory(last[key], { date: l.at, kind: null, source: 'lab result on file' }) ?? undefined;
  }
  return { last, notApplicable, patientReported, lastOutreach };
}

export type PcScreeningResults = {
  phq2: ScoreOnFile;
  phq9: (ScoreOnFile & { item9?: number | null }) | null;
  gad7: ScoreOnFile;
  auditC: ScoreOnFile;
};

export type PatientCareFacts = {
  ageYears: number | null;
  sex: 'F' | 'M' | null;
  diabetes: boolean;
  careGaps: CareGap[];
  screenings: ScreeningDue[];
  scores: PcScreeningResults;
  lastOutreach: string | null;
  actions: GapActionRow[];
};

/** Screening + care gap facts for one client (caller has already passed gateClient). */
export async function loadPatientCareFacts(viewer: Viewer, clientId: string, opts: { now: Date; timeZone: string; disabledGaps?: string[] }): Promise<PatientCareFacts> {
  const facts = await loadCareFactsBatch(viewer.organizationId, [clientId], opts);
  return facts.get(clientId)!;
}

/** Batch version (MA outreach list). Reads only primary-care data: problems, labs, gap actions, PC screenings. */
export async function loadCareFactsBatch(
  organizationId: string,
  clientIds: string[],
  opts: { now: Date; timeZone: string; disabledGaps?: string[] }
): Promise<Map<string, PatientCareFacts>> {
  const out = new Map<string, PatientCareFacts>();
  if (!clientIds.length) return out;
  const since = new Date(opts.now.getTime() - 11 * 365 * DAY_MS);
  const [clients, problems, labResults, actions, assessments, sdoh, roomings] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, organizationId }, select: { id: true, dateOfBirth: true, sexAtBirth: true, administrativeSex: true } }),
    prisma.medicalProblem.findMany({
      where: { clientId: { in: clientIds }, NOT: { status: { in: ['Resolved', 'Inactive', 'Entered in error', 'Entered-in-error', 'Refuted'] } } },
      select: { clientId: true, icd10Code: true },
    }),
    prisma.labResult.findMany({
      where: { order: { organizationId, clientId: { in: clientIds }, status: { not: 'cancelled' } }, createdAt: { gte: since } },
      select: { testName: true, testKey: true, panelName: true, collectedAt: true, createdAt: true, order: { select: { clientId: true, resultedAt: true } } },
      take: 5000,
    }),
    prisma.medicalCareGapAction.findMany({
      where: { organizationId, clientId: { in: clientIds } },
      select: { clientId: true, gapKey: true, action: true, performedOn: true, kind: true, source: true, reason: true, method: true, appointmentId: true, patientReported: true, recordedByName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 10000,
    }).catch(() => [] as (GapActionRow & { clientId: string })[]),
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId, clientId: { in: clientIds }, category: PC_SCREENING_CATEGORY },
      select: { clientId: true, instrumentId: true, totalScore: true, createdAt: true, answers: { where: { itemId: 'q9' }, select: { itemId: true, scoreValue: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.sdohScreening.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { clientId: true, completedAt: true }, orderBy: { completedAt: 'desc' }, take: 5000 }),
    prisma.medicalRooming.findMany({
      where: { organizationId, clientId: { in: clientIds }, status: { in: ['ready', 'in_room'] } },
      select: { clientId: true, checks: true, roomedAt: true },
      orderBy: { roomedAt: 'desc' },
      take: 5000,
    }).catch(() => [] as { clientId: string; checks: unknown; roomedAt: Date | null }[]),
  ]);
  const day = (d: Date) => toPracticeWallTime(d, opts.timeZone).date;

  for (const c of clients) {
    const ageYears = ageOn(c.dateOfBirth, opts.now);
    const sex = sexFrom(c.sexAtBirth, c.administrativeSex);
    const diabetes = hasDiabetesCode(problems.filter((p) => p.clientId === c.id).map((p) => p.icd10Code));
    const myActions = actions.filter((a) => a.clientId === c.id);
    const labs = labResults
      .filter((r) => r.order.clientId === c.id)
      .map((r) => ({ text: `${r.testName} ${r.testKey ?? ''} ${r.panelName ?? ''}`, at: r.collectedAt ?? r.order.resultedAt ?? r.createdAt }));
    const hist = careGapHistoryFrom(myActions, labs);
    const careGaps = computeCareGaps({
      ageYears,
      sex,
      diabetes,
      now: opts.now,
      timeZone: opts.timeZone,
      last: hist.last,
      notApplicable: hist.notApplicable,
      patientReported: hist.patientReported,
      disabled: opts.disabledGaps,
    });

    const mine = assessments.filter((a) => a.clientId === c.id);
    const latest = (id: string) => mine.find((a) => a.instrumentId === id) ?? null;
    const score = (id: string): ScoreOnFile => {
      const r = latest(id);
      return r && r.totalScore != null ? { score: r.totalScore, date: day(r.createdAt) } : null;
    };
    const phq9Row = latest('phq-9');
    const scores: PcScreeningResults = {
      phq2: score('phq-2'),
      phq9: phq9Row && phq9Row.totalScore != null ? { score: phq9Row.totalScore, date: day(phq9Row.createdAt), item9: phq9Row.answers[0]?.scoreValue ?? null } : null,
      gad7: score('gad-7'),
      auditC: score('audit-c'),
    };
    const depressionAt = [latest('phq-2')?.createdAt, latest('phq-9')?.createdAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const roomed = roomings.filter((r) => r.clientId === c.id);
    const roomedScreen = (key: 'tobacco' | 'falls') =>
      roomed.find((r) => {
        const s = (r.checks as { screenings?: Record<string, unknown> } | null)?.screenings;
        return Boolean(s && s[key]);
      })?.roomedAt ?? null;
    const last: Partial<Record<ScreeningKey, Date | null>> = {
      depression: depressionAt,
      tobacco: roomedScreen('tobacco'),
      alcohol: latest('audit-c')?.createdAt ?? null,
      falls: roomedScreen('falls'),
      sdoh: sdoh.find((s) => s.clientId === c.id)?.completedAt ?? null,
    };
    out.set(c.id, {
      ageYears,
      sex,
      diabetes,
      careGaps,
      screenings: screeningsDue({ ageYears, last, now: opts.now, timeZone: opts.timeZone }),
      scores,
      lastOutreach: hist.lastOutreach ? day(hist.lastOutreach) : null,
      actions: myActions,
    });
  }
  return out;
}

/** "Seen by the practice's behavioral health team": non-Part 2 BH appointment in the last 12 months. No content. */
export async function bhInvolvement(organizationId: string, clientId: string, now: Date): Promise<{ involved: boolean; lastSeen: Date | null }> {
  const since = new Date(now.getTime() - 365 * DAY_MS);
  const appt = await prisma.appointment.findFirst({
    where: {
      clientId,
      client: { organizationId },
      status: 'COMPLETED',
      startsAt: { gte: since, lte: now },
      clinician: { role: { notIn: ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'] }, NOT: { roles: { hasSome: ['PHYSICIAN', 'MEDICAL_NP'] } } },
      // A group occurrence may be a 42 CFR Part 2 SUD group: not counted (would disclose Part 2 status)
      groupSessionId: null,
      progressNotes: { none: { part2: true } },
    },
    select: { startsAt: true, clinician: { select: { role: true } } },
    orderBy: { startsAt: 'desc' },
  });
  if (!appt || isMedicalRole(String(appt.clinician?.role ?? ''))) return { involved: false, lastSeen: null };
  return { involved: true, lastSeen: appt.startsAt };
}

// ─── Referrals (incl. BH warm handoff) ──────────────────────────────────────

export type ReferralView = {
  id: string;
  clientId: string;
  kind: string;
  target: string;
  facility: string | null;
  reason: string;
  urgency: string;
  cpt: string | null;
  icd10Codes: string[];
  status: string;
  statusDate: string | null;
  scheduledFor: string | null;
  seenAt: string | null;
  reportReceivedAt: string | null;
  sentAt: string;
  orderedByName: string | null;
  orderedById: string;
};

export async function referralViews(organizationId: string, rows: MedicalReferral[], timeZone: string): Promise<ReferralView[]> {
  const day = (d: Date | null) => (d ? toPracticeWallTime(d, timeZone).date : null);
  const bhClientIds = [...new Set(rows.filter((r) => r.kind === 'internal_bh').map((r) => r.clientId))];
  const bhAppts = bhClientIds.length
    ? await prisma.appointment.findMany({
        where: {
          clientId: { in: bhClientIds },
          client: { organizationId },
          clinicianId: { not: null },
          NOT: { clinician: primaryCareClinicianWhere() },
          startsAt: { gte: new Date(Math.min(...rows.map((r) => r.sentAt.getTime())) - DAY_MS) },
        },
        select: { clientId: true, startsAt: true, status: true, createdAt: true },
        take: 2000,
      })
    : [];
  return rows.map((r) => {
    let status = r.status;
    let statusDate: Date | null = r.reportReceivedAt ?? r.seenAt ?? r.scheduledFor ?? null;
    if (r.kind === 'internal_bh') {
      const d = bhHandoffDerivedStatus(r.status, r.sentAt, bhAppts.filter((a) => a.clientId === r.clientId).map((a) => ({ ...a, status: String(a.status) })));
      status = d.status;
      statusDate = d.date;
    }
    return {
      id: r.id,
      clientId: r.clientId,
      kind: r.kind,
      target: r.target,
      facility: r.facility,
      reason: r.reason,
      urgency: r.urgency,
      cpt: r.cpt,
      icd10Codes: r.icd10Codes,
      status,
      statusDate: day(statusDate),
      scheduledFor: day(r.scheduledFor),
      seenAt: day(r.seenAt),
      reportReceivedAt: day(r.reportReceivedAt),
      sentAt: r.sentAt.toISOString(),
      orderedByName: r.orderedByName,
      orderedById: r.orderedById,
    };
  });
}

/** Appointment for a rooming / visit: same org, primary care clinician. */
export async function loadPrimaryCareAppointment(organizationId: string, appointmentId: string) {
  return prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      OR: [{ organizationId }, { organizationId: null, client: { organizationId } }],
      clinician: primaryCareClinicianWhere(),
    },
    select: {
      id: true,
      clientId: true,
      startsAt: true,
      type: true,
      status: true,
      isVirtual: true,
      clinicianId: true,
      clinicianName: true,
      insurancePayer: true,
      clinician: { select: { name: true } },
      client: { select: { name: true, dateOfBirth: true, insurancePayer: true, insuranceType: true } },
    },
  });
}

/** Practice primary care population the viewer may open (care team / org). */
export function primaryCarePopulation(viewer: Viewer): Prisma.ClientWhereInput {
  return { AND: [accessWhere(viewer), primaryCarePatientWhere(), { status: 'ACTIVE' }] };
}

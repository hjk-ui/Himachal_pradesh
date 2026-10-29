import 'server-only';
/**
 * Front desk huddle loader (server). One pass for a practice-day window (today / tomorrow / up to 7
 * days): appointments in the organization, the facts each readiness rule needs (batched per window,
 * never per row), then src/lib/frontOffice/rules.ts decides every status.
 *
 * Minimum necessary: no clinical content is loaded. Demographic / insurance fields, eligibility
 * status, authorization units, consent titles, copay rules and payments are front-office data; the
 * note flag is signed / not signed only. Each part is gated by the same role rule as its own page.
 */
import type { AppointmentStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { appointmentFilterFacets } from '@/lib/appointments/listFacets';
import { listNoShowRisk, type NoShowRiskItem } from '@/lib/appointments/noShowRisk';
import { clientTelehealthJoinUrl } from '@/lib/telehealth/joinUrl';
import { parseTelehealthMeta } from '@/lib/telehealth/meta';
import { canAccessClientRoster } from '@/lib/clients/orgScope';
import { canAccessConsents } from '@/lib/consents/manage';
import { loadWorklistData } from '@/lib/consents/library/worklist';
import { carelonNeededForClients } from '@/lib/consents/carelon/store';
import { canSeeCarelonFlag } from '@/lib/consents/carelon/workflow';
import { detectMarylandMedicaid } from '@/lib/consents/carelon/medicaid';
import { canAccessEligibility, eligibilityResponseFacts } from '@/lib/eligibility/manage';
import { canAccessPriorAuths } from '@/lib/ehr/priorAuths';
import { canReadLedger } from '@/lib/billing/ledger';
import { patientBalances } from '@/lib/billing/patientLedger';
import { canViewCopayRules } from '@/lib/billing/valantBalances';
import { pickCopayRule, providerTypeForRole } from '@/lib/migration/valantCopays';
import { loadAppointmentNoteStatuses } from '@/lib/analytics/visitDocumentationServer';
import { buildAppointmentLocationResolver, effectiveLocation } from '@/lib/locations/effectiveLocation';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { resolveVisitKind } from '@/lib/visits/resolveKind';
import { PROTOCOLS } from '@/lib/visits/protocols';
import {
  ELIGIBILITY_WINDOW_DAYS,
  FO_VISIT_KIND,
  MEDICAID_SAME_MONTH,
  buildItems,
  itemIdFromStep,
  openByPhase,
  readinessOf,
  summarizeDay,
  type FoAuthFact,
  type FoEligibilityFact,
  type FoFacts,
} from './rules';
import type { FoApptStatus, FoItemId, FoMark, FoRow, FrontOfficeDay } from './types';

export type FoViewer = { organizationId: string; userId: string; role: Role | string };

const PROTECTED = 'Protected record';
const MAX_ROWS = 3000;

async function settle<T>(p: Promise<T>, what: string, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error(`[front-office] ${what} skipped`, err instanceof Error ? err.message : 'unknown');
    return fallback;
  }
}

async function appointmentLocations(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const rows = await settle(
    prisma.$queryRaw<{ id: string; loc: string | null }[]>`SELECT "id", "location_id"::text AS "loc" FROM "Appointment" WHERE "id" = ANY(${ids}::text[])`,
    'appointment locations',
    [] as { id: string; loc: string | null }[]
  );
  for (const r of rows) out.set(r.id, r.loc);
  return out;
}

const clientSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  locationId: true,
  legalFirstName: true,
  legalLastName: true,
  needsNameReview: true,
  dateOfBirth: true,
  administrativeSex: true,
  gender: true,
  addressLine1: true,
  addressStatus: true,
  city: true,
  state: true,
  postalCode: true,
  insurancePayer: true,
  insuranceMemberId: true,
  insuranceType: true,
  insuranceEffectiveTo: true,
  medicaidId: true,
  copayAmount: true,
  identityVerifyRequired: true,
  smsConsent: true,
  smsOptOutAt: true,
  sensitiveRecord: { select: { alias: true } },
} satisfies Prisma.ClientSelect;

export type LoadOptions = {
  /** first practice date (default today) */
  date?: string | null;
  /** practice days in the window, 1-7 */
  days?: number;
  /** Location id filter (null = every location) */
  locationId?: string | null;
  /** only this appointment (appointment detail panel) */
  appointmentId?: string | null;
  now?: Date;
};

export async function loadFrontOfficeDay(viewer: FoViewer, opts: LoadOptions = {}): Promise<FrontOfficeDay> {
  const now = opts.now ?? new Date();
  const org = viewer.organizationId;
  const role = String(viewer.role);
  const tz = await getPracticeTimeZone(org);
  const today = practiceToday(tz, now);
  const first = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : today;
  const days = Math.max(1, Math.min(7, Math.floor(opts.days ?? 1)));
  const dates = Array.from({ length: days }, (_, i) => addDaysYmd(first, i));
  const start = practiceDayBounds(first, tz).start;
  const end = practiceDayBounds(dates[dates.length - 1], tz).end;

  // ─── Locations (resolve before the appointment filter) ──────────────────────
  const locations = await prisma.location.findMany({ where: { organizationId: org }, select: { id: true, name: true } });
  const locationId = opts.locationId && locations.some((l) => l.id === opts.locationId) ? opts.locationId : null;

  // ─── Appointments ───────────────────────────────────────────────────────────
  const and: Prisma.AppointmentWhereInput[] = [appointmentOrgWhere(org)];
  if (opts.appointmentId) and.push({ id: opts.appointmentId });
  else and.push({ startsAt: { gte: start, lt: end } });
  const appts = await prisma.appointment.findMany({
    where: { AND: and },
    orderBy: { startsAt: 'asc' },
    take: MAX_ROWS,
    select: {
      id: true,
      clientId: true,
      clientName: true,
      clinicianId: true,
      clinicianName: true,
      type: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      status: true,
      isVirtual: true,
      notes: true,
      confirmedAt: true,
      insurancePayer: true,
      groupSessionId: true,
      clinician: { select: { name: true, role: true } },
      client: { select: clientSelect },
    },
  });

  const resolve = buildAppointmentLocationResolver(locations);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const own = await appointmentLocations(appts.map((a) => a.id));
  const located = appts
    .map((a) => ({ a, loc: effectiveLocation({ appointmentLocation: own.get(a.id) ?? null, clientLocationId: a.client.locationId }, resolve) }))
    .filter(({ loc }) => !locationId || loc.locationId === locationId);
  const rowsIn = located.map((x) => x.a);
  const ids = rowsIn.map((a) => a.id);
  const clientIds = [...new Set(rowsIn.map((a) => a.clientId))];

  const hidden: string[] = [];
  const can = {
    eligibility: canAccessEligibility(role as Role) && canAccessPath(role, '/dashboard/ehr/eligibility'),
    auths: canAccessPriorAuths(role as Role),
    consents: canAccessConsents(role as Role),
    carelon: canSeeCarelonFlag(role),
    copay: canViewCopayRules(role),
    ledger: canReadLedger(role as Role),
    contact: canAccessClientRoster(role),
  };
  for (const [k, v] of Object.entries(can)) if (!v) hidden.push(k);

  const empty = <T,>(v: T) => Promise.resolve(v);
  const sensitiveIds = [...new Set(rowsIn.filter((a) => a.client.sensitiveRecord).map((a) => a.clientId))];
  const pastFrom = new Date(start.getTime() - 400 * 86_400_000);

  const [
    locked,
    facets,
    eligRows,
    authRows,
    worklist,
    carelon,
    invites,
    intakePackets,
    copayRules,
    payments,
    charges,
    balances,
    accounts,
    noShow,
    nextAppts,
    followUps,
    marks,
    noteStatuses,
  ] = await Promise.all([
    sensitiveIds.length
      ? settle(lockedSensitiveClientIds({ organizationId: org, userId: viewer.userId, role, clientIds: sensitiveIds }), 'sensitive access', new Set(sensitiveIds))
      : empty(new Set<string>()),
    settle(appointmentFilterFacets(rowsIn.map((a) => ({ id: a.id, clientId: a.clientId, startsAt: a.startsAt.toISOString() }))), 'facets', new Map()),
    can.eligibility && clientIds.length
      ? settle(
          prisma.eligibilityCheck.findMany({
            where: { organizationId: org, clientId: { in: clientIds }, checkedAt: { gte: pastFrom } },
            orderBy: { checkedAt: 'desc' },
            take: clientIds.length * 6,
            select: { clientId: true, payerName: true, status: true, checkedAt: true, rawRequest: true, rawResponse: true },
          }),
          'eligibility',
          []
        )
      : empty([]),
    can.auths && clientIds.length
      ? settle(
          prisma.priorAuth.findMany({
            where: { organizationId: org, clientId: { in: clientIds }, status: { in: ['APPROVED', 'SUBMITTED', 'EXPIRED'] } },
            select: { clientId: true, payer: true, authNumber: true, status: true, unitsApproved: true, unitsUsed: true, startDate: true, endDate: true },
          }),
          'prior auths',
          []
        )
      : empty([]),
    can.consents && clientIds.length
      ? settle(loadWorklistData({ organizationId: org, userId: viewer.userId, role }, { clientIds, now }), 'consents due', null)
      : empty(null),
    can.carelon && clientIds.length ? settle(carelonNeededForClients(org, clientIds), 'carelon', null) : empty(null),
    clientIds.length
      ? settle(
          prisma.intakeInvite.findMany({
            where: { organizationId: org, clientId: { in: clientIds } },
            orderBy: { createdAt: 'desc' },
            select: { clientId: true, status: true, createdAt: true, completedAt: true, expiresAt: true },
          }),
          'intake invites',
          []
        )
      : empty([]),
    clientIds.length
      ? settle(
          prisma.consentPacket.findMany({
            where: { organizationId: org, clientId: { in: clientIds }, method: 'intake', status: { in: ['SENT', 'SIGNED'] } },
            orderBy: { sentAt: 'desc' },
            select: { clientId: true, status: true, sentAt: true, signedAt: true },
          }),
          'intake packets',
          []
        )
      : empty([]),
    can.copay && clientIds.length
      ? settle(
          prisma.clientCopayRule.findMany({
            where: { organizationId: org, clientId: { in: clientIds } },
            select: { clientId: true, payerName: true, providerType: true, cptRule: true, amountCents: true, source: true, valantLimitCents: true },
          }),
          'copay rules',
          []
        )
      : empty([]),
    can.ledger && clientIds.length
      ? settle(
          prisma.payment.findMany({
            where: { organizationId: org, clientId: { in: clientIds }, paidAt: { gte: start, lt: end }, method: { notIn: ['INSURANCE', 'STUB'] }, amountCents: { gt: 0 } },
            select: { clientId: true, amountCents: true, paidAt: true },
          }),
          'payments',
          []
        )
      : empty([]),
    can.ledger && ids.length
      ? settle(
          prisma.patientCharge.findMany({
            where: { organizationId: org, appointmentId: { in: ids }, status: { in: ['succeeded', 'partially_refunded'] } },
            select: { appointmentId: true, amountCents: true, refundedCents: true },
          }),
          'patient charges',
          []
        )
      : empty([]),
    can.ledger && clientIds.length ? settle(patientBalances(org, clientIds), 'balances', null) : empty(null),
    clientIds.length
      ? settle(prisma.patientAccount.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, status: true } }), 'portal accounts', [])
      : empty([]),
    !opts.appointmentId && first >= today
      ? settle(listNoShowRisk({ id: viewer.userId, role: role as Role, organizationId: org }, { date: first, days, now }), 'no-show risk', null)
      : empty(null),
    clientIds.length
      ? settle(
          prisma.appointment.findMany({
            where: { AND: [appointmentOrgWhere(org), { clientId: { in: clientIds }, startsAt: { gte: start }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } }] },
            orderBy: { startsAt: 'asc' },
            select: { id: true, clientId: true, startsAt: true },
          }),
          'next appointments',
          []
        )
      : empty([]),
    clientIds.length
      ? settle(
          prisma.scribeFollowUp.findMany({ where: { organizationId: org, clientId: { in: clientIds }, kind: 'next_visit', status: 'OPEN' }, select: { clientId: true } }),
          'follow-ups',
          []
        )
      : empty([]),
    ids.length
      ? settle(
          prisma.visitChecklistItem.findMany({
            where: { organizationId: org, appointmentId: { in: ids }, visitKind: FO_VISIT_KIND },
            select: { appointmentId: true, stepId: true, status: true, reason: true, markedById: true, markedAt: true },
          }),
          'checklist marks',
          []
        )
      : empty([]),
    ids.length ? settle(loadAppointmentNoteStatuses(ids), 'note statuses', new Map()) : empty(new Map()),
  ]);

  // ─── Index the facts ────────────────────────────────────────────────────────
  const group = <T extends { clientId: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const eligBy = new Map<string, FoEligibilityFact[]>();
  for (const r of eligRows) {
    const f = eligibilityResponseFacts(r);
    const list = eligBy.get(r.clientId) ?? [];
    list.push({ status: r.status, checkedAt: r.checkedAt, payerName: r.payerName, awaitingResponse: f.awaitingResponse, priorAuthRequired: f.priorAuthRequired, channel: f.channel });
    eligBy.set(r.clientId, list);
  }
  const authBy = group(authRows);
  const consentsDue = new Map<string, { needed: number; expiring: number; titles: string[] }>();
  if (worklist) {
    for (const r of worklist.rows) {
      if (!r.required || r.standard === 'complete') continue;
      const e = consentsDue.get(r.clientId) ?? { needed: 0, expiring: 0, titles: [] };
      if (r.standard === 'expiring') e.expiring += 1;
      else {
        e.needed += 1;
        if (e.titles.length < 5) e.titles.push(r.title);
      }
      consentsDue.set(r.clientId, e);
    }
  }
  const inviteBy = group(invites);
  const packetBy = group(intakePackets);
  const rulesBy = group(copayRules);
  const paidBy = new Map<string, { date: string; cents: number }[]>();
  for (const p of payments) {
    const list = paidBy.get(p.clientId) ?? [];
    list.push({ date: toPracticeWallTime(p.paidAt, tz).date, cents: p.amountCents });
    paidBy.set(p.clientId, list);
  }
  const chargeBy = new Map<string, number>();
  for (const c of charges) if (c.appointmentId) chargeBy.set(c.appointmentId, (chargeBy.get(c.appointmentId) ?? 0) + c.amountCents - c.refundedCents);
  const portalBy = new Map(accounts.map((a) => [a.clientId ?? '', a.status]));
  const riskItems: NoShowRiskItem[] = (noShow as { items: NoShowRiskItem[] } | null)?.items ?? [];
  const riskBy = new Map<string, NoShowRiskItem>(riskItems.map((i) => [i.appointmentId, i]));
  const nextBy = group(nextAppts);
  const followUpClients = new Set(followUps.map((f) => f.clientId));
  const markers = [...new Set(marks.map((m) => m.markedById))];
  const markerNames = new Map(
    markers.length ? (await settle(prisma.user.findMany({ where: { id: { in: markers } }, select: { id: true, name: true, email: true } }), 'marker names', [])).map((u) => [u.id, u.name?.trim() || u.email]) : []
  );
  const marksBy = new Map<string, Map<FoItemId, FoMark>>();
  for (const m of marks) {
    const id = itemIdFromStep(m.stepId);
    if (!id || !m.appointmentId) continue;
    const map = marksBy.get(m.appointmentId) ?? new Map<FoItemId, FoMark>();
    map.set(id, { status: m.status as FoMark['status'], reason: m.reason, byName: markerNames.get(m.markedById) ?? null, at: m.markedAt.toISOString() });
    marksBy.set(m.appointmentId, map);
  }

  // ─── Rows ───────────────────────────────────────────────────────────────────
  const rows: FoRow[] = [];
  for (const { a, loc } of located) {
    const c = a.client;
    const isLocked = locked.has(a.clientId);
    const facet = facets.get(a.id);
    const payer = facet?.payer ?? (a.insurancePayer?.trim() || c.insurancePayer?.trim() || null);
    const visitDate = toPracticeWallTime(a.startsAt, tz).date;
    const medicaid = detectMarylandMedicaid(
      { medicaidId: c.medicaidId, insuranceType: c.insuranceType, insurancePayer: payer, insuranceMemberId: c.insuranceMemberId, insuranceEffectiveTo: c.insuranceEffectiveTo, coverages: [] },
      { now }
    ).medicaid;
    const kind = resolveVisitKind({ appointmentType: a.type, notes: a.notes, isGroup: Boolean(a.groupSessionId), clinicianRole: a.clinician?.role ?? null });
    const meta = a.isVirtual ? parseTelehealthMeta(a.notes) : null;
    const joinUrl = a.isVirtual && meta ? clientTelehealthJoinUrl({ appointmentId: a.id, clientId: a.clientId, endsAt: a.endsAt, meta }) : null;

    // Copay: client copay rules (most specific), else the chart copay amount
    let copay: FoFacts['copay'];
    if (can.copay) {
      const pick = pickCopayRule(rulesBy.get(a.clientId) ?? [], { payerName: payer, providerType: providerTypeForRole(a.clinician?.role ?? null) });
      if (pick.ok) copay = { expectedCents: pick.amountCents, source: pick.rule.source === 'valant' ? 'copay rule from Valant' : 'copay rule', note: null };
      else if (c.copayAmount != null && Number(c.copayAmount) > 0) copay = { expectedCents: Math.round(Number(c.copayAmount) * 100), source: 'chart copay amount', note: null };
      else copay = { expectedCents: null, source: null, note: pick.reason === 'payer-unknown' ? 'Copay rules exist for several payers: set the visit payer' : 'No copay rule for this payer' };
    }
    const paidToday = (paidBy.get(a.clientId) ?? []).filter((p) => p.date === visitDate).reduce((t, p) => t + p.cents, 0);
    const collectedCents = paidToday + (chargeBy.get(a.id) ?? 0);

    const latestInvite = inviteBy.get(a.clientId)?.[0];
    const latestPacket = packetBy.get(a.clientId)?.[0];
    let intake: FoFacts['intake'] = { status: 'none', sentAt: null, completedAt: null };
    if (latestPacket?.status === 'SIGNED' || latestInvite?.status === 'COMPLETED') {
      intake = { status: 'completed', sentAt: latestPacket?.sentAt ?? latestInvite?.createdAt ?? null, completedAt: latestPacket?.signedAt ?? latestInvite?.completedAt ?? null };
    } else if (latestInvite?.status === 'PENDING' && latestInvite.expiresAt.getTime() > now.getTime()) {
      intake = { status: 'pending', sentAt: latestInvite.createdAt, completedAt: null };
    } else if (latestPacket?.status === 'SENT') {
      intake = { status: 'pending', sentAt: latestPacket.sentAt, completedAt: null };
    } else if (latestInvite) {
      intake = { status: 'expired', sentAt: latestInvite.createdAt, completedAt: null };
    }

    const next = (nextBy.get(a.clientId) ?? []).find((n) => n.id !== a.id && n.startsAt.getTime() > a.startsAt.getTime());
    const risk = riskBy.get(a.id);
    const phone = can.contact && !isLocked ? c.phone?.trim() || null : null;
    const status = a.status as AppointmentStatus as FoApptStatus;
    const facts: FoFacts = {
      now,
      visitDate,
      today,
      appointment: {
        id: a.id,
        clientId: a.clientId,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status,
        isVirtual: a.isVirtual,
        confirmedAt: a.confirmedAt,
        payer,
        isNewClient: Boolean(facet?.isNewClient),
        hasJoinLink: Boolean(joinUrl),
        authorizedProgram: kind.kind === 'prp' || /\bprp\b|psychiatric rehab/i.test(a.type),
      },
      client: {
        ...c,
        insurancePayer: c.insurancePayer,
        identityVerifyRequired: c.identityVerifyRequired,
        smsConsent: c.smsConsent,
        smsOptedOut: Boolean(c.smsOptOutAt),
        hasEmail: Boolean(c.email?.trim()),
        medicaid,
      },
      eligibility: can.eligibility ? eligBy.get(a.clientId) ?? [] : undefined,
      auths: can.auths ? ((authBy.get(a.clientId) ?? []) as FoAuthFact[]) : undefined,
      consents: worklist ? consentsDue.get(a.clientId) ?? null : undefined,
      intake,
      carelonNeeded: carelon ? carelon.has(a.clientId) : undefined,
      copay,
      collected: can.ledger ? { cents: collectedCents, count: 0 } : undefined,
      balanceCents: balances ? balances.get(a.clientId)?.balanceCents ?? 0 : undefined,
      portal: portalBy.has(a.clientId) ? (portalBy.get(a.clientId) === 'ACTIVE' ? 'active' : portalBy.get(a.clientId) === 'INVITED' ? 'invited' : 'none') : 'none',
      noShow: risk ? { level: risk.level, score: risk.score, reasons: risk.reasons } : null,
      nextAppointmentAt: next?.startsAt ?? null,
      followUpRequested: followUpClients.has(a.clientId),
      followUpDays: PROTOCOLS[kind.kind]?.followUpDays ?? null,
      marks: marksBy.get(a.id) ?? new Map(),
      phone,
      settings: { eligibilityWindowDays: ELIGIBILITY_WINDOW_DAYS, medicaidSameMonth: MEDICAID_SAME_MONTH },
    };
    const items = buildItems(facts);
    const noteStatus = noteStatuses.get(a.id);
    const wall = (d: Date) => toPracticeWallTime(d, tz).time;
    rows.push({
      appointmentId: a.id,
      clientId: a.clientId,
      clientName: isLocked ? c.sensitiveRecord?.alias || PROTECTED : a.clientName?.trim() || c.name,
      locked: isLocked,
      clinicianName: a.clinicianName?.trim() || a.clinician?.name || null,
      type: a.type,
      date: visitDate,
      startTime: wall(a.startsAt),
      endTime: wall(a.endsAt),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      status,
      isVirtual: a.isVirtual,
      isNewClient: Boolean(facet?.isNewClient),
      payer,
      locationId: loc.locationId,
      locationName: loc.locationId ? locName.get(loc.locationId) ?? null : null,
      phone,
      items,
      readiness: readinessOf(status, items),
      open: openByPhase(items),
      copay: copay ? { expectedCents: copay.expectedCents, collectedCents, markedCollected: marksBy.get(a.id)?.get('copay')?.status === 'done' } : null,
      noteSigned: noteStatus ? noteStatus === 'SIGNED' : null,
    });
  }

  const summaries = (opts.appointmentId ? [] : dates).map((d) => summarizeDay(d, rows, can.ledger && can.copay && d <= today, now));
  return {
    timeZone: tz,
    today,
    dates,
    locationId,
    rows,
    summaries,
    rules: { eligibilityWindowDays: ELIGIBILITY_WINDOW_DAYS, medicaidSameMonth: MEDICAID_SAME_MONTH },
    hidden,
  };
}

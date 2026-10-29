/**
 * Planned billing codes: database access and the booking defaults (server only).
 * Rules live in ./plannedCodes.ts. Tables: appointment_planned_codes, appointment_billing_plans
 * (prisma/migrations/20261027_appointment_planned_codes.sql). Claim building never reads them.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { caseloadAllows } from '@/lib/clients/caseloadAccess';
import { loadFeeSchedule } from '@/lib/billing/feeScheduleDb';
import { visitContext, type FeeItem } from '@/lib/billing/feeSchedule';
import { loadPayerMappings } from '@/lib/billing/waystarConfig';
import { findPayerMapping, payerPolicyDefaults } from '@/lib/billing/waystarSftpClaims';
import { resolveLicenseLevel } from '@/lib/ehr/therapy/rules';
import { CPT_CODES } from '@/lib/constants/cpt';
import {
  EMPTY_PLAN,
  autoPlaceOfService,
  defaultCodeForType,
  isValidCode,
  normalizeCode,
  plannedCharge,
  telehealthModifierFor,
  type PlannedLine,
  type PlannedPlan,
  type PlannedPrice,
} from '@/lib/appointments/plannedCodes';

type Actor = { id: string; role: Role; organizationId: string };

// ─── Load / save ─────────────────────────────────────────────────────────────

/** Plans for many appointments (list / calendar). Empty map when the tables are missing. */
export async function loadPlannedPlans(organizationId: string, appointmentIds: string[]): Promise<Map<string, PlannedPlan>> {
  const out = new Map<string, PlannedPlan>();
  if (!appointmentIds.length) return out;
  try {
    const [lines, plans] = await Promise.all([
      prisma.appointmentPlannedCode.findMany({
        where: { organizationId, appointmentId: { in: appointmentIds } },
        orderBy: [{ appointmentId: 'asc' }, { sequence: 'asc' }],
      }),
      prisma.appointmentBillingPlan.findMany({ where: { organizationId, appointmentId: { in: appointmentIds } } }),
    ]);
    const get = (id: string) => {
      let p = out.get(id);
      if (!p) {
        p = { ...EMPTY_PLAN, lines: [] };
        out.set(id, p);
      }
      return p;
    };
    for (const l of lines) {
      get(l.appointmentId).lines.push({
        code: l.code,
        units: l.units,
        modifiers: l.modifiers,
        chargeCents: l.chargeCents,
        overrideReason: l.overrideReason,
        isAddOn: l.isAddOn,
      });
    }
    for (const p of plans) {
      Object.assign(get(p.appointmentId), {
        placeOfService: p.placeOfService,
        supervisingProviderId: p.supervisingProviderId,
        discountCents: p.discountCents,
        discountNote: p.discountNote,
      });
    }
  } catch (err) {
    console.warn('[plannedCodes] unavailable:', err instanceof Error ? err.message : err);
  }
  return out;
}

export async function loadPlannedPlan(organizationId: string, appointmentId: string): Promise<PlannedPlan | null> {
  return (await loadPlannedPlans(organizationId, [appointmentId])).get(appointmentId) ?? null;
}

/** Replace the plan (lines + appointment-level fields) in one transaction. */
export async function savePlannedPlan(organizationId: string, appointmentId: string, actorUserId: string, plan: PlannedPlan): Promise<void> {
  await prisma.$transaction([
    prisma.appointmentPlannedCode.deleteMany({ where: { organizationId, appointmentId } }),
    ...(plan.lines.length
      ? [
          prisma.appointmentPlannedCode.createMany({
            data: plan.lines.map((l: PlannedLine, i) => ({
              organizationId,
              appointmentId,
              sequence: i,
              code: l.code,
              units: l.units,
              modifiers: l.modifiers,
              chargeCents: l.chargeCents,
              overrideReason: l.overrideReason,
              isAddOn: l.isAddOn,
              createdById: actorUserId,
              updatedById: actorUserId,
            })),
          }),
        ]
      : []),
    prisma.appointmentBillingPlan.upsert({
      where: { appointmentId },
      create: {
        appointmentId,
        organizationId,
        placeOfService: plan.placeOfService,
        supervisingProviderId: plan.supervisingProviderId,
        discountCents: plan.discountCents,
        discountNote: plan.discountNote,
        updatedById: actorUserId,
      },
      update: {
        placeOfService: plan.placeOfService,
        supervisingProviderId: plan.supervisingProviderId,
        discountCents: plan.discountCents,
        discountNote: plan.discountNote,
        updatedById: actorUserId,
      },
    }),
  ]);
}

// ─── Access ───────────────────────────────────────────────────────────────────

const apptSelect = {
  id: true,
  clientId: true,
  clinicianId: true,
  type: true,
  startsAt: true,
  isVirtual: true,
  audioOnly: true,
  patientLocationType: true,
  groupSessionId: true,
  locationId: true,
  client: { select: { id: true, assignedToId: true } },
} as const;

export type CodesAppointment = {
  id: string;
  clientId: string;
  clinicianId: string | null;
  type: string;
  startsAt: Date;
  isVirtual: boolean;
  audioOnly: boolean;
  patientLocationType: string | null;
  groupSessionId: string | null;
  locationId: string | null;
};

/** Same access rule as editing the appointment: the visit's own clinician, or the client's care team (org scoped). */
export async function appointmentForCodes(actor: Actor, appointmentId: string): Promise<{ ok: true; appointment: CodesAppointment } | { ok: false; status: number; error: string }> {
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, AND: [appointmentOrgWhere(actor.organizationId)] }, select: apptSelect });
  if (!a) return { ok: false, status: 404, error: 'Appointment not found' };
  if (a.clinicianId !== actor.id && !(await caseloadAllows({ organizationId: actor.organizationId, userId: actor.id, role: actor.role }, a.client))) {
    return { ok: false, status: 403, error: 'Not your patient' };
  }
  const { client: _client, ...rest } = a;
  void _client;
  return { ok: true, appointment: rest };
}

// ─── Defaults / quote ─────────────────────────────────────────────────────────

export type CodeVisitInput = {
  clientId: string | null;
  clinicianId: string | null;
  type: string | null;
  isVirtual: boolean;
  audioOnly: boolean;
  patientLocationType?: string | null;
  serviceDate?: Date | string | null;
  groupSessionId?: string | null;
  locationId?: string | null;
};

export type SupervisionInfo = {
  /** Rendering clinician is pre-licensed (HR license level / supervision track / credential) */
  preLicensed: boolean;
  supervisorId: string | null;
  supervisorName: string | null;
  /** Payer rule for supervisee claims (render_as_supervisor | supervisee_with_2310D | not_allowed) */
  payerPolicy: string | null;
  message: string | null;
};

export type CodeContext = {
  defaultPrimary: string | null;
  defaultSource: 'appointment_type' | 'group' | null;
  telehealthModifiers: string[];
  telehealthNote: string | null;
  autoPlaceOfService: string;
  payerName: string | null;
  payerMapped: boolean;
  visit: { telehealth: boolean; selfPay: boolean; child: boolean };
  supervision: SupervisionInfo;
  facility: { id: string | null; name: string | null };
};

async function servicesFor(organizationId: string) {
  const sched = await prisma.schedulingSettings.findUnique({ where: { organizationId }, select: { servicesJson: true } }).catch(() => null);
  return Array.isArray(sched?.servicesJson) ? (sched!.servicesJson as { id?: string; title?: string; defaultCpt?: string }[]) : [];
}

async function groupCode(organizationId: string, groupSessionId: string | null | undefined): Promise<string | null> {
  if (!groupSessionId) return null;
  const s = await prisma.clinicalGroupSession
    .findFirst({ where: { id: groupSessionId, organizationId }, select: { group: { select: { billingCode: true, billingMode: true } } } })
    .catch(() => null);
  if (!s || s.group.billingMode === 'attendance_only') return null;
  const code = normalizeCode(s.group.billingCode);
  return code && isValidCode(code) ? code : null;
}

async function supervisionFor(organizationId: string, clinicianId: string | null, payerPolicy: string | null): Promise<SupervisionInfo> {
  const none: SupervisionInfo = { preLicensed: false, supervisorId: null, supervisorName: null, payerPolicy, message: null };
  if (!clinicianId) return none;
  const user = await prisma.user
    .findFirst({
      where: { id: clinicianId, organizationId },
      select: {
        licenseLevel: true,
        staffCredentials: { where: { credentialType: { in: ['LICENSE', 'CERTIFICATION', 'SUPERVISION'] }, status: { not: 'EXPIRED' } }, select: { title: true } },
      },
    })
    .catch(() => null);
  if (!user) return none;
  const track = await prisma.supervisionTrack
    .findFirst({ where: { organizationId, superviseeId: clinicianId }, select: { supervisorId: true, supervisor: { select: { name: true } } } })
    .catch(() => null);
  const level = resolveLicenseLevel({
    explicit: user.licenseLevel,
    credentialTitles: user.staffCredentials.map((c) => c.title),
    onSupervisionTrack: Boolean(track),
  }).level;
  if (level !== 'PRE_LICENSED') return none;
  const message =
    payerPolicy === 'not_allowed'
      ? 'This payer does not accept claims rendered by a pre-licensed clinician.'
      : !track
        ? 'Pre-licensed clinician with no supervisor on a supervision track (HR > Supervision).'
        : payerPolicy === 'render_as_supervisor'
          ? 'Payer bills the supervisor as rendering provider.'
          : 'Supervisor goes on the claim as supervising provider (2310D).';
  return { preLicensed: true, supervisorId: track?.supervisorId ?? null, supervisorName: track?.supervisor?.name ?? null, payerPolicy, message };
}

async function facilityFor(locationId: string | null | undefined) {
  if (!locationId) return { id: null, name: null };
  const rows = await prisma
    .$queryRaw<{ name: string }[]>`SELECT name FROM practice_locations WHERE id = ${locationId} LIMIT 1`
    .catch(() => [] as { name: string }[]);
  return { id: locationId, name: rows[0]?.name ?? null };
}

/** Booking defaults: type / group code, telehealth modifier (payer rule), POS, supervision, fee context. */
export async function codeContext(organizationId: string, input: CodeVisitInput): Promise<{ context: CodeContext; items: FeeItem[] }> {
  const client = input.clientId
    ? await prisma.client
        .findFirst({ where: { id: input.clientId, organizationId }, select: { dateOfBirth: true, insurancePayer: true, insuranceEffectiveTo: true } })
        .catch(() => null)
    : null;
  const [services, group, mappings, items, facility] = await Promise.all([
    servicesFor(organizationId),
    groupCode(organizationId, input.groupSessionId),
    loadPayerMappings(organizationId).catch(() => []),
    loadFeeSchedule(organizationId, { activeOnly: true }),
    facilityFor(input.locationId),
  ]);
  const payerName = client?.insurancePayer?.trim() || null;
  const mapping = payerName ? findPayerMapping(mappings, payerName) : null;
  const policies = payerPolicyDefaults(mapping?.claimFilingCode);
  const tele = telehealthModifierFor(
    { isVirtual: input.isVirtual, audioOnly: input.audioOnly },
    mapping
      ? {
          payerName: mapping.payerName,
          telehealthModifier: mapping.telehealthModifier,
          audioOnlyModifier: (mapping.audioOnlyModifier as string | null | undefined) || policies.audioOnlyModifier,
        }
      : null
  );
  const typeCode = defaultCodeForType(services, input.type);
  const visit = visitContext(client ?? {}, { serviceDate: input.serviceDate ?? null, telehealth: input.isVirtual || input.audioOnly });
  const supervision = await supervisionFor(
    organizationId,
    input.clinicianId,
    mapping ? String(mapping.superviseeClaims || policies.superviseeClaims) : payerName ? policies.superviseeClaims : null
  );
  return {
    items,
    context: {
      defaultPrimary: group ?? typeCode,
      defaultSource: group ? 'group' : typeCode ? 'appointment_type' : null,
      telehealthModifiers: tele.modifiers,
      telehealthNote: tele.note,
      autoPlaceOfService: autoPlaceOfService({ isVirtual: input.isVirtual, audioOnly: input.audioOnly, patientLocationType: input.patientLocationType }),
      payerName,
      payerMapped: Boolean(mapping),
      visit,
      supervision,
      facility,
    },
  };
}

/** Fee schedule charge per line (null = no fee set). */
export function priceLines(items: FeeItem[], visit: CodeContext['visit'], lines: { code: string; units?: number; modifiers?: string[] }[]): PlannedPrice[] {
  return lines.map((l) => plannedCharge(items, { code: l.code, units: l.units ?? 1, modifiers: l.modifiers }, visit));
}

/** Code pick list: built-in codes + fee schedule base codes, with whether a fee is set (no amounts invented). */
export function codeOptions(items: FeeItem[]): { code: string; description: string; hasFee: boolean }[] {
  const fee = new Map<string, string>();
  for (const i of items) if (i.active && i.baseCpt && !fee.has(i.baseCpt)) fee.set(i.baseCpt, i.description);
  const out = new Map<string, { code: string; description: string; hasFee: boolean }>();
  for (const c of CPT_CODES) out.set(c.code, { code: c.code, description: c.desc, hasFee: fee.has(c.code) });
  for (const [code, description] of fee) if (!out.has(code)) out.set(code, { code, description, hasFee: true });
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

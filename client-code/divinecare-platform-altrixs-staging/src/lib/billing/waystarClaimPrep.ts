import 'server-only';

/**
 * Loads everything the Waystar 837P mapper needs for a set of claims and runs
 * the pre-send checks: billing providers (2010AA), Waystar payer mapping, the
 * client's coverages (subscriber != patient, secondary/tertiary), prior auths,
 * earlier payers' 835 adjudication (COB), the signed note (date of service,
 * rendering clinician, minutes, audio-only, co-signature), the clinician's legal
 * name / taxonomy / supervision (pre-licensed -> supervisor), practice taxonomy,
 * the client's service location (2310C) and codes billed the same day by the same
 * provider (NCCI / per-day caps). Earlier payers' adjudication is read from their
 * posted 835s (era_claim_payments); staff-entered COB is the fallback. Also makes
 * sure each claim has a <= 20-char CLM01 control number.
 *
 * Send path usage (waystarSftpSubmit.ts):
 *   const rows = await prisma.claim.findMany({ where, include: waystarClaimInclude });
 *   const mapped = await prepareClaimsForWaystar(actor.organizationId, rows, { usageIndicator, groupNpi });
 *   mapped.get(row.id)  // MapResult: { ok, claim, warnings } | { ok: false, errors }
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ensureClaimControlNumbers, previousPayerAdjudication } from './claims';
import { loadBillingProviders, loadPayerMappings } from './waystarConfig';
import {
  claimToBatchClaim,
  type BillingProviderConfig,
  type ClaimForMapping,
  type CobAdjudication,
  type MapperContext,
  type MapResult,
  type NoteForMapping,
  type PayerMappingConfig,
  type StaffForClaim,
} from './waystarSftpClaims';
import { notePracticeDate } from './claimRules';
import { planPendingClaimWarning, resolveLicenseLevel } from '@/lib/ehr/therapy/rules';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

const noteSelect = {
  id: true,
  clinicianId: true,
  dateOfService: true,
  durationMinutes: true,
  psychotherapyMinutes: true,
  cptCode: true,
  telehealth: true,
  audioOnly: true,
  appointmentId: true,
  workflow: true,
} satisfies Prisma.ProgressNoteSelect;

export const waystarClaimInclude = {
  client: true,
  progressNote: { select: noteSelect },
  appointment: { include: { clinician: { select: { name: true, npi: true } } } },
  serviceLines: true,
} satisfies Prisma.ClaimInclude;

export type WaystarLoadedClaim = Prisma.ClaimGetPayload<{ include: typeof waystarClaimInclude }>;
type LoadedNote = NonNullable<WaystarLoadedClaim['progressNote']>;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Tables from the 20261016 migration may be missing on a server that has not run it: fall back to the env/manual behavior. */
async function optional<T>(load: () => Promise<T>, what: string): Promise<T | undefined> {
  try {
    return await load();
  } catch (err) {
    console.warn(`[waystar-prep] ${what} unavailable:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

type PreviousClaim = {
  id: string;
  payerResponsibility: string;
  primaryClaimId: string | null;
  submissionData: unknown;
  note: LoadedNote | null;
};

function noteForMapping(n: LoadedNote | null | undefined): NoteForMapping | null {
  if (!n) return null;
  return {
    id: n.id,
    clinicianId: n.clinicianId,
    dateOfService: n.dateOfService,
    cptCode: n.cptCode,
    appointmentId: n.appointmentId,
    durationMinutes: n.durationMinutes,
    psychotherapyMinutes: n.psychotherapyMinutes,
    telehealth: n.telehealth,
    audioOnly: n.audioOnly,
    workflow: n.workflow ? { status: n.workflow.status, cosignRequired: n.workflow.cosignRequired, cosignedAt: n.workflow.cosignedAt } : null,
  };
}

const staffSelect = {
  id: true,
  npi: true,
  role: true,
  legalFirstName: true,
  legalLastName: true,
  taxonomyCode: true,
  licenseLevel: true,
  staffCredentials: {
    where: { credentialType: { in: ['LICENSE', 'CERTIFICATION', 'SUPERVISION'] }, status: { not: 'EXPIRED' } },
    select: { title: true },
  },
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

/** Staff as billed: legal name, NPI, taxonomy, pre-licensed (HR license rules) and supervisor. */
async function loadStaff(organizationId: string, where: { ids: string[]; npis: string[] }) {
  const byId = new Map<string, StaffForClaim>();
  const byNpi = new Map<string, StaffForClaim>();
  const roleById = new Map<string, string>();
  if (!where.ids.length && !where.npis.length) return { byId, byNpi, roleById };
  const users: StaffRow[] = await prisma.user.findMany({
    where: { organizationId, OR: [{ id: { in: where.ids } }, { npi: { in: where.npis } }] },
    select: staffSelect,
  });
  const tracks = await prisma.supervisionTrack
    .findMany({ where: { organizationId, superviseeId: { in: users.map((u) => u.id) } }, select: { superviseeId: true, supervisor: { select: staffSelect } } })
    .catch(() => [] as Array<{ superviseeId: string; supervisor: StaffRow }>);
  const trackBy = new Map(tracks.map((t) => [t.superviseeId, t.supervisor]));
  const toStaff = (u: StaffRow, withSupervisor: boolean): StaffForClaim => {
    const sup = trackBy.get(u.id);
    const level = resolveLicenseLevel({
      explicit: u.licenseLevel,
      credentialTitles: u.staffCredentials.map((c) => c.title),
      onSupervisionTrack: Boolean(sup),
    }).level;
    return {
      userId: u.id,
      npi: u.npi,
      legalFirstName: u.legalFirstName,
      legalLastName: u.legalLastName,
      taxonomyCode: u.taxonomyCode,
      preLicensed: level === 'PRE_LICENSED',
      supervisor: withSupervisor && sup ? toStaff(sup, false) : null,
    };
  };
  for (const u of users) {
    const s = toStaff(u, true);
    byId.set(u.id, s);
    if (u.npi) byNpi.set(u.npi, s);
    roleById.set(u.id, u.role as string);
  }
  return { byId, byNpi, roleById };
}

export async function prepareClaimsForWaystar(
  organizationId: string,
  rows: WaystarLoadedClaim[],
  base: Pick<MapperContext, 'usageIndicator' | 'timeZone' | 'groupNpi' | 'today'> = {}
): Promise<Map<string, MapResult>> {
  const out = new Map<string, MapResult>();
  if (!rows.length) return out;

  // CLM01: the DB default assigns one; this covers rows created before the migration's default
  const missing = rows.filter((r) => !r.claimControlNumber).map((r) => r.id);
  const assigned = missing.length ? await optional(() => ensureClaimControlNumbers(missing), 'claim control numbers') : undefined;

  const clientIds = Array.from(new Set(rows.map((r) => r.clientId)));
  const [providers, mappings, coverages, auths, settings, timeZone] = await Promise.all([
    optional<BillingProviderConfig[]>(() => loadBillingProviders(organizationId), 'billing providers'),
    optional<PayerMappingConfig[]>(() => loadPayerMappings(organizationId), 'payer mappings'),
    optional(() => prisma.clientInsuranceCoverage.findMany({ where: { organizationId, clientId: { in: clientIds } } }), 'coverages'),
    prisma.priorAuth.findMany({ where: { organizationId, clientId: { in: clientIds }, status: 'APPROVED' } }),
    optional(() => prisma.practiceSettings.findUnique({ where: { organizationId }, select: { taxonomyCodes: true, prpBillingModel: true } }), 'practice settings'),
    base.timeZone ? Promise.resolve(base.timeZone) : getPracticeTimeZone(organizationId),
  ]);

  // Previous payers' claims (two levels: tertiary -> secondary -> primary): COB, and the signed note of a secondary claim
  const previous = new Map<string, PreviousClaim>();
  let want = Array.from(new Set(rows.map((r) => r.primaryClaimId).filter((x): x is string => Boolean(x))));
  for (let depth = 0; depth < 2 && want.length; depth++) {
    const found = await prisma.claim.findMany({
      where: { id: { in: want }, organizationId },
      select: { id: true, payerResponsibility: true, primaryClaimId: true, submissionData: true, progressNote: { select: noteSelect } },
    });
    for (const p of found) {
      previous.set(p.id, { id: p.id, payerResponsibility: p.payerResponsibility, primaryClaimId: p.primaryClaimId, submissionData: p.submissionData, note: p.progressNote });
    }
    want = found.map((p) => p.primaryClaimId).filter((x): x is string => Boolean(x) && !previous.has(x as string));
  }
  const chainOf = (row: WaystarLoadedClaim) => {
    const chain: PreviousClaim[] = [];
    for (let id = row.primaryClaimId, guard = 0; id && guard < 3; guard++) {
      const p = previous.get(id);
      if (!p) break;
      chain.push(p);
      id = p.primaryClaimId;
    }
    return chain;
  };
  const noteOf = (row: WaystarLoadedClaim): LoadedNote | null => row.progressNote ?? chainOf(row).at(-1)?.note ?? null;

  // Rendering clinicians: the note's clinician, plus NPIs picked in the claim editor
  const clinicianIds = Array.from(new Set(rows.map((r) => noteOf(r)?.clinicianId).filter((x): x is string => Boolean(x))));
  const renderingNpis = Array.from(new Set(rows.map((r) => str(r.renderingNpi)).filter((n) => /^\d{10}$/.test(n))));
  const staff = await loadStaff(organizationId, { ids: clinicianIds, npis: renderingNpis });
  const providersByNpi = Object.fromEntries(staff.byNpi);

  // Client service locations (2310C) and location keys (billing provider choice)
  const locationIds = Array.from(new Set(rows.map((r) => r.client.locationId).filter((x): x is string => Boolean(x))));
  const locations = locationIds.length
    ? await prisma.location.findMany({
        where: { id: { in: locationIds }, organizationId },
        select: { id: true, code: true, name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, npi: true, npiVerified: true },
      })
    : [];
  const locationById = new Map(locations.map((l) => [l.id, l]));

  // Codes billed for the same client by the same clinician on the same date (other claims)
  const notesInBatch = rows.map((r) => noteOf(r)).filter((n): n is LoadedNote => Boolean(n?.dateOfService && n.clinicianId));
  const sameDayRows = notesInBatch.length
    ? await prisma.claim.findMany({
        where: {
          organizationId,
          clientId: { in: clientIds },
          payerResponsibility: 'P',
          frequencyCode: { not: '8' },
          status: { not: 'DENIED' },
          progressNote: {
            clinicianId: { in: Array.from(new Set(notesInBatch.map((n) => n.clinicianId!))) },
            dateOfService: { in: Array.from(new Set(notesInBatch.map((n) => n.dateOfService!.toISOString()))).map((d) => new Date(d)) },
          },
        },
        select: { id: true, clientId: true, cptCode: true, serviceLines: { select: { cptCode: true } }, progressNote: { select: { clinicianId: true, dateOfService: true } } },
      })
    : [];

  const practiceTaxonomy = settings?.taxonomyCodes?.[0] ?? null;

  for (const row of rows) {
    const chain = chainOf(row);
    const priorAdjudications: Partial<Record<'P' | 'S', CobAdjudication | null>> = {};
    const lineCpts = row.serviceLines.length
      ? [...row.serviceLines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((l) => l.cptCode.split('-')[0])
      : [row.cptCode.split('-')[0]];
    for (const p of chain) {
      const rank = p.payerResponsibility as 'P' | 'S';
      if (rank !== 'P' && rank !== 'S') continue;
      const psd = obj(p.submissionData);
      priorAdjudications[rank] = await previousPayerAdjudication(p.id, lineCpts, {
        payerId: str(psd.payerId) || null,
        claimFilingCode: str(psd.claimFilingCode) || null,
      });
    }
    const note = noteOf(row);
    const noteStatus = note?.workflow?.status ?? null;
    const rendering = note?.clinicianId ? staff.byId.get(note.clinicianId) ?? null : null;
    // A secondary claim bills the same service as its primary: skip the chain's own codes
    const chainIds = new Set([row.id, ...chain.map((p) => p.id)]);
    const dos = notePracticeDate(note?.dateOfService);
    const sameDayCodes = sameDayRows
      .filter(
        (c) =>
          !chainIds.has(c.id) &&
          c.clientId === row.clientId &&
          c.progressNote?.clinicianId === note?.clinicianId &&
          notePracticeDate(c.progressNote?.dateOfService) === dos
      )
      .flatMap((c) => (c.serviceLines.length ? c.serviceLines.map((l) => l.cptCode) : [c.cptCode]));
    const loc = row.client.locationId ? locationById.get(row.client.locationId) : undefined;
    const editorStaff = str(row.renderingNpi) ? staff.byNpi.get(str(row.renderingNpi)) : undefined;

    const input: ClaimForMapping = {
      ...row,
      claimControlNumber: row.claimControlNumber ?? assigned?.get(row.id) ?? null,
      noteStatus,
      noteTelehealth: note?.telehealth ?? null,
      note: noteForMapping(note),
      renderingClinician: rendering,
      appointment: row.appointment
        ? {
            id: row.appointment.id,
            startsAt: row.appointment.startsAt,
            clinicianId: row.appointment.clinicianId,
            isVirtual: row.appointment.isVirtual,
            audioOnly: row.appointment.audioOnly,
            clinician: row.appointment.clinician ?? null,
          }
        : null,
    };
    const ctx: MapperContext = {
      ...base,
      timeZone,
      providersByNpi,
      billingTaxonomy: practiceTaxonomy,
      billingProviders: providers?.length ? providers : undefined,
      clinicianRole: (editorStaff?.userId ? staff.roleById.get(editorStaff.userId) : note?.clinicianId ? staff.roleById.get(note.clinicianId) : null) ?? null,
      locationKeys: loc ? [loc.id, loc.code, loc.name].filter((x): x is string => Boolean(x)) : [],
      serviceLocation: loc
        ? { name: loc.name, addressLine1: loc.addressLine1, addressLine2: loc.addressLine2, city: loc.city, state: loc.state, postalCode: loc.postalCode, npi: loc.npi, npiVerified: loc.npiVerified }
        : null,
      sameDayCodes,
      prpBillingModel: settings?.prpBillingModel ?? null,
      payerMappings: mappings,
      coverages: (coverages ?? [])
        .filter((c) => c.clientId === row.clientId)
        .map((c) => ({ ...c, rank: c.rank as 'P' | 'S' | 'T' })),
      priorAuths: auths.filter((a) => a.clientId === row.clientId),
      priorAdjudications,
    };
    const mapped = claimToBatchClaim(input, ctx);
    // Note signed under the go-live transition without an active plan: a warning, never a block
    const planPending = planPendingClaimWarning(note?.workflow);
    if (planPending) {
      if (mapped.ok) mapped.warnings.push(planPending);
      else mapped.warnings = [...(mapped.warnings ?? []), planPending];
    }
    out.set(row.id, mapped);
  }
  return out;
}

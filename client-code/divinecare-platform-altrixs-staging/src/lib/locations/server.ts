import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { locationsRoleAllowed } from './roleGate';
import {
  buildFacilityResolver,
  normFacility,
  suggestMissingMappings,
  type FacilityKind,
  type LocationLite,
} from './facilityMapping';
import { locationsOf, mappingsOf } from './overviewServer';
export { loadPracticeOverview, hasClientValantFacilityColumn } from './overviewServer';
import {
  distinctBillingEntities,
  locationsWithoutFacility,
  planFacilityListImport,
  type FacilityListRow,
} from './valantFacilities';
import {
  collectEvidence,
  decideClientLocation,
  planFingerprint,
  summarizeDecisions,
  type ClientDecision,
} from './recompute';

/**
 * Server side of locations-from-imports: leadership gate, grouped queries, mapping writes and the
 * owner-triggered client location recompute (preview / apply / undo). Everything is org scoped.
 */

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
/** Read-only viewers of the Practice overview and Census: leadership + Office Manager (daily operations) */
const OVERVIEW_VIEWERS = new Set([...LEADERSHIP, 'OFFICE_MANAGER']);

async function requireRoles(allowed: Set<string>, error: string) {
  const gate = await requireOrgContext();
  if (!gate.ok) return gate;
  if (locationsRoleAllowed(allowed, gate.role, null)) return gate;
  // Admin previewing another role: base role verified against the DB row, never the JWT claim.
  if (!locationsRoleAllowed(allowed, gate.role, await verifiedAdminBaseRole(gate.userId))) {
    return { ok: false as const, status: 403, error };
  }
  return gate;
}

/** Practice leadership (Admin / Director / Practice Director) of a clinic org. Mapping edits, recompute, Locations admin. */
export async function requireLeadership() {
  return requireRoles(LEADERSHIP, 'Only practice leadership can view locations data');
}

/** Practice overview / Census reads and CSV export: leadership + Office Manager. */
export async function requireOverviewViewer() {
  return requireRoles(OVERVIEW_VIEWERS, 'Only practice leadership and office managers can view the practice overview');
}

/**
 * Facility names seen on Valant's Transaction Journal export (October 2026). Offered for mapping before
 * the journal is imported so the owner can set the mapping first; flagged "not imported yet".
 */
export const KNOWN_VALANT_FACILITIES = [
  'Outpatient Mental Health Clinic - Bowie',
  'Family Practice',
  'IOP',
  'Outpatient Mental Health Clinic - STM',
] as const;

// ─── Facility mapping ───────────────────────────────────────────────────────

export async function loadFacilityMapping(organizationId: string) {
  const [locations, mappings, seen] = await Promise.all([
    locationsOf(organizationId),
    mappingsOf(organizationId),
    prisma.valantTransaction.groupBy({
      by: ['facility'],
      where: { organizationId, facility: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const seenRows = new Map(seen.map((s) => [normFacility(s.facility), { facility: s.facility as string, rows: s._count._all }]));
  const candidates = [...seen.map((s) => s.facility as string), ...KNOWN_VALANT_FACILITIES];
  const suggestions = suggestMissingMappings(candidates, mappings, locations as LocationLite[]).map((s) => ({
    ...s,
    importedRows: seenRows.get(normFacility(s.facilityName))?.rows ?? 0,
    seenInImport: seenRows.has(normFacility(s.facilityName)),
  }));
  const primary = locations.find((l) => l.isPrimary) ?? null;
  return {
    locations,
    mappings: mappings.map((m) => ({
      ...m,
      updatedAt: m.updatedAt.toISOString(),
      facilityImportedAt: m.facilityImportedAt?.toISOString() ?? null,
      importedRows: seenRows.get(normFacility(m.facilityName))?.rows ?? 0,
    })),
    suggestions,
    notes: {
      locationsWithoutFacility: mappings.length ? locationsWithoutFacility(locations, mappings) : [],
      primaryLocationFacilities: primary
        ? mappings.filter((m) => m.kind === 'location' && m.locationId === primary.id).map((m) => m.facilityName)
        : [],
      billingEntities: distinctBillingEntities(mappings),
    },
  };
}

export type MappingInput = {
  facilityName: string;
  kind: FacilityKind;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  note: string | null;
};

export async function saveFacilityMapping(organizationId: string, userId: string, input: MappingInput, origin: 'owner' | 'suggested' = 'owner') {
  const facilityName = input.facilityName.trim();
  const data = {
    kind: input.kind,
    locationId: input.kind === 'ignore' ? null : input.locationId,
    programKey: input.kind === 'program' ? input.programKey : null,
    needsConfirmation: input.needsConfirmation,
    note: input.note?.trim() || null,
    origin,
    updatedById: userId,
  };
  return prisma.facilityLocationMap.upsert({
    where: { organizationId_sourceSystem_facilityName: { organizationId, sourceSystem: 'valant', facilityName } },
    create: { organizationId, sourceSystem: 'valant', facilityName, ...data },
    update: data,
  });
}

/** Saves every suggestion that names a location or program; never touches saved rows. */
export async function applySuggestedMapping(organizationId: string, userId: string) {
  const { suggestions } = await loadFacilityMapping(organizationId);
  const usable = suggestions.filter((s) => s.basis !== 'none');
  let created = 0;
  for (const s of usable) {
    const res = await prisma.facilityLocationMap.createMany({
      data: [{
        organizationId, sourceSystem: 'valant', facilityName: s.facilityName, kind: s.kind, locationId: s.locationId,
        programKey: s.programKey, needsConfirmation: s.needsConfirmation, note: s.note, origin: 'suggested', updatedById: userId,
      }],
      skipDuplicates: true,
    });
    created += res.count;
  }
  return { created, skippedUnknown: suggestions.length - usable.length };
}

// ─── Client location recompute ──────────────────────────────────────────────

export async function computeClientLocationPlan(organizationId: string) {
  const [locations, mappings, clients, journalGroups, apptGroups, staffLinks] = await Promise.all([
    locationsOf(organizationId),
    mappingsOf(organizationId),
    prisma.client.findMany({ where: { organizationId }, select: { id: true, locationId: true, sourcePlatform: true } }),
    prisma.valantTransaction.groupBy({
      by: ['clientId', 'facility'],
      where: { organizationId, clientId: { not: null }, facility: { not: null }, category: 'charge' },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ['clientId', 'clinicianId'],
      where: {
        client: { organizationId },
        status: { notIn: ['CANCELLED', 'LATE_CANCEL', 'NO_SHOW'] },
        clinicianId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.userLocation.findMany({ where: { location: { organizationId } }, select: { userId: true, locationId: true } }),
  ]);
  const activeLocIds = new Set(locations.filter((l) => l.active).map((l) => l.id));
  const resolver = buildFacilityResolver(mappings);
  const staffLocations = new Map<string, string[]>();
  for (const l of staffLinks) {
    if (!activeLocIds.has(l.locationId)) continue;
    const arr = staffLocations.get(l.userId) ?? [];
    arr.push(l.locationId);
    staffLocations.set(l.userId, arr);
  }
  const evidence = collectEvidence({
    clients,
    journalGroups: journalGroups.map((g) => ({ clientId: g.clientId as string, facility: g.facility, rows: g._count._all })),
    resolveFacility: (f) => {
      const r = resolver(f);
      // a mapping to an inactive location is not evidence
      if (r.kind === 'location' && !activeLocIds.has(r.locationId)) return { kind: 'unmapped' };
      return r;
    },
    appointmentGroups: apptGroups.map((g) => ({ clientId: g.clientId, clinicianId: g.clinicianId, count: g._count._all })),
    staffLocations,
  });
  const defaultLocationId = locations.find((l) => l.isPrimary)?.id ?? null;
  const decisions = evidence.map((e) => decideClientLocation(e, defaultLocationId));
  return {
    locations,
    defaultLocationId,
    decisions,
    summary: summarizeDecisions(decisions),
    fingerprint: planFingerprint(decisions),
    evidenceAvailable: {
      journalRows: journalGroups.reduce((s, g) => s + g._count._all, 0),
      savedMappings: mappings.length,
      staffWithOneLocation: [...staffLocations.values()].filter((l) => l.length === 1).length,
      staffWithSeveralLocations: [...staffLocations.values()].filter((l) => l.length > 1).length,
    },
  };
}

/** Sample rows for the preview table: client name + MRN for review by leadership (route is audited). */
export async function decorateDecisions(organizationId: string, decisions: ClientDecision[]) {
  const ids = decisions.map((d) => d.clientId);
  const clients = ids.length
    ? await prisma.client.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true, mrn: true, sourcePlatform: true } })
    : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  return decisions.map((d) => ({
    ...d,
    clientName: byId.get(d.clientId)?.name ?? null,
    mrn: byId.get(d.clientId)?.mrn ?? null,
    sourcePlatform: byId.get(d.clientId)?.sourcePlatform ?? null,
  }));
}

export class PlanChangedError extends Error {}

const CHUNK = 200;

export async function applyClientLocationPlan(organizationId: string, userId: string, fingerprint: string) {
  const plan = await computeClientLocationPlan(organizationId);
  if (plan.fingerprint !== fingerprint) throw new PlanChangedError('The data changed since the preview. Run the preview again.');
  const moves = plan.decisions.filter((d) => d.action === 'move' && d.toLocationId);
  const runId = `locrun_${randomUUID()}`;
  for (let i = 0; i < moves.length; i += CHUNK) {
    const chunk = moves.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      const groups = new Map<string, { from: string | null; to: string; ids: string[] }>();
      for (const d of chunk) {
        const k = `${d.fromLocationId ?? ''}>${d.toLocationId}`;
        const g = groups.get(k) ?? { from: d.fromLocationId, to: d.toLocationId as string, ids: [] };
        g.ids.push(d.clientId);
        groups.set(k, g);
      }
      for (const g of groups.values()) {
        const res = await tx.client.updateMany({
          where: { organizationId, id: { in: g.ids }, locationId: g.from },
          data: { locationId: g.to },
        });
        if (res.count !== g.ids.length) throw new PlanChangedError('Some clients changed location since the preview. Run the preview again.');
      }
      await tx.clientLocationChange.createMany({
        data: chunk.map((d) => ({
          organizationId,
          runId,
          clientId: d.clientId,
          previousLocationId: d.fromLocationId,
          newLocationId: d.toLocationId,
          evidence: d.evidence ?? 'unknown',
          detail: d.verdicts
            .filter((v) => v.locationId)
            .map((v) => `${v.source}:${v.count}/${v.total}${v.strong ? '' : ' weak'}`)
            .join(' '),
          appliedById: userId,
        })),
      });
    });
  }
  return { runId, moved: moves.length, summary: plan.summary };
}

export async function listLocationRuns(organizationId: string) {
  const rows = await prisma.clientLocationChange.groupBy({
    by: ['runId'],
    where: { organizationId },
    _count: { _all: true },
    _min: { appliedAt: true },
  });
  const reverted = await prisma.clientLocationChange.groupBy({
    by: ['runId'],
    where: { organizationId, revertedAt: { not: null } },
    _count: { _all: true },
  });
  const rev = new Map(reverted.map((r) => [r.runId, r._count._all]));
  return rows
    .map((r) => ({ runId: r.runId, changes: r._count._all, reverted: rev.get(r.runId) ?? 0, appliedAt: r._min.appliedAt?.toISOString() ?? null }))
    .sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''));
}

/** Undo a run: clients still at the run's new location go back; clients changed since are left alone. */
export async function revertLocationRun(organizationId: string, userId: string, runId: string) {
  const changes = await prisma.clientLocationChange.findMany({
    where: { organizationId, runId, revertedAt: null },
    select: { id: true, clientId: true, previousLocationId: true, newLocationId: true },
  });
  let reverted = 0;
  let skipped = 0;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const chunk = changes.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      const current = await tx.client.findMany({
        where: { organizationId, id: { in: chunk.map((c) => c.clientId) } },
        select: { id: true, locationId: true },
      });
      const loc = new Map(current.map((c) => [c.id, c.locationId]));
      const ok = chunk.filter((c) => loc.has(c.clientId) && loc.get(c.clientId) === c.newLocationId);
      skipped += chunk.length - ok.length;
      const groups = new Map<string, { prev: string | null; next: string | null; ids: string[]; changeIds: string[] }>();
      for (const c of ok) {
        const k = `${c.previousLocationId ?? ''}<${c.newLocationId ?? ''}`;
        const g = groups.get(k) ?? { prev: c.previousLocationId, next: c.newLocationId, ids: [], changeIds: [] };
        g.ids.push(c.clientId);
        g.changeIds.push(c.id);
        groups.set(k, g);
      }
      for (const g of groups.values()) {
        const res = await tx.client.updateMany({
          where: { organizationId, id: { in: g.ids }, locationId: g.next },
          data: { locationId: g.prev },
        });
        if (res.count !== g.ids.length) throw new PlanChangedError('Clients changed during the undo. Try again.');
        await tx.clientLocationChange.updateMany({
          where: { id: { in: g.changeIds } },
          data: { revertedAt: new Date(), revertedById: userId },
        });
        reverted += res.count;
      }
    });
  }
  return { runId, reverted, skippedChangedSince: skipped };
}

// ─── Valant facility list import ────────────────────────────────────────────

/** Plan (dry run) or apply the Valant facility list. Idempotent; see src/lib/locations/valantFacilities.ts. */
export async function importValantFacilityList(organizationId: string, userId: string, rows: FacilityListRow[], dryRun: boolean) {
  const [locations, existing] = await Promise.all([
    locationsOf(organizationId),
    prisma.facilityLocationMap.findMany({
      where: { organizationId, sourceSystem: 'valant' },
      select: {
        id: true, facilityName: true, kind: true, locationId: true, programKey: true, needsConfirmation: true, note: true,
        origin: true, billingEntityName: true, timezone: true, sourceActive: true,
      },
    }),
  ]);
  const plan = planFacilityListImport(existing, rows, locations as LocationLite[]);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const counts = {
    create: plan.filter((p) => p.action === 'create').length,
    update: plan.filter((p) => p.action === 'update').length,
    unchanged: plan.filter((p) => p.action === 'unchanged').length,
    unmatched: plan.filter((p) => p.mapping === 'unmatched').length,
    keptOwner: plan.filter((p) => p.mapping === 'kept_owner').length,
  };
  if (!dryRun) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const p of plan) {
        if (p.action === 'create') {
          await tx.facilityLocationMap.create({
            data: { organizationId, sourceSystem: 'valant', ...p.data, origin: 'facility_import', facilityImportedAt: now, updatedById: userId },
          });
        } else if (p.action === 'update' && p.id) {
          const { facilityName: _name, ...data } = p.data;
          void _name;
          await tx.facilityLocationMap.update({
            where: { id: p.id },
            data: { ...data, ...(p.mapping === 'kept_owner' ? {} : { origin: 'facility_import' }), facilityImportedAt: now, updatedById: userId },
          });
        }
      }
    });
  }
  return {
    counts,
    rows: plan.map((p) => ({
      line: p.line,
      facilityName: p.facilityName,
      action: p.action,
      mapping: p.mapping,
      changed: p.changed,
      kind: p.data.kind,
      mappedTo:
        p.data.kind === 'location' ? (p.data.locationId ? locName.get(p.data.locationId) ?? 'Unknown location' : 'No location')
        : p.data.kind === 'program' ? p.data.programKey
        : 'Not counted (choose on Admin › Locations)',
      needsConfirmation: p.data.needsConfirmation,
      billingEntityName: p.data.billingEntityName,
      timezone: p.data.timezone,
      active: p.data.sourceActive,
    })),
  };
}

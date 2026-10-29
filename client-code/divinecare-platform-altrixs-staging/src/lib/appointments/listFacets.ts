import { prisma } from '@/lib/db/prisma';
import { carelonNeededForClients } from '@/lib/consents/carelon/store';
import { canSeeCarelonFlag } from '@/lib/consents/carelon/workflow';

/**
 * Extra fields the scheduler filters need (GET /api/appointments?facets=1). Only enriches rows
 * the caller was already allowed to list: it never adds appointments, so role / caseload
 * scoping stays where it is (listAppointmentsForUser). Three indexed queries per list:
 *   - the visit's own payer (self-schedule bookings),
 *   - the client's MRN, primary payer, home site and primary-care flag,
 *   - each client's first kept visit (for "New clients").
 */
export type AppointmentFacets = {
  siteId: string | null;
  siteName: string | null;
  clientMrn: string | null;
  payer: string | null;
  isNewClient: boolean;
  primaryCareClient: boolean;
  /**
   * Maryland Medicaid client without a current Carelon non-overlap attestation (front desk sees
   * it at check-in). Only computed for roles that manage the form; absent otherwise.
   */
  carelonAttestationNeeded?: boolean;
};

const NOT_A_VISIT = ['CANCELLED', 'LATE_CANCEL', 'NO_SHOW'] as const;
const CHUNK = 5000;

async function inChunks<T>(values: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(...(await run(values.slice(i, i + CHUNK))));
  return out;
}

export async function appointmentFilterFacets(
  rows: Array<{ id: string; clientId: string; startsAt?: string }>
): Promise<Map<string, AppointmentFacets>> {
  const out = new Map<string, AppointmentFacets>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  // Board / list windows can hold tens of thousands of visits: keep each IN list well under
  // Postgres' bind-parameter limit.
  const [visits, clients, firsts] = await Promise.all([
    inChunks(ids, (part) =>
      prisma.appointment.findMany({ where: { id: { in: part } }, select: { id: true, insurancePayer: true } })
    ),
    inChunks(clientIds, (part) =>
      prisma.client.findMany({
        where: { id: { in: part } },
        select: {
          id: true,
          mrn: true,
          insurancePayer: true,
          primaryCare: true,
          importedAt: true,
          locationId: true,
          location: { select: { name: true } },
        },
      })
    ),
    inChunks(clientIds, (part) =>
      prisma.appointment.groupBy({
        by: ['clientId'],
        where: { clientId: { in: part }, status: { notIn: [...NOT_A_VISIT] } },
        _min: { startsAt: true },
      })
    ),
  ]);
  const visitPayer = new Map(visits.map((v) => [v.id, v.insurancePayer?.trim() || null]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const firstAt = new Map(firsts.map((f) => [f.clientId, f._min.startsAt?.getTime() ?? null]));
  for (const r of rows) {
    const c = clientById.get(r.clientId);
    const startsAt = r.startsAt ? Date.parse(r.startsAt) : NaN;
    out.set(r.id, {
      siteId: c?.locationId ?? null,
      siteName: c?.location?.name ?? null,
      clientMrn: c?.mrn?.trim() || null,
      payer: visitPayer.get(r.id) || c?.insurancePayer?.trim() || null,
      // Same rule as the "New" label suggestion: imported clients are existing patients
      isNewClient: Boolean(c && !c.importedAt && Number.isFinite(startsAt) && firstAt.get(r.clientId) === startsAt),
      primaryCareClient: Boolean(c?.primaryCare),
    });
  }
  return out;
}

/** Clients needing the Carelon attestation, in chunks (one window can hold thousands of clients). */
async function carelonNeeded(organizationId: string, clientIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < clientIds.length; i += CHUNK) {
    for (const id of await carelonNeededForClients(organizationId, clientIds.slice(i, i + CHUNK))) out.add(id);
  }
  return out;
}

export async function withFilterFacets<T extends { id: string; clientId: string; startsAt?: string }>(
  rows: T[],
  viewer?: { organizationId: string; role: string }
): Promise<Array<T & Partial<AppointmentFacets>>> {
  try {
    const facets = await appointmentFilterFacets(rows);
    let carelon: Set<string> | null = null;
    if (viewer && rows.length && canSeeCarelonFlag(viewer.role)) {
      // Badge only: a failure here never hides the schedule or the other facets
      carelon = await carelonNeeded(viewer.organizationId, [...new Set(rows.map((r) => r.clientId))]).catch((err) => {
        console.error('[appointments facets carelon]', err instanceof Error ? err.name : 'unknown');
        return null;
      });
    }
    return rows.map((r) => ({
      ...r,
      ...(facets.get(r.id) ?? {}),
      ...(carelon ? { carelonAttestationNeeded: carelon.has(r.clientId) } : {}),
    }));
  } catch (err) {
    // Facets only power filters: never fail the schedule because of them
    console.error('[appointments facets]', err);
    return rows;
  }
}

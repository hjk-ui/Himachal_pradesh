/**
 * Practice overview (Locations & enterprise) aggregation. Pure: no prisma. The server
 * (src/lib/locations/server.ts) runs grouped queries and hands the rows here; nothing is invented:
 * a figure the data cannot support is null, and the page says why.
 */
import { buildAppointmentLocationResolver, effectiveLocation } from './effectiveLocation';
import { buildFacilityResolver, normFacility, programLabel, type FacilityMapRow } from './facilityMapping';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import type { FacilityOverview } from './facilityOverview';

export type LocationRow = {
  id: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  isPrimary: boolean;
};

export type Money = {
  rows: number;
  chargeCount: number;
  chargesCents: number;
  /** insurance + patient payments, positive */
  paymentsCents: number;
  /** insurance + patient adjustments, positive = written off */
  adjustmentsCents: number;
};

export const emptyMoney = (): Money => ({ rows: 0, chargeCount: 0, chargesCents: 0, paymentsCents: 0, adjustmentsCents: 0 });

/** Valant amounts: charges positive, payments / adjustments negative (as exported). */
export function addMoney(m: Money, category: string, cents: number, count: number): void {
  m.rows += count;
  if (category === 'charge') {
    m.chargeCount += count;
    m.chargesCents += cents;
  } else if (category === 'insurance_payment' || category === 'patient_payment') {
    m.paymentsCents -= cents;
  } else if (category === 'insurance_adjustment' || category === 'patient_adjustment') {
    m.adjustmentsCents -= cents;
  }
}

export type ApptStats = {
  total: number;
  completed: number;
  noShow: number;
  lateCancel: number;
  cancelled: number;
  /** completed + no-show + late cancel; null rate when 0 */
  noShowRate: number | null;
  /** appointments whose location came from the client's home location */
  inferred: number;
};

const emptyAppt = (): ApptStats => ({ total: 0, completed: 0, noShow: 0, lateCancel: 0, cancelled: 0, noShowRate: null, inferred: 0 });

export type OverviewInput = {
  now: Date;
  /** Practice time zone: 90-day / 30-day windows and months are practice-clock days (default America/New_York) */
  timeZone?: string;
  organizationName: string;
  locations: LocationRow[];
  /** Client.groupBy(locationId, status, sourcePlatform) */
  clientGroups: { locationId: string | null; status: string; sourcePlatform: string | null; count: number }[];
  /** clients created in Altrixs (importedAt null) within 30 / 90 days, by location */
  newClientGroups: { locationId: string | null; days: 30 | 90; count: number }[];
  /** Client.primaryCare = true, by location */
  primaryCareFlagGroups: { locationId: string | null; count: number }[];
  /** appointments from the first practice day of the 6-month window to the end of practice day today + 30 */
  appointments: { clientLocationId: string | null; appointmentLocation: string | null; status: string; startsAt: Date }[];
  appointmentLocationColumn: boolean;
  /** ValantTransaction grouped by facility, category, month (YYYY-MM of serviceDate) and whether serviceDate is in the last 90 days; last ~6 months */
  valantGroups: { facility: string | null; category: string; month: string | null; in90: boolean; cents: number; count: number; homeLocationId?: string | null }[];
  /** ValantTransaction distinct clients per facility and client home location (all time) */
  facilityHomeGroups: { facility: string | null; homeLocationId: string | null; clients: number; rows: number }[];
  journalRowCount: number;
  mappings: FacilityMapRow[];
  staffLinks: { userId: string; locationId: string }[];
  /** PrpEnrollment distinct clients by status and client home location (optional: older callers omit it) */
  prpEnrollmentGroups?: { status: string; homeLocationId: string | null; count: number }[];
  staff: { id: string; name: string | null; role: string; status: string }[];
};

export type OverviewWarning = { code: string; level: 'info' | 'warning'; message: string; href?: string };

export type OverviewLocation = LocationRow & {
  clients: { total: number; active: number; valantImported: number; newIn30: number; newIn90: number; primaryCareFlag: number };
  appointments: { last90: ApptStats; upcoming30: number };
  valant: { last90: Money; facilities: string[] };
  staff: { count: number; shared: number };
  /** where each figure comes from */
  sources: { clients: string; appointments: string; valant: string; staff: string };
};

export type OverviewProgram = {
  programKey: string;
  label: string;
  facilities: string[];
  /** distinct clients with Valant rows in the program's facilities */
  clients: number;
  /** of those, by client home location (null key = no location) */
  byHomeLocation: { locationId: string | null; clients: number }[];
  last90: Money;
  /** primary care only: clients flagged by the primary-care intake (Client.primaryCare) */
  intakeFlagged: number | null;
  /** PRP only: Altrixs PRP enrollments (PrpEnrollment), distinct clients */
  enrollments: { total: number; byStatus: Record<string, number>; byHomeLocation: { locationId: string | null; clients: number }[] } | null;
};

export type PracticeOverview = {
  generatedAt: string;
  organizationName: string;
  defaultLocationId: string | null;
  totals: { clients: number; activeClients: number; staff: number; completed90: number; noShowRate90: number | null; charges90Cents: number; payments90Cents: number };
  locations: OverviewLocation[];
  unassigned: { clients: number; activeClients: number; appointments90: number; valant90: Money };
  months: { month: string; byLocation: Record<string, { completed: number; chargesCents: number; paymentsCents: number }> }[];
  programs: OverviewProgram[];
  sharedStaff: { userId: string; name: string; role: string; locationIds: string[] }[];
  facilities: { facility: string; rows: number; mappedTo: string; needsConfirmation: boolean; saved: boolean }[];
  noFacilityRows90: number;
  /** last-90-day charges from program facilities placed at a location by the client's home location */
  programChargesInferred90Cents: number;
  journalImported: boolean;
  warnings: OverviewWarning[];
  /** "By facility" view (the practice's Valant facilities); set by the server loader */
  facilityView?: FacilityOverview;
};

const NO_SHOW = new Set(['NO_SHOW']);
const UNASSIGNED = '__none__';

/** YYYY-MM of an instant: on the practice clock when a time zone is given, else UTC */
export function monthKey(d: Date, timeZone?: string): string {
  if (timeZone) return practiceToday(timeZone, d).slice(0, 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Last n month keys ending with the month of `now` (practice month when a time zone is given), oldest first */
export function lastMonths(now: Date, n: number, timeZone?: string): string[] {
  const [y, m] = monthKey(now, timeZone).split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return out;
}

export function noShowRate(s: Pick<ApptStats, 'completed' | 'noShow' | 'lateCancel'>): number | null {
  const denom = s.completed + s.noShow + s.lateCancel;
  return denom > 0 ? s.noShow / denom : null;
}

export function buildPracticeOverview(input: OverviewInput): PracticeOverview {
  const { now } = input;
  const locIds = new Set(input.locations.map((l) => l.id));
  const key = (id: string | null | undefined) => (id && locIds.has(id) ? id : UNASSIGNED);
  const defaultLocationId = input.locations.find((l) => l.isPrimary)?.id ?? null;
  const resolveFacility = buildFacilityResolver(input.mappings);
  const resolveAppt = buildAppointmentLocationResolver(input.locations);
  const tz = input.timeZone || DEFAULT_PRACTICE_TIME_ZONE;
  const today = practiceToday(tz, now);
  const months = lastMonths(now, 6, tz);
  // the 90 practice days ending today (up to now); upcoming = after now through practice day today + 30
  const since90 = practiceDayBounds(addDaysYmd(today, -89), tz).start;
  const until30 = practiceDayBounds(addDaysYmd(today, 30), tz).end;

  type Acc = {
    clients: OverviewLocation['clients'];
    appt: ApptStats;
    upcoming30: number;
    money90: Money;
    facilities: Set<string>;
  };
  const acc = new Map<string, Acc>();
  const get = (k: string) => {
    let a = acc.get(k);
    if (!a) {
      a = {
        clients: { total: 0, active: 0, valantImported: 0, newIn30: 0, newIn90: 0, primaryCareFlag: 0 },
        appt: emptyAppt(),
        upcoming30: 0,
        money90: emptyMoney(),
        facilities: new Set(),
      };
      acc.set(k, a);
    }
    return a;
  };
  for (const l of input.locations) get(l.id);
  get(UNASSIGNED);

  for (const g of input.clientGroups) {
    const a = get(key(g.locationId));
    a.clients.total += g.count;
    if (g.status === 'ACTIVE') a.clients.active += g.count;
    if ((g.sourcePlatform ?? '').toLowerCase() === 'valant') a.clients.valantImported += g.count;
  }
  for (const g of input.newClientGroups) {
    const a = get(key(g.locationId));
    if (g.days === 30) a.clients.newIn30 += g.count;
    else a.clients.newIn90 += g.count;
  }
  for (const g of input.primaryCareFlagGroups) get(key(g.locationId)).clients.primaryCareFlag += g.count;

  const monthAcc = new Map<string, Map<string, { completed: number; chargesCents: number; paymentsCents: number }>>();
  const monthCell = (m: string, k: string) => {
    let byLoc = monthAcc.get(m);
    if (!byLoc) monthAcc.set(m, (byLoc = new Map()));
    let c = byLoc.get(k);
    if (!c) byLoc.set(k, (c = { completed: 0, chargesCents: 0, paymentsCents: 0 }));
    return c;
  };

  for (const ap of input.appointments) {
    const eff = effectiveLocation({ appointmentLocation: ap.appointmentLocation, clientLocationId: ap.clientLocationId }, resolveAppt);
    const k = key(eff.locationId);
    const a = get(k);
    const t = ap.startsAt.getTime();
    if (t >= since90.getTime() && t <= now.getTime()) {
      a.appt.total += 1;
      if (eff.inferred) a.appt.inferred += 1;
      if (ap.status === 'COMPLETED') a.appt.completed += 1;
      else if (NO_SHOW.has(ap.status)) a.appt.noShow += 1;
      else if (ap.status === 'LATE_CANCEL') a.appt.lateCancel += 1;
      else if (ap.status === 'CANCELLED') a.appt.cancelled += 1;
    } else if (t > now.getTime() && t < until30.getTime() && ap.status !== 'CANCELLED') {
      a.upcoming30 += 1;
    }
    if (ap.status === 'COMPLETED' && t <= now.getTime()) {
      const m = monthKey(ap.startsAt, tz);
      if (months.includes(m)) monthCell(m, k).completed += 1;
    }
  }
  for (const a of acc.values()) a.appt.noShowRate = noShowRate(a.appt);

  // Valant money by mapped facility. Location-mapped facilities count toward their location.
  // Program facilities (Family Practice, IOP, PRP) carry no site in Valant: they are reported under
  // programs AND placed at the program's mapped location, else the client's home location
  // (inferred, see programMoneyInferred90). Rows without facility are counted separately.
  let noFacilityRows90 = 0;
  let programMoneyInferred90 = 0;
  const facilityRows = new Map<string, { facility: string; rows: number }>();
  const programMoney = new Map<string, Money>();
  const addToLocation = (locationId: string, label: string, g: OverviewInput['valantGroups'][number]) => {
    const a = get(key(locationId));
    a.facilities.add(label);
    if (g.in90) addMoney(a.money90, g.category, g.cents, g.count);
    if (g.month && months.includes(g.month)) {
      const cell = monthCell(g.month, key(locationId));
      const m = emptyMoney();
      addMoney(m, g.category, g.cents, g.count);
      cell.chargesCents += m.chargesCents;
      cell.paymentsCents += m.paymentsCents;
    }
  };
  for (const g of input.valantGroups) {
    const in90 = g.in90;
    const fac = g.facility?.trim() || null;
    if (!fac) {
      if (in90) noFacilityRows90 += g.count;
      continue;
    }
    const fr = facilityRows.get(normFacility(fac)) ?? { facility: fac, rows: 0 };
    fr.rows += g.count;
    facilityRows.set(normFacility(fac), fr);
    const r = resolveFacility(fac);
    if (r.kind === 'location') {
      addToLocation(r.locationId, fac, g);
    } else if (r.kind === 'program') {
      if (in90) {
        const pm = programMoney.get(r.programKey) ?? emptyMoney();
        addMoney(pm, g.category, g.cents, g.count);
        programMoney.set(r.programKey, pm);
      }
      if (r.locationId && locIds.has(r.locationId)) {
        addToLocation(r.locationId, fac, g);
      } else if (g.homeLocationId && locIds.has(g.homeLocationId)) {
        addToLocation(g.homeLocationId, `${fac} (by client home location)`, g);
        if (in90 && g.category === 'charge') programMoneyInferred90 += g.cents;
      }
    }
  }
  // Staff
  const linksByUser = new Map<string, string[]>();
  for (const l of input.staffLinks) {
    if (!locIds.has(l.locationId)) continue;
    const arr = linksByUser.get(l.userId) ?? [];
    if (!arr.includes(l.locationId)) arr.push(l.locationId);
    linksByUser.set(l.userId, arr);
  }
  const activeStaff = new Map(input.staff.filter((s) => s.status === 'ACTIVE').map((s) => [s.id, s]));
  const staffCount = new Map<string, number>();
  const sharedCount = new Map<string, number>();
  const sharedStaff: PracticeOverview['sharedStaff'] = [];
  for (const [userId, locs] of linksByUser) {
    const s = activeStaff.get(userId);
    if (!s) continue;
    for (const l of locs) {
      staffCount.set(l, (staffCount.get(l) ?? 0) + 1);
      if (locs.length > 1) sharedCount.set(l, (sharedCount.get(l) ?? 0) + 1);
    }
    if (locs.length > 1) sharedStaff.push({ userId, name: s.name?.trim() || 'Unnamed staff member', role: s.role, locationIds: locs });
  }
  sharedStaff.sort((a, b) => a.name.localeCompare(b.name));

  // Programs from mapping
  const programs = new Map<string, OverviewProgram>();
  for (const m of input.mappings) {
    if (m.kind !== 'program' || !m.programKey) continue;
    const p = programs.get(m.programKey) ?? {
      programKey: m.programKey,
      label: programLabel(m.programKey),
      facilities: [],
      clients: 0,
      byHomeLocation: [],
      last90: emptyMoney(),
      intakeFlagged: null,
      enrollments: null,
    };
    p.facilities.push(m.facilityName);
    programs.set(m.programKey, p);
  }
  for (const g of input.facilityHomeGroups) {
    const r = resolveFacility(g.facility);
    if (r.kind !== 'program') continue;
    const p = programs.get(r.programKey);
    if (!p) continue;
    p.clients += g.clients;
    const homeId = g.homeLocationId && locIds.has(g.homeLocationId) ? g.homeLocationId : null;
    const h = p.byHomeLocation.find((x) => x.locationId === homeId);
    if (h) h.clients += g.clients;
    else p.byHomeLocation.push({ locationId: homeId, clients: g.clients });
  }
  for (const p of programs.values()) {
    p.last90 = programMoney.get(p.programKey) ?? emptyMoney();
    p.byHomeLocation.sort((a, b) => b.clients - a.clients);
    if (p.programKey === 'primary_care') p.intakeFlagged = input.primaryCareFlagGroups.reduce((s, g) => s + g.count, 0);
  }
  const prpGroups = input.prpEnrollmentGroups ?? [];
  if (prpGroups.length || programs.has('prp')) {
    const p = programs.get('prp') ?? {
      programKey: 'prp', label: programLabel('prp'), facilities: [], clients: 0, byHomeLocation: [], last90: emptyMoney(), intakeFlagged: null, enrollments: null,
    };
    const byStatus: Record<string, number> = {};
    const byHome: { locationId: string | null; clients: number }[] = [];
    let total = 0;
    for (const g of prpGroups) {
      total += g.count;
      byStatus[g.status] = (byStatus[g.status] ?? 0) + g.count;
      const homeId = g.homeLocationId && locIds.has(g.homeLocationId) ? g.homeLocationId : null;
      const h = byHome.find((x) => x.locationId === homeId);
      if (h) h.clients += g.count;
      else byHome.push({ locationId: homeId, clients: g.count });
    }
    p.enrollments = { total, byStatus, byHomeLocation: byHome.sort((a, b) => b.clients - a.clients) };
    programs.set('prp', p);
  }

  // Facility list (all seen facilities, with their saved / missing mapping)
  const locName = new Map(input.locations.map((l) => [l.id, l.name]));
  const savedNames = new Set(input.mappings.map((m) => normFacility(m.facilityName)));
  const facilities = [...facilityRows.values()]
    .sort((a, b) => b.rows - a.rows)
    .map((f) => {
      const r = resolveFacility(f.facility);
      const saved = savedNames.has(normFacility(f.facility));
      const mappedTo =
        r.kind === 'location' ? locName.get(r.locationId) ?? 'Unknown location'
        : r.kind === 'program' ? programLabel(r.programKey)
        : r.kind === 'ignore' ? 'Ignored'
        : 'Not mapped';
      return { facility: f.facility, rows: f.rows, mappedTo, needsConfirmation: r.kind === 'location' ? !r.confirmed : !saved, saved };
    });

  const locations: OverviewLocation[] = input.locations.map((l) => {
    const a = get(l.id);
    return {
      ...l,
      clients: a.clients,
      appointments: { last90: a.appt, upcoming30: a.upcoming30 },
      valant: { last90: a.money90, facilities: [...a.facilities].sort() },
      staff: { count: staffCount.get(l.id) ?? 0, shared: sharedCount.get(l.id) ?? 0 },
      sources: {
        clients: 'Client home location',
        appointments: a.appt.total === 0 ? 'No appointments in the last 90 days' : a.appt.inferred === a.appt.total ? "Inferred from the client's home location" : a.appt.inferred > 0 ? "Appointment location, else inferred from the client's home location" : 'Appointment location',
        valant: a.facilities.size ? `Valant facility: ${[...a.facilities].sort().join(', ')}` : 'No Valant facility mapped to this location',
        staff: 'Staff location links',
      },
    };
  });

  const u = get(UNASSIGNED);
  const all = [...acc.values()];
  const sum = (f: (a: Acc) => number) => all.reduce((s, a) => s + f(a), 0);
  const totalAppt = { completed: sum((a) => a.appt.completed), noShow: sum((a) => a.appt.noShow), lateCancel: sum((a) => a.appt.lateCancel) };

  const overview: PracticeOverview = {
    generatedAt: now.toISOString(),
    organizationName: input.organizationName,
    defaultLocationId,
    totals: {
      clients: sum((a) => a.clients.total),
      activeClients: sum((a) => a.clients.active),
      staff: [...linksByUser.keys()].filter((id) => activeStaff.has(id)).length,
      completed90: totalAppt.completed,
      noShowRate90: noShowRate(totalAppt),
      charges90Cents: sum((a) => a.money90.chargesCents),
      payments90Cents: sum((a) => a.money90.paymentsCents),
    },
    locations,
    unassigned: { clients: u.clients.total, activeClients: u.clients.active, appointments90: u.appt.total, valant90: u.money90 },
    months: months.map((m) => {
      const byLoc = monthAcc.get(m) ?? new Map();
      const out: Record<string, { completed: number; chargesCents: number; paymentsCents: number }> = {};
      for (const l of input.locations) out[l.id] = byLoc.get(l.id) ?? { completed: 0, chargesCents: 0, paymentsCents: 0 };
      return { month: m, byLocation: out };
    }),
    programs: [...programs.values()],
    sharedStaff,
    facilities,
    noFacilityRows90,
    programChargesInferred90Cents: programMoneyInferred90,
    journalImported: input.journalRowCount > 0,
    warnings: [],
  };
  overview.warnings = overviewWarnings(overview, input);
  return overview;
}

export function overviewWarnings(o: PracticeOverview, input: Pick<OverviewInput, 'appointmentLocationColumn' | 'staffLinks'>): OverviewWarning[] {
  const w: OverviewWarning[] = [];
  const fmt = (n: number) => n.toLocaleString('en-US');
  const def = o.locations.find((l) => l.id === o.defaultLocationId);
  if (def && def.clients.valantImported > 0) {
    w.push({
      code: 'valant_default_location',
      level: 'warning',
      message:
        `${fmt(def.clients.valantImported)} Valant-imported clients are at ${def.name}, the primary location. The Valant import ` +
        `uses each client's Assigned Facility, and clients without one default to ${def.name}. Review client locations.`,
      href: '/dashboard/admin/locations#recompute',
    });
  }
  for (const l of o.locations) {
    if (l.active && l.clients.total === 0) {
      w.push({ code: 'location_no_clients', level: 'warning', message: `${l.name} has no clients assigned.`, href: '/dashboard/admin/locations' });
    }
  }
  if (o.unassigned.clients > 0) {
    w.push({ code: 'clients_no_location', level: 'warning', message: `${fmt(o.unassigned.clients)} clients have no location.`, href: '/dashboard/admin/locations#recompute' });
  }
  const appt = o.locations.reduce((s, l) => s + l.appointments.last90.total, 0) + o.unassigned.appointments90;
  const inferred = o.locations.reduce((s, l) => s + l.appointments.last90.inferred, 0) + o.unassigned.appointments90;
  if (appt > 0 && inferred > 0) {
    w.push({
      code: 'appointments_inferred',
      level: 'info',
      message: `${fmt(inferred)} of ${fmt(appt)} appointments in the last 90 days have no location of their own; their location is inferred from the client's home location.`,
    });
  }
  if (o.programChargesInferred90Cents > 0) {
    w.push({
      code: 'program_charges_inferred',
      level: 'info',
      message:
        `$${(o.programChargesInferred90Cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of ` +
        `last-90-day charges come from program facilities (e.g. Family Practice) that Valant does not tie to a site; ` +
        `they are shown at each client's home location.`,
    });
  }
  if (!input.appointmentLocationColumn) {
    w.push({ code: 'appointment_location_missing', level: 'info', message: 'Appointments have no location column in this database; every appointment location is inferred.' });
  }
  if (!o.journalImported) {
    w.push({
      code: 'journal_not_imported',
      level: 'warning',
      message: 'The Valant Transaction Journal has not been imported, so Valant charges and payments cannot be split by facility yet.',
      href: '/dashboard/admin/migration',
    });
  }
  const unmapped = o.facilities.filter((f) => !f.saved);
  if (unmapped.length) {
    w.push({
      code: 'facilities_unmapped',
      level: 'warning',
      message: `${unmapped.length} Valant ${unmapped.length === 1 ? 'facility is' : 'facilities are'} not mapped: ${unmapped.map((f) => f.facility).join(', ')}.`,
      href: '/dashboard/admin/locations#mapping',
    });
  }
  const unconfirmed = o.facilities.filter((f) => f.saved && f.needsConfirmation);
  if (unconfirmed.length) {
    w.push({
      code: 'facilities_unconfirmed',
      level: 'info',
      message: `Facility mapping to confirm: ${unconfirmed.map((f) => `${f.facility} → ${f.mappedTo}`).join('; ')}.`,
      href: '/dashboard/admin/locations#mapping',
    });
  }
  const linked = new Set(input.staffLinks.map((s) => s.locationId));
  if (o.locations.length > 1 && linked.size === 1 && o.totals.staff > 0) {
    const only = o.locations.find((l) => linked.has(l.id));
    w.push({
      code: 'staff_one_location',
      level: 'warning',
      message: `All ${fmt(o.totals.staff)} staff are linked to ${only?.name ?? 'one location'} only. Link staff to the locations they work at (staff counts and clinician evidence depend on it).`,
      href: '/dashboard/hr',
    });
  }
  return w;
}

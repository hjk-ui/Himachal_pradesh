/**
 * Daily practice census (Practice overview > Census). Pure: no prisma. censusServer.ts runs the
 * org-scoped queries and hands the rows here. Nothing is invented: a figure the data cannot
 * support is null or 0 with a note saying where it comes from.
 *
 * Day: the PRACTICE-clock calendar day (practiceDay.ts), DST-safe. Appointment / crisis instants are
 * bucketed by their practice-clock date. Date-only columns (PrpAttendance.serviceDate, TMS / Spravato
 * sessionDate and ResidentialResident.admitDate when saved as YYYY-MM-DD) are stored at 00:00 UTC and
 * read as that calendar date, not shifted into the practice zone.
 *
 * Location: appointments use effectiveLocation (appointment location, else client home location);
 * program sessions, residents, crisis episodes and caseload use the client's home location.
 * Part 2 / protected clients: counts only. No client name or id leaves this module.
 */
import { appointmentServiceType } from '@/lib/clinical/sessionFrequency';
import { practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd } from '@/lib/dashboard/practiceDay';
import { buildAppointmentLocationResolver, effectiveLocation } from './effectiveLocation';
import {
  occupancyByLevel,
  summarizeCapacity,
  totalOccupancy,
  type CapacityRow,
  type LevelOccupancy,
} from '@/lib/residential/capacity';

export const CENSUS_TREND_DAYS = 14;
export const UNASSIGNED_LOCATION = '__none__';

export type CensusService = 'therapy' | 'med_management' | 'primary_care' | 'other' | 'unknown';
export const CENSUS_SERVICE_LABELS: Record<CensusService, string> = {
  therapy: 'Therapy',
  med_management: 'Medication management',
  primary_care: 'Primary care',
  other: 'Other visit types',
  unknown: 'Type not recorded',
};
const SERVICE_ORDER: CensusService[] = ['therapy', 'med_management', 'primary_care', 'other', 'unknown'];

/** Visits by a medical (primary-care) clinician, or typed as primary care, are primary care. */
const MEDICAL_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']);
const PRIMARY_CARE_TYPE = /\b(primary care|family practice|family medicine|annual physical|physical exam|sick visit|well visit)\b/i;
const WALK_IN_TYPE = /\bwalk[\s-]?in\b/i;

export type CensusAppointment = {
  clientId: string;
  clinicianId: string | null;
  clinicianName: string | null;
  clinicianRole: string | null;
  type: string | null;
  notes: string | null;
  isVirtual: boolean;
  status: string;
  startsAt: Date;
  appointmentLocation: string | null;
  clientLocationId: string | null;
  /** client has a SensitiveRecord (Part 2 / protected): counted, never named */
  protected: boolean;
};

export type CensusSession = { clientId: string; clientLocationId: string | null; date: Date };

export type CensusResident = {
  clientLocationId: string | null;
  program: string;
  admitDate: Date;
  active: boolean;
  updatedAt: Date;
};

export type CensusInput = {
  now: Date;
  /** YYYY-MM-DD practice date */
  date: string;
  timeZone: string;
  window: { start: Date; end: Date };
  locations: { id: string; name: string; active: boolean }[];
  /** Location id of the organization, or null for all locations */
  locationId: string | null;
  /** appointments starting in the trend window (date - 13 days .. end of date) */
  appointments: CensusAppointment[];
  prpAttendance: CensusSession[];
  tmsSessions: CensusSession[];
  spravatoSessions: CensusSession[];
  /** org-verified residents: every active one plus inactive ones touched in the trend window */
  residents: CensusResident[];
  /** residents with no linked client (organization cannot be verified): not counted */
  unlinkedResidents: number;
  capacity: CapacityRow[];
  capacityMigrationPending?: boolean;
  crisisEpisodes: { clientLocationId: string | null; startedAt: Date; priority: number }[];
  caseload: {
    activeClients: { locationId: string | null; count: number }[];
    prpActive: { locationId: string | null; count: number }[];
    primaryCareActive: { locationId: string | null; count: number }[];
    tmsActive: { locationId: string | null; count: number }[];
    spravatoActive: { locationId: string | null; count: number }[];
  };
  appointmentLocationColumn: boolean;
  /**
   * 'facility': `locations` are the practice's Valant facilities (id = facility name) and every
   * clientLocationId is the client's resolved Valant facility; appointments carry no facility, so
   * appointmentLocation is null and every appointment is inferred (censusServer.ts builds this).
   */
  grouping?: 'location' | 'facility';
  /** facility grouping: clients whose facility cannot be determined (no / ambiguous Valant facility) */
  facilityNotes?: string[];
};

export type StatusCounts = {
  /** every appointment of the day except cancelled */
  booked: number;
  /** status still SCHEDULED */
  notArrived: number;
  checkedIn: number;
  inSession: number;
  completed: number;
  noShow: number;
  lateCancel: number;
  cancelled: number;
  /** not arrived + checked in (not yet seen); on a past date: not closed out */
  remaining: number;
};

export type CensusGroup = {
  key: string;
  label: string;
  counts: StatusCounts;
  telehealth: number;
  inPerson: number;
  /** distinct clients who arrived (checked in, in session or completed) */
  clientsSeen: number;
};

export type ProgramDay = { encounters: number; clients: number };

export type CensusLocation = {
  locationId: string | null;
  name: string;
  appointments: CensusGroup;
  byService: CensusGroup[];
  prp: ProgramDay;
  tms: ProgramDay;
  spravato: ProgramDay;
  uniqueClientsSeen: number;
  walkIns: number;
  inferredAppointments: number;
  residents: number;
  admissions: number;
  discharges: number;
  crisisOpened: number;
};

export type CaseloadRow = {
  locationId: string | null;
  name: string;
  activeClients: number;
  prpActive: number;
  residentialResidents: number;
  primaryCareActive: number;
  tmsActive: number;
  spravatoActive: number;
};

export type PracticeCensus = {
  generatedAt: string;
  /** rows are Altrixs locations (default) or Valant facilities */
  grouping: 'location' | 'facility';
  date: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  /** today | past | future relative to the practice clock */
  when: 'today' | 'past' | 'future';
  location: { id: string; name: string } | null;
  totals: {
    appointments: CensusGroup;
    byService: CensusGroup[];
    prp: ProgramDay;
    tms: ProgramDay;
    spravato: ProgramDay;
    uniqueClientsSeen: number;
    walkIns: number;
    protectedAppointments: number;
    inferredAppointments: number;
  };
  locations: CensusLocation[];
  clinicians: CensusGroup[];
  residential: {
    configured: boolean;
    migrationPending: boolean;
    levels: LevelOccupancy[];
    total: { residents: number; beds: number | null; open: number | null; occupancyPct: number | null };
    admissions: number;
    discharges: number;
    unlinkedExcluded: number;
    attribution: 'residential_site' | 'client_home';
  };
  crisis: { opened: number; byPriority: Record<string, number> };
  trend: { date: string; clientsSeen: number; completed: number; booked: number; noShow: number }[];
  caseload: { rows: CaseloadRow[]; totals: Omit<CaseloadRow, 'locationId' | 'name'> };
  notes: string[];
};

// ─── helpers ─────────────────────────────────────────────────────────────────

export const emptyCounts = (): StatusCounts => ({
  booked: 0, notArrived: 0, checkedIn: 0, inSession: 0, completed: 0, noShow: 0, lateCancel: 0, cancelled: 0, remaining: 0,
});

const ARRIVED = new Set(['CHECKED_IN', 'IN_SESSION', 'COMPLETED']);

/** Adds one appointment status to the buckets. Unknown statuses count as booked only. */
export function addStatus(c: StatusCounts, status: string): void {
  if (status === 'CANCELLED') {
    c.cancelled += 1;
    return;
  }
  c.booked += 1;
  if (status === 'SCHEDULED') c.notArrived += 1;
  else if (status === 'CHECKED_IN') c.checkedIn += 1;
  else if (status === 'IN_SESSION') c.inSession += 1;
  else if (status === 'COMPLETED') c.completed += 1;
  else if (status === 'NO_SHOW') c.noShow += 1;
  else if (status === 'LATE_CANCEL') c.lateCancel += 1;
  c.remaining = c.notArrived + c.checkedIn;
}

export function statusCounts(statuses: string[]): StatusCounts {
  const c = emptyCounts();
  for (const s of statuses) addStatus(c, s);
  return c;
}

export function isArrived(status: string): boolean {
  return ARRIVED.has(status);
}

/** Practice-clock calendar date of an instant. */
export function practiceYmd(at: Date, timeZone: string): string {
  return practiceToday(timeZone, at);
}

/** Calendar date of a date-only column: 00:00:00.000 UTC reads as that date; any other instant uses the practice clock. */
export function storedDayYmd(at: Date, timeZone: string): string {
  const iso = at.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : practiceYmd(at, timeZone);
}

export function censusService(a: Pick<CensusAppointment, 'clinicianRole' | 'type' | 'notes'>): CensusService {
  if (a.clinicianRole && MEDICAL_ROLES.has(a.clinicianRole.toUpperCase())) return 'primary_care';
  if (PRIMARY_CARE_TYPE.test(a.type ?? '')) return 'primary_care';
  return appointmentServiceType({ type: a.type, notes: a.notes });
}

export function isWalkIn(a: Pick<CensusAppointment, 'type'>): boolean {
  return WALK_IN_TYPE.test(a.type ?? '');
}

/** The 14 trend dates ending with `date` (oldest first). */
export function trendDates(date: string, days = CENSUS_TREND_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => addDaysYmd(date, i - (days - 1)));
}

type GroupAcc = { counts: StatusCounts; telehealth: number; inPerson: number; seen: Set<string> };
const groupAcc = (): GroupAcc => ({ counts: emptyCounts(), telehealth: 0, inPerson: 0, seen: new Set() });
function addToGroup(g: GroupAcc, a: CensusAppointment) {
  addStatus(g.counts, a.status);
  if (a.status !== 'CANCELLED') {
    if (a.isVirtual) g.telehealth += 1;
    else g.inPerson += 1;
  }
  if (isArrived(a.status)) g.seen.add(a.clientId);
}
const toGroup = (key: string, label: string, g: GroupAcc): CensusGroup => ({
  key, label, counts: g.counts, telehealth: g.telehealth, inPerson: g.inPerson, clientsSeen: g.seen.size,
});

// ─── build ───────────────────────────────────────────────────────────────────

export function buildPracticeCensus(input: CensusInput): PracticeCensus {
  const { date, timeZone } = input;
  const locIds = new Set(input.locations.map((l) => l.id));
  const locName = new Map(input.locations.map((l) => [l.id, l.name]));
  const filter = input.locationId && locIds.has(input.locationId) ? input.locationId : null;
  const homeKey = (id: string | null | undefined) => (id && locIds.has(id) ? id : UNASSIGNED_LOCATION);
  const inScope = (k: string) => !filter || k === filter;
  const resolveAppt = buildAppointmentLocationResolver(input.locations);
  const grouping = input.grouping ?? 'location';
  const noneLabel = grouping === 'facility' ? 'No Valant facility' : 'No location';
  const today = practiceYmd(input.now, timeZone);
  const dates = trendDates(date);
  const dateSet = new Set(dates);

  // Residential attribution: one configured residential site holds every resident; otherwise client home.
  const capacitySites = [...new Set(input.capacity.map((c) => c.locationId).filter((id) => locIds.has(id)))];
  const attribution: PracticeCensus['residential']['attribution'] = capacitySites.length === 1 ? 'residential_site' : 'client_home';
  const residentKey = (r: CensusResident) => (attribution === 'residential_site' ? capacitySites[0] : homeKey(r.clientLocationId));

  type LocAcc = {
    all: GroupAcc;
    byService: Map<CensusService, GroupAcc>;
    prp: { n: number; c: Set<string> };
    tms: { n: number; c: Set<string> };
    spravato: { n: number; c: Set<string> };
    seen: Set<string>;
    walkIns: number;
    inferred: number;
    residents: number;
    admissions: number;
    discharges: number;
    crisis: number;
  };
  const acc = new Map<string, LocAcc>();
  const loc = (k: string) => {
    let a = acc.get(k);
    if (!a) {
      a = {
        all: groupAcc(), byService: new Map(), prp: { n: 0, c: new Set() }, tms: { n: 0, c: new Set() }, spravato: { n: 0, c: new Set() },
        seen: new Set(), walkIns: 0, inferred: 0, residents: 0, admissions: 0, discharges: 0, crisis: 0,
      };
      acc.set(k, a);
    }
    return a;
  };
  for (const l of input.locations) if (inScope(l.id)) loc(l.id);

  const total = groupAcc();
  const totalByService = new Map<CensusService, GroupAcc>();
  const clinicians = new Map<string, { label: string; g: GroupAcc }>();
  const totalSeen = new Set<string>();
  let walkIns = 0;
  let protectedAppointments = 0;
  let inferredAppointments = 0;

  const trend = new Map(dates.map((d) => [d, { seen: new Set<string>(), completed: 0, booked: 0, noShow: 0 }]));

  for (const a of input.appointments) {
    const eff = effectiveLocation({ appointmentLocation: a.appointmentLocation, clientLocationId: a.clientLocationId }, resolveAppt);
    const k = homeKey(eff.locationId);
    if (!inScope(k)) continue;
    const day = practiceYmd(a.startsAt, timeZone);
    if (!dateSet.has(day)) continue;
    const t = trend.get(day)!;
    if (a.status !== 'CANCELLED') t.booked += 1;
    if (a.status === 'COMPLETED') t.completed += 1;
    if (a.status === 'NO_SHOW') t.noShow += 1;
    if (isArrived(a.status)) t.seen.add(a.clientId);
    if (day !== date) continue;

    const svc = censusService(a);
    const l = loc(k);
    addToGroup(l.all, a);
    if (!l.byService.has(svc)) l.byService.set(svc, groupAcc());
    addToGroup(l.byService.get(svc)!, a);
    addToGroup(total, a);
    if (!totalByService.has(svc)) totalByService.set(svc, groupAcc());
    addToGroup(totalByService.get(svc)!, a);
    const ck = a.clinicianId ?? '__none__';
    if (!clinicians.has(ck)) clinicians.set(ck, { label: a.clinicianId ? a.clinicianName?.trim() || 'Unnamed clinician' : 'No clinician assigned', g: groupAcc() });
    addToGroup(clinicians.get(ck)!.g, a);
    if (isArrived(a.status)) {
      l.seen.add(a.clientId);
      totalSeen.add(a.clientId);
    }
    if (isWalkIn(a) && a.status !== 'CANCELLED') {
      l.walkIns += 1;
      walkIns += 1;
    }
    if (eff.inferred) {
      l.inferred += 1;
      inferredAppointments += 1;
    }
    if (a.protected) protectedAppointments += 1;
  }

  const sessionPass = (rows: CensusSession[], pick: (l: LocAcc) => { n: number; c: Set<string> }) => {
    const tot = { n: 0, c: new Set<string>() };
    for (const s of rows) {
      const k = homeKey(s.clientLocationId);
      if (!inScope(k)) continue;
      const day = storedDayYmd(s.date, timeZone);
      if (dateSet.has(day)) trend.get(day)!.seen.add(s.clientId);
      if (day !== date) continue;
      const p = pick(loc(k));
      p.n += 1;
      p.c.add(s.clientId);
      loc(k).seen.add(s.clientId);
      totalSeen.add(s.clientId);
      tot.n += 1;
      tot.c.add(s.clientId);
    }
    return { encounters: tot.n, clients: tot.c.size };
  };
  const prpTotal = sessionPass(input.prpAttendance, (l) => l.prp);
  const tmsTotal = sessionPass(input.tmsSessions, (l) => l.tms);
  const spravatoTotal = sessionPass(input.spravatoSessions, (l) => l.spravato);

  // Residential
  const scopedResidents = input.residents.filter((r) => inScope(residentKey(r)));
  const current = scopedResidents.filter((r) => r.active);
  let admissions = 0;
  let discharges = 0;
  for (const r of scopedResidents) {
    const l = loc(residentKey(r));
    if (r.active) l.residents += 1;
    if (storedDayYmd(r.admitDate, timeZone) === date) {
      l.admissions += 1;
      admissions += 1;
    }
    if (!r.active && practiceYmd(r.updatedAt, timeZone) === date) {
      l.discharges += 1;
      discharges += 1;
    }
  }
  const capSummary = summarizeCapacity(input.capacity, filter);
  const levels = occupancyByLevel(capSummary, current.map((r) => r.program));

  // Crisis
  const byPriority: Record<string, number> = {};
  let crisisOpened = 0;
  for (const e of input.crisisEpisodes) {
    const k = homeKey(e.clientLocationId);
    if (!inScope(k) || practiceYmd(e.startedAt, timeZone) !== date) continue;
    loc(k).crisis += 1;
    crisisOpened += 1;
    byPriority[String(e.priority)] = (byPriority[String(e.priority)] ?? 0) + 1;
  }

  // Caseload
  const caseAcc = new Map<string, CaseloadRow>();
  const caseRow = (k: string) => {
    let r = caseAcc.get(k);
    if (!r) {
      r = { locationId: k === UNASSIGNED_LOCATION ? null : k, name: k === UNASSIGNED_LOCATION ? noneLabel : locName.get(k) ?? 'Unknown location', activeClients: 0, prpActive: 0, residentialResidents: 0, primaryCareActive: 0, tmsActive: 0, spravatoActive: 0 };
      caseAcc.set(k, r);
    }
    return r;
  };
  for (const l of input.locations) if (inScope(l.id)) caseRow(l.id);
  const addCase = (rows: { locationId: string | null; count: number }[], f: keyof Omit<CaseloadRow, 'locationId' | 'name'>) => {
    for (const g of rows) {
      const k = homeKey(g.locationId);
      if (inScope(k)) caseRow(k)[f] += g.count;
    }
  };
  addCase(input.caseload.activeClients, 'activeClients');
  addCase(input.caseload.prpActive, 'prpActive');
  addCase(input.caseload.primaryCareActive, 'primaryCareActive');
  addCase(input.caseload.tmsActive, 'tmsActive');
  addCase(input.caseload.spravatoActive, 'spravatoActive');
  for (const r of current) caseRow(residentKey(r)).residentialResidents += 1;
  const caseRows = [...caseAcc.values()].filter((r) => r.locationId !== null || Object.values(r).some((v) => typeof v === 'number' && v > 0));
  const caseTotals = { activeClients: 0, prpActive: 0, residentialResidents: 0, primaryCareActive: 0, tmsActive: 0, spravatoActive: 0 };
  for (const r of caseRows) for (const f of Object.keys(caseTotals) as (keyof typeof caseTotals)[]) caseTotals[f] += r[f];

  const serviceGroups = (m: Map<CensusService, GroupAcc>) =>
    SERVICE_ORDER.filter((s) => m.has(s)).map((s) => toGroup(s, CENSUS_SERVICE_LABELS[s], m.get(s)!));

  const locations: CensusLocation[] = [...acc.entries()]
    .filter(([k, a]) => k !== UNASSIGNED_LOCATION || a.all.counts.booked + a.all.counts.cancelled + a.prp.n + a.tms.n + a.spravato.n + a.residents + a.admissions + a.discharges + a.crisis > 0)
    .map(([k, a]) => ({
      locationId: k === UNASSIGNED_LOCATION ? null : k,
      name: k === UNASSIGNED_LOCATION ? noneLabel : locName.get(k) ?? 'Unknown location',
      appointments: toGroup(k, 'All appointments', a.all),
      byService: serviceGroups(a.byService),
      prp: { encounters: a.prp.n, clients: a.prp.c.size },
      tms: { encounters: a.tms.n, clients: a.tms.c.size },
      spravato: { encounters: a.spravato.n, clients: a.spravato.c.size },
      uniqueClientsSeen: a.seen.size,
      walkIns: a.walkIns,
      inferredAppointments: a.inferred,
      residents: a.residents,
      admissions: a.admissions,
      discharges: a.discharges,
      crisisOpened: a.crisis,
    }))
    .sort((x, y) => (x.locationId === null ? 1 : y.locationId === null ? -1 : 0));

  const notes: string[] = [
    'Seen = checked in, in session or completed appointments, PRP attendance, TMS and Spravato sessions; each client counted once.',
    ...(grouping === 'facility'
      ? [
          "Rows are the practice's Valant facilities. Appointments have no facility: each is counted at the client's Valant facility (inferred).",
          "PRP, TMS, Spravato, residential, crisis and caseload counts use the client's Valant facility.",
          ...(input.facilityNotes ?? []),
        ]
      : [
          input.appointmentLocationColumn
            ? "Appointment location: the location on the appointment, else the client's home location (inferred)."
            : "Appointments have no location column in this database; every appointment location is the client's home location.",
          'PRP, TMS, Spravato, residential, crisis and caseload counts use the client home location.',
        ]),
    'Primary care = visits by a Physician / Medical NP / Medical assistant, or typed as primary care. Therapy and medication management come from the Valant code, else the appointment type.',
    'Walk-ins: Altrixs has no walk-in flag; counted only when the appointment type says walk-in.',
    'Residential discharges: residents marked inactive whose record was last changed on this day (no discharge date is stored).',
    'Residents shown are the current census (now), not as of a past date.',
  ];
  if (attribution === 'residential_site' && capacitySites[0]) notes.push(`All residents are counted at ${locName.get(capacitySites[0]) ?? 'the residential site'}, the only location with residential beds configured.`);
  if (input.unlinkedResidents > 0) notes.push(`${input.unlinkedResidents} active residential record(s) have no linked client chart and are not counted (their organization cannot be verified).`);
  if (protectedAppointments > 0) notes.push(`${protectedAppointments} appointment(s) belong to protected (Part 2 / sensitive) records: counted, never named.`);

  return {
    generatedAt: input.now.toISOString(),
    grouping,
    date,
    timeZone,
    windowStart: input.window.start.toISOString(),
    windowEnd: input.window.end.toISOString(),
    when: date === today ? 'today' : date < today ? 'past' : 'future',
    location: filter ? { id: filter, name: locName.get(filter) ?? 'Unknown location' } : null,
    totals: {
      appointments: toGroup('all', 'All appointments', total),
      byService: serviceGroups(totalByService),
      prp: prpTotal,
      tms: tmsTotal,
      spravato: spravatoTotal,
      uniqueClientsSeen: totalSeen.size,
      walkIns,
      protectedAppointments,
      inferredAppointments,
    },
    locations,
    clinicians: [...clinicians.entries()]
      .map(([k, c]) => toGroup(k, c.label, c.g))
      .sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : b.counts.booked - a.counts.booked || a.label.localeCompare(b.label))),
    residential: {
      configured: capSummary.configured,
      migrationPending: Boolean(input.capacityMigrationPending),
      levels,
      total: totalOccupancy(levels),
      admissions,
      discharges,
      unlinkedExcluded: input.unlinkedResidents,
      attribution,
    },
    crisis: { opened: crisisOpened, byPriority },
    trend: dates.map((d) => {
      const t = trend.get(d)!;
      return { date: d, clientsSeen: t.seen.size, completed: t.completed, booked: t.booked, noShow: t.noShow };
    }),
    caseload: { rows: caseRows, totals: caseTotals },
    notes,
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no spreadsheet formulas
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const COUNT_HEADERS = ['Booked', 'Not arrived', 'Checked in', 'In session', 'Completed', 'No-show', 'Late cancel', 'Cancelled', 'Remaining', 'Telehealth', 'In person', 'Clients seen'];
const countCells = (g: CensusGroup) => [
  g.counts.booked, g.counts.notArrived, g.counts.checkedIn, g.counts.inSession, g.counts.completed, g.counts.noShow,
  g.counts.lateCancel, g.counts.cancelled, g.counts.remaining, g.telehealth, g.inPerson, g.clientsSeen,
];

/** Counts only (no client names or ids). */
export function censusCsv(c: PracticeCensus): string {
  const rows: (string | number | null)[][] = [];
  rows.push(['Practice census', c.date, c.timeZone, c.location ? c.location.name : c.grouping === 'facility' ? 'All facilities' : 'All locations', c.grouping === 'facility' ? 'By Valant facility' : 'By location']);
  rows.push([]);
  rows.push(['Section', 'Location', 'Group', ...COUNT_HEADERS]);
  rows.push(['Appointments', 'All', 'All appointments', ...countCells(c.totals.appointments)]);
  for (const g of c.totals.byService) rows.push(['Appointments', 'All', g.label, ...countCells(g)]);
  for (const l of c.locations) {
    rows.push(['Appointments', l.name, 'All appointments', ...countCells(l.appointments)]);
    for (const g of l.byService) rows.push(['Appointments', l.name, g.label, ...countCells(g)]);
  }
  for (const g of c.clinicians) rows.push(['Clinician', 'All', g.label, ...countCells(g)]);
  rows.push([]);
  rows.push(['Section', 'Location', 'Clients seen', 'Walk-ins', 'PRP encounters', 'PRP clients', 'TMS sessions', 'Spravato sessions', 'Residents', 'Admissions', 'Discharges', 'Crisis episodes opened']);
  rows.push(['Day', 'All', c.totals.uniqueClientsSeen, c.totals.walkIns, c.totals.prp.encounters, c.totals.prp.clients, c.totals.tms.encounters, c.totals.spravato.encounters, c.residential.total.residents, c.residential.admissions, c.residential.discharges, c.crisis.opened]);
  for (const l of c.locations) {
    rows.push(['Day', l.name, l.uniqueClientsSeen, l.walkIns, l.prp.encounters, l.prp.clients, l.tms.encounters, l.spravato.encounters, l.residents, l.admissions, l.discharges, l.crisisOpened]);
  }
  rows.push([]);
  rows.push(['Section', 'ASAM level', 'Beds', 'Residents', 'Open', 'Occupancy %']);
  for (const l of c.residential.levels) rows.push(['Residential', l.level, l.beds ?? 'Beds not configured', l.residents, l.open, l.occupancyPct]);
  rows.push([]);
  rows.push(['Section', 'Date', 'Clients seen', 'Completed', 'Booked', 'No-show']);
  for (const t of c.trend) rows.push(['Trend', t.date, t.clientsSeen, t.completed, t.booked, t.noShow]);
  rows.push([]);
  rows.push(['Section', 'Location', 'Active clients', 'PRP active', 'Residential residents', 'Primary care active', 'TMS active', 'Spravato active']);
  for (const r of c.caseload.rows) rows.push(['Caseload', r.name, r.activeClients, r.prpActive, r.residentialResidents, r.primaryCareActive, r.tmsActive, r.spravatoActive]);
  rows.push(['Caseload', 'Total', c.caseload.totals.activeClients, c.caseload.totals.prpActive, c.caseload.totals.residentialResidents, c.caseload.totals.primaryCareActive, c.caseload.totals.tmsActive, c.caseload.totals.spravatoActive]);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Practice overview "By facility": the practice's sites are its Valant facilities (Setup › Facilities),
 * as imported into FacilityLocationMap by the facility list import (valantFacilities.ts). Pure: no prisma.
 *
 * Rules (nothing is invented):
 *  - Sites = FacilityLocationMap rows the facility list import touched (facilityImportedAt set). Until the
 *    list is imported, the facilities the owner listed from Valant are shown as "expected", with no figures.
 *  - Clients: Client.valantFacility (the Valant client export's assigned-facility value) resolved against the
 *    sites: the facility name itself, else a billing entity that has exactly ONE facility (Valant's client
 *    export gives the facility's Name = billing entity, e.g. "MD Behavioral Health - PRP"). An entity with
 *    several facilities ("MD Behavioral Health") is ambiguous and counted nowhere. Never from the city.
 *  - Money / visits / payers: ValantTransaction.facility equal to the facility name (normFacility equality:
 *    trim, single spaces, case; never a prefix or "contains" match).
 *  - Appointments carry no facility: derived from the client's resolved facility and labelled inferred.
 *  - Programs come from the facility's saved program mapping (prp / iop / primary_care).
 */
import { normFacility, programLabel } from './facilityMapping';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { lastMonths, noShowRate, type ApptStats } from './overview';
import {
  valantKpis,
  valantPayerMix,
  type AltrixsClaimSummary,
  type AltrixsPaymentSummary,
  type PayerMixRow,
  type ValantKpis,
} from '@/lib/billing/overviewValant';
import { addValantGroup, emptyValantMoney } from '@/lib/reports/outcomesReports';

/** The owner's Valant facility list (Practice overview › locations, 2026-10-18). Shown only as "expected" until imported. */
export const EXPECTED_VALANT_FACILITIES: readonly { facilityName: string; billingEntityName: string; timezone: string; active: boolean }[] = [
  { facilityName: 'Family Practice', billingEntityName: 'MD Behavioral Health', timezone: 'America/New_York', active: true },
  { facilityName: 'Outpatient Mental Health Clinic - Bowie', billingEntityName: 'MD Behavioral Health', timezone: 'America/New_York', active: true },
  { facilityName: 'IOP', billingEntityName: 'MD Behavioral Health', timezone: 'America/New_York', active: true },
  { facilityName: 'PRP', billingEntityName: 'MD Behavioral Health - PRP', timezone: 'America/New_York', active: true },
  { facilityName: 'Outpatient Mental Health Clinic - STM', billingEntityName: 'MD Behavioral Health - STM', timezone: 'America/New_York', active: true },
];

export const FACILITY_IMPORT_HREF = '/dashboard/admin/migration?tab=facilities';
export const CLIENT_IMPORT_HREF = '/dashboard/admin/migration';
export const BILLING_PROVIDERS_HREF = '/dashboard/practice-setup?section=billing';
export const JOURNAL_IMPORT_HREF = '/dashboard/admin/migration?tab=transactions';
export const NOT_RECORDED_LABEL = 'Facility not recorded';
export const NOT_IN_LIST_LABEL = 'Facilities not in the facility list';

export type FacilitySiteRow = {
  facilityName: string;
  billingEntityName: string | null;
  timezone: string | null;
  sourceActive: boolean | null;
  kind: string;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  /** set by the facility list import; rows without it are mappings only, not sites */
  facilityImportedAt: Date | string | null;
};

export type ClientFacilityBasis = 'facility' | 'billing_entity' | 'ambiguous' | 'unmatched' | 'missing';
export type ClientFacilityResolution = { facilityName: string | null; basis: ClientFacilityBasis; candidates: string[] };

/** Client.valantFacility -> site. Exact facility name, else a billing entity with exactly one facility. */
export function resolveClientFacility(
  raw: string | null | undefined,
  sites: readonly Pick<FacilitySiteRow, 'facilityName' | 'billingEntityName'>[]
): ClientFacilityResolution {
  const want = normFacility(raw);
  if (!want) return { facilityName: null, basis: 'missing', candidates: [] };
  const byName = sites.find((s) => normFacility(s.facilityName) === want);
  if (byName) return { facilityName: byName.facilityName, basis: 'facility', candidates: [] };
  const byEntity = sites.filter((s) => s.billingEntityName && normFacility(s.billingEntityName) === want);
  if (byEntity.length === 1) return { facilityName: byEntity[0].facilityName, basis: 'billing_entity', candidates: [] };
  if (byEntity.length > 1) return { facilityName: null, basis: 'ambiguous', candidates: byEntity.map((s) => s.facilityName) };
  return { facilityName: null, basis: 'unmatched', candidates: [] };
}

/** Memoized resolver over raw values (many clients share a handful of values). */
export function buildClientFacilityResolver(sites: readonly Pick<FacilitySiteRow, 'facilityName' | 'billingEntityName'>[]) {
  const cache = new Map<string, ClientFacilityResolution>();
  return (raw: string | null | undefined): ClientFacilityResolution => {
    const k = normFacility(raw);
    let r = cache.get(k);
    if (!r) cache.set(k, (r = resolveClientFacility(raw, sites)));
    return r;
  };
}

/** Sites of the practice: rows the facility list import touched, by name. */
export function importedSites(rows: readonly FacilitySiteRow[]): FacilitySiteRow[] {
  return rows.filter((r) => r.facilityImportedAt).sort((a, b) => a.facilityName.localeCompare(b.facilityName));
}

export type FacilityOverviewInput = {
  now: Date;
  timeZone?: string;
  /** every saved Valant FacilityLocationMap row; only facility-import rows become sites */
  facilityRows: FacilitySiteRow[];
  locations: { id: string; name: string }[];
  /** false when Client.valantFacility does not exist in this database (migration not run) */
  clientFacilityColumn: boolean;
  /** Client.groupBy(valantFacility, status) */
  clientFacilityGroups: { valantFacility: string | null; status: string; count: number }[];
  /** ValantTransaction by facility, category, service month, last-90-days flag (same query as the location overview) */
  valantGroups: { facility: string | null; category: string; month: string | null; in90: boolean; cents: number; count: number }[];
  /** last 90 days, per facility (null = no facility on the row): distinct patient + service date with a positive charge, distinct patients billed */
  visitGroups: { facility: string | null; visits: number; clients: number }[];
  /** last 90 days, per facility (null included) × insurance cell × category */
  payerGroups: { facility: string | null; insurance: string | null; category: string; cents: number; count: number }[];
  /** per facility: distinct patients whose FIRST journal charge at that facility falls in the last 30 / 90 days */
  firstChargeGroups: { facility: string | null; first30: number; first90: number }[];
  /** earliest service date on the imported journal (null = none) */
  journalFirstServiceDate: Date | string | null;
  /** appointments in the 6-month window .. today + 30 with the client's Valant facility */
  appointments: { clientValantFacility: string | null; status: string; startsAt: Date }[];
  /** Altrixs claims / payments created in the last 90 days (live billing; separate from Valant, never summed) */
  altrixs?: { claims: AltrixsClaimSummary; payments: AltrixsPaymentSummary | null } | null;
  /** distinct patients billed in the last 90 days, practice-wide (a patient at two facilities counts once) */
  practiceBilledClients90?: number;
  programs: {
    prpEnrollments: { status: string; count: number }[];
    prpAttendance90: { encounters: number; clients: number };
    primaryCareActive: number;
    medicalVisits90: number;
  };
};

export type FacilityProgram =
  | { key: 'prp'; label: string; enrollments: { total: number; byStatus: Record<string, number> }; attendance90: { encounters: number; clients: number }; source: string }
  | { key: 'primary_care'; label: string; activePatients: number; visits90: number; source: string }
  | { key: string; label: string; note: string };

export type FacilitySite = {
  facilityName: string;
  billingEntityName: string | null;
  timezone: string | null;
  active: boolean | null;
  kind: string;
  programKey: string | null;
  /** Altrixs location / program the facility maps to (scheduling, location features) */
  mappedTo: string;
  needsConfirmation: boolean;
  /** billing entity differs from the practice's main entity (likely a separate billing provider / NPI) */
  separateBillingEntity: boolean;
  clients: { assigned: number; active: number; viaBillingEntity: number } | null;
  newClients: { first30: number | null; first90: number | null };
  billed90: { visits: number; clients: number };
  money90: ValantKpis;
  months: { month: string; chargesCents: number; paymentsCents: number; adjustmentsCents: number }[];
  payerMix: PayerMixRow[];
  appointments: { last90: ApptStats; upcoming30: number };
  program: FacilityProgram | null;
};

/** Journal money that is not at one of the sites, so the breakdown always sums to the practice total */
export type FacilityBreakdownExtra = {
  key: 'not_recorded' | 'not_in_list';
  label: string;
  rows90: number;
  money90: ValantKpis;
  visits90: number;
  months: { month: string; chargesCents: number; paymentsCents: number; adjustmentsCents: number }[];
};

export type PracticeFinancials = {
  /** every Valant row in the last 90 days, whatever its facility */
  valant90: ValantKpis;
  rows90: number;
  billedClients90: number | null;
  months: { month: string; chargesCents: number; paymentsCents: number; adjustmentsCents: number }[];
  payerMix: PayerMixRow[];
  payerRowsWithInsurance: number;
  altrixs: { claims: AltrixsClaimSummary; payments: AltrixsPaymentSummary | null } | null;
  /** last 90 days, rows with no facility on them (Transactions report rows; the journal carries facility) */
  notRecorded: { rows: number; chargesCents: number; paymentsCents: number };
};

export type FacilityOverview = {
  /** facility_import = sites from the imported list; expected = list not imported yet (no figures) */
  source: 'facility_import' | 'expected';
  sites: FacilitySite[];
  /** expected facilities (owner's Valant list) that are not among the imported sites */
  expected: { facilityName: string; billingEntityName: string; timezone: string; active: boolean }[];
  mainBillingEntity: string | null;
  months: string[];
  totals: { assignedClients: number; activeClients: number; charges90Cents: number; payments90Cents: number; visits90: number };
  clientAssignment: {
    column: boolean;
    clientsTotal: number;
    resolved: number;
    withoutFacility: number;
    ambiguous: { value: string; clients: number; candidates: string[] }[];
    unmatched: { value: string; clients: number }[];
  };
  /** journal facilities (last 6 months) that are not one of the imported sites (all of them before the list is imported) */
  otherJournalFacilities: { facility: string; rows: number; charges90Cents: number }[];
  noFacilityRows90: number;
  journalImported: boolean;
  journalFirstServiceDate: string | null;
  appointmentsInferred: { total90: number; noFacility90: number };
  notes: string[];
  links: { facilityImport: string; clientImport: string; billingProviders: string; journalImport: string };
  practice: PracticeFinancials;
  /** "Facility not recorded" / "not in the facility list" rows (only when they hold rows) */
  extras: FacilityBreakdownExtra[];
};

const emptyAppt = (): ApptStats => ({ total: 0, completed: 0, noShow: 0, lateCancel: 0, cancelled: 0, noShowRate: null, inferred: 0 });

/** The most common billing entity among the sites ("MD Behavioral Health"). */
export function mainEntityOf(rows: readonly { billingEntityName: string | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.billingEntityName) counts.set(r.billingEntityName, (counts.get(r.billingEntityName) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = k;
  return best;
}

export function buildFacilityOverview(input: FacilityOverviewInput): FacilityOverview {
  const { now } = input;
  const tz = input.timeZone || DEFAULT_PRACTICE_TIME_ZONE;
  const today = practiceToday(tz, now);
  const months = lastMonths(now, 6, tz);
  const since90 = practiceDayBounds(addDaysYmd(today, -89), tz).start;
  const since30Ymd = addDaysYmd(today, -29);
  const since90Ymd = addDaysYmd(today, -89);
  const until30 = practiceDayBounds(addDaysYmd(today, 30), tz).end;
  const sitesRaw = importedSites(input.facilityRows);
  const imported = sitesRaw.length > 0;
  const siteKey = new Map(sitesRaw.map((s) => [normFacility(s.facilityName), s.facilityName]));
  const siteOf = (facility: string | null | undefined) => siteKey.get(normFacility(facility)) ?? null;
  const resolveClient = buildClientFacilityResolver(sitesRaw);
  const locName = new Map(input.locations.map((l) => [l.id, l.name]));
  const mainEntity = mainEntityOf(sitesRaw.length ? sitesRaw : EXPECTED_VALANT_FACILITIES);
  const journalFirst = input.journalFirstServiceDate
    ? (typeof input.journalFirstServiceDate === 'string' ? input.journalFirstServiceDate : input.journalFirstServiceDate.toISOString()).slice(0, 10)
    : null;

  type Acc = {
    assigned: number; active: number; viaEntity: number;
    groups90: { category: string; cents: number; count: number }[];
    monthMoney: Map<string, ReturnType<typeof emptyValantMoney>>;
    payer: { insurance: string | null; category: string; cents: number; count: number }[];
    visits: number; billedClients: number; first30: number; first90: number;
    appt: ApptStats; upcoming30: number;
  };
  const acc = new Map<string, Acc>();
  for (const s of sitesRaw) {
    acc.set(s.facilityName, {
      assigned: 0, active: 0, viaEntity: 0, groups90: [], monthMoney: new Map(), payer: [], visits: 0, billedClients: 0,
      first30: 0, first90: 0, appt: emptyAppt(), upcoming30: 0,
    });
  }

  // Clients
  let clientsTotal = 0;
  let resolved = 0;
  let withoutFacility = 0;
  const ambiguous = new Map<string, { value: string; clients: number; candidates: string[] }>();
  const unmatched = new Map<string, { value: string; clients: number }>();
  if (input.clientFacilityColumn) {
    for (const g of input.clientFacilityGroups) {
      clientsTotal += g.count;
      const r = resolveClient(g.valantFacility);
      if (r.facilityName) {
        const a = acc.get(r.facilityName)!;
        a.assigned += g.count;
        if (g.status === 'ACTIVE') a.active += g.count;
        if (r.basis === 'billing_entity') a.viaEntity += g.count;
        resolved += g.count;
      } else if (r.basis === 'missing') {
        withoutFacility += g.count;
      } else if (r.basis === 'ambiguous') {
        const k = normFacility(g.valantFacility);
        const e = ambiguous.get(k) ?? { value: (g.valantFacility ?? '').trim(), clients: 0, candidates: r.candidates };
        e.clients += g.count;
        ambiguous.set(k, e);
      } else {
        const k = normFacility(g.valantFacility);
        const e = unmatched.get(k) ?? { value: (g.valantFacility ?? '').trim(), clients: 0 };
        e.clients += g.count;
        unmatched.set(k, e);
      }
    }
  }

  // Valant journal money (exact facility name)
  let noFacilityRows90 = 0;
  const other = new Map<string, { facility: string; rows: number; charges90Cents: number }>();
  let journalRows = 0;
  type ExtraAcc = { rows90: number; groups90: { category: string; cents: number; count: number }[]; visits: number; monthMoney: Map<string, ReturnType<typeof emptyValantMoney>> };
  const extraAcc = (): ExtraAcc => ({ rows90: 0, groups90: [], visits: 0, monthMoney: new Map() });
  const practiceAcc = extraAcc();
  const notRecordedAcc = extraAcc();
  const notInListAcc = extraAcc();
  const addTo = (x: ExtraAcc, g: FacilityOverviewInput['valantGroups'][number]) => {
    if (g.in90) {
      x.rows90 += g.count;
      x.groups90.push({ category: g.category, cents: g.cents, count: g.count });
    }
    if (g.month && months.includes(g.month)) {
      const m = x.monthMoney.get(g.month) ?? emptyValantMoney();
      addValantGroup(m, g);
      x.monthMoney.set(g.month, m);
    }
  };
  for (const g of input.valantGroups) {
    addTo(practiceAcc, g);
    const fac = g.facility?.trim() || null;
    if (!fac) {
      if (g.in90) noFacilityRows90 += g.count;
      addTo(notRecordedAcc, g);
      continue;
    }
    journalRows += g.count;
    const site = siteOf(fac);
    if (!site) {
      addTo(notInListAcc, g);
      const k = normFacility(fac);
      const o = other.get(k) ?? { facility: fac, rows: 0, charges90Cents: 0 };
      o.rows += g.count;
      if (g.in90 && g.category === 'charge') o.charges90Cents += g.cents;
      other.set(k, o);
      continue;
    }
    const a = acc.get(site)!;
    if (g.in90) a.groups90.push({ category: g.category, cents: g.cents, count: g.count });
    if (g.month && months.includes(g.month)) {
      const m = a.monthMoney.get(g.month) ?? emptyValantMoney();
      addValantGroup(m, g);
      a.monthMoney.set(g.month, m);
    }
  }
  let practiceVisits = 0;
  for (const v of input.visitGroups) {
    practiceVisits += v.visits;
    const site = siteOf(v.facility);
    if (!site) {
      (v.facility?.trim() ? notInListAcc : notRecordedAcc).visits += v.visits;
      continue;
    }
    const a = acc.get(site)!;
    a.visits += v.visits;
    a.billedClients += v.clients;
  }
  const practicePayer: { insurance: string | null; category: string; cents: number; count: number }[] = [];
  for (const p of input.payerGroups) {
    practicePayer.push({ insurance: p.insurance, category: p.category, cents: p.cents, count: p.count });
    const site = siteOf(p.facility);
    if (site) acc.get(site)!.payer.push({ insurance: p.insurance, category: p.category, cents: p.cents, count: p.count });
  }
  for (const f of input.firstChargeGroups) {
    const site = siteOf(f.facility);
    if (!site) continue;
    acc.get(site)!.first30 += f.first30;
    acc.get(site)!.first90 += f.first90;
  }

  // Appointments: facility inferred from the client's resolved Valant facility
  let apptTotal90 = 0;
  let apptNoFacility90 = 0;
  for (const ap of input.appointments) {
    const t = ap.startsAt.getTime();
    const in90 = t >= since90.getTime() && t <= now.getTime();
    const r = input.clientFacilityColumn ? resolveClient(ap.clientValantFacility) : null;
    const a = r?.facilityName ? acc.get(r.facilityName) : undefined;
    if (in90) {
      apptTotal90 += 1;
      if (!a) {
        apptNoFacility90 += 1;
        continue;
      }
      a.appt.total += 1;
      a.appt.inferred += 1;
      if (ap.status === 'COMPLETED') a.appt.completed += 1;
      else if (ap.status === 'NO_SHOW') a.appt.noShow += 1;
      else if (ap.status === 'LATE_CANCEL') a.appt.lateCancel += 1;
      else if (ap.status === 'CANCELLED') a.appt.cancelled += 1;
    } else if (a && t > now.getTime() && t < until30.getTime() && ap.status !== 'CANCELLED') {
      a.upcoming30 += 1;
    }
  }

  // "New" = first journal charge at the facility in the window; only meaningful when the journal starts before it
  const can30 = journalFirst !== null && journalFirst < since30Ymd;
  const can90 = journalFirst !== null && journalFirst < since90Ymd;

  const program = (s: FacilitySiteRow): FacilityProgram | null => {
    if (s.kind !== 'program' || !s.programKey) return null;
    if (s.programKey === 'prp') {
      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const g of input.programs.prpEnrollments) {
        total += g.count;
        byStatus[g.status] = (byStatus[g.status] ?? 0) + g.count;
      }
      return {
        key: 'prp', label: programLabel('prp'), enrollments: { total, byStatus }, attendance90: input.programs.prpAttendance90,
        source: 'Altrixs PRP program (all enrollments and attendance; PRP is run by this facility)',
      };
    }
    if (s.programKey === 'primary_care') {
      return {
        key: 'primary_care', label: programLabel('primary_care'), activePatients: input.programs.primaryCareActive, visits90: input.programs.medicalVisits90,
        source: 'Altrixs primary care: active primary-care patients and medical visits, last 90 days',
      };
    }
    if (s.programKey === 'iop') return { key: 'iop', label: programLabel('iop'), note: 'Altrixs has no IOP program records yet; figures above come from the Valant journal and client facility only.' };
    return { key: s.programKey, label: programLabel(s.programKey), note: 'No Altrixs program records for this program.' };
  };

  const sites: FacilitySite[] = sitesRaw.map((s) => {
    const a = acc.get(s.facilityName)!;
    a.appt.noShowRate = noShowRate(a.appt);
    const kpis = valantKpis(a.groups90, a.visits);
    const mapped =
      s.kind === 'location' ? (s.locationId ? locName.get(s.locationId) ?? 'Unknown location' : 'No location chosen')
      : s.kind === 'program' ? `${programLabel(s.programKey)}${s.locationId && locName.get(s.locationId) ? ` at ${locName.get(s.locationId)}` : ''}`
      : 'Not mapped';
    return {
      facilityName: s.facilityName,
      billingEntityName: s.billingEntityName,
      timezone: s.timezone,
      active: s.sourceActive,
      kind: s.kind,
      programKey: s.programKey,
      mappedTo: mapped,
      needsConfirmation: s.needsConfirmation,
      separateBillingEntity: Boolean(s.billingEntityName && mainEntity && s.billingEntityName !== mainEntity),
      clients: input.clientFacilityColumn ? { assigned: a.assigned, active: a.active, viaBillingEntity: a.viaEntity } : null,
      newClients: { first30: can30 ? a.first30 : null, first90: can90 ? a.first90 : null },
      billed90: { visits: a.visits, clients: a.billedClients },
      money90: kpis,
      months: months.map((m) => {
        const mm = a.monthMoney.get(m) ?? emptyValantMoney();
        return { month: m, chargesCents: mm.chargesCents, paymentsCents: mm.insurancePaymentsCents + mm.patientPaymentsCents, adjustmentsCents: mm.adjustmentsCents };
      }),
      payerMix: valantPayerMix(a.payer, 5).topByCharges,
      appointments: { last90: a.appt, upcoming30: a.upcoming30 },
      program: program(s),
    };
  });

  const siteNames = new Set(sitesRaw.map((s) => normFacility(s.facilityName)));
  const expected = EXPECTED_VALANT_FACILITIES.filter((e) => !siteNames.has(normFacility(e.facilityName)));

  const notes: string[] = [];
  if (!imported) {
    notes.push('The Valant facility list has not been imported: the five facilities below are expected from Valant and show no figures until it is.');
  }
  if (!input.clientFacilityColumn) {
    notes.push('Client facility is not available in this database yet (migration 20261019_client_valant_facility.sql).');
  } else if (clientsTotal > 0 && resolved === 0 && withoutFacility === clientsTotal) {
    notes.push('No client has a Valant facility yet: re-import the Valant client file (Data import › Clients, "facility only") to capture it.');
  } else if (withoutFacility > 0) {
    notes.push(`${withoutFacility.toLocaleString('en-US')} clients have no Valant facility (created in Altrixs, or imported before the facility was captured).`);
  }
  if (ambiguous.size) {
    notes.push(
      `Valant's client export names the facility's billing entity; ${[...ambiguous.values()].map((v) => `"${v.value}" (${v.clients.toLocaleString('en-US')} clients)`).join(', ')} ` +
        `covers several facilities (${[...new Set([...ambiguous.values()].flatMap((v) => v.candidates))].join(', ')}), so those clients are not assigned to one. ` +
        'Their visits and money still appear under the facility on each journal row.'
    );
  }
  notes.push('Charges, payments, adjustments, visits billed and payer mix: Valant Transaction Journal rows whose facility is exactly the facility name, by date of service.');
  notes.push(`Rows always add up to the practice total: amounts on rows with no facility are under "${NOT_RECORDED_LABEL}", amounts at facilities missing from the facility list under "${NOT_IN_LIST_LABEL}".`);
  notes.push("Appointments have no facility in Altrixs: they are counted at the client's Valant facility (inferred).");
  if (journalFirst && (!can30 || !can90)) notes.push(`New clients (first journal charge at the facility) need journal history before the window; the imported journal starts ${journalFirst}.`);

  const sum = (f: (s: FacilitySite) => number) => sites.reduce((n, s) => n + f(s), 0);
  const monthsOf = (x: ExtraAcc) =>
    months.map((m) => {
      const mm = x.monthMoney.get(m) ?? emptyValantMoney();
      return { month: m, chargesCents: mm.chargesCents, paymentsCents: mm.insurancePaymentsCents + mm.patientPaymentsCents, adjustmentsCents: mm.adjustmentsCents };
    });
  const extras: FacilityBreakdownExtra[] = [];
  if (notInListAcc.rows90 > 0 || notInListAcc.monthMoney.size > 0) {
    extras.push({ key: 'not_in_list', label: NOT_IN_LIST_LABEL, rows90: notInListAcc.rows90, money90: valantKpis(notInListAcc.groups90, notInListAcc.visits), visits90: notInListAcc.visits, months: monthsOf(notInListAcc) });
  }
  if (notRecordedAcc.rows90 > 0 || notRecordedAcc.monthMoney.size > 0) {
    extras.push({ key: 'not_recorded', label: NOT_RECORDED_LABEL, rows90: notRecordedAcc.rows90, money90: valantKpis(notRecordedAcc.groups90, notRecordedAcc.visits), visits90: notRecordedAcc.visits, months: monthsOf(notRecordedAcc) });
  }
  const practiceKpis = valantKpis(practiceAcc.groups90, practiceVisits);
  const nr = valantKpis(notRecordedAcc.groups90, notRecordedAcc.visits);
  const mix = valantPayerMix(practicePayer, 8);
  return {
    source: imported ? 'facility_import' : 'expected',
    sites,
    expected: [...expected],
    mainBillingEntity: mainEntity,
    months,
    totals: {
      assignedClients: sum((s) => s.clients?.assigned ?? 0),
      activeClients: sum((s) => s.clients?.active ?? 0),
      charges90Cents: sum((s) => s.money90.chargesCents),
      payments90Cents: sum((s) => s.money90.netCollectionsCents),
      visits90: sum((s) => s.billed90.visits),
    },
    clientAssignment: {
      column: input.clientFacilityColumn,
      clientsTotal,
      resolved,
      withoutFacility,
      ambiguous: [...ambiguous.values()].sort((a, b) => b.clients - a.clients),
      unmatched: [...unmatched.values()].sort((a, b) => b.clients - a.clients),
    },
    otherJournalFacilities: [...other.values()].sort((a, b) => b.rows - a.rows),
    noFacilityRows90,
    journalImported: journalRows > 0,
    journalFirstServiceDate: journalFirst,
    appointmentsInferred: { total90: apptTotal90, noFacility90: apptNoFacility90 },
    notes,
    links: { facilityImport: FACILITY_IMPORT_HREF, clientImport: CLIENT_IMPORT_HREF, billingProviders: BILLING_PROVIDERS_HREF, journalImport: JOURNAL_IMPORT_HREF },
    practice: {
      valant90: practiceKpis,
      rows90: practiceAcc.rows90,
      billedClients90: input.practiceBilledClients90 ?? null,
      months: monthsOf(practiceAcc),
      payerMix: mix.topByCharges,
      payerRowsWithInsurance: mix.rowsWithInsurance,
      altrixs: input.altrixs ?? null,
      notRecorded: { rows: notRecordedAcc.rows90, chargesCents: nr.chargesCents, paymentsCents: nr.netCollectionsCents },
    },
    extras,
  };
}


/**
 * Valant facility name -> Altrixs location / program. Pure: no prisma, safe for tests and client code.
 *
 * Valant's Transaction Journal has a "Facility" per row. Seen on the October 2026 journal:
 *   "Outpatient Mental Health Clinic - Bowie"  -> the Bowie location
 *   "Outpatient Mental Health Clinic - STM"    -> Lexington Park (St. Mary's County). Confirmed by the owner
 *                                                  2026-10-17: Valant's client export pairs "MD Behavioral Health - STM"
 *                                                  with Lexington Park, and Valant's facility list names it so
 *   "Family Practice"                          -> program: primary care (run at Silver Spring and Bowie)
 *   "IOP"                                      -> program: intensive outpatient
 *   "PRP"                                      -> program: psychiatric rehabilitation (COMAR 10.63)
 * A suggestion is only a suggestion: rows are written to FacilityLocationMap when the owner applies them.
 */
import { PRIMARY_CARE_VALANT_FACILITY } from '@/lib/medical/medicalProgram';

export type FacilityKind = 'location' | 'program' | 'ignore';

export const PROGRAM_KEYS = ['primary_care', 'iop', 'prp'] as const;
export type ProgramKey = (typeof PROGRAM_KEYS)[number];

export const PROGRAM_LABELS: Record<string, string> = {
  primary_care: 'Primary care (Family Practice)',
  iop: 'IOP',
  prp: 'PRP (psychiatric rehabilitation)',
};

export function programLabel(key: string | null | undefined): string {
  if (!key) return 'Program';
  return PROGRAM_LABELS[key] ?? key;
}

export type LocationLite = {
  id: string;
  name: string;
  city: string | null;
  isPrimary: boolean;
  active: boolean;
};

export type FacilityMapRow = {
  facilityName: string;
  kind: FacilityKind;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  note: string | null;
};

export type FacilitySuggestion = FacilityMapRow & {
  /** exact = facility names the location; abbreviation = known short code; program; none = no idea */
  basis: 'exact' | 'abbreviation' | 'program' | 'none';
};

/** Lower case, single spaces, trimmed */
export function normFacility(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Known Valant facility abbreviations -> location name or city they mean. `confirmed` = the owner confirmed it;
 * unconfirmed ones are suggested with needsConfirmation (the owner confirms on Admin › Locations).
 */
export const FACILITY_ABBREVIATIONS: Record<string, { location: string; confirmed: boolean; note: string }> = {
  stm: {
    location: 'Lexington Park',
    confirmed: true,
    note:
      "STM = St. Mary's County (Lexington Park), confirmed by the owner 2026-10-17: Valant's client export pairs " +
      '"MD Behavioral Health - STM" with Lexington Park, as does the Valant facility list.',
  },
};

const PROGRAM_FACILITIES: Record<string, ProgramKey> = {
  [normFacility(PRIMARY_CARE_VALANT_FACILITY)]: 'primary_care',
  iop: 'iop',
  'intensive outpatient': 'iop',
  'intensive outpatient program': 'iop',
  prp: 'prp',
  'psychiatric rehabilitation program': 'prp',
};

function findLocation(term: string, locations: LocationLite[]): LocationLite | null {
  const want = normFacility(term);
  if (!want) return null;
  const pool = locations.filter((l) => l.active);
  return (
    pool.find((l) => normFacility(l.name) === want) ??
    pool.find((l) => normFacility(l.city) === want) ??
    null
  );
}

/** The site part of a facility name: text after the last " - " ("... Clinic - Bowie" -> "Bowie"), else the whole name */
export function facilitySiteTerm(facility: string): string {
  const parts = facility.split(/\s+-\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : facility).trim();
}

export function suggestFacilityMapping(facilityName: string, locations: LocationLite[]): FacilitySuggestion {
  const facility = facilityName.trim();
  const n = normFacility(facility);
  const program = PROGRAM_FACILITIES[n];
  if (program) {
    return {
      facilityName: facility,
      kind: 'program',
      locationId: null,
      programKey: program,
      needsConfirmation: false,
      note: null,
      basis: 'program',
    };
  }
  const site = facilitySiteTerm(facility);
  const exact = findLocation(site, locations) ?? findLocation(facility, locations);
  if (exact) {
    return {
      facilityName: facility,
      kind: 'location',
      locationId: exact.id,
      programKey: null,
      needsConfirmation: false,
      note: null,
      basis: 'exact',
    };
  }
  const abbr = FACILITY_ABBREVIATIONS[normFacility(site)];
  const abbrLoc = abbr ? findLocation(abbr.location, locations) : null;
  if (abbr && abbrLoc) {
    return {
      facilityName: facility,
      kind: 'location',
      locationId: abbrLoc.id,
      programKey: null,
      needsConfirmation: !abbr.confirmed,
      note: abbr.note,
      basis: 'abbreviation',
    };
  }
  return {
    facilityName: facility,
    kind: 'location',
    locationId: null,
    programKey: null,
    needsConfirmation: true,
    note: 'No location matches this facility name. Choose the location or mark it as a program.',
    basis: 'none',
  };
}

/** Suggestions for facilities that have no saved mapping yet (saved rows always win). */
export function suggestMissingMappings(
  facilities: string[],
  saved: Pick<FacilityMapRow, 'facilityName'>[],
  locations: LocationLite[]
): FacilitySuggestion[] {
  const have = new Set(saved.map((r) => normFacility(r.facilityName)));
  const seen = new Set<string>();
  const out: FacilitySuggestion[] = [];
  for (const f of facilities) {
    const n = normFacility(f);
    if (!n || have.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(suggestFacilityMapping(f, locations));
  }
  return out;
}

export type FacilityResolution =
  | { kind: 'location'; locationId: string; confirmed: boolean }
  | { kind: 'program'; programKey: string; locationId: string | null }
  | { kind: 'ignore' }
  | { kind: 'unmapped' };

export type FacilityResolver = (facility: string | null | undefined) => FacilityResolution;

/** Resolve facility names against SAVED rows only (suggestions never count as evidence). */
export function buildFacilityResolver(rows: FacilityMapRow[]): FacilityResolver {
  const byName = new Map(rows.map((r) => [normFacility(r.facilityName), r]));
  return (facility) => {
    const row = byName.get(normFacility(facility));
    if (!row) return { kind: 'unmapped' };
    if (row.kind === 'ignore') return { kind: 'ignore' };
    if (row.kind === 'program') {
      return row.programKey ? { kind: 'program', programKey: row.programKey, locationId: row.locationId } : { kind: 'unmapped' };
    }
    return row.locationId ? { kind: 'location', locationId: row.locationId, confirmed: !row.needsConfirmation } : { kind: 'unmapped' };
  };
}

/** Validate an owner edit of one mapping row; returns an error message or null. */
export function validateMappingRow(
  row: Pick<FacilityMapRow, 'kind' | 'locationId' | 'programKey'>,
  locationIds: Set<string>
): string | null {
  if (row.kind === 'location') {
    if (!row.locationId) return 'Choose the location this facility belongs to.';
    if (!locationIds.has(row.locationId)) return 'Location not found in this organization.';
    return null;
  }
  if (row.kind === 'program') {
    if (!row.programKey || !/^[a-z][a-z0-9_]{1,39}$/.test(row.programKey)) return 'Choose a program.';
    if (row.locationId && !locationIds.has(row.locationId)) return 'Location not found in this organization.';
    return null;
  }
  if (row.kind === 'ignore') return null;
  return 'Unknown mapping kind.';
}

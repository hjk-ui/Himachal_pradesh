/**
 * Valant facility list (Setup › Facilities DataGrid export, .xlsx) -> FacilityLocationMap rows. Pure: no prisma.
 *
 * Header: Facility Id, Name, Local Time Zone, Active. "Facility Id" is the facility name Valant puts on the
 * Transaction Journal ("Outpatient Mental Health Clinic - Bowie"); "Name" is the billing entity the facility
 * belongs to ("MD Behavioral Health", "MD Behavioral Health - PRP"). No patient data.
 *
 * Import rules (idempotent: importing the same file again changes nothing):
 *  - new facility: created with its attributes and the suggested mapping (the owner provided and confirmed
 *    this list, so the suggestion is applied; still editable on Admin › Locations). A facility no location or
 *    program matches is created as kind 'ignore' + needsConfirmation so it counts nowhere until mapped.
 *  - existing row edited by the owner (origin 'owner'): attributes updated, mapping kept.
 *  - existing row from a suggestion or an earlier import: attributes updated and the suggestion applied.
 */
import { headerMatches } from '@/lib/migration/valantReportCommon';
import { normFacility, suggestFacilityMapping, type FacilityKind, type LocationLite } from './facilityMapping';

export const FACILITY_LIST_HEADER = ['Facility Id', 'Name', 'Local Time Zone', 'Active'] as const;

export function facilityListHeaderOk(header: readonly string[] | undefined): boolean {
  return !!header && headerMatches(header.map((h) => String(h ?? '').trim()), FACILITY_LIST_HEADER);
}

export type FacilityListRow = {
  line: number;
  facilityName: string;
  billingEntityName: string | null;
  timezone: string | null;
  active: boolean | null;
};

export type ParsedFacilityList = {
  headerOk: boolean;
  rows: FacilityListRow[];
  duplicates: { facilityName: string; lines: number[] }[];
  errors: { line: number; error: string }[];
};

const TZ = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function parseFacilityListRecords(records: string[][]): ParsedFacilityList {
  const header = (records[0] ?? []).map((h) => stripBom(String(h ?? '')).trim());
  if (!facilityListHeaderOk(header)) return { headerOk: false, rows: [], duplicates: [], errors: [] };
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iId = col('Facility Id');
  const iName = col('Name');
  const iTz = col('Local Time Zone');
  const iActive = col('Active');
  const rows: FacilityListRow[] = [];
  const errors: ParsedFacilityList['errors'] = [];
  const seen = new Map<string, number[]>();
  records.slice(1).forEach((rec, idx) => {
    const line = idx + 2;
    const cell = (i: number) => (i >= 0 ? String(rec[i] ?? '').trim().replace(/\s+/g, ' ') : '');
    const facilityName = cell(iId);
    if (!facilityName && rec.every((c) => !String(c ?? '').trim())) return;
    if (!facilityName) {
      errors.push({ line, error: 'Facility Id is blank' });
      return;
    }
    const tzRaw = cell(iTz);
    let timezone: string | null = null;
    if (tzRaw) {
      if (TZ.test(tzRaw)) timezone = tzRaw;
      else errors.push({ line, error: `Unrecognized time zone "${tzRaw.slice(0, 60)}" (row kept without it)` });
    }
    const a = cell(iActive).toLowerCase();
    const active = ['active', 'yes', 'true', 'y', '1'].includes(a) ? true : ['inactive', 'no', 'false', 'n', '0'].includes(a) ? false : null;
    if (a && active === null) errors.push({ line, error: `Active value "${cell(iActive).slice(0, 40)}" not recognized (row kept)` });
    const key = normFacility(facilityName);
    const lines = seen.get(key) ?? [];
    lines.push(line);
    seen.set(key, lines);
    if (lines.length > 1) return; // first occurrence wins
    rows.push({ line, facilityName, billingEntityName: cell(iName) || null, timezone, active });
  });
  const duplicates = [...seen.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([k, lines]) => ({ facilityName: rows.find((r) => normFacility(r.facilityName) === k)?.facilityName ?? k, lines }));
  return { headerOk: true, rows, duplicates, errors };
}

export type ExistingFacilityRow = {
  id: string;
  facilityName: string;
  kind: string;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  note: string | null;
  origin: string;
  billingEntityName: string | null;
  timezone: string | null;
  sourceActive: boolean | null;
};

export type FacilityRowData = {
  facilityName: string;
  kind: FacilityKind;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  note: string | null;
  billingEntityName: string | null;
  timezone: string | null;
  sourceActive: boolean | null;
};

export type FacilityPlanItem = {
  line: number;
  facilityName: string;
  action: 'create' | 'update' | 'unchanged';
  /** mapping applied from the suggestion, or the owner's saved mapping kept */
  mapping: 'suggested' | 'kept_owner' | 'unmatched';
  changed: string[];
  id: string | null;
  data: FacilityRowData;
};

const MAPPING_FIELDS = ['kind', 'locationId', 'programKey', 'needsConfirmation', 'note'] as const;
const ATTR_FIELDS = ['billingEntityName', 'timezone', 'sourceActive'] as const;

export function planFacilityListImport(
  existing: ExistingFacilityRow[],
  rows: FacilityListRow[],
  locations: LocationLite[]
): FacilityPlanItem[] {
  const byName = new Map(existing.map((e) => [normFacility(e.facilityName), e]));
  return rows.map((r) => {
    const s = suggestFacilityMapping(r.facilityName, locations);
    const unmatched = s.basis === 'none';
    const suggested = unmatched
      ? { kind: 'ignore' as FacilityKind, locationId: null, programKey: null, needsConfirmation: true, note: s.note }
      : { kind: s.kind, locationId: s.locationId, programKey: s.programKey, needsConfirmation: s.needsConfirmation, note: s.note };
    const attrs = { billingEntityName: r.billingEntityName, timezone: r.timezone, sourceActive: r.active };
    const ex = byName.get(normFacility(r.facilityName));
    if (!ex) {
      return {
        line: r.line,
        facilityName: r.facilityName,
        action: 'create',
        mapping: unmatched ? 'unmatched' : 'suggested',
        changed: [],
        id: null,
        data: { facilityName: r.facilityName, ...suggested, ...attrs },
      };
    }
    const keepOwner = ex.origin === 'owner';
    const mapping = keepOwner
      ? { kind: ex.kind as FacilityKind, locationId: ex.locationId, programKey: ex.programKey, needsConfirmation: ex.needsConfirmation, note: ex.note }
      : unmatched
        // never downgrade an existing mapping to 'ignore' because the list has no match
        ? { kind: ex.kind as FacilityKind, locationId: ex.locationId, programKey: ex.programKey, needsConfirmation: ex.needsConfirmation, note: ex.note }
        : suggested;
    const data: FacilityRowData = { facilityName: ex.facilityName, ...mapping, ...attrs };
    const changed = [...MAPPING_FIELDS, ...ATTR_FIELDS].filter(
      (f) => (data[f] ?? null) !== ((ex as unknown as Record<string, unknown>)[f] ?? null)
    );
    return {
      line: r.line,
      facilityName: ex.facilityName,
      action: changed.length ? 'update' : 'unchanged',
      mapping: keepOwner ? 'kept_owner' : unmatched ? 'unmatched' : 'suggested',
      changed,
      id: ex.id,
      data,
    };
  });
}

/**
 * Billing entity names that differ from the practice's main one (the most common Name in the list, e.g.
 * "MD Behavioral Health"). Such facilities may bill under a separate NPI.
 */
export function distinctBillingEntities(rows: { facilityName: string; billingEntityName: string | null }[]): {
  mainEntity: string | null;
  others: { facilityName: string; billingEntityName: string }[];
} {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.billingEntityName) counts.set(r.billingEntityName, (counts.get(r.billingEntityName) ?? 0) + 1);
  let mainEntity: string | null = null;
  for (const [name, n] of counts) if (mainEntity === null || n > (counts.get(mainEntity) ?? 0)) mainEntity = name;
  return {
    mainEntity,
    others: rows
      .filter((r) => r.billingEntityName && r.billingEntityName !== mainEntity)
      .map((r) => ({ facilityName: r.facilityName, billingEntityName: r.billingEntityName as string })),
  };
}

/** Active locations no saved location-kind facility maps to (they have no Valant facility of their own). */
export function locationsWithoutFacility(
  locations: { id: string; name: string; active: boolean }[],
  mappings: { kind: string; locationId: string | null }[]
): { id: string; name: string }[] {
  const mapped = new Set(mappings.filter((m) => m.kind === 'location' && m.locationId).map((m) => m.locationId));
  return locations.filter((l) => l.active && !mapped.has(l.id)).map((l) => ({ id: l.id, name: l.name }));
}

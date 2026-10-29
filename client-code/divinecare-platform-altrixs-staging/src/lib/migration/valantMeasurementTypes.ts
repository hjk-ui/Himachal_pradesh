/**
 * Valant "Measurement Types" export (Setup > Measurement Types > DataGrid .xlsx, sheet "Sheet").
 * A definition catalog: names of the scores and vitals Valant records, with data type and units.
 * No patient data. Pure functions only (no Prisma, no xlsx), so the browser tab and the API
 * route share the same parsing and the tests can run it directly.
 *
 * Grouping into instruments and mapping to Altrixs instruments / MedicalVital fields use the
 * explicit tables below: exact names and prefixes, never fuzzy matching. A row that no table
 * names stays standalone and unmapped ("Score entry only").
 */

export const MEASUREMENT_TYPES_HEADER = ['Name', 'Documentation Code', 'Category', 'Data Type', 'Default Units', 'Status'] as const;

export const MEASUREMENT_DATA_TYPES = ['integer', 'real', 'blood_pressure', 'bmi', 'length', 'mass', 'smoking_status'] as const;
export type MeasurementDataType = (typeof MEASUREMENT_DATA_TYPES)[number];

/** 'vital_sign' | 'other', or the raw Valant category lower-cased with underscores */
export type MeasurementCategory = string;

/** MedicalVital columns a Valant vital maps onto (the model's canonical names, see api/medical/_lib/vitals.ts) */
export type VitalField = 'bpSystolic' | 'bpDiastolic' | 'bloodPressure' | 'heartRate' | 'respiratoryRate' | 'heightInches' | 'weightLbs' | 'bmi';

export type ParsedMeasurementType = {
  /** 1-based spreadsheet line of the first row with this definition */
  line: number;
  name: string;
  documentationCode: string | null;
  category: MeasurementCategory;
  dataType: MeasurementDataType;
  /** UCUM code (mm[Hg], kg/m2, mg/dL, /min, [in_i], [lb_av]); null when Valant has none */
  defaultUnits: string | null;
  active: boolean;
  sourceName: string;
  sourceCategory: string;
  sourceDataType: string;
  sourceUnits: string | null;
  parentInstrument: string | null;
  isSubscore: boolean;
  /** Altrixs instrument id (ASSESSMENT_CATALOG) the row belongs to */
  instrumentKey: string | null;
  vitalField: VitalField | null;
};

export type MeasurementTypeParse = {
  headerOk: boolean;
  /** Data rows read (header excluded, blank rows skipped) */
  rows: number;
  types: ParsedMeasurementType[];
  /** Same (name, code, data type, units) more than once: imported once */
  duplicates: { name: string; lines: number[] }[];
  errors: { line: number; error: string }[];
};

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function measurementHeaderOk(header: string[] | undefined): boolean {
  if (!header) return false;
  const h = header.map((c) => clean(c).toLowerCase());
  return MEASUREMENT_TYPES_HEADER.every((col, i) => h[i] === col.toLowerCase());
}

// ─── Data types, units, categories ───────────────────────────────────────────

const DATA_TYPE_MAP: Record<string, MeasurementDataType> = {
  'integer number': 'integer',
  integer: 'integer',
  'real number': 'real',
  real: 'real',
  'blood pressure': 'blood_pressure',
  'b m i': 'bmi',
  bmi: 'bmi',
  'length height': 'length',
  length: 'length',
  'mass weight': 'mass',
  mass: 'mass',
  'smoking status': 'smoking_status',
};

export function normalizeDataType(raw: string): MeasurementDataType | null {
  return DATA_TYPE_MAP[clean(raw).toLowerCase()] ?? null;
}

export const DATA_TYPE_LABEL: Record<MeasurementDataType, string> = {
  integer: 'Whole number',
  real: 'Decimal number',
  blood_pressure: 'Blood pressure',
  bmi: 'BMI',
  length: 'Length',
  mass: 'Weight',
  smoking_status: 'Smoking status',
};

/** Valant unit text (lower-cased) -> UCUM code */
const UNIT_MAP: Record<string, string> = {
  'mm[hg]': 'mm[Hg]',
  mmhg: 'mm[Hg]',
  'kg/m2': 'kg/m2',
  'kg/m^2': 'kg/m2',
  'mg/dl': 'mg/dL',
  '/min': '/min',
  bpm: '/min',
  'beats per minute': '/min',
  'breaths per minute': '/min',
  'breaths/min': '/min',
  in: '[in_i]',
  inch: '[in_i]',
  inches: '[in_i]',
  '[in_i]': '[in_i]',
  lb: '[lb_av]',
  lbs: '[lb_av]',
  '[lb_av]': '[lb_av]',
  kg: 'kg',
  cm: 'cm',
  '%': '%',
};

const UNIT_DISPLAY: Record<string, string> = {
  'mm[Hg]': 'mmHg',
  'kg/m2': 'kg/m²',
  'mg/dL': 'mg/dL',
  '/min': '/min',
  '[in_i]': 'in',
  '[lb_av]': 'lb',
  kg: 'kg',
  cm: 'cm',
  '%': '%',
};

/** UCUM code for a Valant unit; unknown text is kept as typed (reported, never guessed) */
export function normalizeUnits(raw: string): { code: string | null; known: boolean } {
  const v = clean(raw);
  if (!v) return { code: null, known: true };
  const code = UNIT_MAP[v.toLowerCase()];
  return code ? { code, known: true } : { code: v, known: false };
}

/** Display text for a stored unit code ("mm[Hg]" -> "mmHg"); breaths and beats share /min */
export function unitsDisplay(code: string | null | undefined, vitalField?: string | null): string {
  if (!code) return '';
  if (code === '/min' && vitalField === 'respiratoryRate') return 'breaths/min';
  if (code === '/min' && vitalField === 'heartRate') return 'beats/min';
  return UNIT_DISPLAY[code] ?? code;
}

export function mapCategory(raw: string): MeasurementCategory {
  const v = clean(raw).toLowerCase();
  if (v === 'vital sign' || v === 'vital signs' || v === 'vital_sign') return 'vital_sign';
  if (!v || v === 'other') return 'other';
  return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ─── Instrument grouping (explicit table) ────────────────────────────────────

export type InstrumentGroupRule = {
  /** Group name shown in the catalog */
  group: string;
  /** Name prefixes (case-insensitive). A name matches when it equals the prefix or continues with a space, "-", "_" or "/" */
  prefixes: string[];
  /** Rows that are the instrument's overall score; every other row in the group is a subscore */
  totals: string[];
  /** Altrixs instrument id (ASSESSMENT_CATALOG) for the group, when the instrument is the same one */
  instrumentKey?: string;
  /** Why a similar Altrixs instrument is deliberately not linked */
  note?: string;
};

export const INSTRUMENT_GROUPS: InstrumentGroupRule[] = [
  { group: 'Adult Hope Scale', prefixes: ['Adult Hope Scale'], totals: ['Adult Hope Scale Total Score'] },
  { group: "Children's Hope Scale", prefixes: ["Children's Hope Scale"], totals: ["Children's Hope Scale Total Score"] },
  { group: 'AIMS', prefixes: ['AIMS'], totals: ['AIMS', 'AIMS Score', 'AIMS Total Score'] },
  { group: 'ARM-5', prefixes: ['ARM-5'], totals: ['ARM-5 Total Score'] },
  {
    group: 'ASRS V1.1',
    prefixes: ['ASRS V1.1'],
    totals: ['ASRS V1.1'],
    note: 'Altrixs ASRS-v1.1 is the 6-item Part A screener; Valant "ASRS V1.1" is the full 18-item score, so it is not linked',
  },
  { group: 'BAM', prefixes: ['BAM'], totals: [], instrumentKey: 'bam' },
  {
    group: 'BDD-YBOCS',
    prefixes: ['BDD-YBOCS'],
    totals: ['BDD-YBOCS Total'],
    note: 'Body dysmorphic version; not the Altrixs Y-BOCS',
  },
  { group: 'CORE-10', prefixes: ['CORE-10'], totals: ['CORE-10 Total Score'] },
  { group: 'CY-BOCS', prefixes: ['CY-BOCS'], totals: ['CY-BOCS'], note: "Children's version; not the Altrixs Y-BOCS" },
  { group: 'DASS-21', prefixes: ['DASS 21'], totals: [], instrumentKey: 'dass-21' },
  { group: 'DASS-42', prefixes: ['DASS 42'], totals: [], instrumentKey: 'dass-42' },
  { group: 'DSM-5 Level 1 Cross-Cutting', prefixes: ['DSM-5 Level 1 Cross-Cutting'], totals: [], instrumentKey: 'dsm5-cc' },
  { group: 'EDE-Q', prefixes: ['EDE-Q'], totals: ['EDE-Q'] },
  { group: 'MDQ', prefixes: ['MDQ'], totals: [], instrumentKey: 'mdq' },
  {
    group: 'NIDA-Modified ASSIST',
    // Valant spells one row "NIDA-Modifed ASSIST" (sic)
    prefixes: ['NIDA-Modified ASSIST', 'NIDA-Modifed ASSIST'],
    totals: [],
    instrumentKey: 'nida-assist',
  },
  { group: 'Ohio Scales', prefixes: ['Ohio Scales'], totals: [] },
  { group: 'PCL-C', prefixes: ['PCL-C'], totals: ['PCL-C'], note: 'DSM-IV civilian checklist; not the Altrixs PCL-5' },
  { group: 'PCL-S', prefixes: ['PCL-S'], totals: ['PCL-S'], note: 'DSM-IV specific checklist; not the Altrixs PCL-5' },
  { group: 'PCL-5', prefixes: ['PCL5'], totals: ['PCL5 - Total'], instrumentKey: 'pcl-5' },
  { group: 'PSC-17', prefixes: ['PSC17'], totals: ['PSC17 Total Score'] },
  { group: 'SCARED-Child', prefixes: ['SCARED-child'], totals: ['SCARED-child'], instrumentKey: 'scared-c' },
  { group: 'SCARED-Parent', prefixes: ['SCARED-parent'], totals: ['SCARED-parent'], instrumentKey: 'scared-p' },
  { group: 'Sheehan Disability Scale', prefixes: ['Sheehan'], totals: ['Sheehan'], instrumentKey: 'sds' },
  { group: 'Vanderbilt-Parent', prefixes: ['Vanderbilt-parent'], totals: [], instrumentKey: 'vanderbilt' },
  { group: 'Vanderbilt-Teacher', prefixes: ['Vanderbilt-teacher'], totals: [], instrumentKey: 'vanderbilt-t' },
  { group: 'WHO-5', prefixes: ['WHO-5'], totals: ['WHO-5 Raw Score'], instrumentKey: 'who-5' },
  // Altrixs WHODAS 2.0 is the 12-item version (max 48), so the 12-item sum is its total
  { group: 'WHODAS 2.0', prefixes: ['WHODAS 2.0'], totals: ['WHODAS 2.0 12-item sum score'], instrumentKey: 'whodas' },
];

/** Single-row Valant measures that are the same score as an Altrixs instrument (exact name, case-insensitive) */
export const STANDALONE_INSTRUMENT_MAP: Record<string, string> = {
  'ace score': 'aces',
  audit: 'audit',
  'bprs 18-item': 'bprs',
  'cage-aid score': 'cage-aid',
  'ciwa-ar': 'ciwa-ar',
  crafft: 'crafft',
  'des-ii score': 'des-ii',
  'gad-7 score': 'gad-7',
  'ham-d total score': 'ham-d',
  'hdcl-c': 'hdcl-c',
  'oci-r score': 'oci-r',
  pdss: 'pdss',
  'phq-15 score': 'phq-15',
  'phq-9 score': 'phq-9',
  'phq-a total score': 'phq-a',
  spin: 'spin',
  'y-bocs': 'ybocs',
  ymrs: 'ymrs',
};

/** Valant documentation codes that are aliases of an Altrixs instrument */
export const DOC_CODE_INSTRUMENT_MAP: Record<string, string> = {
  phq9: 'phq-9',
  gad7: 'gad-7',
};

/** Valant vital documentation code (lower-case) -> MedicalVital column. Codes not listed have no column. */
export const VITAL_FIELD_MAP: Record<string, VitalField> = {
  bp: 'bloodPressure',
  sbp: 'bpSystolic',
  dbp: 'bpDiastolic',
  pulse: 'heartRate',
  respiration: 'respiratoryRate',
  height: 'heightInches',
  weight: 'weightLbs',
  bmi: 'bmi',
};

/** Valant vitals with no MedicalVital column today (kept as measures only) */
export const VITALS_WITHOUT_FIELD = ['waist', 'fasting_glucose', 'smoking'] as const;

function prefixMatches(name: string, prefix: string) {
  const n = name.toLowerCase();
  const p = prefix.toLowerCase();
  if (n === p) return true;
  return n.startsWith(p) && /[\s\-_/]/.test(n.charAt(p.length));
}

export function groupFor(name: string): InstrumentGroupRule | null {
  // Longest prefix first so a more specific rule wins
  let best: { rule: InstrumentGroupRule; len: number } | null = null;
  for (const rule of INSTRUMENT_GROUPS) {
    for (const p of rule.prefixes) {
      if (prefixMatches(name, p) && (!best || p.length > best.len)) best = { rule, len: p.length };
    }
  }
  return best?.rule ?? null;
}

export function classifyMeasurement(name: string, documentationCode: string | null, category: MeasurementCategory) {
  const code = (documentationCode ?? '').toLowerCase();
  const vitalField = VITAL_FIELD_MAP[code] ?? null;
  const rule = groupFor(name);
  if (rule) {
    return {
      parentInstrument: rule.group,
      isSubscore: !rule.totals.some((t) => t.toLowerCase() === name.toLowerCase()),
      instrumentKey: rule.instrumentKey ?? null,
      vitalField,
    };
  }
  const instrumentKey =
    category === 'vital_sign' ? null : STANDALONE_INSTRUMENT_MAP[name.toLowerCase()] ?? DOC_CODE_INSTRUMENT_MAP[code] ?? null;
  return { parentInstrument: null, isSubscore: false, instrumentKey, vitalField };
}

/** Identity of a definition: (name, documentation code, data type, units). '' stands for none. */
export function measurementIdentity(t: { name: string; documentationCode: string | null; dataType: string; defaultUnits: string | null }) {
  return [t.name, t.documentationCode ?? '', t.dataType, t.defaultUnits ?? ''].join('\u0001');
}

export function parseMeasurementTypeRecords(records: string[][]): MeasurementTypeParse {
  const [header, ...body] = records;
  const out: MeasurementTypeParse = { headerOk: measurementHeaderOk(header), rows: 0, types: [], duplicates: [], errors: [] };
  if (!out.headerOk) return out;
  const seen = new Map<string, ParsedMeasurementType>();
  const dupLines = new Map<string, number[]>();
  body.forEach((cells, i) => {
    const line = i + 2;
    if (!cells.some((c) => clean(c))) return;
    out.rows++;
    const name = clean(cells[0]);
    const codeRaw = clean(cells[1]);
    const sourceCategory = clean(cells[2]);
    const sourceDataType = clean(cells[3]);
    const unitsRaw = clean(cells[4]);
    const status = clean(cells[5]).toLowerCase();
    if (!name) return void out.errors.push({ line, error: 'Missing name' });
    const dataType = normalizeDataType(sourceDataType);
    if (!dataType) return void out.errors.push({ line, error: `Unknown data type "${sourceDataType}" for ${name}` });
    if (status && status !== 'active' && status !== 'inactive') {
      return void out.errors.push({ line, error: `Unknown status "${cells[5]}" for ${name}` });
    }
    const units = normalizeUnits(unitsRaw);
    if (!units.known) out.errors.push({ line, error: `Unrecognized units "${unitsRaw}" for ${name}: kept as typed` });
    const category = mapCategory(sourceCategory);
    const documentationCode = codeRaw || null;
    const t: ParsedMeasurementType = {
      line,
      name,
      documentationCode,
      category,
      dataType,
      defaultUnits: units.code,
      active: status !== 'inactive',
      sourceName: name,
      sourceCategory,
      sourceDataType,
      sourceUnits: unitsRaw || null,
      ...classifyMeasurement(name, documentationCode, category),
    };
    const id = measurementIdentity(t);
    if (seen.has(id)) {
      const lines = dupLines.get(id) ?? [seen.get(id)!.line];
      lines.push(line);
      dupLines.set(id, lines);
      return;
    }
    seen.set(id, t);
    out.types.push(t);
  });
  out.duplicates = [...dupLines.entries()].map(([id, lines]) => ({ name: seen.get(id)!.name, lines }));
  return out;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export type MeasurementTypeSummary = {
  types: number;
  byCategory: Record<string, number>;
  byDataType: Record<string, number>;
  instruments: { group: string; instrumentKey: string | null; rows: number; subscores: number; note?: string }[];
  groupedRows: number;
  subscores: number;
  standalone: number;
  /** Rows linked to an Altrixs instrument (group or standalone) */
  mappedRows: number;
  /** Distinct Altrixs instruments linked */
  mappedInstrumentKeys: string[];
  /** Rows that are the same score an Altrixs instrument records (linked and not a subscore) */
  instrumentTotals: number;
  /** Score rows (not vital signs) with no Altrixs instrument: recorded via "Record a measure" */
  scoreEntryOnly: number;
  vitalsMapped: { name: string; field: VitalField }[];
  vitalsUnmapped: string[];
};

export function isVitalLike(t: { category: string; vitalField?: string | null; documentationCode?: string | null; dataType: string }) {
  if (t.category === 'vital_sign' || t.vitalField || t.dataType === 'smoking_status') return true;
  return (VITALS_WITHOUT_FIELD as readonly string[]).includes((t.documentationCode ?? '').toLowerCase());
}

export function summarizeMeasurementTypes(types: ParsedMeasurementType[]): MeasurementTypeSummary {
  const count = (key: (t: ParsedMeasurementType) => string) =>
    types.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {});
  const groups = new Map<string, { group: string; instrumentKey: string | null; rows: number; subscores: number; note?: string }>();
  for (const t of types) {
    if (!t.parentInstrument) continue;
    const g = groups.get(t.parentInstrument) ?? {
      group: t.parentInstrument,
      instrumentKey: t.instrumentKey,
      rows: 0,
      subscores: 0,
      note: INSTRUMENT_GROUPS.find((r) => r.group === t.parentInstrument)?.note,
    };
    g.rows++;
    if (t.isSubscore) g.subscores++;
    groups.set(t.parentInstrument, g);
  }
  const vitals = types.filter(isVitalLike);
  const mapped = types.filter((t) => t.instrumentKey);
  return {
    types: types.length,
    byCategory: count((t) => t.category),
    byDataType: count((t) => t.dataType),
    instruments: [...groups.values()].sort((a, b) => a.group.localeCompare(b.group)),
    groupedRows: types.filter((t) => t.parentInstrument).length,
    subscores: types.filter((t) => t.isSubscore).length,
    standalone: types.filter((t) => !t.parentInstrument).length,
    mappedRows: mapped.length,
    mappedInstrumentKeys: [...new Set(mapped.map((t) => t.instrumentKey!))].sort(),
    instrumentTotals: mapped.filter((t) => !t.isSubscore).length,
    scoreEntryOnly: types.filter((t) => !isVitalLike(t) && !t.instrumentKey).length,
    vitalsMapped: vitals.filter((t) => t.vitalField).map((t) => ({ name: t.name, field: t.vitalField! })),
    vitalsUnmapped: vitals.filter((t) => !t.vitalField).map((t) => t.name),
  };
}

// ─── Import plan (idempotent upsert) ─────────────────────────────────────────

export type ExistingMeasurementType = {
  id: string;
  name: string;
  /** '' = none (the DB stores '' so the unique key holds) */
  documentationCode: string;
  dataType: string;
  defaultUnits: string;
  category: string;
  sourceName: string | null;
  sourceCategory: string | null;
  sourceDataType: string | null;
  sourceUnits: string | null;
  parentInstrument: string | null;
  isSubscore: boolean;
  instrumentKey: string | null;
  vitalField: string | null;
  source: string;
};

/** Columns the import owns. `active` is not among them: after the first import it is the practice's toggle. */
const IMPORT_FIELDS = [
  'category',
  'sourceName',
  'sourceCategory',
  'sourceDataType',
  'sourceUnits',
  'parentInstrument',
  'isSubscore',
  'instrumentKey',
  'vitalField',
] as const;

export type MeasurementTypeRow = Omit<ParsedMeasurementType, 'line' | 'documentationCode' | 'defaultUnits'> & {
  documentationCode: string;
  defaultUnits: string;
};

export function toRow(t: ParsedMeasurementType): MeasurementTypeRow {
  const { line: _line, ...rest } = t;
  return { ...rest, documentationCode: t.documentationCode ?? '', defaultUnits: t.defaultUnits ?? '' };
}

export function planMeasurementTypeImport(existing: ExistingMeasurementType[], types: ParsedMeasurementType[]) {
  const byId = new Map(existing.map((e) => [measurementIdentity({ ...e, documentationCode: e.documentationCode || null, defaultUnits: e.defaultUnits || null }), e]));
  const create: MeasurementTypeRow[] = [];
  const update: { id: string; name: string; changed: string[]; data: Partial<MeasurementTypeRow> }[] = [];
  const unchanged: string[] = [];
  const matched = new Set<string>();
  for (const t of types) {
    const row = toRow(t);
    const cur = byId.get(measurementIdentity(t));
    if (!cur) {
      create.push(row);
      continue;
    }
    matched.add(cur.id);
    const changed = IMPORT_FIELDS.filter((f) => (cur[f] ?? null) !== (row[f] ?? null));
    if (changed.length) {
      update.push({ id: cur.id, name: t.name, changed: [...changed], data: Object.fromEntries(changed.map((f) => [f, row[f]])) });
    } else unchanged.push(t.name);
  }
  const notInFile = existing.filter((e) => e.source === 'valant' && !matched.has(e.id)).map((e) => e.name);
  return { create, update, unchanged, notInFile };
}

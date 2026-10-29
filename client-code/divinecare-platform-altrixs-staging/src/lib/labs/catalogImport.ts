/**
 * Valant "Lab request types" export (DataGrid: Name, Is Lab Panel?, LOINC Code, Status) →
 * per-org LabTest rows. Pure planner: no prisma. Dedupes onto the built-in catalog so two Valant
 * names for the same test (e.g. "Liver Function Tests (LFTs)" and "Hepatic Function Panel") become
 * ONE orderable with an alias, never two.
 *
 * Codes: a LOINC in the Valant file is never stored on its own. It is kept only when it equals the
 * verified catalog code; any other value is reported for review (owner rule: no unverified codes).
 */
import {
  BUILTIN_LAB_TESTS,
  findTestByName,
  normalizeTestName,
  slugTestKey,
  type LabTestDef,
  type OrgLabTestRow,
} from './catalog';

export const VALANT_LAB_TYPES_HEADER = ['Name', 'Is Lab Panel?', 'LOINC Code', 'Status'] as const;

export type ValantLabTypeRow = { line: number; name: string; isPanel: boolean; loinc: string; active: boolean };

export function parseValantLabTypes(records: string[][]): {
  headerOk: boolean;
  rows: ValantLabTypeRow[];
  errors: { line: number; error: string }[];
} {
  const header = (records[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  const idx = (label: string) => header.indexOf(label.toLowerCase());
  const iName = idx('Name');
  const iPanel = idx('Is Lab Panel?');
  const iLoinc = idx('LOINC Code');
  const iStatus = idx('Status');
  if (iName < 0 || iPanel < 0 || iStatus < 0) return { headerOk: false, rows: [], errors: [] };
  const rows: ValantLabTypeRow[] = [];
  const errors: { line: number; error: string }[] = [];
  records.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const name = String(cells[iName] ?? '').trim().replace(/\s+/g, ' ');
    if (!name) {
      if (cells.some((c) => String(c ?? '').trim())) errors.push({ line, error: 'Name is blank' });
      return;
    }
    const status = String(cells[iStatus] ?? '').trim().toLowerCase();
    rows.push({
      line,
      name,
      isPanel: /^(yes|y|true|1)$/i.test(String(cells[iPanel] ?? '').trim()),
      loinc: iLoinc >= 0 ? String(cells[iLoinc] ?? '').trim() : '',
      active: status !== 'inactive',
    });
  });
  return { headerOk: true, rows, errors };
}

/** LOINC code shape with Mod-10 check digit (LOINC users' guide) */
export function isLoincShape(code: string): boolean {
  const m = /^(\d{1,7})-(\d)$/.exec(code.trim());
  if (!m) return false;
  const digits = m[1];
  // Mod 10: double every other digit from the right, sum digits
  let sum = 0;
  const rev = digits.split('').reverse();
  rev.forEach((d, i) => {
    let n = Number(d);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n = Math.floor(n / 10) + (n % 10);
    }
    sum += n;
  });
  return (10 - (sum % 10)) % 10 === Number(m[2]);
}

export type CatalogMapping = {
  valantName: string;
  key: string;
  altrixsName: string;
  /** same = Valant name is the catalog name; alias = merged onto an existing test; new = no built-in match */
  relation: 'same' | 'alias' | 'new';
  /** Other Valant names merged into the same orderable */
  mergedWith: string[];
  loinc: string | null;
  cpt: string | null;
  codeNote: string | null;
};

export type PlannedLabTest = OrgLabTestRow & { valantNames: string[] };

export type LabCatalogImportPlan = {
  mapping: CatalogMapping[];
  create: PlannedLabTest[];
  update: { key: string; data: PlannedLabTest; changed: string[] }[];
  unchanged: string[];
  /** Codes / flags in the file that were not applied */
  review: { valantName: string; note: string }[];
  duplicatesMerged: { key: string; names: string[] }[];
};

function plannedFromDef(t: LabTestDef, valantNames: string[], active: boolean): PlannedLabTest {
  const aliases = [...new Set([...t.aliases, ...valantNames])].filter((a) => normalizeTestName(a) !== normalizeTestName(t.name));
  return {
    key: t.key,
    name: t.name,
    aliases,
    isPanel: t.isPanel,
    components: t.components,
    loinc: t.loinc,
    cpt: t.cpt,
    specimenType: t.specimenType,
    container: t.container,
    fastingRequired: t.fastingRequired,
    specialHandling: t.specialHandling,
    category: t.category,
    orderType: t.orderType,
    active,
    source: 'valant',
    sourceNames: valantNames,
    valantNames,
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Plan the import against the org's existing LabTest rows. Re-running with the same file changes
 * nothing (idempotent): names already recorded are not re-added, active state only changes when
 * the file says so.
 */
export function planLabCatalogImport(
  rows: ValantLabTypeRow[],
  existing: OrgLabTestRow[],
  builtin: LabTestDef[] = BUILTIN_LAB_TESTS
): LabCatalogImportPlan {
  const groups = new Map<string, { def: LabTestDef; names: string[]; active: boolean; isNew: boolean }>();
  const review: LabCatalogImportPlan['review'] = [];
  const mappingBase: { row: ValantLabTypeRow; def: LabTestDef; isNew: boolean }[] = [];
  const existingAsDefs: LabTestDef[] = existing.map((r) => ({
    ...r,
    category: r.category as LabTestDef['category'],
    orderType: r.orderType === 'in_office_procedure' ? 'in_office_procedure' : 'lab',
    source: r.source === 'valant' ? 'valant' : 'altrixs',
  }));

  for (const row of rows) {
    let match = findTestByName(row.name, builtin) || findTestByName(row.name, existingAsDefs);
    let isNew = false;
    if (!match) {
      isNew = true;
      match = {
        key: slugTestKey(row.name),
        name: row.name,
        aliases: [],
        isPanel: row.isPanel,
        components: [],
        loinc: null,
        cpt: null,
        specimenType: null,
        container: null,
        fastingRequired: false,
        specialHandling: null,
        category: 'other',
        orderType: 'lab',
        active: row.active,
        source: 'valant',
      };
      review.push({ valantName: row.name, note: 'No Altrixs catalog match: added as a new test with no codes, category Other. Review specimen, category and codes.' });
    }
    if (row.loinc) {
      if (match.loinc && row.loinc === match.loinc) {
        /* agrees with the verified code */
      } else if (!isLoincShape(row.loinc)) {
        review.push({ valantName: row.name, note: `Valant LOINC "${row.loinc}" is not a valid LOINC code; not imported.` });
      } else {
        review.push({ valantName: row.name, note: `Valant LOINC ${row.loinc} differs from or is not in the verified catalog${match.loinc ? ` (${match.loinc})` : ''}; not imported — verify at loinc.org.` });
      }
    }
    if (row.isPanel !== match.isPanel && !isNew) {
      review.push({
        valantName: row.name,
        note: `Valant "Is Lab Panel?" = ${row.isPanel ? 'Yes' : 'No'}; Altrixs treats ${match.name} as ${match.isPanel ? 'a panel' : 'a single test'}.`,
      });
    }
    const g = groups.get(match.key);
    if (g) {
      g.names.push(row.name);
      g.active = g.active || row.active;
    } else {
      groups.set(match.key, { def: match, names: [row.name], active: row.active, isNew });
    }
    mappingBase.push({ row, def: match, isNew });
  }

  const mapping: CatalogMapping[] = mappingBase.map(({ row, def, isNew }) => ({
    valantName: row.name,
    key: def.key,
    altrixsName: def.name,
    relation: isNew ? 'new' : normalizeTestName(def.name) === normalizeTestName(row.name) ? 'same' : 'alias',
    mergedWith: (groups.get(def.key)?.names ?? []).filter((n) => n !== row.name),
    loinc: def.loinc,
    cpt: def.cpt,
    codeNote: def.codeNote ?? null,
  }));

  const existingByKey = new Map(existing.map((r) => [r.key, r]));
  const plan: LabCatalogImportPlan = { mapping, create: [], update: [], unchanged: [], review, duplicatesMerged: [] };
  for (const [key, g] of groups) {
    if (g.names.length > 1) plan.duplicatesMerged.push({ key, names: g.names });
    const planned = plannedFromDef(g.def, g.names, g.active);
    const prev = existingByKey.get(key);
    if (!prev) {
      plan.create.push(planned);
      continue;
    }
    // Keep everything already on the row; add names / aliases; follow the file's active state
    const sourceNames = [...new Set([...prev.sourceNames, ...g.names])];
    const aliases = [...new Set([...prev.aliases, ...planned.aliases])].filter((a) => normalizeTestName(a) !== normalizeTestName(prev.name));
    const data: PlannedLabTest = {
      ...prev,
      aliases,
      sourceNames,
      active: g.active,
      // Fill only blank code fields from the verified catalog
      loinc: prev.loinc || planned.loinc,
      cpt: prev.cpt || planned.cpt,
      valantNames: g.names,
    };
    const changed: string[] = [];
    if (!sameSet(prev.sourceNames, sourceNames)) changed.push('sourceNames');
    if (!sameSet(prev.aliases, aliases)) changed.push('aliases');
    if (prev.active !== g.active) changed.push('active');
    if (prev.loinc !== data.loinc) changed.push('loinc');
    if (prev.cpt !== data.cpt) changed.push('cpt');
    if (changed.length) plan.update.push({ key, data, changed });
    else plan.unchanged.push(key);
  }
  return plan;
}

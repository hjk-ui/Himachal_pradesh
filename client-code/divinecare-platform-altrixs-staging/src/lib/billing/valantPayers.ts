/**
 * Valant "Insurance Companies" grid export (DataGrid .xlsx: Name, Address, Tax IDs, Phone,
 * EDI Payor Id, Active) -> one ValantPayer per (normalized name, EDI payer ID) with every
 * distinct claim address kept as a child row.
 *
 * Pure: no Prisma, no node:crypto, so the browser (header check) and tests can import it.
 *
 * Rules (owner, Oct 2026):
 *  - "EDI Payor Id" is Valant's clearinghouse payer ID. It is shown as "Valant EDI payer ID"
 *    and is never copied into the Waystar payer mapping (Waystar's IDs can differ).
 *  - "Tax IDs" is a Valant-internal list of provider / payer tax-ID associations (it often
 *    contains the practice's own EIN). It is kept raw for reference and never shown as the
 *    payer's tax ID.
 *  - Phones and addresses are normalized only when they are well formed; otherwise the raw
 *    value is kept and flagged. Nothing is invented.
 *  - Links to Altrixs payer data (registry, client insurance names) are suggestions; staff confirm.
 */

export const VALANT_PAYER_HEADER = ['Name', 'Address', 'Tax IDs', 'Phone', 'EDI Payor Id', 'Active'] as const;

/** Same normalization as the Waystar payer mapping (waystarSftpClaims.normalizePayerName). */
export function normalizePayerName(name: string | null | undefined) {
  return (name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

export function normalizeEdiId(raw: string | null | undefined) {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

// ─── Header ──────────────────────────────────────────────────────────────────

type Col = 'name' | 'address' | 'taxIds' | 'phone' | 'edi' | 'active';

const HEADER_ALIASES: Record<Col, string[]> = {
  name: ['name', 'insurancecompany', 'insurancename', 'payername'],
  address: ['address'],
  taxIds: ['taxids', 'taxid'],
  phone: ['phone', 'phonenumber'],
  edi: ['edipayorid', 'edipayerid', 'payorid', 'payerid'],
  active: ['active', 'status'],
};

/** Column positions, or null when the row is not the Valant insurance companies header. */
export function valantPayerColumns(header: string[] | undefined): Record<Col, number> | null {
  if (!header) return null;
  const keys = header.map((h) => clean(h).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const out = {} as Record<Col, number>;
  for (const col of Object.keys(HEADER_ALIASES) as Col[]) {
    const idx = keys.findIndex((k) => HEADER_ALIASES[col].includes(k));
    if (idx < 0) return null;
    out[col] = idx;
  }
  return out;
}

export function valantPayerHeaderOk(header: string[] | undefined) {
  return valantPayerColumns(header) != null;
}

// ─── Phone ───────────────────────────────────────────────────────────────────

export type PhoneStatus = 'valid' | 'invalid' | 'missing';
export type ParsedPhone = { phone: string | null; raw: string; status: PhoneStatus; reason?: string };

/**
 * NANP format check: 10 digits (optional leading 1), area code and exchange start 2-9, area
 * code not N11, exchange not 555 (reserved / fictional). A valid format does not prove the
 * number is the payer's; it only means it can be dialled.
 */
export function normalizeNanpPhone(rawValue: string | null | undefined): ParsedPhone {
  const raw = clean(rawValue);
  if (!raw) return { phone: null, raw: '', status: 'missing' };
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return { phone: null, raw, status: 'invalid', reason: 'not 10 digits' };
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (!/^[2-9]/.test(area)) return { phone: null, raw, status: 'invalid', reason: `area code ${area} cannot start with 0 or 1` };
  if (/^[2-9]11$/.test(area)) return { phone: null, raw, status: 'invalid', reason: `area code ${area} is a service code` };
  if (!/^[2-9]/.test(exchange)) return { phone: null, raw, status: 'invalid', reason: `exchange ${exchange} cannot start with 0 or 1` };
  if (exchange === '555') return { phone: null, raw, status: 'invalid', reason: '555 numbers are reserved' };
  return { phone: digits, raw, status: 'valid' };
}

export function formatPhone(digits: string | null | undefined) {
  return digits && /^\d{10}$/.test(digits) ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : '';
}

// ─── Address ─────────────────────────────────────────────────────────────────

export type AddressStatus = 'ok' | 'suspect' | 'unparsed' | 'missing';
export type ParsedAddress = {
  line: string;
  city: string;
  state: string;
  zip: string;
  raw: string;
  status: AddressStatus;
  issues: string[];
};

/** USPS ZIP3 prefix ranges per state (inclusive), used only to flag an implausible ZIP. */
const ZIP3: Record<string, [number, number][]> = {
  AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729], [755, 755]], CA: [[900, 961]],
  CO: [[800, 816]], CT: [[60, 69]], DE: [[197, 199]], DC: [[200, 205], [569, 569]], FL: [[320, 349]],
  GA: [[300, 319], [398, 399]], HI: [[967, 968]], ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]],
  IA: [[500, 528]], KS: [[660, 679]], KY: [[400, 427]], LA: [[700, 714]], ME: [[39, 49]],
  MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]], MN: [[550, 567]], MS: [[386, 397]],
  MO: [[630, 658]], MT: [[590, 599]], NE: [[680, 693]], NV: [[889, 898]], NH: [[30, 38]],
  NJ: [[70, 89]], NM: [[870, 884]], NY: [[5, 5], [100, 149]], NC: [[270, 289]], ND: [[580, 588]],
  OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]], PA: [[150, 196]], RI: [[28, 29]],
  SC: [[290, 299]], SD: [[570, 577]], TN: [[370, 385]], TX: [[733, 733], [750, 799], [885, 885]],
  UT: [[840, 847]], VT: [[50, 59]], VA: [[201, 201], [220, 246]], WA: [[980, 994]], WV: [[247, 268]],
  WI: [[530, 549]], WY: [[820, 831]], PR: [[6, 9]], VI: [[8, 8]], GU: [[969, 969]],
};

export function zipMatchesState(zip: string, state: string): boolean | null {
  const ranges = ZIP3[state];
  if (!ranges || !/^\d{5}/.test(zip)) return null;
  const p = Number(zip.slice(0, 3));
  return ranges.some(([a, b]) => p >= a && p <= b);
}

/**
 * Valant prints "Street, City, ST, ZIP" (street may itself contain commas). Returns the parts
 * when the tail is a state + ZIP, and flags what looks like placeholder data.
 */
export function parseValantAddress(rawValue: string | null | undefined, payerName = ''): ParsedAddress {
  const raw = clean(rawValue);
  const empty = { line: '', city: '', state: '', zip: '', raw };
  if (!raw) return { ...empty, status: 'missing', issues: [] };
  const parts = raw.split(',').map((p) => p.trim());
  const zipRaw = parts[parts.length - 1] ?? '';
  const stateRaw = (parts[parts.length - 2] ?? '').toUpperCase();
  const zipMatch = /^(\d{5})(?:-?(\d{4}))?$/.exec(zipRaw);
  if (parts.length < 3 || !zipMatch || !/^[A-Z]{2}$/.test(stateRaw)) {
    return { ...empty, status: 'unparsed', issues: ['not in "street, city, state, ZIP" form'] };
  }
  const zip = zipMatch[2] ? `${zipMatch[1]}-${zipMatch[2]}` : zipMatch[1];
  const city = parts.length >= 4 ? parts[parts.length - 3] : '';
  const line = parts.slice(0, parts.length >= 4 ? -3 : -2).join(', ');
  const issues: string[] = [];
  if (!ZIP3[stateRaw]) issues.push(`unknown state ${stateRaw}`);
  else if (zipMatchesState(zip, stateRaw) === false) issues.push(`ZIP ${zip} is not a ${stateRaw} ZIP`);
  if (line.replace(/[^a-z0-9]/gi, '').length < 3) issues.push('street is too short');
  else if (normalizePayerName(line) === normalizePayerName(payerName)) issues.push('street is the payer name');
  if (!city || city.replace(/[^a-z]/gi, '').length < 3) issues.push('city is missing or too short');
  return { line, city, state: stateRaw, zip, raw, status: issues.length ? 'suspect' : 'ok', issues };
}

// ─── Rows, hashing, grouping ─────────────────────────────────────────────────

export type ValantPayerRow = {
  /** 1-based line in the file (header = 1) */
  line: number;
  name: string;
  addressRaw: string;
  taxIdsRaw: string;
  phoneRaw: string;
  ediPayerId: string;
  active: boolean;
};

/** Small stable 53-bit string hash (cyrb53), hex. Identity / change detection only, not security. */
export function stableHash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export type ParseResult = {
  headerOk: boolean;
  rows: ValantPayerRow[];
  /** blank rows skipped (Valant appends one) */
  blankRows: number;
  errors: { line: number; error: string }[];
};

export function parseValantPayerRecords(records: string[][]): ParseResult {
  const cols = valantPayerColumns(records[0]);
  if (!cols) return { headerOk: false, rows: [], blankRows: 0, errors: [] };
  const rows: ValantPayerRow[] = [];
  const errors: { line: number; error: string }[] = [];
  let blankRows = 0;
  records.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (!cells.some((c) => clean(c))) {
      blankRows++;
      return;
    }
    const name = clean(cells[cols.name]);
    if (!name) {
      errors.push({ line, error: 'no insurance company name' });
      return;
    }
    const activeRaw = clean(cells[cols.active]).toLowerCase();
    rows.push({
      line,
      name,
      addressRaw: clean(cells[cols.address]),
      taxIdsRaw: clean(cells[cols.taxIds]),
      phoneRaw: clean(cells[cols.phone]),
      ediPayerId: normalizeEdiId(cells[cols.edi]),
      active: !['inactive', 'no', 'false', 'n', '0'].includes(activeRaw),
    });
  });
  return { headerOk: true, rows, blankRows, errors };
}

export type PlannedAddress = {
  /** stable within the payer: hash of the normalized street/city/state/ZIP5 (or "no-address") */
  addressKey: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  addressRaw: string;
  addressStatus: AddressStatus;
  addressIssues: string[];
  /** first well-formed phone on these rows */
  phone: string | null;
  /** every distinct phone as printed */
  phonesRaw: string[];
  phoneStatus: PhoneStatus;
  phoneIssues: string[];
  /** Valant tax-ID association lists as printed (reference only) */
  taxIdsRaw: string[];
  sourceLines: number[];
};

export type PlannedPayer = {
  /** `${normalizedName}|${ediPayerId}` */
  key: string;
  name: string;
  normalizedName: string;
  ediPayerId: string;
  /** spellings of the name seen in the file */
  nameVariants: string[];
  active: boolean;
  /** primary address = first well-formed one, else the first */
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  addressRaw: string;
  phone: string | null;
  phoneRaw: string;
  phoneStatus: PhoneStatus;
  /** distinct Valant tax-ID lists, " | " joined (reference only, never the payer's tax ID) */
  taxIdsRaw: string;
  /** hash of every source row's content: unchanged file -> unchanged hash */
  sourceRowHash: string;
  sourceRowCount: number;
  sourceLines: number[];
  /** set when another payer shares this name or EDI ID (possible duplicate for review) */
  duplicateGroup: string | null;
  addresses: PlannedAddress[];
};

function addressKeyFor(a: ParsedAddress) {
  if (a.status === 'missing') return 'no-address';
  const k = a.status === 'unparsed'
    ? normalizePayerName(a.raw)
    : [normalizePayerName(a.line), normalizePayerName(a.city), a.state, a.zip.slice(0, 5)].join('|');
  return stableHash(`addr|${k}`);
}

/** Groups rows by normalized name + EDI ID; one payer keeps every distinct address. */
export function groupValantPayers(rows: ValantPayerRow[]): PlannedPayer[] {
  const groups = new Map<string, ValantPayerRow[]>();
  for (const r of rows) {
    const key = `${normalizePayerName(r.name)}|${r.ediPayerId}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const payers: PlannedPayer[] = [];
  for (const [key, list] of groups) {
    const addrMap = new Map<string, PlannedAddress>();
    for (const r of list) {
      const a = parseValantAddress(r.addressRaw, r.name);
      const ph = normalizeNanpPhone(r.phoneRaw);
      const ak = addressKeyFor(a);
      let entry = addrMap.get(ak);
      if (!entry) {
        entry = {
          addressKey: ak,
          addressLine: a.line,
          city: a.city,
          state: a.state,
          zip: a.zip,
          addressRaw: a.raw,
          addressStatus: a.status,
          addressIssues: a.issues,
          phone: null,
          phonesRaw: [],
          phoneStatus: 'missing',
          phoneIssues: [],
          taxIdsRaw: [],
          sourceLines: [],
        };
        addrMap.set(ak, entry);
      } else if (a.zip.length > entry.zip.length) {
        // Same street/city/ZIP5 printed with ZIP+4 on another row: keep the fuller ZIP
        entry.zip = a.zip;
        entry.addressRaw = a.raw;
      }
      entry.sourceLines.push(r.line);
      if (r.taxIdsRaw && !entry.taxIdsRaw.includes(r.taxIdsRaw)) entry.taxIdsRaw.push(r.taxIdsRaw);
      if (ph.raw && !entry.phonesRaw.includes(ph.raw)) {
        entry.phonesRaw.push(ph.raw);
        if (ph.status === 'invalid' && ph.reason) entry.phoneIssues.push(`${ph.raw}: ${ph.reason}`);
      }
      if (ph.status === 'valid' && !entry.phone) entry.phone = ph.phone;
      entry.phoneStatus = entry.phone ? 'valid' : entry.phonesRaw.length ? 'invalid' : 'missing';
    }
    const addresses = [...addrMap.values()].filter((a) => a.addressKey !== 'no-address' || a.phonesRaw.length || addrMap.size === 1);
    const rank = (a: PlannedAddress) => ({ ok: 0, suspect: 1, unparsed: 2, missing: 3 })[a.addressStatus];
    const primary = [...addresses].sort((x, y) => rank(x) - rank(y) || x.sourceLines[0] - y.sourceLines[0])[0];
    const phoneEntry = addresses.find((a) => a.phone) ?? addresses.find((a) => a.phonesRaw.length);
    const variants = [...new Set(list.map((r) => r.name))];
    const taxLists = [...new Set(list.map((r) => r.taxIdsRaw).filter(Boolean))];
    payers.push({
      key,
      name: variants[0],
      normalizedName: key.split('|')[0],
      ediPayerId: list[0].ediPayerId,
      nameVariants: variants,
      active: list.some((r) => r.active),
      addressLine: primary?.addressLine ?? '',
      city: primary?.city ?? '',
      state: primary?.state ?? '',
      zip: primary?.zip ?? '',
      addressRaw: primary?.addressRaw ?? '',
      phone: phoneEntry?.phone ?? null,
      phoneRaw: phoneEntry?.phonesRaw[0] ?? '',
      phoneStatus: phoneEntry?.phone ? 'valid' : phoneEntry ? 'invalid' : 'missing',
      taxIdsRaw: taxLists.join(' | '),
      sourceRowHash: stableHash(
        list
          .map((r) => [r.name, r.addressRaw, r.taxIdsRaw, r.phoneRaw, r.ediPayerId, r.active ? '1' : '0'].join('\u0001'))
          .sort()
          .join('\u0002')
      ),
      sourceRowCount: list.length,
      sourceLines: list.map((r) => r.line),
      duplicateGroup: null,
      addresses,
    });
  }
  assignDuplicateGroups(payers);
  return payers.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.ediPayerId.localeCompare(b.ediPayerId));
}

/** Union of payers that share a normalized name or a non-blank EDI ID; label = first member key. */
function assignDuplicateGroups(payers: PlannedPayer[]) {
  const parent = payers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const byName = new Map<string, number>();
  const byEdi = new Map<string, number>();
  payers.forEach((p, i) => {
    const n = byName.get(p.normalizedName);
    if (n == null) byName.set(p.normalizedName, i);
    else union(n, i);
    if (p.ediPayerId) {
      const e = byEdi.get(p.ediPayerId);
      if (e == null) byEdi.set(p.ediPayerId, i);
      else union(e, i);
    }
  });
  const members = new Map<number, number[]>();
  payers.forEach((_, i) => {
    const r = find(i);
    members.set(r, [...(members.get(r) ?? []), i]);
  });
  for (const list of members.values()) {
    if (list.length < 2) continue;
    const label = list.map((i) => payers[i].key).sort()[0];
    for (const i of list) payers[i].duplicateGroup = label;
  }
}

export type PayerFileSummary = {
  rows: number;
  blankRows: number;
  payers: number;
  withEdiId: number;
  active: number;
  mergedRows: number;
  multiAddressPayers: number;
  addresses: number;
  suspectAddresses: number;
  unparsedAddresses: number;
  invalidPhones: number;
  possibleDuplicateGroups: number;
};

export function summarizeValantPayers(parsed: ParseResult, payers: PlannedPayer[]): PayerFileSummary {
  const all = payers.flatMap((p) => p.addresses);
  return {
    rows: parsed.rows.length + parsed.errors.length,
    blankRows: parsed.blankRows,
    payers: payers.length,
    withEdiId: payers.filter((p) => p.ediPayerId).length,
    active: payers.filter((p) => p.active).length,
    mergedRows: parsed.rows.length - payers.length,
    multiAddressPayers: payers.filter((p) => p.addresses.filter((a) => a.addressStatus !== 'missing').length > 1).length,
    addresses: all.filter((a) => a.addressStatus !== 'missing').length,
    suspectAddresses: all.filter((a) => a.addressStatus === 'suspect').length,
    unparsedAddresses: all.filter((a) => a.addressStatus === 'unparsed').length,
    invalidPhones: all.reduce((n, a) => n + a.phoneIssues.length, 0),
    possibleDuplicateGroups: new Set(payers.map((p) => p.duplicateGroup).filter(Boolean)).size,
  };
}

// ─── Import plan (idempotent) ────────────────────────────────────────────────

export type ExistingValantPayer = { id: string; normalizedName: string; ediPayerId: string; sourceRowHash: string; duplicateGroup: string | null };

export type PayerImportPlan = {
  create: PlannedPayer[];
  update: { id: string; payer: PlannedPayer }[];
  unchanged: { id: string; key: string }[];
  /** payers in Altrixs that are not in this file (kept; never deleted by an import) */
  notInFile: { id: string; key: string }[];
};

/** New key -> create; same key with a different content hash (or duplicate group) -> update; else unchanged. */
export function planValantPayerImport(existing: ExistingValantPayer[], payers: PlannedPayer[]): PayerImportPlan {
  const byKey = new Map(existing.map((e) => [`${e.normalizedName}|${e.ediPayerId}`, e]));
  const seen = new Set<string>();
  const plan: PayerImportPlan = { create: [], update: [], unchanged: [], notInFile: [] };
  for (const p of payers) {
    const e = byKey.get(p.key);
    seen.add(p.key);
    if (!e) plan.create.push(p);
    else if (e.sourceRowHash !== p.sourceRowHash || (e.duplicateGroup ?? null) !== p.duplicateGroup) plan.update.push({ id: e.id, payer: p });
    else plan.unchanged.push({ id: e.id, key: p.key });
  }
  for (const [key, e] of byKey) if (!seen.has(key)) plan.notInFile.push({ id: e.id, key });
  return plan;
}

// ─── Matching suggestions ────────────────────────────────────────────────────

const STOP = new Set([
  'inc', 'llc', 'the', 'of', 'co', 'corp', 'corporation', 'company', 'ins', 'insurance', 'claims', 'claim', 'dept', 'department',
  'services', 'service', 'plan', 'plans', 'health', 'healthcare', 'and', 'for', 'from', 'a', 'md',
]);

export function nameTokens(name: string): string[] {
  return [...new Set((name || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)))];
}

/** Similarity 0..1: token Jaccard, or a long prefix (Valant truncates names at 40 characters). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizePayerName(a);
  const nb = normalizePayerName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 12 && long.startsWith(short)) return 0.9;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const inter = ta.filter((t) => tb.includes(t)).length;
  return inter / new Set([...ta, ...tb]).size;
}

export const SIMILAR_THRESHOLD = 0.6;

/**
 * Programs known to be billed under a different name. Shown as "check" suggestions only.
 * Maryland Medicaid behavioral health is billed to the Public Behavioral Health System (ASO);
 * Maryland Medicare Part B is administered by Novitas Solutions.
 */
export const KNOWN_EQUIVALENTS: { a: string; b: string; reason: string }[] = [
  {
    a: 'Maryland Medicaid',
    b: 'Maryland Public Behavioral Health System',
    reason: 'Maryland Medicaid behavioral-health claims are filed to the Public Behavioral Health System (ASO)',
  },
  { a: 'Medicare', b: 'Novitas Solutions Part B', reason: 'Novitas Solutions is the Medicare Part B contractor for Maryland and DC' },
];

export type NameCount = { name: string; count: number };

export type ClientNameMatch = { name: string; count: number; kind: 'exact' | 'confirmed' | 'similar'; score: number };

/**
 * Client insurance payer names that match a Valant payer. exact/confirmed are counted as
 * "used by"; similar ones are suggestions until staff confirm them (confirmedAliases).
 */
export function clientNameMatches(
  payer: { name: string; nameVariants?: string[]; confirmedAliases?: string[] },
  names: NameCount[]
): ClientNameMatch[] {
  const own = new Set([payer.name, ...(payer.nameVariants ?? [])].map(normalizePayerName));
  const confirmed = new Set((payer.confirmedAliases ?? []).map(normalizePayerName));
  const out: ClientNameMatch[] = [];
  for (const n of names) {
    const key = normalizePayerName(n.name);
    if (!key) continue;
    if (own.has(key)) out.push({ name: n.name, count: n.count, kind: 'exact', score: 1 });
    else if (confirmed.has(key)) out.push({ name: n.name, count: n.count, kind: 'confirmed', score: 1 });
    else {
      const score = Math.max(...[payer.name, ...(payer.nameVariants ?? [])].map((v) => nameSimilarity(v, n.name)));
      if (score >= SIMILAR_THRESHOLD) out.push({ name: n.name, count: n.count, kind: 'similar', score });
    }
  }
  return out.sort((x, y) => (x.kind === 'similar' ? 1 : 0) - (y.kind === 'similar' ? 1 : 0) || y.count - x.count);
}

export type RegistryLite = { id: string; payerId: string; name: string };
export type RegistryMatch = { id: string; payerId: string; name: string; by: 'edi' | 'name' | 'edi+name' };

/** Payer registry entries whose payer ID equals the Valant EDI ID and/or whose name matches. */
export function registryMatches(payer: { name: string; ediPayerId: string; nameVariants?: string[] }, registry: RegistryLite[]): RegistryMatch[] {
  const names = new Set([payer.name, ...(payer.nameVariants ?? [])].map(normalizePayerName));
  const out: RegistryMatch[] = [];
  for (const r of registry) {
    const edi = Boolean(payer.ediPayerId) && normalizeEdiId(r.payerId) === payer.ediPayerId;
    const name = names.has(normalizePayerName(r.name));
    if (edi || name) out.push({ id: r.id, payerId: r.payerId, name: r.name, by: edi && name ? 'edi+name' : edi ? 'edi' : 'name' });
  }
  return out;
}

export type MappingLite = { id: string; payerName: string; aliases: string[]; waystarPayerId: string; verified: boolean; active: boolean };

export type WaystarReference = {
  mappingId: string;
  payerName: string;
  waystarPayerId: string;
  verified: boolean;
  valant: { id: string; name: string; ediPayerId: string; match: 'name' | 'equivalent'; reason?: string; clientCount?: number }[];
  /** Valant EDI IDs that differ from the Waystar ID (verify against Waystar's payer list) */
  discrepancies: string[];
};

/**
 * For each Waystar payer mapping, the Valant payers with the same (normalized) name or alias, plus
 * known program equivalents. Read-only reference: nothing here writes a mapping.
 */
export function waystarValantReference(
  mappings: MappingLite[],
  valant: { id: string; name: string; normalizedName: string; ediPayerId: string; clientCount?: number }[]
): WaystarReference[] {
  return mappings.map((m) => {
    const keys = new Set([m.payerName, ...m.aliases].map(normalizePayerName));
    const hits: WaystarReference['valant'] = [];
    for (const v of valant) {
      if (keys.has(v.normalizedName)) hits.push({ id: v.id, name: v.name, ediPayerId: v.ediPayerId, match: 'name', clientCount: v.clientCount });
    }
    for (const eq of KNOWN_EQUIVALENTS) {
      const [ours, theirs] = keys.has(normalizePayerName(eq.a)) ? [eq.a, eq.b] : keys.has(normalizePayerName(eq.b)) ? [eq.b, eq.a] : [null, null];
      if (!ours || !theirs) continue;
      for (const v of valant) {
        if (v.normalizedName === normalizePayerName(theirs) && !hits.some((h) => h.id === v.id)) {
          hits.push({ id: v.id, name: v.name, ediPayerId: v.ediPayerId, match: 'equivalent', reason: eq.reason, clientCount: v.clientCount });
        }
      }
    }
    const wid = normalizeEdiId(m.waystarPayerId);
    const discrepancies = [...new Set(hits.map((h) => h.ediPayerId).filter((id) => id && id !== wid))];
    return { mappingId: m.id, payerName: m.payerName, waystarPayerId: m.waystarPayerId, verified: m.verified, valant: hits, discrepancies };
  });
}

/** Transaction Journal "Insurance" cell: whole cell when it is one payer name, else the comma parts. */
export function journalPayerNames(cell: string, knownNormalized: Set<string>): string[] {
  const whole = clean(cell);
  if (!whole) return [];
  if (knownNormalized.has(normalizePayerName(whole))) return [whole];
  const parts = whole.split(',').map((p) => p.trim()).filter(Boolean);
  // Re-join pieces like "ALLEGIANCE BENEFIT PLAN MANAGEMENT" + "INC." when the joined name is known
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const joined = i + 1 < parts.length ? `${parts[i]}, ${parts[i + 1]}` : '';
    if (joined && knownNormalized.has(normalizePayerName(joined))) {
      out.push(joined);
      i++;
    } else out.push(parts[i]);
  }
  return out;
}

/**
 * Community resource directory helpers (pure): service areas, SDOH domain -> resource
 * suggestions, and the CSV import template / parser. Rows live in sdoh_resources.
 */
import type { AhcDomain } from '@/lib/sdoh/ahcHrsn';
import { RESOURCE_DOMAINS, resourceDomainFor, type ResourceDomain } from '@/lib/sdoh/workflow';

export const COUNTIES = [
  { value: 'prince_georges', label: "Prince George's County" },
  { value: 'montgomery', label: 'Montgomery County' },
  { value: 'baltimore_city', label: 'Baltimore City' },
  { value: 'st_marys', label: "St. Mary's County" },
  { value: 'statewide', label: 'Statewide (Maryland)' },
] as const;
export type County = (typeof COUNTIES)[number]['value'];
export const countyLabel = (v: string) => COUNTIES.find((c) => c.value === v)?.label ?? v;
export const isCounty = (v: string): v is County => COUNTIES.some((c) => c.value === v);

/** Directory domains that answer a positive AHC HRSN domain (most specific first). */
export function directoryDomainsFor(domain: AhcDomain): ResourceDomain[] {
  const main = resourceDomainFor(domain);
  const extra: ResourceDomain[] = domain === 'safety' ? ['domestic_violence'] : domain === 'employment' ? ['financial'] : [];
  return [main, ...extra];
}

export type DirectoryEntry = {
  id: string;
  name: string;
  domains: string[];
  counties: string[];
  active: boolean;
  lastVerifiedAt: Date | string | null;
};

export type Suggestion<T extends DirectoryEntry> = { domain: AhcDomain; resources: T[] };

/**
 * For each positive domain: active directory entries whose domains match, ranked
 *   1. a specific domain match before an all-needs line (domain "general", e.g. 211 Maryland);
 *   2. serving the client's county before statewide-only entries; entries for other counties are left out;
 *   3. most recently verified first.
 * An entry with no counties set is treated as "area not recorded" and kept after county matches.
 */
export function suggestCommunityResources<T extends DirectoryEntry>(positive: AhcDomain[], directory: T[], county?: string | null, limit = 5): Suggestion<T>[] {
  const verified = (e: T) => (e.lastVerifiedAt ? new Date(e.lastVerifiedAt).getTime() : 0);
  return positive.map((domain) => {
    const wanted = directoryDomainsFor(domain);
    const scored = directory
      .filter((e) => e.active)
      .filter((e) => !county || !e.counties.length || e.counties.includes(county) || e.counties.includes('statewide'))
      .map((e) => {
        const specific = e.domains.some((d) => (wanted as string[]).includes(d));
        const general = e.domains.includes('general');
        if (!specific && !general) return null;
        const area = county && e.counties.includes(county) ? 0 : e.counties.includes('statewide') ? 1 : 2;
        return { e, rank: (specific ? 0 : 10) + area };
      })
      .filter((x): x is { e: T; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank || verified(b.e) - verified(a.e) || a.e.name.localeCompare(b.e.name));
    return { domain, resources: scored.slice(0, limit).map((x) => x.e) };
  });
}

// ─── CSV import ─────────────────────────────────────────────────────────────

export const CSV_COLUMNS = [
  'name',
  'categories',
  'counties',
  'address',
  'city',
  'state',
  'postal_code',
  'phone',
  'email',
  'website',
  'hours',
  'eligibility',
  'languages',
  'cost',
  'last_verified',
  'verified_by_source',
] as const;

/** Template with the header and one commented instruction row (never sample agencies). */
export function csvTemplate(): string {
  const help = [
    '# One agency per row. Delete this line.',
    `categories: ${RESOURCE_DOMAINS.join('|')}`,
    `counties: ${COUNTIES.map((c) => c.value).join('|')}`,
    'languages: separate with |',
    'last_verified: YYYY-MM-DD (date you confirmed the listing with the agency)',
    'verified_by_source: URL or "phone call"',
  ];
  return `${CSV_COLUMNS.join(',')}\n"${help.join('; ').replace(/"/g, '""')}"\n`;
}

/** RFC 4180-style parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type CsvAgency = {
  name: string;
  domains: ResourceDomain[];
  counties: County[];
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours: string | null;
  eligibilityNotes: string | null;
  languages: string[];
  cost: string | null;
  lastVerifiedAt: Date | null;
  verificationSource: string | null;
};

export type CsvResult = { rows: CsvAgency[]; errors: { line: number; error: string }[] };

/** Validates every row; rows with errors are reported and not imported. Nothing is invented or defaulted. */
export function parseAgencyCsv(text: string, maxRows = 1000): CsvResult {
  const all = parseCsv(text);
  const errors: CsvResult['errors'] = [];
  if (!all.length) return { rows: [], errors: [{ line: 1, error: 'The file is empty' }] };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const idx = (c: string) => header.indexOf(c);
  if (idx('name') < 0 || idx('categories') < 0) return { rows: [], errors: [{ line: 1, error: 'Header must include name and categories (use the template)' }] };
  const rows: CsvAgency[] = [];
  const body = all.slice(1);
  if (body.length > maxRows) errors.push({ line: maxRows + 2, error: `Only the first ${maxRows} rows are read` });
  body.slice(0, maxRows).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: string) => {
      const j = idx(c);
      const v = j >= 0 ? (cells[j] ?? '').trim() : '';
      return v || null;
    };
    const first = (cells[0] ?? '').trim();
    if (first.startsWith('#')) return;
    const name = get('name');
    if (!name) { errors.push({ line, error: 'Name is required' }); return; }
    const split = (v: string | null) => (v ? v.split('|').map((x) => x.trim()).filter(Boolean) : []);
    const cats = split(get('categories'));
    const badCats = cats.filter((c) => !(RESOURCE_DOMAINS as readonly string[]).includes(c));
    if (!cats.length || badCats.length) { errors.push({ line, error: badCats.length ? `Unknown category: ${badCats.join(', ')}` : 'At least one category is required' }); return; }
    const counties = split(get('counties'));
    const badCounties = counties.filter((c) => !isCounty(c));
    if (badCounties.length) { errors.push({ line, error: `Unknown county: ${badCounties.join(', ')}` }); return; }
    const website = get('website');
    if (website && !/^https?:\/\/\S+$/i.test(website)) { errors.push({ line, error: 'Website must start with http:// or https://' }); return; }
    const email = get('email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push({ line, error: 'Email is not valid' }); return; }
    const lv = get('last_verified');
    let lastVerifiedAt: Date | null = null;
    if (lv) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lv) || Number.isNaN(Date.parse(`${lv}T00:00:00Z`))) { errors.push({ line, error: 'last_verified must be YYYY-MM-DD' }); return; }
      lastVerifiedAt = new Date(`${lv}T00:00:00Z`);
    }
    rows.push({
      name: name.slice(0, 200),
      domains: [...new Set(cats)] as ResourceDomain[],
      counties: [...new Set(counties)] as County[],
      address: get('address'),
      city: get('city'),
      state: get('state'),
      postalCode: get('postal_code'),
      phone: get('phone'),
      email,
      website,
      hours: get('hours'),
      eligibilityNotes: get('eligibility'),
      languages: split(get('languages')),
      cost: get('cost'),
      lastVerifiedAt,
      verificationSource: get('verified_by_source'),
    });
  });
  return { rows, errors };
}

/** Client.county is free text ("Prince George's", "Baltimore City", "St. Mary's County") -> service-area key, or null. */
export function countyFromText(text: string | null | undefined): County | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/county/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  if (/^prince georges?$/.test(t)) return 'prince_georges';
  if (t === 'montgomery') return 'montgomery';
  if (t === 'baltimore city') return 'baltimore_city';
  if (/^(st|saint) marys?$/.test(t)) return 'st_marys';
  return null;
}

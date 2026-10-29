/**
 * Split a multi-patient document (e.g. a Valant export with many clients) into one group of pages
 * per patient. Pure: takes the per-page match results and returns the groups; the caller does the
 * OCR, roster lookups and database writes.
 *
 * Rules (a page on the wrong chart is a HIPAA breach, so anything unclear goes to staff):
 *   - A page whose identifiers match a client starts or continues that client's group.
 *   - A page with no identifiers continues the previous page's group (continuation pages).
 *   - A page with only a name that agrees with the current group's last name also continues it
 *     (page 2 of a note often repeats "Patient: Jane Doe" without the DOB or ID).
 *   - A page whose identifiers match nobody, or more than one client, starts an "unresolved"
 *     group that staff must assign. Pages with the same unresolved identity share one group.
 *   - All pages of the same matched client form one group, in page order, even when they are
 *     not next to each other.
 *   - Pages before the first identified page form their own unresolved group.
 */
import { normalizeName, type ExtractedIdentifiers, type MatchCandidate } from './patientMatcher';

export type PageMatch =
  | { page: number; kind: 'none' }
  | { page: number; kind: 'matched'; clientId: string; lastName?: string; reason: string }
  | {
      page: number;
      kind: 'unresolved';
      /** Same key = same (unknown) patient */
      key: string;
      lastName?: string;
      /** Only a name was found (no DOB, no ID): may continue the current group if the name agrees */
      nameOnly: boolean;
      reason: string;
      candidates: MatchCandidate[];
    };

export type PageGroup =
  | { kind: 'matched'; clientId: string; pages: number[]; reason: string }
  | { kind: 'unresolved'; key: string; pages: number[]; reason: string; candidates: MatchCandidate[] };

export const LEADING_KEY = 'leading-pages';

export function identityKey(ids: ExtractedIdentifiers): string | null {
  const sourceIds = [...new Set(ids.sourceIds.map((s) => s.replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').toUpperCase()))]
    .filter(Boolean)
    .sort();
  if (sourceIds.length) return `id:${sourceIds.join(',')}`;
  const last = ids.lastName ? normalizeName(ids.lastName) : '';
  const first = ids.firstName ? normalizeName(ids.firstName).split(' ')[0] : '';
  if (!last && !ids.dob) return null;
  return `person:${last}|${first}|${ids.dob ?? ''}`;
}

export function hasIdentifiers(ids: ExtractedIdentifiers): boolean {
  return Boolean(ids.sourceIds.length || ids.lastName || ids.dob);
}

export function segmentPages(pages: PageMatch[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  let current: string | null = null;
  let currentLastName = '';

  const add = (key: string, make: () => PageGroup, page: number) => {
    const g = groups.get(key) ?? make();
    if (!groups.has(key)) groups.set(key, g);
    if (!g.pages.includes(page)) g.pages.push(page);
    return g;
  };

  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    if (p.kind === 'none') {
      if (current) {
        groups.get(current)!.pages.push(p.page);
      } else {
        current = `u:${LEADING_KEY}`;
        add(current, () => ({
          kind: 'unresolved', key: LEADING_KEY, pages: [],
          reason: 'No patient name, date of birth or ID on these pages',
          candidates: [],
        }), p.page);
      }
      continue;
    }

    if (p.kind === 'matched') {
      current = `c:${p.clientId}`;
      currentLastName = p.lastName ? normalizeName(p.lastName) : '';
      add(current, () => ({ kind: 'matched', clientId: p.clientId, pages: [], reason: p.reason }), p.page);
      continue;
    }

    // Unresolved identifiers: a bare name that agrees with the current group continues it
    const last = p.lastName ? normalizeName(p.lastName) : '';
    if (p.nameOnly && current && last && last === currentLastName) {
      groups.get(current)!.pages.push(p.page);
      continue;
    }
    current = `u:${p.key}`;
    currentLastName = last;
    const g = add(current, () => ({ kind: 'unresolved', key: p.key, pages: [], reason: p.reason, candidates: [] }), p.page);
    if (g.kind === 'unresolved') {
      for (const c of p.candidates) {
        if (!g.candidates.some((x) => x.clientId === c.clientId)) g.candidates.push(c);
      }
    }
  }

  const out = [...groups.values()];
  for (const g of out) g.pages.sort((a, b) => a - b);
  return out.sort((a, b) => a.pages[0] - b.pages[0]);
}

/** Split only when at least two different patients (matched or not) were identified */
export function shouldSplit(groups: PageGroup[]): boolean {
  return groups.filter((g) => !(g.kind === 'unresolved' && g.key === LEADING_KEY)).length >= 2;
}

/** [1,2,3,5,7,8] → "1–3, 5, 7–8" */
export function formatPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  return parts.join(', ');
}

/**
 * Page texts for a document: the stored per-page texts, or (older rows) the extracted text split
 * on the blank line OCR put between pages, only when that gives exactly pageCount pages.
 */
export function resolvePageTexts(doc: {
  pageTexts: unknown;
  extractedText: string | null;
  pageCount: number | null;
}): { pages: string[] } | { error: string } {
  if (Array.isArray(doc.pageTexts) && doc.pageTexts.every((p) => typeof p === 'string')) {
    return { pages: doc.pageTexts as string[] };
  }
  const text = doc.extractedText ?? '';
  if (!text.trim() || !doc.pageCount) {
    return { error: 'No page text is stored for this document. Re-process it to read the pages again.' };
  }
  const pages = text.split('\n\n');
  if (pages.length !== doc.pageCount) {
    return {
      error: `The stored text does not separate cleanly into ${doc.pageCount} pages (found ${pages.length}). Re-process the document to read each page again.`,
    };
  }
  return { pages };
}

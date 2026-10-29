/**
 * ICD-10-CM code formatting + small UI helpers. Pure and client-safe (no fs / Prisma):
 * the diagnosis pickers import this; the code set itself lives server-side (./codeSet).
 */

/** The fiscal year of the checked-in code set (data/icd10cm/icd10cm-2027.tsv.gz). */
export const ICD10_FISCAL_YEAR = 2027;
export const ICD10_FY_LABEL = `FY${ICD10_FISCAL_YEAR}`;

/** "f33.1 " / "F331" → "F331" (uppercase, no dot, no spaces). Not validated. */
export function icd10Key(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[\s.]/g, '');
}

/** "F331" / "f33.1" → "F33.1"; three-character categories have no dot ("F33"). */
export function formatIcd10(raw: string): string {
  const k = icd10Key(raw);
  return k.length > 3 ? `${k.slice(0, 3)}.${k.slice(3)}` : k;
}

/** Shape check only (letter, digit, alnum, then up to 4 more): "F33", "F33.1", "F331", "S72.001A". */
export function looksLikeIcd10(raw: string): boolean {
  return /^[A-Z][0-9][0-9A-Z]([0-9A-Z]{1,4})?$/.test(icd10Key(raw));
}

/** True when the query reads as a code (prefix) rather than words: "f3", "F33.1", "z79". */
export function isCodeQuery(raw: string): boolean {
  const t = String(raw || '').trim();
  return /^[A-Za-z][0-9][0-9A-Za-z]?(\.?[0-9A-Za-z]{0,4})?$/.test(t);
}

/** Lower-case word tokens of a query or description ("Post-traumatic" → ["post", "traumatic"]). */
export function wordTokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export type HighlightSegment = { text: string; match: boolean };

/** Split `text` into segments where words starting with any query term are marked (for <mark>). */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = wordTokens(query).filter((t) => t.length >= 1);
  if (!text || !terms.length) return [{ text: text || '', match: false }];
  const out: HighlightSegment[] = [];
  const re = /[A-Za-z0-9]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0].toLowerCase();
    const term = terms.find((t) => word.startsWith(t));
    if (!term) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
    out.push({ text: text.slice(m.index, m.index + term.length), match: true });
    last = m.index + term.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.filter((s) => s.text);
}

/** Highlight for the code column: the leading part that matches a code query ("F33" in "F33.1"). */
export function highlightCode(code: string, query: string): HighlightSegment[] {
  const q = icd10Key(query);
  if (!q || !isCodeQuery(query)) return [{ text: code, match: false }];
  const k = icd10Key(code);
  if (!k.startsWith(q)) return [{ text: code, match: false }];
  // map the matched key length onto the dotted display string
  const visible = q.length > 3 ? q.length + 1 : q.length;
  return [
    { text: code.slice(0, visible), match: true },
    { text: code.slice(visible), match: false },
  ].filter((s) => s.text);
}

// ─── Picker keyboard behaviour (logic only; the component renders it) ─────────

export type PickerOption = { code: string; billable: boolean };
export type PickerKeyResult =
  | { type: 'move'; index: number }
  | { type: 'select'; index: number }
  | { type: 'blocked'; index: number; reason: string }
  | { type: 'close' }
  | { type: 'none' };

/** Message shown on a category header code (not valid on HIPAA transactions). */
export const NON_BILLABLE_MESSAGE = 'Non-billable — pick a more specific code';

/**
 * ArrowDown / ArrowUp wrap through the list, Home / End jump, Enter selects; a non-billable option is "blocked" when the form requires billable codes.
 * Escape closes. Index -1 means nothing highlighted.
 */
export function pickerKey(
  key: string,
  index: number,
  options: PickerOption[],
  opts: { requireBillable?: boolean } = {}
): PickerKeyResult {
  const n = options.length;
  switch (key) {
    case 'ArrowDown':
      return n ? { type: 'move', index: index < 0 || index >= n - 1 ? 0 : index + 1 } : { type: 'none' };
    case 'ArrowUp':
      return n ? { type: 'move', index: index <= 0 ? n - 1 : index - 1 } : { type: 'none' };
    case 'Home':
      return n ? { type: 'move', index: 0 } : { type: 'none' };
    case 'End':
      return n ? { type: 'move', index: n - 1 } : { type: 'none' };
    case 'Escape':
      return { type: 'close' };
    case 'Enter': {
      if (index < 0 || index >= n) return { type: 'none' };
      if (opts.requireBillable && !options[index].billable) {
        return { type: 'blocked', index, reason: `${options[index].code}: ${NON_BILLABLE_MESSAGE}` };
      }
      return { type: 'select', index };
    }
    default:
      return { type: 'none' };
  }
}

// ─── Picker options: client's active diagnoses first, then search results ─────

export type Icd10Option = {
  code: string;
  description: string;
  billable: boolean;
  /** 'client' = the client's active diagnosis; 'search' = code-set search result */
  source: 'client' | 'search';
  /** e.g. "Problem list" / "Chart diagnosis" */
  sourceLabel?: string;
  /** Code-set status for client codes ('unknown' / 'deleted' = not in the current code set) */
  status?: string;
  message?: string | null;
  categoryCode?: string;
  categoryDescription?: string | null;
};

/** Does a client suggestion match what was typed (code prefix, or every word as a word prefix)? */
export function suggestionMatches(s: { code: string; description: string }, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (isCodeQuery(q) && icd10Key(s.code).startsWith(icd10Key(q))) return true;
  const words = wordTokens(s.description);
  const terms = wordTokens(q);
  return terms.length > 0 && terms.every((t) => words.some((w) => w.startsWith(t)) || icd10Key(s.code).startsWith(t.toUpperCase()));
}

/** Client suggestions that match the query first, then search hits not already listed. */
export function mergeIcd10Options(suggestions: Icd10Option[], hits: Icd10Option[], query: string, max = 25): Icd10Option[] {
  const out: Icd10Option[] = [];
  const seen = new Set<string>();
  for (const s of suggestions) {
    const k = icd10Key(s.code);
    if (seen.has(k) || !suggestionMatches(s, query)) continue;
    seen.add(k);
    out.push(s);
  }
  for (const h of hits) {
    const k = icd10Key(h.code);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.slice(0, max);
}

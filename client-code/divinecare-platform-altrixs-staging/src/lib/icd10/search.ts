/**
 * ICD-10-CM in-memory index + ranked search. Pure (no fs): built from rows by ./codeSet, and
 * from synthetic rows in tests.
 *
 * Ranking: exact code > code prefix (shorter codes first) > description word matches.
 * Words match in any order as word prefixes ("major depress recurrent"); every query word must
 * match. context=bh boosts Chapter 5 (F codes). No PHI is involved anywhere here.
 */
import { formatIcd10, icd10Key, isCodeQuery, wordTokens } from './normalize';

export type Icd10Row = { key: string; billable: boolean; short: string; long: string };

export type Icd10Context = 'bh' | 'primary' | 'any';

export type Icd10Hit = {
  /** Display code with dot ("F33.1") */
  code: string;
  /** Code without dot ("F331") */
  key: string;
  description: string;
  shortDescription: string;
  billable: boolean;
  /** Parent three-character category */
  category: { code: string; description: string | null };
  chapter: { number: number; range: string; title: string } | null;
  score: number;
};

export type Icd10Index = {
  keys: string[];
  billable: Uint8Array;
  shorts: string[];
  longs: string[];
  byKey: Map<string, number>;
  /** Row indices sorted by key (for prefix ranges) */
  sortedByKey: Int32Array;
  /** Sorted unique description tokens and their postings (row indices, ascending) */
  tokens: string[];
  postings: Int32Array[];
};

// ─── Chapters (FY2027 tabular list) ───────────────────────────────────────────

const CHAPTERS: [number, string, string, string][] = [
  [1, 'A00', 'B99', 'Certain infectious and parasitic diseases'],
  [2, 'C00', 'D49', 'Neoplasms'],
  [3, 'D50', 'D89', 'Diseases of the blood and blood-forming organs and certain disorders involving the immune mechanism'],
  [4, 'E00', 'E89', 'Endocrine, nutritional and metabolic diseases'],
  [5, 'F01', 'F99', 'Mental, behavioral and neurodevelopmental disorders'],
  [6, 'G00', 'G99', 'Diseases of the nervous system'],
  [7, 'H00', 'H59', 'Diseases of the eye and adnexa'],
  [8, 'H60', 'H95', 'Diseases of the ear and mastoid process'],
  [9, 'I00', 'I99', 'Diseases of the circulatory system'],
  [10, 'J00', 'J99', 'Diseases of the respiratory system'],
  [11, 'K00', 'K95', 'Diseases of the digestive system'],
  [12, 'L00', 'L99', 'Diseases of the skin and subcutaneous tissue'],
  [13, 'M00', 'M99', 'Diseases of the musculoskeletal system and connective tissue'],
  [14, 'N00', 'N99', 'Diseases of the genitourinary system'],
  [15, 'O00', 'O9A', 'Pregnancy, childbirth and the puerperium'],
  [16, 'P00', 'P96', 'Certain conditions originating in the perinatal period'],
  [17, 'Q00', 'Q99', 'Congenital malformations, deformations and chromosomal abnormalities'],
  [18, 'R00', 'R99', 'Symptoms, signs and abnormal clinical and laboratory findings, not elsewhere classified'],
  [19, 'S00', 'T88', 'Injury, poisoning and certain other consequences of external causes'],
  [20, 'V00', 'Y99', 'External causes of morbidity'],
  [21, 'Z00', 'Z99', 'Factors influencing health status and contact with health services'],
  [22, 'U00', 'U85', 'Codes for special purposes'],
];

export function chapterOf(code: string): Icd10Hit['chapter'] {
  const cat = icd10Key(code).slice(0, 3);
  if (cat.length < 3) return null;
  for (const [number, from, to, title] of CHAPTERS) {
    if (cat >= from && cat <= to) return { number, range: `${from}-${to}`, title };
  }
  return null;
}

// ─── Query words ──────────────────────────────────────────────────────────────

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'to', 'for', 'or', 'on', 'by', 'at', 'as']);

/** Common clinical abbreviations → the words ICD-10-CM uses. Each word is required. */
export const ICD10_SYNONYMS: Record<string, string[]> = {
  mdd: ['major', 'depressive'],
  gad: ['generalized', 'anxiety'],
  ptsd: ['post', 'traumatic', 'stress'],
  adhd: ['attention', 'deficit', 'hyperactivity'],
  ocd: ['obsessive', 'compulsive'],
  asd: ['autistic'],
  aud: ['alcohol'],
  oud: ['opioid'],
  cud: ['cannabis'],
  anxious: ['anxiety'],
  depressed: ['depress'],
  htn: ['hypertension'],
  hld: ['hyperlipidemia'],
  dm: ['diabetes', 'mellitus'],
  t2dm: ['type', '2', 'diabetes'],
  dm2: ['type', '2', 'diabetes'],
  t1dm: ['type', '1', 'diabetes'],
  copd: ['chronic', 'obstructive', 'pulmonary'],
  chf: ['heart', 'failure'],
  cad: ['atherosclerotic', 'heart'],
  ckd: ['chronic', 'kidney'],
  gerd: ['gastro', 'esophageal', 'reflux'],
  uti: ['urinary', 'tract', 'infection'],
  uri: ['upper', 'respiratory', 'infection'],
  afib: ['atrial', 'fibrillation'],
  osa: ['obstructive', 'sleep', 'apnea'],
};

/**
 * Frequently used codes (behavioral health + primary care) get a small boost on word searches so
 * "hypertension" offers I10 before rarer variants. Every entry is a billable FY2027 code (tested).
 */
export const COMMON_CODES = new Set([
  // behavioral health
  'F329', 'F32A', 'F320', 'F321', 'F322', 'F330', 'F331', 'F332', 'F339', 'F411', 'F410', 'F419', 'F4310', 'F4312',
  'F4321', 'F4322', 'F4323', 'F4325', 'F900', 'F901', 'F902', 'F909', 'F3110', 'F3130', 'F319', 'F3181', 'F209', 'F250',
  'F259', 'F603', 'F429', 'F1020', 'F1010', 'F1120', 'F1220', 'F1290', 'F17210', 'F840', 'F5101', 'F340', 'F99',
  // primary care
  'I10', 'E119', 'E1165', 'E785', 'E782', 'E669', 'E6601', 'E039', 'E559', 'K219', 'J45909', 'J449', 'J069', 'N390',
  'M5450', 'R519', 'G4733', 'D649', 'E871', 'Z0000', 'Z0001', 'Z23', 'I4891', 'I2510', 'N1830', 'G43909', 'R7303',
]);

type Term = { text: string; alts: string[] };

/** Query → required terms; each term may match by itself or a crude stem ("depression" → "depress"). */
export function queryTerms(q: string): Term[] {
  const out: Term[] = [];
  for (const w of wordTokens(q)) {
    if (STOP.has(w)) continue;
    const expanded = ICD10_SYNONYMS[w] ?? [w];
    for (const t of expanded) {
      const alts = [t];
      if (t.length >= 6 && /[a-z]$/.test(t)) alts.push(t.slice(0, Math.max(5, t.length - 3)));
      if (!out.some((o) => o.text === t)) out.push({ text: t, alts });
    }
  }
  return out;
}

// ─── Index ────────────────────────────────────────────────────────────────────

export function buildIcd10Index(rows: Icd10Row[]): Icd10Index {
  const n = rows.length;
  const keys = new Array<string>(n);
  const shorts = new Array<string>(n);
  const longs = new Array<string>(n);
  const billable = new Uint8Array(n);
  const byKey = new Map<string, number>();
  const post = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    keys[i] = r.key;
    longs[i] = r.long;
    shorts[i] = r.short || r.long;
    billable[i] = r.billable ? 1 : 0;
    byKey.set(r.key, i);
    const seen = new Set<string>();
    for (const t of wordTokens(`${r.long} ${r.short}`)) {
      if (seen.has(t)) continue;
      seen.add(t);
      let list = post.get(t);
      if (!list) post.set(t, (list = []));
      list.push(i);
    }
  }
  const tokens = [...post.keys()].sort();
  const postings = tokens.map((t) => Int32Array.from(post.get(t)!));
  const sortedByKey = Int32Array.from(keys.map((_, i) => i).sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0)));
  return { keys, billable, shorts, longs, byKey, sortedByKey, tokens, postings };
}

function lowerBound(arr: ArrayLike<string>, x: string, get: (i: number) => string = (i) => arr[i] as string) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (get(mid) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Row indices whose code key starts with `prefix`. */
function codePrefixRows(ix: Icd10Index, prefix: string, cap = 5000): number[] {
  const get = (i: number) => ix.keys[ix.sortedByKey[i]];
  const out: number[] = [];
  for (let p = lowerBound(ix.sortedByKey as unknown as ArrayLike<string>, prefix, get); p < ix.sortedByKey.length && out.length < cap; p++) {
    const row = ix.sortedByKey[p];
    if (!ix.keys[row].startsWith(prefix)) break;
    out.push(row);
  }
  return out;
}

/** Row indices having a description word starting with `prefix` (union of postings). */
function wordPrefixRows(ix: Icd10Index, prefix: string): Set<number> {
  const out = new Set<number>();
  for (let p = lowerBound(ix.tokens, prefix); p < ix.tokens.length && ix.tokens[p].startsWith(prefix); p++) {
    for (const row of ix.postings[p]) out.add(row);
  }
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function lookupIcd10(ix: Icd10Index, code: string): Omit<Icd10Hit, 'score'> | null {
  const row = ix.byKey.get(icd10Key(code));
  return row === undefined ? null : hitOf(ix, row, 0);
}

function hitOf(ix: Icd10Index, row: number, score: number): Icd10Hit {
  const key = ix.keys[row];
  const catKey = key.slice(0, 3);
  const catRow = ix.byKey.get(catKey);
  return {
    code: formatIcd10(key),
    key,
    description: ix.longs[row],
    shortDescription: ix.shorts[row],
    billable: ix.billable[row] === 1,
    category: { code: catKey, description: catRow === undefined ? null : ix.longs[catRow] },
    chapter: chapterOf(key),
    score,
  };
}

export type Icd10SearchOptions = { limit?: number; billableOnly?: boolean; context?: Icd10Context };

export function searchIcd10(ix: Icd10Index, rawQuery: string, opts: Icd10SearchOptions = {}): Icd10Hit[] {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const context = opts.context ?? 'any';
  const q = String(rawQuery || '').trim().slice(0, 120);
  if (q.length < 2) return [];
  const scores = new Map<number, number>();
  const put = (row: number, s: number) => {
    if ((scores.get(row) ?? -Infinity) < s) scores.set(row, s);
  };

  // 1) Code: exact > prefix (fewer extra characters first)
  if (isCodeQuery(q)) {
    const k = icd10Key(q);
    for (const row of codePrefixRows(ix, k)) {
      const extra = ix.keys[row].length - k.length;
      put(row, extra === 0 ? 1000 : 900 - extra * 20);
    }
  }

  // 2) Words in any order (every term must match a word prefix, or a code prefix for code-like terms)
  const terms = queryTerms(q).filter((t) => t.text.length >= 2 || /\d/.test(t.text));
  if (terms.length) {
    const termSets = terms.map((t) => {
      const set = new Set<number>();
      for (const a of t.alts) for (const r of wordPrefixRows(ix, a)) set.add(r);
      if (isCodeQuery(t.text)) for (const r of codePrefixRows(ix, icd10Key(t.text))) set.add(r);
      return set;
    });
    const order = termSets.map((s, i) => [s.size, i] as const).sort((a, b) => a[0] - b[0]);
    let candidates = [...termSets[order[0][1]]];
    for (let j = 1; j < order.length && candidates.length; j++) {
      const s = termSets[order[j][1]];
      candidates = candidates.filter((r) => s.has(r));
    }
    const exactRes = terms.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t.text)}($|[^a-z0-9])`));
    const directRes = terms.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t.text)}`));
    const firstWord = terms[0].text;
    for (const row of candidates) {
      const long = ix.longs[row].toLowerCase();
      let s = 500;
      terms.forEach((_, i) => {
        if (exactRes[i].test(long)) s += 30;
        else if (directRes[i].test(long)) s += 15;
      });
      if (long.startsWith(firstWord)) s += 40;
      // terms appearing in the typed order
      let pos = -1;
      let inOrder = true;
      for (const t of terms) {
        const at = long.indexOf(t.text, pos + 1);
        if (at < 0 || at < pos) { inOrder = false; break; }
        pos = at;
      }
      if (inOrder && terms.length > 1) s += 20;
      // share of the description's words the query covers ("Essential (primary) hypertension")
      const words = wordTokens(long).filter((w) => !STOP.has(w));
      const covered = words.filter((w) => terms.some((t) => t.alts.some((a) => w.startsWith(a)))).length;
      s += words.length ? (60 * covered) / words.length : 0;
      if (COMMON_CODES.has(ix.keys[row])) s += 45;
      s -= Math.min(long.length, 240) / 4; // concise descriptions first
      put(row, s);
    }
  }

  const hits: Icd10Hit[] = [];
  for (const [row, base] of scores) {
    const isBillable = ix.billable[row] === 1;
    if (opts.billableOnly && !isBillable) continue;
    let s = base;
    if (base < 800 && context === 'bh' && ix.keys[row].startsWith('F')) s += 150;
    if (base < 900 && !isBillable) s -= 8;
    hits.push(hitOf(ix, row, s));
  }
  hits.sort((a, b) => b.score - a.score || (a.key.length - b.key.length) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return hits.slice(0, limit);
}

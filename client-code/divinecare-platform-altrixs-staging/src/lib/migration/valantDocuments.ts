/**
 * Valant documents ZIP import: pure rules (no database, no I/O) shared by the processing job
 * (src/lib/migration/valantDocumentsJob.ts), the admin API, the CLI scripts and the tests.
 *
 * The export holds ONE FOLDER PER CLIENT (optionally inside one wrapper folder), each with PDFs and
 * maybe subfolders: progress notes, intake note / forms / consents, addenda, discharge summary,
 * measures, lab reports, patient ID, demographics, payment receipts, other.
 *
 * Safety rules:
 *   - A client folder files to a chart only on an exact match: the folder name IS the Valant client
 *     code (Client.sourceId of a Valant-imported client, e.g. "WALYAS", "SEMALE93"), else a Valant ID /
 *     MRN in the name, else full name + DOB, else a full name that is unique in the organization.
 *     A file named "CODE_YYYYMMDD_Title(DocId).pdf" must carry the same code, or that file goes to review. Anything ambiguous or conflicting goes to
 *     the document intake review queue; nothing is guessed.
 *   - Outside a matched client folder (resolveDocumentTarget): a subfolder up to 2 levels down that is
 *     exactly one client's code is that client's folder; else a file name starting "CODE_" with CODE
 *     exactly one client's code files to that client; else ERA exception / claims / remittance / EOB
 *     records go to the practice billing archive (no client, billing roles only); else review.
 *   - Dates come only from the file name; a document without one has no date (never invented).
 *   - Reports carry counts and masked labels ("Xxxx, Xxxx (#####)") only, never names or contents.
 */
import { FILING_PATH, type AnyDocType } from '@/lib/docIntake/classify';
import { VALANT_SOURCE_PLATFORMS } from './clientFacility';

export const VALANT_DOC_SOURCE = 'Valant import';
/** DocumentIntake.matchStatus of a document filed by an exact client-folder match */
export const VALANT_FOLDER_MATCH = 'valant_folder';

export type ValantDocType = Extract<
  AnyDocType,
  | 'Progress Note'
  | 'Intake Note'
  | 'Addendum'
  | 'Discharge Summary'
  | 'Measures'
  | 'Lab Report'
  | 'Consent / ROI'
  | 'Intake Form'
  | 'Patient ID'
  | 'Demographics'
  | 'Payment Receipt'
  | 'Other'
>;

export type TypeRule = { type: ValantDocType; pattern: RegExp };

/**
 * Keyword rules, first match wins (more specific first: "intake note" before "intake form",
 * "addendum" before "progress note"). Matched against normalized text: lower case, separators
 * (_ - . +) and camelCase boundaries turned into spaces. Edit this table when the real export's
 * folder names are known; `scripts/inspect-valant-zip.ts` lists them (masked).
 */
export const DEFAULT_TYPE_RULES: TypeRule[] = [
  { type: 'Addendum', pattern: /\baddend(a|um|ums)\b/ },
  { type: 'Intake Note', pattern: /\bintake (progress )?notes?\b|\binitial (eval(uation)?|assessment) notes?\b/ },
  { type: 'Discharge Summary', pattern: /\bdischarge( summar(y|ies))?\b/ },
  { type: 'Progress Note', pattern: /\bprogress notes?\b|\bpsychotherapy notes?\b|\bsession notes?\b|\bprogress ?notes\b/ },
  { type: 'Measures', pattern: /\bmeasures?\b|\bmeasurements?\b|\bassessments?\b|\boutcome measures?\b/ },
  { type: 'Lab Report', pattern: /\blabs?\b|\blab (report|result)s?\b|\blaboratory\b/ },
  { type: 'Consent / ROI', pattern: /\bconsents?\b|\brelease of information\b|\broi\b/ },
  { type: 'Intake Form', pattern: /\bintake (forms?|packets?|paperwork|questionnaires?)\b/ },
  { type: 'Patient ID', pattern: /\bpatient id\b|\bclient id card\b|\bid cards?\b|\bdriver'?s? licen[cs]e\b|\blicen[cs]e\b|\bphoto id\b|\bidentification\b/ },
  { type: 'Demographics', pattern: /\bdemographics?\b|\bface ?sheets?\b/ },
  { type: 'Payment Receipt', pattern: /\breceipts?\b|\bpayments?\b/ },
];

/** Lower case; separators and camelCase boundaries become single spaces */
export function normalizeForRules(s: string): string {
  return s
    .replace(/\.[a-z0-9]{2,5}$/i, '') // extension
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.+()[\]{}#,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Type of one file from its own name first, then its subfolders from the deepest up
 * (e.g. "Progress Notes/2024-01-05 Addendum.pdf" is an Addendum). No keyword: 'Other'.
 */
export function classifyValantDocument(
  subfolders: string[],
  fileName: string,
  rules: TypeRule[] = DEFAULT_TYPE_RULES
): { type: ValantDocType; matchedOn: 'file' | 'folder' | 'none' } {
  const test = (text: string) => {
    const n = normalizeForRules(text);
    return rules.find((r) => r.pattern.test(n))?.type ?? null;
  };
  const byFile = test(fileName);
  if (byFile) return { type: byFile, matchedOn: 'file' };
  for (let i = subfolders.length - 1; i >= 0; i--) {
    // Folder names keep their "extension-like" endings (e.g. "Notes.v2"): only strip a real one
    const t = test(`${subfolders[i]}.dir`);
    if (t) return { type: t, matchedOn: 'folder' };
  }
  return { type: 'Other', matchedOn: 'none' };
}

export function filingPathFor(type: ValantDocType): string {
  return FILING_PATH[type];
}

// ─── Dates ────────────────────────────────────────────────────────────────────

function ymd(y: number, m: number, d: number, minYear: number, maxYear: number): string | null {
  if (y < minYear || y > maxYear || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 02-30
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Date of service / signing printed in a FILE name (YYYY-MM-DD, YYYY_MM_DD, MM-DD-YYYY, MM_DD_YYYY,
 * MM.DD.YYYY, YYYYMMDD). The first valid one wins; none → null (never invented).
 * `now` bounds the year so an ID like 20991231 is not read as a date.
 */
export function parseDocumentDate(fileName: string, now: Date = new Date()): string | null {
  const s = fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
  const maxYear = now.getUTCFullYear() + 1;
  const patterns: Array<{ re: RegExp; order: 'ymd' | 'mdy' }> = [
    { re: /(?<!\d)(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/g, order: 'ymd' },
    { re: /(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})(?!\d)/g, order: 'mdy' },
    { re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g, order: 'ymd' },
  ];
  const hits: Array<{ at: number; value: string }> = [];
  for (const { re, order } of patterns) {
    for (const m of s.matchAll(re)) {
      const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const v = order === 'ymd' ? ymd(a, b, c, 1990, maxYear) : ymd(c, a, b, 1990, maxYear);
      if (v) hits.push({ at: m.index ?? 0, value: v });
    }
  }
  hits.sort((x, y) => x.at - y.at);
  return hits[0]?.value ?? null;
}

// ─── Valant file names: "CODE_YYYYMMDD_Title(DocId).pdf" ──────────────────────

export type ValantFileName = {
  /** Valant client code from the file-name prefix, as written ("SEMALE93") */
  code: string;
  /** YYYY-MM-DD, or null when the 8 digits are not a valid calendar date */
  date: string | null;
  /** Document title ("Progress Note"), used for the type rules */
  title: string;
  /** Valant document id (the number in parentheses), leading zeros removed */
  valantDocumentId: string;
};

const VALANT_FILE_NAME = /^\s*([A-Za-z0-9]+(?: [A-Za-z0-9]+)?)_(\d{8})_(.*?)\s*\((\d{1,20})\)\s*(?:\.[A-Za-z0-9]{1,5})?\s*$/;

/**
 * Valant export file name: "<client code>_<YYYYMMDD>_<document title>(<document id>).<ext>".
 * Anything else → null (the generic date / keyword rules apply instead).
 */
export function parseValantFileName(fileName: string, now: Date = new Date()): ValantFileName | null {
  const m = fileName.normalize('NFC').match(VALANT_FILE_NAME);
  if (!m) return null;
  const [, code, d8, title, docId] = m;
  const date = ymd(Number(d8.slice(0, 4)), Number(d8.slice(4, 6)), Number(d8.slice(6, 8)), 1900, now.getUTCFullYear() + 1);
  return { code, date, title: title.trim(), valantDocumentId: docId.replace(/^0+(?=\d)/, '') };
}

// ─── Client folder parsing ────────────────────────────────────────────────────

export type ParsedClientFolder = {
  raw: string;
  /** Candidate (first, last) pairs, normalized. One pair for "Last, First"; several when the order is unknown */
  nameKeys: string[];
  firstName: string | null;
  lastName: string | null;
  nameOrderKnown: boolean;
  sourceIds: string[];
  dob: string | null;
};

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
const ID_LIKE = /^[A-Za-z0-9-]{3,20}$/;
/** Numeric IDs, or Valant's letter IDs (WALYAS, SEMALE93) */
const isIdToken = (t: string) => ID_LIKE.test(t) && (/\d/.test(t) || /^[A-Z]{4,8}\d{0,3}$/.test(t));

/** A date of birth in a folder name (1900 to this year) */
function folderDate(token: string, now: Date = new Date()): string | null {
  const s = token.trim();
  const max = now.getUTCFullYear();
  let m = s.match(/^(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]), 1900, max);
  m = s.match(/^(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})$/);
  if (m) return ymd(Number(m[3]), Number(m[1]), Number(m[2]), 1900, max);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]), 1900, max);
  return null;
}

/** Normalized name words: no diacritics, punctuation, middle initials or suffixes */
export function nameWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SUFFIX.test(w));
}

export const nameKey = (first: string, last: string) => `${nameWords(first).join(' ')}|${nameWords(last).join(' ')}`;

/**
 * Parse a client folder name: "Last, First", "First Last", "Last_First_12345", optional
 * "(12345)" / "[WALYAS]" / "- 12345" / "ID 12345" / "MRN 12345", optional DOB
 * ("1980-01-31", "01-31-1980", "DOB 19800131").
 */
export function parseClientFolder(raw: string): ParsedClientFolder {
  let s = ` ${raw.normalize('NFC')} `;
  const sourceIds: string[] = [];
  let dob: string | null = null;
  const addId = (t: string) => {
    const v = t.trim();
    if (v && !sourceIds.includes(v)) sourceIds.push(v);
  };

  // Labeled DOB (any date format, including 8 digits)
  s = s.replace(/\b(?:DOB|D\.O\.B\.?|Birth\s*Date|Date\s*of\s*Birth)\s*[:#]?\s*([0-9][0-9_.\-/]{6,9}[0-9])/gi, (_m, d: string) => {
    dob ??= folderDate(d.replace(/\//g, '-'));
    return ' ';
  });
  // Labeled IDs
  s = s.replace(/\b(?:Valant\s*(?:Patient\s*)?ID|Patient\s*ID|Client\s*ID|MRN|ID)\s*[:#]?\s*([A-Za-z0-9-]{3,20})\b/g, (m, id: string) => {
    if (!isIdToken(id)) return m;
    addId(id);
    return ' ';
  });
  // Bracketed groups: an ID, a DOB, or something else (nickname) that is not part of the legal name
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (_m, inner: string) => {
    const v = inner.trim();
    const d = folderDate(v);
    if (d) dob ??= d;
    else if (isIdToken(v)) addId(v);
    return ' ';
  });
  // Unlabeled dashed / underscored dates
  s = s.replace(/(?<![A-Za-z0-9])(\d{4}[-_.]\d{1,2}[-_.]\d{1,2}|\d{1,2}[-_.]\d{1,2}[-_.]\d{4})(?![A-Za-z0-9])/g, (m) => {
    const d = folderDate(m);
    if (d) {
      dob ??= d;
      return ' ';
    }
    return m;
  });
  // Remaining digit tokens are IDs ("Smith, John - 12345", "Smith_John_12345")
  const hasLower = /[a-z]/.test(s);
  s = s.replace(/(^|[\s_\-#]+)([A-Za-z]*\d[A-Za-z0-9]*)(?=[\s_\-#]+|$)/g, (_m, pre: string, tok: string) => {
    if (isIdToken(tok)) addId(tok);
    return ' ';
  });
  // " - WALYAS" after a mixed-case name: a letter ID
  if (hasLower) {
    s = s.replace(/\s-\s*([A-Z]{4,8})\s*$/, (_m, tok: string) => {
      addId(tok);
      return ' ';
    });
  }

  const hasComma = s.includes(',');
  const cleaned = s.replace(/_/g, ' ').replace(/\s-\s/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-,\s]+|[-,\s]+$/g, '');
  let firstName: string | null = null;
  let lastName: string | null = null;
  const nameKeys: string[] = [];

  if (hasComma) {
    const [last, ...rest] = cleaned.split(',');
    const first = rest.join(' ');
    const lw = nameWords(last);
    const fw = nameWords(first);
    if (lw.length && fw.length) {
      lastName = lw.join(' ');
      firstName = fw.join(' ');
      nameKeys.push(`${firstName}|${lastName}`);
      // "Last, First Middle": the middle name may not be on the chart
      if (fw.length > 1) nameKeys.push(`${fw[0]}|${lastName}`);
    }
  } else {
    const w = nameWords(cleaned);
    if (w.length >= 2) {
      firstName = w[0];
      lastName = w.slice(1).join(' ');
      // Order unknown: every split, both orders ("John Smith", "Smith John", "Mary Ann Smith")
      for (let k = 1; k < w.length; k++) {
        const a = w.slice(0, k).join(' ');
        const b = w.slice(k).join(' ');
        for (const key of [`${a}|${b}`, `${b}|${a}`]) if (!nameKeys.includes(key)) nameKeys.push(key);
      }
    }
  }
  return { raw, nameKeys, firstName, lastName, nameOrderKnown: hasComma, sourceIds, dob };
}

// ─── Client matching ──────────────────────────────────────────────────────────

export type FolderRosterClient = {
  clientId: string;
  displayName: string;
  dob: string; // YYYY-MM-DD or ''
  sourceId: string | null;
  mrn: string | null;
  keys: string[];
  /** Normalized Valant client code (sourceId of a Valant-imported client), else null */
  valantCode: string | null;
};

export type RosterInput = {
  id: string;
  name: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  dateOfBirth: Date | null;
  mrn: string | null;
  sourceId: string | null;
  /** Client.sourcePlatform; only Valant imports take part in client-code matching */
  sourcePlatform?: string | null;
};

const VALANT_PLATFORMS = new Set<string>(VALANT_SOURCE_PLATFORMS.map((p) => p.toLowerCase()));
export const isValantPlatform = (p: string | null | undefined) => Boolean(p && VALANT_PLATFORMS.has(p.trim().toLowerCase()));

/**
 * Valant client code as compared: trimmed, inner whitespace collapsed, upper case. Letters and digits
 * only (single inner spaces allowed, "AB CDE"), 3 to 20 characters; anything else → '' (not a code).
 */
export function normalizeClientCode(s: string | null | undefined): string {
  const v = String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z0-9]+(?: [A-Z0-9]+)*$/.test(v) && v.replace(/ /g, '').length >= 3 && v.length <= 20 ? v : '';
}

export function toFolderRoster(rows: RosterInput[]): FolderRosterClient[] {
  return rows.map((r) => {
    const keys = new Set<string>();
    if (r.legalFirstName?.trim() && r.legalLastName?.trim()) {
      keys.add(nameKey(r.legalFirstName, r.legalLastName));
    } else {
      const w = nameWords(r.name || '');
      for (let k = 1; k < w.length; k++) keys.add(`${w.slice(0, k).join(' ')}|${w.slice(k).join(' ')}`);
    }
    return {
      clientId: r.id,
      displayName: (r.name || [r.legalFirstName, r.legalLastName].filter(Boolean).join(' ')).trim(),
      dob: r.dateOfBirth ? r.dateOfBirth.toISOString().slice(0, 10) : '',
      sourceId: r.sourceId,
      mrn: r.mrn,
      keys: [...keys].filter((k) => !k.startsWith('|') && !k.endsWith('|')),
      valantCode: isValantPlatform(r.sourcePlatform) ? normalizeClientCode(r.sourceId) || null : null,
    };
  });
}

export const normalizeId = (s: string) => s.replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').toUpperCase();

/** 'code': the folder name is the client's Valant client code (counted with the ID matches) */
export type MatchBasis = 'code' | 'id' | 'name_dob' | 'name';
export type FolderMatch = {
  status: 'matched' | 'needs_review' | 'unmatched';
  clientId: string | null;
  basis: MatchBasis | null;
  reason: string;
  candidates: Array<{ clientId: string; name: string; dob: string; reason: string }>;
  /** Matched client's Valant client code (normalized), to confirm file-name codes */
  clientCode?: string | null;
};

/** Indexes for matching thousands of folders against the whole roster */
export function indexRoster(roster: FolderRosterClient[]) {
  const byId = new Map<string, FolderRosterClient[]>();
  const byKey = new Map<string, FolderRosterClient[]>();
  const byCode = new Map<string, FolderRosterClient[]>();
  const push = (m: Map<string, FolderRosterClient[]>, k: string, c: FolderRosterClient) => {
    const list = m.get(k) ?? [];
    if (!list.includes(c)) list.push(c);
    m.set(k, list);
  };
  for (const c of roster) {
    for (const id of [c.sourceId, c.mrn]) if (id && normalizeId(id)) push(byId, normalizeId(id), c);
    for (const k of c.keys) push(byKey, k, c);
    if (c.valantCode) push(byCode, c.valantCode, c);
  }
  return { byId, byKey, byCode };
}
export type RosterIndex = ReturnType<typeof indexRoster>;

const cand = (c: FolderRosterClient, reason: string) => ({ clientId: c.clientId, name: c.displayName, dob: c.dob, reason });

/**
 * Priority: the folder name is exactly the Valant client code (case-insensitive, trimmed) of one
 * Valant-imported client; then exact Valant ID / MRN, then exact full name + DOB, then a full name unique in the
 * organization (only with `allowNameOnly`). Any conflict (ID and name or DOB disagree, several
 * candidates, a different Valant ID on the name match) → needs_review. Nothing found → unmatched.
 */
export function matchClientFolder(
  folder: ParsedClientFolder,
  index: RosterIndex,
  opts: { allowNameOnly?: boolean } = {}
): FolderMatch {
  const allowNameOnly = opts.allowNameOnly ?? true;
  const review = (reason: string, list: FolderRosterClient[], why: string): FolderMatch => ({
    status: 'needs_review', clientId: null, basis: null, reason, candidates: list.slice(0, 5).map((c) => cand(c, why)),
  });
  const matched = (c: FolderRosterClient, basis: MatchBasis, reason: string): FolderMatch => ({
    status: 'matched', clientId: c.clientId, basis, reason, candidates: [], clientCode: c.valantCode,
  });

  // 0. The folder name is the Valant client code (the Valant export layout)
  const code = normalizeClientCode(folder.raw);
  const codeHits = code ? index.byCode.get(code) ?? [] : [];
  if (codeHits.length > 1) return review('Several clients have this Valant client code', codeHits, 'Same client code');
  if (codeHits.length === 1) return matched(codeHits[0], 'code', 'Folder name is the Valant client code');

  const nameHits = [...new Set(folder.nameKeys.flatMap((k) => index.byKey.get(k) ?? []))];
  const nameMatches = (c: FolderRosterClient) => nameHits.includes(c);

  // 1. Valant ID / MRN
  const ids = folder.sourceIds.map(normalizeId).filter(Boolean);
  const idHits = [...new Set(ids.flatMap((id) => index.byId.get(id) ?? []))];
  if (idHits.length > 1) return review('Several clients have this Valant ID / MRN', idHits, 'Same ID');
  if (idHits.length === 1) {
    const c = idHits[0];
    if (folder.dob && c.dob && folder.dob !== c.dob) return review('Valant ID matches but the date of birth differs', [c], 'Same ID, different DOB');
    if (folder.nameKeys.length && !nameMatches(c)) return review('Valant ID matches but the name differs', [c], 'Same ID, different name');
    return matched(c, 'id', 'Valant ID / MRN in the folder name');
  }

  if (!nameHits.length) {
    return { status: 'unmatched', clientId: null, basis: null, reason: folder.nameKeys.length ? 'No client with this name or ID' : 'No name or ID in the folder name', candidates: [] };
  }
  // A name match whose chart carries a different Valant ID is a different person (or a data problem)
  const folderIds = new Set(ids);
  const idConflict = (c: FolderRosterClient) =>
    folderIds.size > 0 && Boolean(c.sourceId && normalizeId(c.sourceId)) && !folderIds.has(normalizeId(c.sourceId!));

  // 2. Full name + DOB
  if (folder.dob) {
    const same = nameHits.filter((c) => c.dob === folder.dob);
    if (same.length > 1) return review('Several clients share this name and date of birth', same, 'Same name and DOB');
    if (same.length === 1) {
      if (idConflict(same[0])) return review('Name and DOB match but the chart has a different Valant ID', same, 'Different Valant ID');
      return matched(same[0], 'name_dob', 'Full name and date of birth');
    }
    const conflicting = nameHits.filter((c) => c.dob && c.dob !== folder.dob);
    if (conflicting.length) return review('Name matches but the date of birth differs', nameHits, 'Same name, different DOB');
    // Only charts without a DOB remain: fall through to the unique-name rule
  }

  // 3. Unique full name
  if (nameHits.length > 1) return review('Several clients have this name', nameHits, 'Same name');
  const only = nameHits[0];
  if (idConflict(only)) return review('Name matches but the chart has a different Valant ID', [only], 'Different Valant ID');
  if (!allowNameOnly) return review('Name-only match (needs confirmation)', [only], 'Same name');
  return matched(only, 'name', 'Full name, unique in the practice');
}

/**
 * Per-file confirmation of a matched folder: the client code in a Valant file name must be the
 * folder's code (code matches) or the matched chart's Valant code (other matches). Returns null when
 * the file may be filed, else the review reason. A file without the Valant name pattern passes.
 */
export function fileCodeConflict(match: FolderMatch | null, folderName: string | null, fileCode: string | null | undefined): string | null {
  if (!match || match.status !== 'matched' || !fileCode) return null;
  const fc = normalizeClientCode(fileCode);
  if (match.basis === 'code') {
    return fc && fc === normalizeClientCode(folderName) ? null : 'Client code in the file name differs from the folder code';
  }
  if (match.clientCode && fc !== match.clientCode) return "Client code in the file name differs from the chart's Valant code";
  return null;
}

// ─── Where one file goes: client folder, nested client folder, file code, billing archive ──

/** DocumentIntake.matchStatus of a document filed by the client code at the start of its file name */
export const VALANT_FILE_CODE_MATCH = 'valant_file_code';
/** DocumentIntake.matchStatus of a practice-level billing record (ERA exceptions, claims, remittance, EOB) */
export const PRACTICE_BILLING_MATCH = 'practice_billing';
/** DocumentIntake.status of a practice billing record: no client, not in the review queue */
export const BILLING_ARCHIVE_STATUS = 'archived';
export const BILLING_ARCHIVE_TYPE = 'Billing Archive';
export const BILLING_ARCHIVE_FILING_PATH = 'Billing › Valant billing archive';
/** Nested client folders are looked for this many levels below an unmatched top folder */
export const NESTED_FOLDER_LEVELS = 2;

/**
 * Practice billing keywords (folder names and file names, normalized): ERA / ERA exceptions,
 * claims, remittance, EOB / explanation of benefits, 835.
 */
const BILLING_KEYWORDS = /\bera\b|\bclaims?\b|\bremit(tances?|s)?\b|\beobs?\b|\bexplanation of benefits?\b|\b835s?\b/;
/** A file-name prefix that is a billing word, never a client code ("ERA_Exceptions_...") */
const BILLING_WORD_TOKEN = /^(era|eras|eob|eobs|claim|claims|remit|remits|remittance|remittances|835|837|exceptions?|denials?|payments?)$/i;

export function isBillingArchivePath(folders: string[], fileName: string): boolean {
  return [...folders.map((f) => `${f}.dir`), fileName].some((t) => BILLING_KEYWORDS.test(normalizeForRules(t)));
}

/**
 * Payer name from a practice billing file name, e.g.
 * "ERA_Exceptions_PAYER NAME, LLC._20240105(123456789).pdf" → "PAYER NAME, LLC.". Leading billing
 * words and a trailing date are dropped; nothing left → null.
 */
export function parseBillingPayer(fileName: string): string | null {
  const stem = fileName.normalize('NFC').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/\s*\(\d{1,20}\)\s*$/, '');
  const parts = stem.split('_').map((p) => p.trim()).filter(Boolean);
  while (parts.length && /^[\d\-.]{6,10}$/.test(parts[parts.length - 1])) parts.pop();
  while (parts.length && parts[0].split(/\s+/).every((w) => BILLING_WORD_TOKEN.test(w))) parts.shift();
  const payer = parts.join(' ').replace(/\s+/g, ' ').trim();
  return payer && payer.length <= 120 && /[A-Za-z]/.test(payer) ? payer : null;
}

/**
 * Client code at the start of a file name: the Valant pattern's code ("AB CDE_20240105_Note(1).pdf"),
 * else the first "_"-separated token ("WALYAS_Statement.pdf"). Billing words never count as a code.
 */
export function fileNameClientCode(fileName: string): string | null {
  const parsed = parseValantFileName(fileName);
  const raw = parsed?.code ?? fileName.normalize('NFC').match(/^\s*([A-Za-z0-9]+)_/)?.[1] ?? null;
  if (!raw || raw.split(/\s+/).some((w) => BILLING_WORD_TOKEN.test(w))) return null;
  return normalizeClientCode(raw) || null;
}

export type TargetCandidate = FolderMatch['candidates'][number];

export type DocumentTarget =
  | {
      kind: 'client';
      clientId: string;
      /** folder: the top folder matched; nested_folder: a client-code folder below it; file_code: the file name's code */
      basis: 'folder' | 'nested_folder' | 'file_code';
      matchStatus: typeof VALANT_FOLDER_MATCH | typeof VALANT_FILE_CODE_MATCH;
      reason: string;
    }
  | { kind: 'billing'; payer: string | null; reason: string }
  | {
      kind: 'review';
      reason: string;
      candidates: TargetCandidate[];
      /** The file-name code disagrees with this matched client (shown as the candidate) */
      conflictClientId?: string | null;
      codeMismatch?: boolean;
    };

/** A client-code folder below an unmatched top folder (up to NESTED_FOLDER_LEVELS levels) */
export function matchNestedFolder(
  subfolders: string[],
  index: RosterIndex
): { status: 'none' } | { status: 'matched'; folder: string; client: FolderRosterClient } | { status: 'review'; reason: string; candidates: TargetCandidate[] } {
  const hits: Array<{ folder: string; client: FolderRosterClient }> = [];
  for (const folder of subfolders.slice(0, NESTED_FOLDER_LEVELS)) {
    const code = normalizeClientCode(folder);
    const list = code ? index.byCode.get(code) ?? [] : [];
    if (list.length > 1) {
      return { status: 'review', reason: 'Several clients have the client code of a subfolder', candidates: list.slice(0, 5).map((c) => cand(c, 'Same client code')) };
    }
    if (list.length === 1) hits.push({ folder, client: list[0] });
  }
  if (!hits.length) return { status: 'none' };
  const clients = [...new Set(hits.map((h) => h.client))];
  if (clients.length > 1) {
    return { status: 'review', reason: 'Nested subfolders carry the client codes of different clients', candidates: clients.map((c) => cand(c, 'Nested folder code')) };
  }
  return { status: 'matched', folder: hits[0].folder, client: hits[0].client };
}

/**
 * Where one file goes. Rules, in order (nothing is guessed; any conflict → review):
 *   1. The top folder matched a client: filed there, unless the file name's code disagrees.
 *   2. Nested client folders: a subfolder (up to 2 levels below an unmatched top folder) whose name is
 *      exactly one client's Valant code is that client's folder ("Archived/WALYAS/Notes/x.pdf").
 *   3. File-level client code: a file outside a matched client folder whose name starts with "CODE_",
 *      CODE exactly one client's Valant code ("ESignature Eligible/WALYAS_20240105_Consent(1).pdf").
 *   4. Practice billing archive: a file under ERA exception / claims / remittance / EOB folders or
 *      titles that no rule above files to a client, whose top folder does not point at clients by
 *      name (needs_review), and whose name is not a Valant client file name ("CODE_YYYYMMDD_Title(id)").
 *   5. Anything else: the review queue.
 */
export function resolveDocumentTarget(
  file: { topFolder: string | null; subfolders: string[]; fileName: string },
  topMatch: FolderMatch | null,
  index: RosterIndex
): DocumentTarget {
  const parsed = parseValantFileName(file.fileName);
  if (topMatch?.status === 'matched' && topMatch.clientId) {
    const conflict = fileCodeConflict(topMatch, file.topFolder, parsed?.code);
    if (!conflict) return { kind: 'client', clientId: topMatch.clientId, basis: 'folder', matchStatus: VALANT_FOLDER_MATCH, reason: topMatch.reason };
    return { kind: 'review', reason: conflict, candidates: [], conflictClientId: topMatch.clientId, codeMismatch: true };
  }

  const nested = file.topFolder ? matchNestedFolder(file.subfolders, index) : ({ status: 'none' } as const);
  if (nested.status === 'review') return { kind: 'review', reason: nested.reason, candidates: nested.candidates };
  if (nested.status === 'matched') {
    const m: FolderMatch = {
      status: 'matched', clientId: nested.client.clientId, basis: 'code', reason: 'Subfolder name is the Valant client code', candidates: [], clientCode: nested.client.valantCode,
    };
    const conflict = fileCodeConflict(m, nested.folder, parsed?.code);
    if (conflict) return { kind: 'review', reason: conflict, candidates: [], conflictClientId: nested.client.clientId, codeMismatch: true };
    return { kind: 'client', clientId: nested.client.clientId, basis: 'nested_folder', matchStatus: VALANT_FOLDER_MATCH, reason: m.reason };
  }

  const code = fileNameClientCode(file.fileName);
  const codeHits = code ? index.byCode.get(code) ?? [] : [];
  if (codeHits.length > 1) {
    return { kind: 'review', reason: 'Several clients have the client code in the file name', candidates: codeHits.slice(0, 5).map((c) => cand(c, 'Same client code')) };
  }
  if (codeHits.length === 1) {
    const c = codeHits[0];
    // The top folder already points at other clients (by name): conflicting evidence
    if (topMatch?.status === 'needs_review' && topMatch.candidates.length && !topMatch.candidates.some((x) => x.clientId === c.clientId)) {
      return {
        kind: 'review',
        reason: 'The client code in the file name is not one of the folder candidates',
        candidates: [...topMatch.candidates, cand(c, 'Client code in the file name')].slice(0, 6),
      };
    }
    return { kind: 'client', clientId: c.clientId, basis: 'file_code', matchStatus: VALANT_FILE_CODE_MATCH, reason: 'File name starts with the Valant client code' };
  }

  const folders = [...(file.topFolder ? [file.topFolder] : []), ...file.subfolders];
  if (topMatch?.status !== 'needs_review' && !parsed && isBillingArchivePath(folders, file.fileName)) {
    return { kind: 'billing', payer: parseBillingPayer(file.fileName), reason: 'Practice billing record (ERA / claims / remittance / EOB), not a client document' };
  }
  return { kind: 'review', reason: topMatch ? topMatch.reason : 'File outside a client folder', candidates: topMatch?.candidates ?? [] };
}

// ─── Archive layout ───────────────────────────────────────────────────────────

/** macOS / Windows metadata and hidden files: never documents */
export function isJunkEntry(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '__MACOSX' || p.startsWith('._'))) return true;
  const base = parts[parts.length - 1] || '';
  return /^(\.ds_store|thumbs\.db|desktop\.ini)$/i.test(base) || base.startsWith('.') || base.startsWith('~$');
}

export const normalizeEntryPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

/**
 * Leading wrapper folders above the client folders (e.g. "Valant Export/Smith, John/..."): strip
 * single shared top folders while the level below has at least two folders.
 */
export function detectWrapperDepth(filePaths: string[]): number {
  let depth = 0;
  for (;;) {
    const tops = new Set<string>();
    const below = new Set<string>();
    let fileAtLevel = false;
    for (const p of filePaths) {
      const parts = p.split('/').filter(Boolean);
      if (parts.length <= depth + 1) {
        fileAtLevel = true;
        continue;
      }
      tops.add(parts[depth]);
      if (parts.length > depth + 2) below.add(parts[depth + 1]);
    }
    if (fileAtLevel || tops.size !== 1 || below.size < 2) return depth;
    depth++;
  }
}

export type ArchiveFile = { clientFolder: string | null; subfolders: string[]; fileName: string };

/** Split a file path into client folder, subfolders below it, and file name. Loose files have no client folder */
export function splitArchivePath(path: string, wrapperDepth: number): ArchiveFile {
  const parts = normalizeEntryPath(path).split('/').filter(Boolean).slice(wrapperDepth);
  const fileName = parts.pop() || '';
  if (!parts.length) return { clientFolder: null, subfolders: [], fileName };
  return { clientFolder: parts[0], subfolders: parts.slice(1), fileName };
}

// ─── File content sniffing ────────────────────────────────────────────────────

export type FileKind = { ext: 'pdf' | 'jpg' | 'png'; mime: string };
export const SUPPORTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
/** Larger single files are reported, not imported (the chart viewer streams files from memory) */
export const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;

export const extensionOf = (name: string) => (name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '').toLowerCase();

/** Real type from the first bytes ("%PDF-" may follow a short preamble) */
export function sniffFileKind(head: Uint8Array): FileKind | null {
  const b = head;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  const n = Math.min(b.length, 1024) - 4;
  for (let i = 0; i < n; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) {
      return { ext: 'pdf', mime: 'application/pdf' };
    }
  }
  return null;
}

// ─── Duplicates ───────────────────────────────────────────────────────────────

/**
 * Duplicate keys: the same content for the same client, or the same content at the same archive
 * path (an unmatched folder re-imported, even after staff filed it). Voided and rejected rows count:
 * re-running an import never brings back a document.
 */
export type DuplicateInput = { clientId: string | null; sha256: string; sourcePath: string | null; valantDocumentId?: string | null };

/** Also: the same Valant document id for the same client (the same document exported twice) */
export function duplicateKeys(input: DuplicateInput): string[] {
  const keys = [`p:${input.sourcePath ?? ''}:${input.sha256}`];
  if (input.clientId) keys.unshift(`c:${input.clientId}:${input.sha256}`);
  if (input.clientId && input.valantDocumentId) keys.unshift(`v:${input.clientId}:${input.valantDocumentId}`);
  return keys;
}

export function isDuplicate(seen: Set<string>, input: DuplicateInput) {
  return duplicateKeys(input).some((k) => seen.has(k));
}

export function rememberDocument(seen: Set<string>, input: DuplicateInput) {
  for (const k of duplicateKeys(input)) seen.add(k);
}

// ─── Unreadable files: why ────────────────────────────────────────────────────

/** Disk full on the server: the job stops (failed, resumable) instead of counting files unreadable */
export function isDiskFullError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOSPC' || code === 'EDQUOT';
}

/**
 * Reason class for a file that could not be read (counts and report; never PHI): encrypted,
 * zero_size, not_pdf_or_image, unsupported_compression:<method>, invalid_signature, size_mismatch,
 * truncated, extract_7z_failed:<exit code>, read_error:<error code | error name>.
 * An error carrying `reason` (thrown by the archive reader) keeps it.
 */
export function classifyReadError(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; name?: unknown; message?: unknown; reason?: unknown };
  if (typeof e.reason === 'string' && e.reason) return e.reason;
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  let m = msg.match(/unsupported compression method:\s*(\d+)/i);
  if (m) return `unsupported_compression:${m[1]}`;
  if (/invalid (local|central directory) file header signature/i.test(msg)) return 'invalid_signature';
  if (/encrypt/i.test(msg)) return 'encrypted';
  if (/too many bytes in the stream|not enough bytes in the stream/i.test(msg)) return 'size_mismatch';
  if (/file data overflows file bounds|unexpected EOF|unexpected end of file/i.test(msg)) return 'truncated';
  m = msg.match(/^7z exited with code (\d+)/);
  if (m) return `extract_7z_failed:${m[1]}`;
  if (code && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return `read_error:${code}`;
  const name = typeof e.name === 'string' && e.name !== 'Error' && /^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : '';
  return `read_error:${name || 'unknown'}`;
}

/** Count one unreadable file and keep its masked path under its reason (capped per reason) */
export function recordUnreadable(
  counts: { unreadable: number; unreadableByReason: Record<string, number> },
  byReason: Record<string, string[]>,
  reason: string,
  maskedPath: string,
  cap = 50
) {
  counts.unreadable++;
  counts.unreadableByReason[reason] = (counts.unreadableByReason[reason] ?? 0) + 1;
  const list = (byReason[reason] ??= []);
  if (list.length < cap) list.push(maskedPath);
}

// ─── Re-run with updated matching ─────────────────────────────────────────────

export type RematchRow = {
  id: string;
  status: string;
  matchStatus: string | null;
  suggestedClientId: string | null;
  voidedAt: Date | null;
  sourcePath: string | null;
  valantDocumentId?: string | null;
};

export type RematchFiling = {
  id: string;
  clientId: string;
  reason: string;
  valantDocumentId: string | null;
  basis: 'folder' | 'nested_folder' | 'file_code';
  matchStatus: string;
};
export type RematchArchive = { id: string; payer: string | null; reason: string };
export type RematchPlan = { file: RematchFiling[]; archive: RematchArchive[] };

/**
 * Review-queue documents of a batch that the current rules now place: still waiting for review
 * ('ready' + needs_review, no client, not voided). Each is resolved like a new file
 * (resolveDocumentTarget): filed to a client (top folder, nested client folder or file-name code), or
 * moved to the practice billing archive. Anything staff already handled is left alone, and a placed
 * row is no longer 'ready', so a second run finds nothing (idempotent). `sourcePath` is the path
 * below the wrapper folders ("<top folder>/.../<file>").
 */
export function planRematch(
  rows: RematchRow[],
  matchForFolder: (folder: string) => FolderMatch | null,
  index: RosterIndex = indexRoster([])
): RematchPlan {
  const plan: RematchPlan = { file: [], archive: [] };
  for (const r of rows) {
    if (r.status !== 'ready' || r.matchStatus !== 'needs_review' || r.suggestedClientId || r.voidedAt || !r.sourcePath) continue;
    const parts = normalizeEntryPath(r.sourcePath).split('/').filter(Boolean);
    const fileName = parts.pop() || '';
    const topFolder = parts[0] ?? null;
    const target = resolveDocumentTarget({ topFolder, subfolders: parts.slice(1), fileName }, topFolder ? matchForFolder(topFolder) : null, index);
    if (target.kind === 'client') {
      plan.file.push({
        id: r.id,
        clientId: target.clientId,
        reason: target.reason,
        valantDocumentId: r.valantDocumentId ?? parseValantFileName(fileName)?.valantDocumentId ?? null,
        basis: target.basis,
        matchStatus: target.matchStatus,
      });
    } else if (target.kind === 'billing') {
      plan.archive.push({ id: r.id, payer: target.payer, reason: target.reason });
    }
  }
  return plan;
}

/** The filings of planRematch (kept for callers that only file to charts) */
export function planRematchFiling(rows: RematchRow[], matchForFolder: (folder: string) => FolderMatch | null, index?: RosterIndex): RematchFiling[] {
  return planRematch(rows, matchForFolder, index).file;
}

// ─── Masking (reports, inspect script) ────────────────────────────────────────

/** Letters → X / x by case, digits → #; punctuation and spaces kept */
export function maskText(s: string): string {
  return s.replace(/\p{Lu}/gu, 'X').replace(/\p{Ll}|\p{Lo}|\p{Lt}|\p{Lm}/gu, 'x').replace(/\p{Nd}/gu, '#');
}

/**
 * Subfolder names are shown as-is only when they hold no digits and match a document type keyword
 * ("Progress Notes"); anything else could carry a name or ID and is masked.
 */
export function maskSubfolder(name: string, rules: TypeRule[] = DEFAULT_TYPE_RULES): string {
  if (/\d/.test(name)) return maskText(name);
  const n = normalizeForRules(`${name}.dir`);
  return rules.some((r) => r.pattern.test(n)) ? name : maskText(name);
}

/** Extensions shown unmasked (a known file type carries no PHI; "Jane.Doe" must not leak "Doe") */
const KNOWN_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'doc', 'docx', 'rtf', 'txt', 'xls', 'xlsx', 'csv',
  'htm', 'html', 'xml', 'msg', 'eml', 'zip', 'db', 'ini',
]);

/** Masks a file name but keeps a known extension (".pdf") */
export function maskFileName(name: string): string {
  const m = name.match(/^(.+)\.([A-Za-z0-9]{1,5})$/);
  return m && KNOWN_EXTENSIONS.has(m[2].toLowerCase()) ? `${maskText(m[1])}.${m[2].toLowerCase()}` : maskText(name);
}

/** Every folder and the file name masked; the extension kept */
export function maskPath(path: string): string {
  const parts = normalizeEntryPath(path).split('/');
  const file = parts.pop() ?? '';
  return [...parts.map(maskText), maskFileName(file)].join('/');
}

// ─── Access by document type (chart documents list and file download) ──────────

export const LEADERSHIP_DOC_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
/** Payment receipts: billing roles, leadership and the front desk; never clinicians */
export const RECEIPT_DOC_ROLES = new Set([...LEADERSHIP_DOC_ROLES, 'BILLING', 'OFFICE_MANAGER', 'FRONT_DESK']);
/** Patient ID and demographics: front office, billing, leadership, and the client's care team */
export const IDENTITY_DOC_ROLES = new Set([...LEADERSHIP_DOC_ROLES, 'FRONT_DESK', 'OFFICE_MANAGER', 'BILLING']);
/** Practice billing archive (Valant ERA exceptions, claims, ...): billing roles and leadership. Office
 * Manager removed 2026-10-22 (owner: patient-side billing only). */
export const BILLING_ARCHIVE_ROLES = new Set([...LEADERSHIP_DOC_ROLES, 'BILLING']);
export const canViewBillingArchive = (role: string | null | undefined) => BILLING_ARCHIVE_ROLES.has(String(role ?? '').toUpperCase());
/** Roles without the clinical chart that still open the documents list for the types above */
export const ADMIN_DOC_VIEWER_ROLES = new Set(['FRONT_DESK', 'OFFICE_MANAGER', 'BILLING']);

export type DocAccessClass = 'receipt' | 'identity' | 'clinical';

export function documentAccessClass(documentType: string): DocAccessClass {
  if (documentType === 'Payment Receipt') return 'receipt';
  if (documentType === 'Patient ID' || documentType === 'Demographics') return 'identity';
  return 'clinical';
}

/**
 * Whether a viewer may see a filed chart document of this type. `ehrAccess` is the existing chart
 * documents rule (canAccessPath(role, '/dashboard/ehr')); `onCareTeam` the client care-team link.
 * 42 CFR Part 2 / VIP locks are checked separately (assertClientPhiAccess) and always apply.
 */
export function canViewChartDocument(input: { role: string; documentType: string; ehrAccess: boolean; onCareTeam: boolean }): boolean {
  const role = String(input.role).toUpperCase();
  switch (documentAccessClass(input.documentType)) {
    case 'receipt':
      return RECEIPT_DOC_ROLES.has(role);
    case 'identity':
      return IDENTITY_DOC_ROLES.has(role) || (input.ehrAccess && input.onCareTeam);
    default:
      return input.ehrAccess;
  }
}

/** May open the chart documents list at all (clinical chart access, or a front-office / billing role) */
export function canOpenChartDocuments(role: string, ehrAccess: boolean): boolean {
  return ehrAccess || ADMIN_DOC_VIEWER_ROLES.has(String(role).toUpperCase()) || LEADERSHIP_DOC_ROLES.has(String(role).toUpperCase());
}

export const canVoidImportedDocument = (role: string) => LEADERSHIP_DOC_ROLES.has(String(role).toUpperCase());

// ─── Counts / report shapes ───────────────────────────────────────────────────

export type ImportCounts = {
  entries: number;
  files: number;
  totalBytes: number;
  processed: number;
  junk: number;
  looseFiles: number;
  byType: Record<string, number>;
  byExtension: Record<string, number>;
  dated: number;
  /** apply: rows created (filed + needsReview + billingArchived); dry run: rows that would be created */
  documents: number;
  filed: number;
  needsReview: number;
  duplicates: number;
  unreadable: number;
  /** Unreadable files by reason (classifyReadError) */
  unreadableByReason: Record<string, number>;
  unsupported: number;
  tooLarge: number;
  /** Already imported by this batch (a resumed or re-run batch skips them) */
  alreadyImported: number;
  /** Re-run: review-queue documents filed to a chart by the updated matching */
  refiled: number;
  /** Files whose client code (file name) disagrees with the folder match: sent to review */
  codeMismatch: number;
  /** Entries read through 7-Zip (Deflate64) */
  extractedWith7z: number;
  /** Of filed: by a client-code subfolder below an unmatched top folder (rule 2) */
  filedByNestedFolder: number;
  /** Of filed: by the client code at the start of the file name (rule 1) */
  filedByFileCode: number;
  /** Practice billing records stored in the billing archive (no client, not in the review queue) */
  billingArchived: number;
  /** Re-run: review-queue rows placed in place, by rule (refiled = the three filing rules) */
  refiledByFolder: number;
  refiledByNestedFolder: number;
  refiledByFileCode: number;
  rearchivedBilling: number;
  folders: {
    total: number;
    matched: number;
    /** Valant client code (folder name) or a Valant ID / MRN in the folder name */
    matchedById: number;
    /** Of matchedById: the folder name is the Valant client code */
    matchedByCode: number;
    matchedByNameDob: number;
    matchedByNameOnly: number;
    needsReview: number;
    unmatched: number;
    /** Client-code folders found below unmatched top folders (rule 2) */
    nestedMatched: number;
  };
};

export function emptyCounts(): ImportCounts {
  return {
    entries: 0, files: 0, totalBytes: 0, processed: 0, junk: 0, looseFiles: 0, byType: {}, byExtension: {}, dated: 0,
    documents: 0, filed: 0, needsReview: 0, duplicates: 0, unreadable: 0, unreadableByReason: {}, unsupported: 0, tooLarge: 0,
    alreadyImported: 0, refiled: 0, codeMismatch: 0, extractedWith7z: 0,
    filedByNestedFolder: 0, filedByFileCode: 0, billingArchived: 0,
    refiledByFolder: 0, refiledByNestedFolder: 0, refiledByFileCode: 0, rearchivedBilling: 0,
    folders: { total: 0, matched: 0, matchedById: 0, matchedByCode: 0, matchedByNameDob: 0, matchedByNameOnly: 0, needsReview: 0, unmatched: 0, nestedMatched: 0 },
  };
}

export const bump = (m: Record<string, number>, k: string, by = 1) => {
  m[k] = (m[k] ?? 0) + by;
};

export type ImportOptions = {
  /** Wrapper folders above the client folders; null = detect */
  wrapperDepth?: number | null;
  /** Match on a full name that is unique in the practice (no ID, no DOB). Default true */
  allowNameOnly?: boolean;
  /** Mark the batch for text extraction later (search). No OCR runs during the import */
  ocrForSearch?: boolean;
  /** Read Deflate64 (method 9) entries with 7-Zip (p7zip-full). Default true */
  use7z?: boolean;
};

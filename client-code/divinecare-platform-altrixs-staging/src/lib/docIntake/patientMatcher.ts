/**
 * Patient matching for intake documents (uploads, faxes, Valant exports).
 * Ported from the divinecare monorepo; adds Valant's letter-only patient IDs.
 *
 * Two steps:
 *   1. extractPatientIdentifiers() — pull name / DOB / source-system ID out of
 *      the document text and file name.
 *   2. matchPatient() — compare those identifiers against the client roster.
 *
 * Safety rules (a wrong-chart filing is a HIPAA breach and a clinical risk):
 *   - Never auto-match on name alone — a DOB or a source-system ID is required.
 *   - Any conflict (ID matches but DOB disagrees, several candidates, partial
 *     name) goes to needs_review, never to a best guess.
 *   - "matched" still means "suggested" — staff confirm every filing.
 */

export interface RosterClient {
  clientId:  string;
  firstName: string;
  lastName:  string;
  dob:       string;   // YYYY-MM-DD
  mrn?:      string;
  sourceId?: string;   // ID from the source EHR (Valant patient ID)
}

export interface ExtractedIdentifiers {
  firstName?: string;
  lastName?:  string;
  dob?:       string;     // YYYY-MM-DD
  sourceIds:  string[];   // labeled IDs from text first, then ID-like tokens from the file name
}

export type MatchStatus = 'matched' | 'needs_review' | 'unmatched';

export interface MatchCandidate {
  clientId: string;
  name:     string;
  dob:      string;
  reason:   string;
}

export interface MatchResult {
  status:     MatchStatus;
  clientId?:  string;            // set only when status === 'matched'
  clientName?: string;
  reason:     string;
  candidates: MatchCandidate[];  // populated for needs_review
}

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeName(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeId(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').toUpperCase();
}

/** Parses MM/DD/YYYY, M/D/YY, MM-DD-YYYY, YYYY-MM-DD into YYYY-MM-DD. */
export function parseDate(s: string): string | undefined {
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us  = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    // Two-digit years are DOBs here, so anything later than this year is last century
    if (us[3].length === 2) y += 2000 + y > new Date().getFullYear() ? 1900 : 2000;
  } else {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Common nickname ↔ legal name pairs; checked in both directions
const NICKNAMES: Record<string, string[]> = {
  william: ['will', 'bill', 'billy', 'liam'], robert: ['rob', 'bob', 'bobby'],
  richard: ['rick', 'rich', 'dick'], james: ['jim', 'jimmy', 'jamie'],
  michael: ['mike', 'mikey'], elizabeth: ['liz', 'beth', 'betty', 'eliza', 'lizzie'],
  katherine: ['kate', 'kathy', 'katie', 'kat'], catherine: ['cathy', 'cate', 'katie'],
  margaret: ['maggie', 'meg', 'peggy'], jennifer: ['jen', 'jenny'],
  christopher: ['chris'], christina: ['chris', 'tina'], anthony: ['tony'],
  joseph: ['joe', 'joey'], thomas: ['tom', 'tommy'], charles: ['charlie', 'chuck'],
  daniel: ['dan', 'danny'], matthew: ['matt'], patricia: ['pat', 'patty', 'trish'],
  alexander: ['alex'], alexandra: ['alex', 'lexi'], samuel: ['sam'], samantha: ['sam'],
  benjamin: ['ben'], jonathan: ['jon'], nicholas: ['nick'], deborah: ['deb', 'debbie'],
  rebecca: ['becky'], victoria: ['vicky', 'tori'], edward: ['ed', 'eddie', 'ted'],
  andrew: ['andy', 'drew'], steven: ['steve'], stephen: ['steve'], gregory: ['greg'],
  timothy: ['tim'], kenneth: ['ken', 'kenny'], ronald: ['ron'], donald: ['don'],
  terrence: ['terry'], tyrone: ['ty'], lawrence: ['larry'], abigail: ['abby'],
};

function firstNamesCompatible(a: string, b: string): boolean {
  const x = normalizeName(a).split(' ')[0];
  const y = normalizeName(b).split(' ')[0];
  if (!x || !y) return false;
  if (x === y) return true;
  // Initial only ("J." vs "James")
  if ((x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))) return true;
  return (NICKNAMES[x]?.includes(y) ?? false) || (NICKNAMES[y]?.includes(x) ?? false);
}

type LastNameMatch = 'exact' | 'partial' | 'none';

function compareLastNames(a: string, b: string): LastNameMatch {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 'none';
  if (x === y || x.replace(/[\s-]/g, '') === y.replace(/[\s-]/g, '')) return 'exact';
  // Hyphenated / compound surnames: "smith-jones" vs "jones"
  const xs = x.split(/[\s-]/), ys = y.split(/[\s-]/);
  if (xs.some(p => p.length > 1 && ys.includes(p))) return 'partial';
  if (editDistance(x, y) === 1 && Math.min(x.length, y.length) >= 4) return 'partial';  // likely typo
  return 'none';
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ─── Identifier extraction ────────────────────────────────────────────────────

const NAME_LABEL = /(?:patient|client)(?:\s+name)?\s*[:#]\s*([A-Za-z][A-Za-z.'\- ]*?(?:,\s*[A-Za-z][A-Za-z.'\- ]*?)?)\s*(?=\s{2,}|\n|\t|DOB|D\.O\.B|Date of Birth|\bMRN\b|\bID\b|\bAge\b|\bSex\b|\bGender\b|\(|$)/i;
const DOB_LABEL  = /(?:DOB|D\.O\.B\.?|Date of Birth|Birth ?Date)\s*[:#]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i;
const ID_LABEL   = /(?:Valant\s*(?:Patient\s*)?ID|Patient\s*ID|Client\s*ID|MRN|Chart\s*(?:#|No\.?|Number)|Account\s*(?:#|No\.?|Number))\s*[:#]?\s*([A-Z0-9-]{3,20})/gi;

function splitPersonName(raw: string): { firstName?: string; lastName?: string } {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return {};
  if (s.includes(',')) {
    // "Last, First Middle"
    const [last, rest] = s.split(',', 2).map(p => p.trim());
    return { lastName: last, firstName: rest?.split(' ')[0] };
  }
  // "First Middle Last" — drop middle initials and suffixes
  const parts = s.split(' ').filter(p => !/^(jr|sr|ii|iii|iv)\.?$/i.test(p));
  if (parts.length < 2) return {};
  const rest = parts.slice(1).filter(p => !/^[A-Z]\.?$/i.test(p));
  return { firstName: parts[0], lastName: rest.length ? rest[rest.length - 1] : undefined };
}

export function extractPatientIdentifiers(text: string, fileName = ''): ExtractedIdentifiers {
  // Patient identifiers sit in the header — only look at the start of the document
  const head = text.slice(0, 3000);
  const out: ExtractedIdentifiers = { sourceIds: [] };

  const name = head.match(NAME_LABEL);
  if (name) Object.assign(out, splitPersonName(name[1]));

  const dob = head.match(DOB_LABEL);
  if (dob) out.dob = parseDate(dob[1]);

  for (const m of head.matchAll(ID_LABEL)) {
    // Labeled IDs: numeric MRNs, or Valant's letter IDs (WALYAS, SEMALE93)
    const id = m[1];
    if ((/\d/.test(id) || /^[A-Z]{5,8}$/.test(id)) && !out.sourceIds.includes(id)) out.sourceIds.push(id);
  }

  // Valant reports print patients as "First Last (VALANTID)"
  const valant = head.match(/([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,3}) \(([A-Z]{4,8}\d{0,3})\)/);
  if (valant) {
    if (!out.lastName) Object.assign(out, splitPersonName(valant[1]));
    if (!out.sourceIds.includes(valant[2])) out.sourceIds.push(valant[2]);
  }

  // File name: ID-like numeric tokens that are not dates ("12345_ProgressNote_2025-03-01.pdf")
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const withoutDates = base.replace(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{2,4}|\d{8}(?!\d)/g, ' ');
  // Only when the document itself also prints that number: scanner/export names carry timestamps and
  // counters ("Documents_20261016_125011_11407") that would otherwise match an unrelated patient
  for (const tok of withoutDates.split(/[^A-Za-z0-9]+/)) {
    if (/^\d{4,12}$/.test(tok) && new RegExp(`\\b${tok}\\b`).test(head) && !out.sourceIds.includes(tok)) {
      out.sourceIds.push(tok);
    }
  }

  return out;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

const fullName = (c: RosterClient) => `${c.firstName} ${c.lastName}`;
const toCandidate = (c: RosterClient, reason: string): MatchCandidate =>
  ({ clientId: c.clientId, name: fullName(c), dob: c.dob, reason });

export function matchPatient(ids: ExtractedIdentifiers, roster: RosterClient[]): MatchResult {
  // 1. Source-system ID — strongest signal, but a DOB conflict overrides it
  const wanted = new Set(ids.sourceIds.map(normalizeId).filter(Boolean));
  const byId = roster.filter(c =>
    [c.sourceId, c.mrn].some(v => v && wanted.has(normalizeId(v))));

  if (byId.length === 1) {
    const c = byId[0];
    if (ids.dob && ids.dob !== c.dob) {
      return { status: 'needs_review', reason: `Patient ID matches ${fullName(c)} but DOB on document (${ids.dob}) differs from chart (${c.dob})`, candidates: [toCandidate(c, 'ID match, DOB conflict')] };
    }
    if (ids.lastName && compareLastNames(ids.lastName, c.lastName) === 'none') {
      return { status: 'needs_review', reason: `Patient ID matches ${fullName(c)} but name on document is ${ids.firstName ?? ''} ${ids.lastName}`.trim(), candidates: [toCandidate(c, 'ID match, name conflict')] };
    }
    return { status: 'matched', clientId: c.clientId, clientName: fullName(c), reason: 'Source patient ID match', candidates: [] };
  }
  if (byId.length > 1) {
    return { status: 'needs_review', reason: 'Patient ID matches more than one client', candidates: byId.map(c => toCandidate(c, 'ID match')) };
  }

  // 2. DOB + name
  if (!ids.dob) {
    if (!ids.lastName) return { status: 'unmatched', reason: 'No patient ID, name, or DOB found on document', candidates: [] };
    const byName = roster.filter(c => compareLastNames(ids.lastName!, c.lastName) === 'exact'
      && (!ids.firstName || firstNamesCompatible(ids.firstName, c.firstName)));
    return byName.length
      ? { status: 'needs_review', reason: 'Name found but no DOB — cannot confirm identity', candidates: byName.slice(0, 5).map(c => toCandidate(c, 'Name only')) }
      : { status: 'unmatched', reason: 'No DOB on document and no client with that name', candidates: [] };
  }

  const sameDob = roster.filter(c => c.dob === ids.dob);
  if (!ids.lastName) {
    return sameDob.length
      ? { status: 'needs_review', reason: 'DOB found but no patient name', candidates: sameDob.slice(0, 5).map(c => toCandidate(c, 'DOB only')) }
      : { status: 'unmatched', reason: `No client with DOB ${ids.dob}`, candidates: [] };
  }

  const strong: RosterClient[] = [];
  const weak: MatchCandidate[] = [];
  for (const c of sameDob) {
    const last  = compareLastNames(ids.lastName, c.lastName);
    const first = ids.firstName ? firstNamesCompatible(ids.firstName, c.firstName) : false;
    if (last === 'exact' && first) strong.push(c);
    else if (last === 'exact') weak.push(toCandidate(c, 'DOB + last name, first name differs'));
    else if (last === 'partial') weak.push(toCandidate(c, first ? 'DOB + first name, last name similar' : 'DOB + last name similar'));
    else if (first) weak.push(toCandidate(c, 'DOB + first name, last name differs'));
  }

  if (strong.length === 1 && weak.length === 0) {
    return { status: 'matched', clientId: strong[0].clientId, clientName: fullName(strong[0]), reason: 'DOB + full name match', candidates: [] };
  }
  if (strong.length + weak.length > 0) {
    return {
      status: 'needs_review',
      reason: strong.length > 1 ? 'More than one client with this name and DOB' : 'Close but not exact name match',
      candidates: [...strong.map(c => toCandidate(c, 'DOB + full name')), ...weak],
    };
  }
  return { status: 'unmatched', reason: `No client named ${ids.lastName} with DOB ${ids.dob}`, candidates: [] };
}

/**
 * Client diagnosis list: the rules every screen shares. Pure and client-safe (no fs / Prisma), so
 * the chart panel, the API and tests use the same code. Server-only rules that need the ICD-10-CM
 * code set live in ./rules; database reads and writes in ./store.
 *
 * Standard followed (ICD-10-CM Official Guidelines FY2027, CMS-1500 / 837P, DSM-5-TR, FHIR
 * Condition status, and how Valant / TherapyNotes / athena keep a problem list):
 *  - One list per client. Exactly one primary (rank 1) among the current diagnoses.
 *  - Current = ACTIVE or PROVISIONAL (DSM-5-TR "provisional"). RULED_OUT, RESOLVED and
 *    ENTERED_IN_ERROR stay on the record as history; nothing is ever deleted.
 *  - Client.primaryDiagnosis / primaryDiagnosisCode / secondaryDiagnoses are a derived copy of the
 *    current list (deriveLegacyFields) so older readers keep working.
 */

export const DIAGNOSIS_STATUSES = ['ACTIVE', 'PROVISIONAL', 'RULED_OUT', 'RESOLVED', 'ENTERED_IN_ERROR'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

export const DIAGNOSIS_STATUS_LABEL: Record<DiagnosisStatus, string> = {
  ACTIVE: 'Active',
  PROVISIONAL: 'Provisional',
  RULED_OUT: 'Ruled out',
  RESOLVED: 'Resolved',
  ENTERED_IN_ERROR: 'Entered in error',
};

/** Statuses that are on the current list (ranked, linkable to notes / plans / claims) */
export const CURRENT_STATUSES: ReadonlySet<string> = new Set<DiagnosisStatus>(['ACTIVE', 'PROVISIONAL']);

/** Statuses that need a reason when set */
export const REASON_REQUIRED: ReadonlySet<string> = new Set<DiagnosisStatus>(['RULED_OUT', 'RESOLVED', 'ENTERED_IN_ERROR']);

export const DIAGNOSIS_SOURCES = ['CLINICIAN', 'INTAKE', 'VALANT_IMPORT', 'DRFIRST', 'LEGACY_CHART', 'AI_ACCEPTED'] as const;
export type DiagnosisSource = (typeof DIAGNOSIS_SOURCES)[number];

export const DIAGNOSIS_SOURCE_LABEL: Record<string, string> = {
  CLINICIAN: 'Clinician',
  INTAKE: 'Intake',
  VALANT_IMPORT: 'Valant import',
  DRFIRST: 'DrFirst',
  LEGACY_CHART: 'Client record',
  AI_ACCEPTED: 'AI suggestion (accepted)',
};

/** Where a change or review was made (ClientDiagnosisEvent.context) */
export const REVIEW_CONTEXTS = ['manual', 'intake', 'treatment_plan_review', 'note', 'ai_suggestion', 'drfirst', 'client_profile', 'valant_import', 'backfill'] as const;
export type ReviewContext = (typeof REVIEW_CONTEXTS)[number];

export const DEFAULT_REVIEW_DAYS = 90;

export type DiagnosisRow = {
  id: string;
  code: string | null;
  description: string;
  dsmName: string | null;
  rank: number;
  isPrimary: boolean;
  status: DiagnosisStatus;
  /** YYYY-MM-DD */
  onsetDate: string | null;
  resolvedDate: string | null;
  statusReason: string | null;
  diagnosingProviderName: string | null;
  source: string;
  updatedAt?: string | null;
  /** true when read from the client record before the list was created (not saved as rows yet) */
  legacy?: boolean;
};

export const isCurrent = (r: { status: string }) => CURRENT_STATUSES.has(r.status);

export function isDiagnosisStatus(s: unknown): s is DiagnosisStatus {
  return typeof s === 'string' && (DIAGNOSIS_STATUSES as readonly string[]).includes(s);
}

const codeKey = (c: string | null | undefined) => String(c || '').toUpperCase().replace(/[\s.]/g, '');

/** "f331" / "F33.1" → "F33.1" (no validation) */
export function displayCode(raw: string): string {
  const k = codeKey(raw);
  return k.length > 3 ? `${k.slice(0, 3)}.${k.slice(3)}` : k;
}

const ICD_SHAPE = /^[A-TV-Z][0-9][0-9A-Z](?:[0-9A-Z]{1,4})?$/;
export const looksLikeIcd10Code = (raw: string | null | undefined) => ICD_SHAPE.test(codeKey(raw));

// ─── Ranking (exactly one primary) ──────────────────────────────────────────

/**
 * Current rows ranked 1..n in their present order (rank, then primary first), rank 1 is the
 * primary; non-current rows rank 0 and are never primary. Returns new objects.
 */
export function normalizeRanks<T extends Pick<DiagnosisRow, 'rank' | 'isPrimary' | 'status'>>(rows: T[]): T[] {
  const current = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isCurrent(r))
    .sort((a, b) => (a.r.rank || 999) - (b.r.rank || 999) || Number(b.r.isPrimary) - Number(a.r.isPrimary) || a.i - b.i);
  const rankOf = new Map<number, number>(current.map(({ i }, n) => [i, n + 1]));
  return rows.map((r, i) => {
    const rank = rankOf.get(i) ?? 0;
    return { ...r, rank, isPrimary: rank === 1 };
  });
}

/** Current rows in rank order */
export function currentInOrder<T extends Pick<DiagnosisRow, 'rank' | 'isPrimary' | 'status'>>(rows: T[]): T[] {
  return normalizeRanks(rows).filter(isCurrent).sort((a, b) => a.rank - b.rank);
}

/** Move a current diagnosis up / down one place, or make it primary. Unknown id: unchanged. */
export function moveDiagnosis<T extends Pick<DiagnosisRow, 'id' | 'rank' | 'isPrimary' | 'status'>>(rows: T[], id: string, move: 'up' | 'down' | 'primary'): T[] {
  const ordered = currentInOrder(rows);
  const idx = ordered.findIndex((r) => r.id === id);
  if (idx < 0) return normalizeRanks(rows);
  const ids = ordered.map((r) => r.id);
  const [item] = ids.splice(idx, 1);
  const to = move === 'primary' ? 0 : move === 'up' ? Math.max(0, idx - 1) : Math.min(ids.length, idx + 1);
  ids.splice(to, 0, item);
  return applyOrder(rows, ids);
}

/**
 * Apply a full order of the current diagnoses (drag and drop). Ids not listed keep their relative
 * order after the listed ones; ids of non-current rows are ignored.
 */
export function applyOrder<T extends Pick<DiagnosisRow, 'id' | 'rank' | 'isPrimary' | 'status'>>(rows: T[], orderedIds: string[]): T[] {
  const ordered = currentInOrder(rows);
  const listed = orderedIds.filter((id, i) => orderedIds.indexOf(id) === i && ordered.some((r) => r.id === id));
  const rest = ordered.filter((r) => !listed.includes(r.id)).map((r) => r.id);
  const pos = new Map([...listed, ...rest].map((id, i) => [id, i + 1]));
  return normalizeRanks(rows.map((r) => (pos.has(r.id) ? { ...r, rank: pos.get(r.id)!, isPrimary: false } : r)));
}

/** Allowed status changes. Entered in error is final (add the correct diagnosis instead). */
export function canChangeStatus(from: string, to: string): boolean {
  if (!isDiagnosisStatus(to) || from === to) return false;
  if (from === 'ENTERED_IN_ERROR') return false;
  return true;
}

// ─── Derived legacy fields on Client ────────────────────────────────────────

export type LegacyDiagnosisFields = {
  primaryDiagnosisCode: string | null;
  primaryDiagnosis: string | null;
  /** Codes of the other current diagnoses, rank order, comma separated (Valant import format) */
  secondaryDiagnoses: string | null;
};

export function deriveLegacyFields(rows: Pick<DiagnosisRow, 'code' | 'description' | 'dsmName' | 'rank' | 'isPrimary' | 'status'>[]): LegacyDiagnosisFields {
  const current = currentInOrder(rows);
  const primary = current[0];
  const secondary: string[] = [];
  for (const r of current.slice(1)) {
    // Uncoded entries keep their text; ICD descriptions contain commas, so they are cleaned
    const v = r.code ? r.code : r.description.replace(/[,;\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (v && !secondary.includes(v)) secondary.push(v);
  }
  return {
    primaryDiagnosisCode: primary?.code ?? null,
    primaryDiagnosis: primary ? (primary.dsmName || primary.description || null)?.slice(0, 250) ?? null : null,
    secondaryDiagnoses: secondary.length ? secondary.join(', ').slice(0, 500) : null,
  };
}

// ─── Legacy client-record text → rows (fallback read + backfill) ────────────

export type ParsedLegacyDiagnosis = { code: string | null; description: string; rank: number };

const CODE_IN_TEXT = /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/i;

/**
 * One secondary entry: "F41.1", "F41.1 - Generalized anxiety disorder", "Generalized anxiety
 * disorder (F41.1)", or plain words (uncoded). Codes are only taken when the entry contains one;
 * nothing is guessed from words.
 */
export function parseLegacyEntry(text: string): { code: string | null; description: string } {
  const t = text.trim();
  const leading = t.match(/^([A-TV-Z][0-9][0-9A-Z](?:\.?[0-9A-Z]{1,4})?)\s*(?:[-–:]\s*(.*))?$/i);
  if (leading && looksLikeIcd10Code(leading[1])) return { code: displayCode(leading[1]), description: (leading[2] || '').trim() };
  const inParens = t.match(/^(.*?)\s*[([]\s*([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*[)\]]\s*$/i);
  if (inParens && looksLikeIcd10Code(inParens[2])) return { code: displayCode(inParens[2]), description: inParens[1].trim() };
  const anywhere = t.match(CODE_IN_TEXT);
  if (anywhere && looksLikeIcd10Code(anywhere[1]) && t.replace(anywhere[1], '').trim().length === 0) {
    return { code: displayCode(anywhere[1]), description: '' };
  }
  return { code: null, description: t };
}

/**
 * Client.primaryDiagnosis* + secondaryDiagnoses → ranked entries (primary first). Secondary text is
 * split on commas / semicolons / new lines, except a comma inside parentheses. Repeats dropped.
 */
export function parseLegacyDiagnoses(c: { primaryDiagnosisCode?: string | null; primaryDiagnosis?: string | null; secondaryDiagnoses?: string | null }): ParsedLegacyDiagnosis[] {
  const out: ParsedLegacyDiagnosis[] = [];
  const seen = new Set<string>();
  const push = (code: string | null, description: string) => {
    const key = code ? `C:${codeKey(code)}` : `T:${description.toLowerCase()}`;
    if ((!code && !description) || seen.has(key)) return;
    seen.add(key);
    out.push({ code, description, rank: out.length + 1 });
  };
  const pCodeRaw = c.primaryDiagnosisCode?.trim() || '';
  const pName = c.primaryDiagnosis?.trim() || '';
  if (pCodeRaw || pName) {
    const fromCode = pCodeRaw ? parseLegacyEntry(pCodeRaw) : null;
    const fromName = !fromCode?.code && pName ? parseLegacyEntry(pName) : null;
    const code = fromCode?.code ?? fromName?.code ?? null;
    let description = '';
    if (fromName?.code) description = fromName.description;
    else if (pName) description = pName;
    else if (fromCode?.code) description = fromCode.description;
    if (!code && !description) description = pCodeRaw;
    push(code, description);
  }
  for (const part of splitOutsideParens(c.secondaryDiagnoses || '')) {
    const e = parseLegacyEntry(part);
    push(e.code, e.description);
  }
  return out;
}

function splitOutsideParens(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth++;
    if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ─── Review ("Reviewed — no change") ────────────────────────────────────────

export type ReviewState = {
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  intervalDays: number;
  /** YYYY-MM-DD the next review is due (null = never reviewed) */
  dueOn: string | null;
  /** never reviewed, or past the interval */
  due: boolean;
  overdueDays: number;
};

export function reviewState(input: { lastReviewedAt: Date | string | null; lastReviewedBy?: string | null; intervalDays?: number | null; now?: Date }): ReviewState {
  const intervalDays = input.intervalDays && input.intervalDays > 0 ? Math.round(input.intervalDays) : DEFAULT_REVIEW_DAYS;
  const now = input.now ?? new Date();
  if (!input.lastReviewedAt) return { lastReviewedAt: null, lastReviewedBy: null, intervalDays, dueOn: null, due: true, overdueDays: 0 };
  const last = new Date(input.lastReviewedAt);
  const due = new Date(last.getTime() + intervalDays * 86_400_000);
  const overdueDays = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000));
  return {
    lastReviewedAt: last.toISOString(),
    lastReviewedBy: input.lastReviewedBy ?? null,
    intervalDays,
    dueOn: due.toISOString().slice(0, 10),
    due: now.getTime() >= due.getTime(),
    overdueDays,
  };
}

// ─── Note sign reminders (never block) ──────────────────────────────────────

export type DiagnosisNoteWarning = { id: string; message: string; severity: 'warn' };

/**
 * Soft reminders shown before signing a note: linked codes that are no longer current on the
 * list, a primary pointer that is provisional, and a list review that is due. Signing is never
 * blocked by these (the existing "link at least one diagnosis" rule stays as it is).
 */
export function diagnosisNoteWarnings(input: {
  linkedCodes: string[];
  rows: Pick<DiagnosisRow, 'code' | 'status' | 'legacy'>[];
  review: Pick<ReviewState, 'due' | 'lastReviewedAt' | 'lastReviewedBy'> | null;
  clientId?: string | null;
}): DiagnosisNoteWarning[] {
  const out: DiagnosisNoteWarning[] = [];
  const structured = input.rows.some((r) => !r.legacy);
  if (structured) {
    for (const code of input.linkedCodes) {
      const k = codeKey(code);
      const matches = input.rows.filter((r) => codeKey(r.code) === k);
      if (!matches.length) {
        out.push({ id: `dx.notOnList.${k}`, severity: 'warn', message: `${displayCode(code)} is linked to this note but is not on the client's diagnosis list. Add it to the list or unlink it.` });
      } else if (!matches.some(isCurrent)) {
        const st = matches[0].status as DiagnosisStatus;
        out.push({ id: `dx.notCurrent.${k}`, severity: 'warn', message: `${displayCode(code)} is ${DIAGNOSIS_STATUS_LABEL[st]?.toLowerCase() ?? st} on the diagnosis list. Unlink it or update its status.` });
      }
    }
    const first = input.linkedCodes[0];
    if (first && input.rows.some((r) => codeKey(r.code) === codeKey(first) && r.status === 'PROVISIONAL')) {
      out.push({ id: 'dx.provisionalPrimary', severity: 'warn', message: `${displayCode(first)} (first diagnosis on the claim) is provisional. Confirm it or link a confirmed diagnosis first.` });
    }
  }
  if (input.review?.due) {
    const when = input.review.lastReviewedAt
      ? `last reviewed ${input.review.lastReviewedAt.slice(0, 10)}${input.review.lastReviewedBy ? ` by ${input.review.lastReviewedBy}` : ''}`
      : 'not reviewed yet';
    out.push({ id: 'dx.reviewDue', severity: 'warn', message: `Diagnosis list review is due (${when}). Review it on the chart (Diagnoses): "Reviewed — no change" is enough when nothing changed.` });
  }
  return out;
}

// ─── 42 CFR Part 2 ──────────────────────────────────────────────────────────

/** F10–F16, F18, F19 (42 CFR 2.11: tobacco F17 and caffeine are not substance use disorders) */
export function isPart2SudCode(code: string | null | undefined): boolean {
  return /^F1[0-689](\.|$)/.test(displayCode(String(code || '')));
}

/** Locked (Part 2 / sensitive chart the viewer cannot open): no diagnoses at all. */
export function diagnosesForViewer<T>(rows: T[], viewer: { locked: boolean }): T[] {
  return viewer.locked ? [] : rows;
}

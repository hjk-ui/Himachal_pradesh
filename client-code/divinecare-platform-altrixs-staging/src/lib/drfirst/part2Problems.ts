/**
 * 42 CFR Part 2 (as amended 2024) rule for the DrFirst problem push (pure, no I/O).
 *
 * For a Part 2-protected client (SensitiveRecord classified Part 2 / SUD, or any Part 2 progress
 * note: the same rule as the scribe, measures and consent composer), substance use disorder
 * diagnoses (isPart2SudCode: F10-F16, F18, F19; tobacco F17 is not Part 2) are withheld from
 * send_problem UNLESS the client has a Part 2 consent on file (consent-library key
 * "part2-consent") that is signed, unexpired, unrevoked and not superseded / voided, and that
 * covers the disclosure: the single TPO consent (purposeTag "tpo" / recipientType "tpo"), or a
 * named recipient that is DrFirst / Rcopia / e-prescribing / the prescriber. Non-SUD diagnoses
 * still go, and non-protected clients are unchanged. A withheld code that was sent before leaves
 * the push list, so the existing ledger sends it to Rcopia as removed (Deleted=y).
 */
import { isPart2SudCode } from '@/lib/diagnoses/model';
import { LEGACY_TYPE_TO_KEY, templateKeyOf } from '@/lib/consents/library/catalog';

export const PART2_CONSENT_KEY = 'part2-consent';

export const PART2_WITHHELD_REASON = 'part2_no_consent' as const;

export const PART2_WITHHELD_NOTICE = 'SUD diagnoses not sent to DrFirst: no Part 2 consent on file';

export type Part2ConsentRow = {
  type: string;
  formKey: string | null;
  status: string;
  formStatus: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  recipientName: string | null;
  formData?: unknown;
};

/** Named recipients that cover the DrFirst push (the e-prescribing system or the prescriber) */
const DRFIRST_RECIPIENT_RE = /\b(drfirst|dr\.?\s*first|rcopia|e-?\s*prescrib\w*|electronic\s+prescrib\w*|prescrib(er|ers|ing)?)\b/i;

const SIGNED_FORM_STATUSES = new Set(['CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED']);
const DEAD_FORM_STATUSES = new Set(['SUPERSEDED', 'VOIDED', 'REVOKED']);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** One consent row: a valid Part 2 consent whose scope covers the DrFirst push. */
export function part2ConsentRowCoversDrFirst(r: Part2ConsentRow, now: Date): boolean {
  const key = templateKeyOf(r.formKey) ?? (r.formKey ? null : LEGACY_TYPE_TO_KEY[r.type] ?? null);
  if (key !== PART2_CONSENT_KEY) return false;
  const signed = r.status === 'SIGNED' || SIGNED_FORM_STATUSES.has(String(r.formStatus ?? ''));
  if (!signed || r.revokedAt || DEAD_FORM_STATUSES.has(String(r.formStatus ?? ''))) return false;
  if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) return false;
  const fd = (r.formData && typeof r.formData === 'object' ? r.formData : {}) as {
    purposeTag?: unknown;
    response?: { fields?: Record<string, unknown> } | null;
    revocation?: unknown;
  };
  if (fd.revocation) return false;
  const fields = fd.response?.fields ?? {};
  if (str(fd.purposeTag) === 'tpo' || str(fields.recipientType) === 'tpo') return true;
  const recipient = `${r.recipientName ?? ''} ${str(fields.recipientName)}`;
  return DRFIRST_RECIPIENT_RE.test(recipient);
}

export function part2ConsentCoversDrFirst(rows: Part2ConsentRow[], now: Date = new Date()): boolean {
  return rows.some((r) => part2ConsentRowCoversDrFirst(r, now));
}

export type Part2ProblemDecision<T> = {
  send: T[];
  withheld: T[];
  reason: typeof PART2_WITHHELD_REASON | null;
};

/** Split the push list: SUD diagnoses of a Part 2 client without a covering consent are withheld. */
export function applyPart2ProblemRule<T extends { code: string }>(
  problems: T[],
  input: { part2Client: boolean; consentCovers: boolean },
): Part2ProblemDecision<T> {
  if (!input.part2Client || input.consentCovers) return { send: problems, withheld: [], reason: null };
  const withheld = problems.filter((p) => isPart2SudCode(p.code));
  return { send: problems.filter((p) => !isPart2SudCode(p.code)), withheld, reason: withheld.length ? PART2_WITHHELD_REASON : null };
}

/** Audit metadata for the withholding decision: counts and the reason only, never codes or text. */
export function part2WithholdAuditMetadata(input: { withheld: number; removedFromDrFirst: number; sent: number }): Record<string, unknown> {
  return {
    reason: PART2_WITHHELD_REASON,
    rule: '42 CFR Part 2',
    withheldCount: input.withheld,
    removedFromDrFirstCount: input.removedFromDrFirst,
    nonSudSentCount: input.sent,
  };
}

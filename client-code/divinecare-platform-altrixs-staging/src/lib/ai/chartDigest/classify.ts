/**
 * Which chart sources feed the digest. Pure (no I/O).
 *
 * - Filed documents: clinical narrative types only (progress / intake / evaluation / discharge /
 *   treatment plan / addendum, including Valant imports). Billing, insurance cards, IDs,
 *   demographics, receipts, consents / ROI, measures, labs and letters are skipped unless the
 *   title says the document is a clinical record (evaluation, assessment, discharge, summary...).
 * - Psychotherapy notes (HIPAA 45 CFR 164.501) are ALWAYS excluded: native ones live in a separate
 *   table this pipeline never reads; imported files titled "psychotherapy note(s)" / "process note(s)"
 *   are dropped here.
 * - 42 CFR Part 2: a native note flagged part2, an SUD-program document (title), or any imported
 *   document of a Part 2-classified client is a Part 2 source. Part 2 sources are excluded unless
 *   the client has an active Part 2 consent covering treatment (TPO / treatment purpose); when
 *   included, their facts are marked Part 2 and shown with the redisclosure notice.
 */
import { LEGACY_TYPE_TO_KEY, templateKeyOf } from '@/lib/consents/library/catalog';
import { PART2_CONSENT_KEY, type Part2ConsentRow } from '@/lib/drfirst/part2Problems';

export type DocClassInput = {
  documentType: string;
  /** file name, Valant folder path, title field (any may be null) */
  fileName?: string | null;
  sourcePath?: string | null;
  title?: string | null;
  folder?: string | null;
};

export type DocClass =
  | { include: true; reason: 'clinical_type' | 'clinical_title' }
  | { include: false; reason: 'psychotherapy_note' | 'non_clinical_type' | 'not_clinical_title' };

/** Document types that are clinical narrative records */
const CLINICAL_TYPES = new Set([
  'progress note',
  'intake note',
  'addendum',
  'discharge summary',
  'treatment plan',
  'psychiatric evaluation',
  'evaluation',
  'assessment',
  'clinical record',
]);

/** Never clinical narrative (title cannot override these) */
const NON_CLINICAL_TYPES = new Set([
  'payment receipt',
  'patient id',
  'demographics',
  'insurance card',
  'consent / roi',
  'billing archive',
  'prior auth letter',
]);

const PSYCHOTHERAPY_NOTE_RE = /\bpsycho\s*therapy\s*notes?\b|\bprocess\s*notes?\b|\bpsychotherapy_notes?\b/i;
const CLINICAL_TITLE_RE =
  /\b(progress|session|intake|initial|psychiatric|psych|diagnostic|biopsychosocial|bps|clinical|mental status|medication management|med management)\s*(notes?|eval(uation)?s?|assessments?|summar(y|ies)|records?)\b|\bdischarge\b|\btreatment plans?\b|\bevaluations?\b|\bassessment (notes?|reports?)\b|\bhospital records?\b|\bclinical summary\b|\baddend(um|a)\b/i;

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.+()[\]{}#,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyChartDocument(d: DocClassInput): DocClass {
  const titleText = [d.title, d.fileName, d.sourcePath, d.folder].map(norm).join(' | ');
  if (PSYCHOTHERAPY_NOTE_RE.test(titleText)) return { include: false, reason: 'psychotherapy_note' };
  const type = norm(d.documentType).toLowerCase();
  if (NON_CLINICAL_TYPES.has(String(d.documentType ?? '').trim().toLowerCase()) || NON_CLINICAL_TYPES.has(type)) {
    return { include: false, reason: 'non_clinical_type' };
  }
  if (CLINICAL_TYPES.has(String(d.documentType ?? '').trim().toLowerCase()) || CLINICAL_TYPES.has(type)) {
    return { include: true, reason: 'clinical_type' };
  }
  // Other / Unclassified / Referral / Court Order / Lab Report / Measures / letters: only a clinical title
  if (CLINICAL_TITLE_RE.test(titleText)) return { include: true, reason: 'clinical_title' };
  return { include: false, reason: 'not_clinical_title' };
}

/** Native progress note types that are psychotherapy notes (never included) */
export function isPsychotherapyNoteType(noteType: string | null | undefined): boolean {
  return PSYCHOTHERAPY_NOTE_RE.test(norm(noteType));
}

const SUD_PROGRAM_RE =
  /\b(sud|substance use (disorder )?(program|treatment|services|intake|assessment|evaluation)|asam|otp|opioid treatment program|methadone|buprenorphine (program|induction)|suboxone (program|clinic)|detox(ification)?|addiction (program|services|treatment)|iop sud|smart recovery program)\b/i;

/** A document whose title / folder marks it as a substance use disorder program record */
export function isSudProgramDocument(d: DocClassInput): boolean {
  return SUD_PROGRAM_RE.test([d.title, d.fileName, d.sourcePath, d.folder].map(norm).join(' | '));
}

/** Part 2 source? Imported documents of a Part 2 client cannot be told apart by program, so all are */
export function isPart2Source(input: { kind: 'doc' | 'note'; notePart2?: boolean; part2Client: boolean; doc?: DocClassInput }): boolean {
  if (input.kind === 'note') return Boolean(input.notePart2);
  return input.part2Client || (input.doc ? isSudProgramDocument(input.doc) : false);
}

const SIGNED_FORM_STATUSES = new Set(['CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED']);
const DEAD_FORM_STATUSES = new Set(['SUPERSEDED', 'VOIDED', 'REVOKED']);
const TREATMENT_RECIPIENT_RE = /\b(treat(ment|ing)?|tpo|care team|treating (provider|clinician)s?|this practice|divine counseling|altrixs)\b/i;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * One consent row: a signed, unexpired, unrevoked, not superseded Part 2 consent (library key
 * "part2-consent") whose scope covers treatment by this practice: the single TPO consent
 * (purposeTag / recipientType "tpo"), a "treatment" purpose, or a treating-provider recipient.
 */
export function part2ConsentRowCoversTreatment(r: Part2ConsentRow, now: Date): boolean {
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
  const purpose = `${str(fd.purposeTag)} ${str(fields.recipientType)} ${str(fields.purpose)}`.toLowerCase();
  if (/\btpo\b|\btreatment\b/.test(purpose)) return true;
  return TREATMENT_RECIPIENT_RE.test(`${r.recipientName ?? ''} ${str(fields.recipientName)}`);
}

export function part2ConsentCoversTreatment(rows: Part2ConsentRow[], now: Date = new Date()): boolean {
  return rows.some((r) => part2ConsentRowCoversTreatment(r, now));
}

export type SourceDecision = { include: boolean; part2: boolean; reason: string };

/** Final include / exclude for one source after the Part 2 rule */
export function decideSource(input: { part2: boolean; part2ConsentCovers: boolean }): SourceDecision {
  if (!input.part2) return { include: true, part2: false, reason: 'ok' };
  if (input.part2ConsentCovers) return { include: true, part2: true, reason: 'part2_consented' };
  return { include: false, part2: true, reason: 'part2_no_consent' };
}

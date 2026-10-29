/**
 * E-signature evidence (pure, browser-safe). Recorded on ConsentPacket.evidence when a packet is
 * signed (migration 20261021_consents_signing_evidence.sql) and printed in the PDF audit trail.
 *
 * Signature methods (industry standard, ESIGN / UETA intent + attribution):
 *  - portal_esign:      the client (or a verified proxy) signed in the patient portal; login + IP + user agent
 *  - intake_esign:      signed in the public new-client intake; IP + user agent
 *  - in_office_tablet:  the client signed on a practice device handed to them; staff member present
 *  - paper_scanned:     the client signed the paper form; staff enter the answers and the scan reference
 *  - verbal_witnessed:  consent given verbally (e.g. at the start of a telehealth visit) and witnessed
 *                       by staff. NOT allowed for an ROI / Part 2 consent / card authorization, which
 *                       the rules require in writing (45 CFR §164.508(c)(1)(vi), 42 CFR §2.31(a)).
 *
 * The signed text is frozen per section with the SHA-256 of its canonical JSON (freeze.ts); the
 * evidence lists each hash so the PDF and audits can show exactly which text was signed.
 */
import type { ConsentTemplateVersion } from './types';

export const SIGNATURE_METHODS = ['portal_esign', 'intake_esign', 'in_office_tablet', 'paper_scanned', 'verbal_witnessed'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** Methods staff can choose when recording a signing in the office. */
export const STAFF_SIGNATURE_METHODS = ['in_office_tablet', 'paper_scanned', 'verbal_witnessed'] as const;
export type StaffSignatureMethod = (typeof STAFF_SIGNATURE_METHODS)[number];

export const SIGNATURE_METHOD_LABEL: Record<SignatureMethod, string> = {
  portal_esign: 'Electronic signature in the patient portal',
  intake_esign: 'Electronic signature in the online intake',
  in_office_tablet: 'Signed in the office on a practice device',
  paper_scanned: 'Signed on paper (scanned copy on file)',
  verbal_witnessed: 'Verbal consent, witnessed by staff',
};

export type InterpreterEvidence = { used: boolean; language: string | null; name: string | null };

/** What staff enter for an in-office signing (beyond the client's own answers). */
export type StaffEvidenceInput = {
  signatureMethod: StaffSignatureMethod;
  interpreter?: InterpreterEvidence | null;
  /** verbal_witnessed: the staff witness's name */
  witnessName?: string | null;
  /** paper_scanned: where the scanned paper is (chart document name / id) */
  paperDocumentRef?: string | null;
};

export type SigningEvidence = {
  signatureMethod: SignatureMethod;
  signedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** portal login that signed (portal_esign) */
  portalAccountId: string | null;
  /** signed by a proxy (parent / guardian / representative) through the portal */
  proxy: { relationship: string; portalAccessId: string | null } | null;
  /** staff member present / recording (in office) */
  staff: { userId: string | null; name: string | null } | null;
  witnessName: string | null;
  interpreter: InterpreterEvidence | null;
  paperDocumentRef: string | null;
  /** SHA-256 of each section's rendered text as signed */
  hashes: { key: string; version: number; sha256: string }[];
};

const t = (s: string | null | undefined) => (s ?? '').trim();

/** Validate the staff-entered evidence; authorizations cannot be verbal. */
export function validateStaffEvidence(input: StaffEvidenceInput, templates: Pick<ConsentTemplateVersion, 'title' | 'effects' | 'signing'>[]): string[] {
  const errors: string[] = [];
  if (!(STAFF_SIGNATURE_METHODS as readonly string[]).includes(input.signatureMethod)) errors.push('Choose how the client signed.');
  if (input.interpreter?.used && t(input.interpreter.language).length < 2) errors.push('Enter the language the interpreter used.');
  if (input.signatureMethod === 'paper_scanned' && t(input.paperDocumentRef).length < 3) errors.push('Enter where the scanned paper form is filed (document name or number).');
  if (input.signatureMethod === 'verbal_witnessed') {
    if (t(input.witnessName).length < 2) errors.push('Enter the name of the staff witness to the verbal consent.');
    const written = templates.filter((x) => x.signing === 'standalone' || x.effects?.some((e) => e === 'roi' || e === 'part2' || e === 'card_on_file'));
    if (written.length) errors.push(`${written.map((x) => x.title).join(', ')} must be signed in writing; verbal consent is not allowed for an authorization.`);
  }
  return errors;
}

export function buildEvidence(input: {
  signatureMethod: SignatureMethod;
  signedAt: Date;
  request?: { ipAddress: string | null; userAgent: string | null } | null;
  portalAccountId?: string | null;
  proxy?: SigningEvidence['proxy'];
  staff?: SigningEvidence['staff'];
  staffInput?: StaffEvidenceInput | null;
  hashes: SigningEvidence['hashes'];
}): SigningEvidence {
  const s = input.staffInput;
  const interp = s?.interpreter?.used ? { used: true, language: t(s.interpreter.language).slice(0, 60) || null, name: t(s.interpreter.name).slice(0, 120) || null } : null;
  return {
    signatureMethod: input.signatureMethod,
    signedAt: input.signedAt.toISOString(),
    ipAddress: input.request?.ipAddress?.slice(0, 64) ?? null,
    userAgent: input.request?.userAgent?.slice(0, 300) ?? null,
    portalAccountId: input.portalAccountId ?? null,
    proxy: input.proxy ?? null,
    staff: input.staff ?? null,
    witnessName: s?.signatureMethod === 'verbal_witnessed' ? t(s.witnessName).slice(0, 120) || null : null,
    interpreter: interp,
    paperDocumentRef: s?.signatureMethod === 'paper_scanned' ? t(s.paperDocumentRef).slice(0, 200) || null : null,
    hashes: input.hashes,
  };
}

/** Audit-trail lines for the signed PDF (plain text, oldest first). */
export function evidenceLines(e: SigningEvidence | null, delivery: { sentAt: string; lastSentAt: string | null; sendCount: number; channels: string[]; viewedAt: string | null } | null, fmt: (iso: string) => string): string[] {
  const lines: string[] = [];
  if (delivery) {
    lines.push(`Sent ${fmt(delivery.sentAt)}${delivery.channels.length ? ` (notified by ${delivery.channels.join(', ')})` : ''}.`);
    if (delivery.sendCount > 1 && delivery.lastSentAt) lines.push(`Reminded ${delivery.sendCount - 1} time${delivery.sendCount === 2 ? '' : 's'}; last ${fmt(delivery.lastSentAt)}.`);
    if (delivery.viewedAt) lines.push(`First opened by the client ${fmt(delivery.viewedAt)}.`);
  }
  if (!e) return lines;
  lines.push(`${SIGNATURE_METHOD_LABEL[e.signatureMethod]}: ${fmt(e.signedAt)}.`);
  if (e.ipAddress || e.userAgent) lines.push(`Device: IP ${e.ipAddress ?? 'not recorded'}; ${e.userAgent ? e.userAgent.slice(0, 120) : 'browser not recorded'}.`);
  if (e.portalAccountId) lines.push(`Portal login ${e.portalAccountId}${e.proxy ? ` (signed as ${e.proxy.relationship.replace(/_/g, ' ')})` : ''}.`);
  if (e.staff?.name) lines.push(`Staff member present / recording: ${e.staff.name}.`);
  if (e.witnessName) lines.push(`Witness to verbal consent: ${e.witnessName}.`);
  if (e.interpreter?.used) lines.push(`Interpreter used: ${e.interpreter.language ?? 'language not recorded'}${e.interpreter.name ? `, ${e.interpreter.name}` : ''}.`);
  if (e.paperDocumentRef) lines.push(`Paper original filed as: ${e.paperDocumentRef}.`);
  for (const h of e.hashes) lines.push(`Text signed: ${h.key} v${h.version} SHA-256 ${h.sha256}`);
  return lines;
}

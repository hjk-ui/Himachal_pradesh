/**
 * Packet signing rules (pure). The client completes one flow: an acknowledgment per section, then
 * ONE final typed signature for all packet sections. Standalone authorizations (ROI, Part 2
 * consent, card authorization) cannot be combined with the consent to treatment (HIPAA
 * §164.508(b)(3)), so each has its own typed signature in the same flow, or is declined.
 * A representative (parent / guardian / authorized representative) gives relationship + authority.
 */
import type { RenderedTemplate } from './types';
import type { MinorRule, PacketItem } from './composer';
import { templateVersion } from './catalog';
import { missingElements } from './elements';

export type SignerType = 'self' | 'representative';
export type SigningMethod = 'intake' | 'portal' | 'in_office';

export const REPRESENTATIVE_RELATIONSHIPS = ['Parent', 'Legal guardian', 'Health care agent', 'Court-appointed representative', 'Other legal representative'] as const;

export type SectionResponse = {
  version: number;
  acknowledged: boolean;
  checkboxes?: Record<string, boolean>;
  choices?: Record<string, string>;
  fields?: Record<string, string | string[]>;
  /** Standalone only: decline instead of signing */
  declined?: boolean;
  /** Standalone only: its own typed signature (must match the printed name) */
  signature?: string;
};

export type SignerInput = {
  signerType: SignerType;
  printedName: string;
  relationship?: string | null;
  authority?: string | null;
  /** Typed signature: the printed name typed again */
  signature: string;
  agree: boolean;
};

export type PacketSubmission = { sections: Record<string, SectionResponse>; signer: SignerInput };

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function validateSigner(s: SignerInput, minor: MinorRule | null): string[] {
  const errors: string[] = [];
  if (!s.printedName?.trim() || s.printedName.trim().length < 2) errors.push('Enter the printed name of the person signing.');
  if (!s.signature?.trim()) errors.push('Type your full name as your signature.');
  else if (norm(s.signature) !== norm(s.printedName)) errors.push('The typed signature must match the printed name.');
  if (!s.agree) errors.push('Confirm that you agree to sign electronically.');
  if (s.signerType === 'representative') {
    if (!s.relationship?.trim()) errors.push('Enter your relationship to the client.');
    if (!s.authority?.trim() || s.authority.trim().length < 3) errors.push('Describe your legal authority to sign for the client (e.g. parent with custody, guardianship order).');
  }
  if (minor && !minor.mayConsentAlone && s.signerType === 'self') {
    errors.push(`The client is under 18. ${minor.explanation}`);
  }
  return errors;
}

function fieldFilled(v: string | string[] | undefined) {
  return Array.isArray(v) ? v.length > 0 : Boolean(v && v.trim());
}

/** Field rules beyond "required" (expiration date or event, named recipient). */
export function fieldErrors(r: RenderedTemplate, fields: Record<string, string | string[]>): string[] {
  const errors: string[] = [];
  for (const f of r.fields) {
    if (f.required && !fieldFilled(fields[f.key])) errors.push(`${r.title}: ${f.label} is required.`);
  }
  const keys = new Set(r.fields.map((f) => f.key));
  if (keys.has('expirationDate') && keys.has('expirationEvent') && !fieldFilled(fields.expirationDate) && !fieldFilled(fields.expirationEvent)) {
    errors.push(`${r.title}: enter an expiration date or an expiration event.`);
  }
  if (keys.has('recipientType') && fields.recipientType === 'named' && !fieldFilled(fields.recipientName)) {
    errors.push(`${r.title}: enter the recipient's name.`);
  }
  if (typeof fields.expirationDate === 'string' && fields.expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.expirationDate)) {
    errors.push(`${r.title}: the expiration date must be a valid date.`);
  }
  return errors;
}

export function validateSection(item: PacketItem, r: RenderedTemplate, resp: SectionResponse | undefined, printedName: string, signer?: SignerInput): string[] {
  if (!resp) return item.optional ? [`${r.title}: sign or decline this authorization.`] : [`${r.title}: acknowledge this section.`];
  if (resp.version !== item.version) return [`${r.title} changed while you were completing the packet. Reload and review it again.`];
  if (item.optional && resp.declined) return [];
  const errors: string[] = [];
  if (!resp.acknowledged) errors.push(`${r.title}: check the acknowledgment.`);
  for (const c of r.checkboxes) if (c.required && !resp.checkboxes?.[c.key]) errors.push(`${r.title}: check "${c.label}".`);
  for (const ch of r.choices) {
    const v = resp.choices?.[ch.key];
    if (ch.required && !v) errors.push(`${r.title}: choose ${ch.label}.`);
    if (v && !ch.options.some((o) => o.value === v)) errors.push(`${r.title}: invalid choice for ${ch.label}.`);
  }
  errors.push(...fieldErrors(r, resp.fields ?? {}));
  if (item.signing === 'standalone') {
    if (!resp.signature?.trim()) errors.push(`${r.title}: type your full name to sign this authorization separately.`);
    else if (norm(resp.signature) !== norm(printedName)) errors.push(`${r.title}: the signature must match the printed name.`);
    // HIPAA §164.508(c) / 42 CFR §2.31: every required element must be present before signing
    const t = templateVersion(item.key, item.version);
    if (t && !errors.length) {
      const missing = missingElements(t, r, { ...(item.prefill ?? {}), ...(resp.fields ?? {}) }, {
        printedName,
        signature: resp.signature,
        signerType: signer?.signerType ?? 'self',
        relationship: signer?.relationship,
        authority: signer?.authority,
      });
      for (const m of missing) errors.push(`${r.title}: this form cannot be signed until it says ${m.label}.`);
    }
  }
  return errors;
}

export function validatePacketSubmission(items: PacketItem[], rendered: Map<string, RenderedTemplate>, sub: PacketSubmission, minor: MinorRule | null): string[] {
  const errors = validateSigner(sub.signer, minor);
  for (const item of items) {
    const r = rendered.get(item.key);
    if (!r) {
      errors.push(`${item.title} is no longer available.`);
      continue;
    }
    // Part 2 (§2.14): a minor who can consent to SUD treatment alone is the only one who can sign this
    if (item.key === 'part2-consent' && minor?.minorControlsPart2 && sub.signer.signerType === 'representative' && !sub.sections[item.key]?.declined) {
      errors.push('The SUD records consent must be signed by the client (a minor who consents to SUD treatment controls disclosures, 42 CFR §2.14). Decline it here; the client can sign it with staff.');
      continue;
    }
    errors.push(...validateSection(item, r, sub.sections[item.key], sub.signer.printedName, sub.signer));
  }
  return errors;
}

/** Expiration of a signed section: its own expiration date field, else renewal cadence, else none. */
export function expiresAtFor(renewalMonths: number | null, fields: Record<string, string | string[]> | undefined, signedAt: Date): Date | null {
  const own = fields?.expirationDate;
  if (typeof own === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(own)) return new Date(`${own}T23:59:59Z`);
  if (!renewalMonths) return null;
  const d = new Date(signedAt);
  d.setUTCMonth(d.getUTCMonth() + renewalMonths);
  return d;
}

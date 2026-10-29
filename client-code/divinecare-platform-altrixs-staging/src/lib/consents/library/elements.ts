/**
 * Required elements of an authorization (pure, browser-safe).
 *
 * HIPAA authorization (ROI), 45 CFR §164.508(c): core elements (c)(1)(i)-(vi) and required
 * statements (c)(2)(i)-(iii). 42 CFR Part 2 consent, §2.31(a): patient name, who may disclose,
 * recipients (name or general designation / TPO single consent), purpose, amount and kind of SUD
 * information, right to revoke, expiration, signature and date; plus the redisclosure and
 * conditioning statements. Each template lists what satisfies each element (types.ts
 * regulatoryElements); this module checks a template (static: every element is covered) and a
 * signing (dynamic: every element is filled in), so signing is blocked when any one is missing.
 * The §2.32 notice that accompanies each Part 2 DISCLOSURE is PART2_REDISCLOSURE_NOTICE.
 */
import type { ConsentTemplateVersion, RenderedTemplate } from './types';

/** Plain-language names (shown to staff and signers when something is missing). */
export const HIPAA_AUTHORIZATION_ELEMENTS: readonly { element: string; label: string }[] = [
  { element: '164.508(c)(1)(i)', label: 'what information will be shared' },
  { element: '164.508(c)(1)(ii)', label: 'who may share it' },
  { element: '164.508(c)(1)(iii)', label: 'who will receive it' },
  { element: '164.508(c)(1)(iv)', label: 'why it is being shared' },
  { element: '164.508(c)(1)(v)', label: 'when this permission ends (a date or an event)' },
  { element: '164.508(c)(1)(vi)', label: "signature and date (and a representative's authority)" },
  { element: '164.508(c)(2)(i)', label: 'the right to take back (revoke) this permission in writing' },
  { element: '164.508(c)(2)(ii)', label: 'whether care or payment depends on signing' },
  { element: '164.508(c)(2)(iii)', label: 'that the recipient might share it again' },
];

export const PART2_CONSENT_ELEMENTS: readonly { element: string; label: string }[] = [
  { element: 'part2.patient_name', label: "the client's name" },
  { element: 'part2.authorized_discloser', label: 'who may use or share the records' },
  { element: 'part2.information', label: 'how much and what kind of substance use information' },
  { element: 'part2.recipients', label: 'who will receive it (a name, or treatment / payment / operations)' },
  { element: 'part2.purpose', label: 'why it is being shared' },
  { element: 'part2.expiration', label: 'when this consent ends (a date or an event)' },
  { element: 'part2.signature', label: 'signature and date' },
  { element: 'part2.revocation', label: 'the right to take back (revoke) this consent' },
  { element: 'part2.conditioning', label: 'whether care depends on signing' },
  { element: 'part2.redisclosure', label: 'that the recipient might share it again' },
];

/** 42 CFR §2.32(a)(2) short-form notice: must accompany every disclosure made with a Part 2 consent. */
export const PART2_REDISCLOSURE_NOTICE = '42 CFR part 2 prohibits unauthorized use or disclosure of these records.';

/** Which element list a template must meet (null = not an authorization). */
export function requiredElementsFor(t: Pick<ConsentTemplateVersion, 'effects'>): readonly { element: string; label: string }[] | null {
  if (t.effects?.includes('part2')) return PART2_CONSENT_ELEMENTS;
  if (t.effects?.includes('roi')) return HIPAA_AUTHORIZATION_ELEMENTS;
  return null;
}

const filled = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v.some((x) => x && x.trim()) : Boolean(v && v.trim()));

/** Static check: every required element is mapped, and its field / statement exists in the template. */
export function templateElementGaps(t: ConsentTemplateVersion): string[] {
  const required = requiredElementsFor(t);
  if (!required) return [];
  const gaps: string[] = [];
  const map = new Map((t.regulatoryElements ?? []).map((e) => [e.element, e.satisfiedBy]));
  for (const { element, label } of required) {
    const by = map.get(element);
    if (!by) {
      gaps.push(`${element} (${label}) is not mapped`);
      continue;
    }
    if (by.startsWith('field:')) {
      const keys = by.slice(6).split('|');
      const fields = keys.map((k) => t.fields?.find((f) => f.key === k));
      if (fields.some((f) => !f)) gaps.push(`${element}: field ${keys.join('|')} missing from the template`);
      // a single field must be required; an either-or pair is enforced by the expiration rule
      else if (keys.length === 1 && !fields[0]!.required) gaps.push(`${element}: field ${keys[0]} is not required`);
    } else if (by === 'block') {
      if (!t.blocks.some((b) => b.kind === 'p' && b.element === element)) gaps.push(`${element}: no statement tagged with this element`);
    } else if (by !== 'signature') gaps.push(`${element}: unknown mapping ${by}`);
  }
  return gaps;
}

export type ElementSigner = {
  printedName: string;
  /** typed signature (the authorization's own signature) */
  signature: string | null | undefined;
  signerType: 'self' | 'representative';
  relationship?: string | null;
  authority?: string | null;
};

/**
 * Dynamic check at signing: the elements still missing for this authorization, in plain language.
 * Empty = the authorization is complete and may be signed.
 */
export function missingElements(t: ConsentTemplateVersion, r: Pick<RenderedTemplate, 'blocks'>, fields: Record<string, string | string[]>, signer: ElementSigner): { element: string; label: string }[] {
  const required = requiredElementsFor(t);
  if (!required) return [];
  const map = new Map((t.regulatoryElements ?? []).map((e) => [e.element, e.satisfiedBy]));
  const out: { element: string; label: string }[] = [];
  for (const el of required) {
    const by = map.get(el.element);
    let ok = false;
    if (!by) ok = false;
    else if (by.startsWith('field:')) ok = by.slice(6).split('|').some((k) => filled(fields[k]));
    else if (by === 'block') ok = r.blocks.some((b) => b.kind === 'p' && b.element === el.element && b.text.trim().length > 0);
    else if (by === 'signature') {
      ok = filled(signer.printedName) && filled(signer.signature ?? '');
      if (ok && signer.signerType === 'representative') ok = filled(signer.relationship ?? '') && filled(signer.authority ?? '');
    }
    // A named recipient needs the name (Part 2 recipient type "named", or any ROI)
    if (ok && el.element === 'part2.recipients' && fields.recipientType === 'named') ok = filled(fields.recipientName);
    if (!ok) out.push(el);
  }
  return out;
}

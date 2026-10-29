/**
 * Portal proxy (guardian / representative) rules. Pure functions: no database, no clock except the
 * `now` passed in. Written guidance for the owner: docs/portal-proxy-access.md.
 *
 * Model (Epic MyChart proxy / athena / SimplePractice): a portal USER (PatientAccount = login identity)
 * holds PortalAccess links to one or more client charts. The client's own login is the 'self' link;
 * a parent, legal guardian or authorized representative holds a proxy link.
 *
 * Maryland defaults (PROXY_RULES; the owner can adjust the numbers here):
 *  - under 12: a parent / guardian proxy has FULL access;
 *  - 12-17: LIMITED by default. Limited hides mental health records (treatment plans, medications)
 *    when the minor consented to their own mental health treatment (Md. Health-General §20-104,
 *    16 and older; flag Client.portalMinorSelfConsentMh set by staff);
 *  - every proxy (any age, full or limited) never sees: items a clinician marked confidential,
 *    42 CFR Part 2 (SUD) content (§2.14: a minor who can consent to SUD treatment, any age in Maryland
 *    under Health-General §20-102(c), controls disclosure), unless the clinician marked that item
 *    "shared with guardian" (for Part 2 only with the minor's written consent on file), and the
 *    client's own private messages and mood check-ins;
 *  - at 18 a link granted while the client was a minor ends automatically (nightly job + every
 *    request) and the client is invited to their own login;
 *  - adults with an authorized representative / legal guardian: full or limited by staff choice, with
 *    the reason and the legal document recorded.
 */

export type PortalRelationship = 'self' | 'parent' | 'legal_guardian' | 'authorized_representative';
export type PortalAccessLevel = 'full' | 'limited';

export const PORTAL_RELATIONSHIPS: readonly PortalRelationship[] = ['self', 'parent', 'legal_guardian', 'authorized_representative'];
export const PROXY_RELATIONSHIPS: readonly Exclude<PortalRelationship, 'self'>[] = ['parent', 'legal_guardian', 'authorized_representative'];
export const PORTAL_ACCESS_LEVELS: readonly PortalAccessLevel[] = ['full', 'limited'];

export const RELATIONSHIP_LABEL: Record<PortalRelationship, string> = {
  self: 'Self',
  parent: 'Parent',
  legal_guardian: 'Legal guardian',
  authorized_representative: 'Authorized representative',
};

/** Verification of authority staff must record before a proxy link is active. */
export const VERIFICATION_METHODS = [
  'photo_id_in_person',
  'photo_id_video',
  'birth_certificate',
  'custody_order',
  'guardianship_order',
  'power_of_attorney',
  'health_care_agent',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_LABEL: Record<VerificationMethod, string> = {
  photo_id_in_person: 'Photo ID checked in person (and relationship confirmed)',
  photo_id_video: 'Photo ID checked on video (and relationship confirmed)',
  birth_certificate: 'Photo ID + birth certificate',
  custody_order: 'Photo ID + custody order',
  guardianship_order: 'Photo ID + guardianship order (court)',
  power_of_attorney: 'Photo ID + power of attorney',
  health_care_agent: 'Photo ID + advance directive naming a health care agent',
};

/** Legal-document methods: the document reference is required. */
export const DOCUMENT_METHODS: readonly VerificationMethod[] = ['birth_certificate', 'custody_order', 'guardianship_order', 'power_of_attorney', 'health_care_agent'];

/** Configurable defaults (owner may change). */
export const PROXY_RULES = {
  /** Under this age a parent / guardian proxy gets full access by default */
  fullAccessUnderAge: 12,
  /** Proxy links granted while the client was a minor end at this age */
  proxyEndsAtAge: 18,
  /** Md. Health-General §20-104: minors this age and older may consent to mental health treatment */
  mentalHealthSelfConsentAge: 16,
} as const;

export function isPortalRelationship(v: unknown): v is PortalRelationship {
  return typeof v === 'string' && (PORTAL_RELATIONSHIPS as readonly string[]).includes(v);
}

export function isProxyRelationship(v: unknown): v is Exclude<PortalRelationship, 'self'> {
  return typeof v === 'string' && (PROXY_RELATIONSHIPS as readonly string[]).includes(v);
}

export function isPortalAccessLevel(v: unknown): v is PortalAccessLevel {
  return v === 'full' || v === 'limited';
}

/** Whole years on `now` (UTC date parts; DOB is a date-only value). null when unknown. */
export function ageInYears(dob: Date | string | null | undefined, now: Date): number | null {
  if (!dob) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** The day the client turns `age` (UTC midnight). */
export function birthdayAt(dob: Date, age: number): Date {
  return new Date(Date.UTC(dob.getUTCFullYear() + age, dob.getUTCMonth(), dob.getUTCDate()));
}

/**
 * Default access level when staff grant a link.
 *  - self: full.
 *  - parent / guardian of a minor: full under 12, limited 12-17.
 *  - adult (or unknown age) representative: no default: staff must choose (null).
 */
export function defaultAccessLevel(relationship: PortalRelationship, ageYears: number | null): PortalAccessLevel | null {
  if (relationship === 'self') return 'full';
  if (ageYears === null) return null;
  if (ageYears < PROXY_RULES.proxyEndsAtAge) return ageYears < PROXY_RULES.fullAccessUnderAge ? 'full' : 'limited';
  return null;
}

/**
 * Checks a staff grant request. Returns the error text, or null when acceptable.
 *  - 'parent' only for a minor (a parent has no automatic authority over an adult child);
 *  - an adult needs a legal guardian / authorized representative with a legal document, a chosen
 *    level and a reason;
 *  - choosing a level other than the age default needs a reason.
 */
export function validateGrant(input: {
  relationship: PortalRelationship;
  accessLevel: PortalAccessLevel | null;
  accessLevelReason?: string | null;
  ageYears: number | null;
}): string | null {
  const { relationship, ageYears } = input;
  if (relationship === 'self') return 'Use the portal invitation for the client’s own login.';
  if (ageYears === null) return 'Add the client’s date of birth first: proxy rules depend on age.';
  const minor = ageYears < PROXY_RULES.proxyEndsAtAge;
  if (!minor && relationship === 'parent') {
    return 'A parent has no automatic authority over an adult client. Use legal guardian or authorized representative with the court order / power of attorney.';
  }
  const reason = (input.accessLevelReason ?? '').trim();
  if (!minor) {
    if (!input.accessLevel) return 'Choose full or limited access for an adult’s representative.';
    if (reason.length < 5) return 'Record why this access level was chosen (and the legal authority).';
    return null;
  }
  const def = defaultAccessLevel(relationship, ageYears);
  if (input.accessLevel && def && input.accessLevel !== def && reason.length < 5) {
    return `The default for this age is ${def}. Record why you chose ${input.accessLevel}.`;
  }
  return null;
}

/** Verification check: method required; legal-document methods need the document reference. */
export function validateVerification(input: {
  relationship: PortalRelationship;
  method: string | null | undefined;
  legalDocumentRef?: string | null;
  ageYears: number | null;
}): string | null {
  const method = input.method as VerificationMethod;
  if (!method || !(VERIFICATION_METHODS as readonly string[]).includes(method)) return 'Choose how authority was verified.';
  const minor = input.ageYears !== null && input.ageYears < PROXY_RULES.proxyEndsAtAge;
  const docRequired = DOCUMENT_METHODS.includes(method) || input.relationship === 'legal_guardian' || input.relationship === 'authorized_representative' || !minor;
  if (docRequired && !(input.legalDocumentRef ?? '').trim()) {
    return 'Record the legal document (custody / guardianship order, power of attorney, birth certificate) reference.';
  }
  if ((input.relationship === 'legal_guardian' || !minor) && (method === 'photo_id_in_person' || method === 'photo_id_video')) {
    return 'A legal guardian / adult representative needs the legal document as the verification method.';
  }
  return null;
}

export type PortalLinkRow = {
  id: string | null;
  relationship: string;
  accessLevel: string;
  minorAtGrant: boolean;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  endedReason?: string | null;
};

export type PortalLinkState = 'active' | 'pending_verification' | 'revoked' | 'expired' | 'aged_out';

/**
 * State of one link right now. A proxy link granted while the client was a minor ends on the
 * client's 18th birthday (also when the minorAtGrant flag is missing but the relationship is 'parent').
 */
export function linkState(link: PortalLinkRow, client: { dateOfBirth: Date | null }, now: Date): PortalLinkState {
  if (link.revokedAt) return link.endedReason === 'aged_out' ? 'aged_out' : link.endedReason === 'expired' ? 'expired' : 'revoked';
  if (link.relationship === 'self') return 'active';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (link.minorAtGrant || link.relationship === 'parent') {
    const age = ageInYears(client.dateOfBirth, now);
    if (age !== null && age >= PROXY_RULES.proxyEndsAtAge) return 'aged_out';
  }
  if (!link.verifiedAt) return 'pending_verification';
  return 'active';
}

/** What the active person on the session is (attached to every patient request). */
export type PortalActor = {
  /** PortalAccess row (null = implicit 'self' of a pre-migration account) */
  accessId: string | null;
  relationship: PortalRelationship;
  accessLevel: PortalAccessLevel;
  isProxy: boolean;
  /** Name of the person signed in (guardian name for a proxy) */
  actorName: string;
  clientAgeYears: number | null;
  minorSelfConsentMh: boolean;
};

export type PortalItemCategory = 'administrative' | 'mental_health' | 'general';

export type PortalItemFacts = {
  /** 42 CFR Part 2 (SUD) content */
  part2?: boolean;
  category?: PortalItemCategory;
  /** Clinician decision for this item (PortalItemVisibility) */
  override?: 'confidential' | 'shared_with_guardian' | null;
};

/**
 * May the signed-in person see this item for the active client?
 * Self always may. A proxy never sees confidential items; sees Part 2 items and limited-hidden
 * categories only when the clinician marked the item shared with the guardian.
 */
export function proxyMayView(actor: Pick<PortalActor, 'isProxy' | 'accessLevel' | 'minorSelfConsentMh'>, item: PortalItemFacts): boolean {
  if (!actor.isProxy) return true;
  if (item.override === 'confidential') return false;
  if (item.override === 'shared_with_guardian') return true;
  if (item.part2) return false;
  if (actor.accessLevel === 'limited' && item.category === 'mental_health' && actor.minorSelfConsentMh) return false;
  return true;
}

/** Portal features and whether a proxy may use them. */
export type PortalFeature =
  | 'appointments'
  | 'messages'
  | 'documents'
  | 'consents'
  | 'resources'
  | 'billing'
  | 'profile.view'
  | 'profile.edit'
  | 'avatar'
  | 'account.delete'
  | 'check-ins'
  | 'progress'
  | 'medications'
  | 'device-token';

export function proxyMayUse(actor: Pick<PortalActor, 'isProxy' | 'accessLevel' | 'minorSelfConsentMh'>, feature: PortalFeature): boolean {
  if (!actor.isProxy) return true;
  switch (feature) {
    case 'appointments':
    case 'messages':
    case 'documents':
    case 'consents':
    case 'resources':
    case 'billing':
    case 'profile.view':
    case 'device-token':
      return true;
    case 'profile.edit':
    case 'avatar':
      return actor.accessLevel === 'full';
    case 'medications':
      return !(actor.accessLevel === 'limited' && actor.minorSelfConsentMh);
    // The client's own mood journal / check-ins and closing the client's account stay with the client
    case 'check-ins':
    case 'progress':
    case 'account.delete':
      return false;
    default:
      return false;
  }
}

/** Sender label on a message a proxy sends: "Jordan Smith (parent of Alex)" style, never the email. */
export function proxySenderLabel(actorName: string, relationship: PortalRelationship, clientFirstName: string): string {
  const who = actorName.trim() || 'Guardian';
  if (relationship === 'self') return who;
  const rel = relationship === 'parent' ? 'parent' : relationship === 'legal_guardian' ? 'legal guardian' : 'representative';
  return `${who} (${rel} of ${clientFirstName.trim() || 'client'})`.slice(0, 120);
}

/** Signer relationship for representative signatures (treatment plans / consent packets). */
export function representativeSignerRelationship(relationship: PortalRelationship): 'Parent' | 'Legal guardian' | 'Self' | 'Guarantor' {
  if (relationship === 'parent') return 'Parent';
  if (relationship === 'legal_guardian' || relationship === 'authorized_representative') return 'Legal guardian';
  return 'Self';
}

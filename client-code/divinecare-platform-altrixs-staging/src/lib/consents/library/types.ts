/**
 * Consent / forms library: shared types (pure, browser-safe).
 *
 * The legal TEXT of every template version lives in source control (templates.ts), like the Carelon
 * attestation: a released version is never edited, a change is a new version. The per-practice
 * LIFECYCLE of each version (Draft → Approved → Active → Retired, who approved and when) lives in the
 * ConsentTemplateState table (migration 20261019_consent_library.sql). Only an Active version can be
 * sent or put in an intake packet. A signed consent freezes the rendered text + version it was
 * signed on (ConsentForm.formData.frozen), so later versions never change a signed record.
 */

export const TEMPLATE_STATUSES = ['DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: 'Draft (needs approval)',
  APPROVED: 'Approved (not yet active)',
  ACTIVE: 'Active',
  RETIRED: 'Retired',
};

/**
 * Where a version's wording came from.
 *  practice_packet: the practice's own Valant intake packet (received 2026-10-12), kept verbatim
 *    except the practice name, which is a template variable (review notes 1-2).
 *  proposed: wording drafted in Altrixs for owner / compliance approval ("Proposed").
 *  proposed_typo_fix: the practice wording with ONLY the typos from review note 8 corrected.
 *  standard: regulatory boilerplate whose content is dictated by the rule (NPP acknowledgment of
 *    receipt, 45 CFR §164.520(c)(2)(ii)); shipped Active.
 */
export type TemplateOrigin = 'practice_packet' | 'proposed' | 'proposed_typo_fix' | 'standard';

export type TemplateCategory =
  | 'orientation'
  | 'treatment'
  | 'privacy'
  | 'authorization'
  | 'financial'
  | 'communication'
  | 'technology'
  | 'clinical'
  | 'program';

export type TemplateBlock =
  | { kind: 'h'; text: string }
  /** element: regulatory element this statement satisfies (e.g. '164.508(c)(2)(i)') */
  | { kind: 'p'; text: string; element?: string }
  /** paragraph with a bold lead-in ("Outpatient Assessment – ...") */
  | { kind: 'lead'; label: string; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  /** italic note as printed on the form */
  | { kind: 'note'; text: string };

/** A choice the signer makes inside a section (e.g. on-site / off-site services). */
export type TemplateChoice = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  required: boolean;
  multiple?: boolean;
};

/** A labeled checkbox the signer ticks inside a section (beyond the acknowledgment). */
export type TemplateCheckbox = { key: string; label: string; required: boolean };

/**
 * Structured fields filled per instance (ROI / Part 2 builders, advance directive status...).
 * The values are frozen with the signed record.
 */
export type TemplateField = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'date' | 'select' | 'multiselect' | 'checkbox';
  required: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  /** Regulatory element this field satisfies (shown to staff, checked by tests) */
  element?: string;
};

export type ReviewFlag = {
  /** review-note number from docs/source-forms/mdb-intake-form-valant-2026-10-12.md, or 'new' */
  note: string;
  severity: 'needs_decision' | 'info';
  text: string;
};

/** Packet composer rule: when a template applies to a client. */
export type AppliesRule =
  | { kind: 'all' }
  | { kind: 'service'; services: ServiceFlag[] }
  | { kind: 'minor' }
  | { kind: 'medicaid' }
  /** never auto-included; staff add it per client (e.g. an ROI to a named recipient) */
  | { kind: 'manual' };

export type ServiceFlag = 'omhc' | 'prp' | 'sud' | 'primary_care' | 'telehealth' | 'medication' | 'group';

/** What a signed / revoked consent of this template switches on or off elsewhere in Altrixs. */
export type ConsentEffect =
  | 'sms'
  | 'email'
  | 'voicemail'
  | 'portal'
  | 'ai_drafting'
  | 'recording'
  | 'roi'
  | 'part2'
  | 'card_on_file'
  | 'telehealth';

export type ConsentTemplateVersion = {
  key: string;
  version: number;
  title: string;
  category: TemplateCategory;
  origin: TemplateOrigin;
  /** Status when the practice has not recorded a decision (ConsentTemplateState row absent) */
  defaultStatus: TemplateStatus;
  /** Where the wording comes from (page / heading of the source packet, or the regulation) */
  source: string;
  blocks: TemplateBlock[];
  /** The checkbox the signer ticks for this section */
  acknowledgment: string;
  checkboxes?: TemplateCheckbox[];
  choices?: TemplateChoice[];
  fields?: TemplateField[];
  reviewFlags: ReviewFlag[];
  /** What changed vs the previous version (proposed versions) */
  changeNote?: string;
  /** Re-sign cadence; null = no periodic renewal */
  renewalMonths: number | null;
  /** When this version becomes Active, clients signed on an older version must re-sign */
  resignOnNewVersion: boolean;
  appliesTo: AppliesRule;
  /** Can be revoked (all consents/authorizations; plain acknowledgments of receipt cannot) */
  revocable: boolean;
  effects?: ConsentEffect[];
  /**
   * packet: signed inside the intake packet with the one final signature;
   * standalone: its own signature (ROI / Part 2 consent per recipient)
   */
  signing: 'packet' | 'standalone';
  /** Text shown to staff only (never part of the signed document) */
  staffGuidance?: string[];
  /** Variables used in the text, e.g. practiceName */
  variables?: string[];
  /** Blocks sending until a practice setting exists (e.g. the NPP document) */
  requiresConfig?: 'npp_document';
  /**
   * Regulatory elements this template must carry and what satisfies each one:
   * 'field:<key>' (a required field), 'block' (a statement whose element tag matches), or
   * 'signature' (the signing record: signer name, signature, date, representative authority).
   */
  regulatoryElements?: { element: string; label: string; satisfiedBy: string }[];
  /** Legacy ConsentForm.type this template maps to (existing gates read it, e.g. 'AI Note Drafting') */
  consentType?: string;
};

/** Rendered (variables resolved) text: what the signer saw. */
export type RenderedTemplate = {
  key: string;
  version: number;
  title: string;
  blocks: TemplateBlock[];
  acknowledgment: string;
  checkboxes: TemplateCheckbox[];
  choices: TemplateChoice[];
  fields: TemplateField[];
  /** variables used and the value they had when rendered ('' when not set) */
  variables: Record<string, string>;
  /** Variables the text uses that had no value (sending is blocked while any remain) */
  missingVariables: string[];
};

/** Frozen into ConsentForm.formData at signing: the rendered text + its SHA-256 (tamper evidence). */
export type FrozenSection = RenderedTemplate & { sha256: string; frozenAt: string };

export type TemplateVariables = {
  practiceName: string | null;
  practicePhone?: string | null;
  practiceAddress?: string | null;
  nppUrl?: string | null;
  nppEffectiveDate?: string | null;
};

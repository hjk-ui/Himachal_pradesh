/**
 * Carelon Behavioral Health - Maryland: "Attestation to Discharge Conflicting/Overlapping
 * Authorization(s) Due to Non-Overlap Requirement". Pure module (browser-safe).
 *
 * The wording below reproduces the Carelon form EXACTLY (text only; Carelon's logo is not
 * embedded). Versions are kept side by side: a revised Carelon form is added as a new entry in
 * CARELON_TEMPLATES and CARELON_CURRENT_VERSION moves to it. A signed attestation freezes the
 * template it was signed on (formData.document), so later revisions never change a signed record.
 */

export const CARELON_FORM_KEY = 'carelon-md-nonoverlap-attestation' as const;
/** ConsentForm.type for these rows (the consents table is shared with the other consent forms) */
export const CARELON_CONSENT_TYPE = 'Carelon Non-Overlap Attestation' as const;

export type CarelonField = { key: string; label: string };

export type CarelonTemplate = {
  formKey: typeof CARELON_FORM_KEY;
  version: string;
  title: string;
  subtitle: string;
  footer: string;
  participantInfo: { heading: string; fields: CarelonField[] };
  providerInfo: { heading: string; fields: CarelonField[] };
  purpose: { heading: string; paragraphs: string[] };
  partA: {
    heading: string;
    lead: string;
    /** Statement 1 is the "I am (check one)" choice: text before, the two options, text between */
    statement1: { before: string; optionParticipant: string; or: string; optionRepresentative: string };
    /** Statements 2..6 */
    statements: string[];
    fields: CarelonField[];
  };
  partB: {
    heading: string;
    lead: string;
    /** Statements 1..4 */
    statements: string[];
    fields: CarelonField[];
  };
};

/** COMAR reference shown to staff next to "new attestation needed" (the form's own citation). */
export const COMAR_NON_OVERLAP_CITATION = 'COMAR 10.09.80.06B';
export const COMAR_NON_OVERLAP_NOTE =
  'Certain Maryland Public Behavioral Health System services may not overlap (COMAR 10.09.80.06B; see Carelon\'s "Combination of Mental Health Services" and "Combination of SUD Services" documents). When a client starts a service with non-overlap rules (PRP, IOP, residential, TMS, case management and similar), a new attestation is needed so Carelon can discharge the conflicting authorization.';

const TEMPLATE_2025: CarelonTemplate = {
  formKey: CARELON_FORM_KEY,
  version: '2025',
  title: 'Carelon Behavioral Health - Maryland',
  subtitle: 'Attestation to Discharge Conflicting/Overlapping Authorization(s) Due to Non-Overlap Requirement',
  footer: 'maryland.carelonbh.com',
  participantInfo: {
    heading: 'Participant Information',
    fields: [
      { key: 'participantName', label: 'Participant Full Name' },
      { key: 'participantId', label: 'Participant ID' },
      { key: 'dateOfBirth', label: 'Date of Birth (MM/DD/YYYY)' },
    ],
  },
  providerInfo: {
    heading: 'Provider Information',
    fields: [
      { key: 'organizationName', label: 'Provider Organization Name' },
      { key: 'npi', label: 'Provider NPI / Provider Identifier' },
      { key: 'tin', label: 'Provider TIN Number' },
    ],
  },
  purpose: {
    heading: 'Purpose',
    paragraphs: [
      "Certain services are not permitted to overlap according to COMAR 10.09.80.06B. You can also refer to the Combination of Mental Health Services document or the Combination of SUD Services document on Carelon's website for additional details.",
      "This attestation documents the participant's (or Authorized Representative's) request to receive services with the provider listed above and to discharge/end any conflicting, overlapping authorization(s) that prevent authorization and/or delivery of those services.",
      'If the participant has any questions, they can call customer service at 1-800-888-1965 to ask for additional details.',
    ],
  },
  partA: {
    heading: 'A) Participant / Authorized Representative Attestation',
    lead: 'By signing below, I attest and agree that:',
    statement1: {
      before: '1. I am (check one):',
      optionParticipant: 'The participant identified above,',
      or: 'OR',
      optionRepresentative: "The participant's Authorized Representative/legal guardian with legal authority to act on the participant's behalf.",
    },
    statements: [
      '2. I am requesting to receive the indicated behavioral health service(s) with the provider identified above.',
      '3. I understand that certain service authorizations may not overlap, and that existing overlapping authorizations may prevent the requested services from being authorized and/or delivered from this Provider.',
      '4. I am requesting that any conflicting and overlapping authorization(s) (including those associated with other provider(s)) that are not permitted to overlap with the services I am seeking with this provider be discharged/ended/closed, as allowed under program rules, so that services may proceed with this provider. I understand that conflicting and overlapping authorizations will be discharged/ended/closed immediately upon submission of this document.',
      "5. I understand that ending/discharging an authorization may affect the participant's ability to receive services under the discharged authorization(s). I have had the opportunity to ask questions about this decision and have received answers I understand.",
      '6. I attest that this decision is voluntary and made without coercion.',
    ],
    fields: [
      { key: 'printedName', label: 'Printed Name (participant or Authorized Representative)' },
      { key: 'relationship', label: 'If Authorized Representative, relationship to participant' },
      { key: 'authority', label: 'If Authorized Representative, brief description of authority' },
      { key: 'signature', label: 'Signature' },
      { key: 'dateSigned', label: 'Date Signed (MM/DD/YYYY)' },
    ],
  },
  partB: {
    heading: 'B) Provider / Authorized Provider Representative Attestation',
    lead: 'By signing below, I attest and agree that:',
    statements: [
      '1. I am the provider or an Authorized Representative of the provider identified above, and I am authorized to sign this attestation on behalf of the Provider.',
      '2. The participant (or Authorized Representative) completed this attestation in concert with the provider and affirmed they are seeking services with this Provider.',
      '3. To the best of my knowledge, the participant may have an existing authorization(s) that conflicts with the non-overlap requirement for the service(s) being sought with this provider, and this attestation is intended to document the participant\'s request to discharge/end such conflicting, overlapping authorization(s) (including authorization(s) associated with other provider(s)).',
      '4. I informed the participant (or Authorized Representative) that discharging an authorization may affect access to services under the discharged authorization(s) and provided an opportunity for questions.',
    ],
    fields: [
      { key: 'printedName', label: 'Printed Name (Provider/Representative)' },
      { key: 'title', label: 'Title' },
      { key: 'signature', label: 'Signature' },
      { key: 'dateSigned', label: 'Date Signed (MM/DD/YYYY)' },
    ],
  },
};

/** Every version ever used, by version id. Never edit a released version: add a new one. */
export const CARELON_TEMPLATES: Readonly<Record<string, CarelonTemplate>> = Object.freeze({
  [TEMPLATE_2025.version]: TEMPLATE_2025,
});

export const CARELON_CURRENT_VERSION = '2025';

export function carelonTemplate(version: string = CARELON_CURRENT_VERSION): CarelonTemplate | null {
  return CARELON_TEMPLATES[version] ?? null;
}

/** Statement 1 as one line (how it reads on the paper form). */
export function statement1Text(t: CarelonTemplate): string {
  const s = t.partA.statement1;
  return `${s.before} ☐ ${s.optionParticipant} ${s.or} ☐ ${s.optionRepresentative}`;
}

/** All attestation statements a signer agrees to, in order (used by tests and the PDF check). */
export function allStatements(t: CarelonTemplate): string[] {
  return [
    ...t.purpose.paragraphs,
    t.partA.lead,
    t.partA.statement1.before,
    t.partA.statement1.optionParticipant,
    t.partA.statement1.optionRepresentative,
    ...t.partA.statements,
    t.partB.lead,
    ...t.partB.statements,
  ];
}

/** Deep copy for freezing into a signed record. */
export function freezeTemplate(t: CarelonTemplate): CarelonTemplate {
  return JSON.parse(JSON.stringify(t)) as CarelonTemplate;
}

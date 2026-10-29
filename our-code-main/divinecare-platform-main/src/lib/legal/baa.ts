import { createHash } from 'crypto';

export const BAA_VERSION = '2026-10-26-draft';
export const BAA_LEGAL_REVIEWED = false;
export const BAA_TITLE = 'Altrixs Business Associate Agreement';
export const BAA_DRAFT_BANNER = 'Draft — pending legal review';
export const BAA_BREACH_DAYS = 10;

export function baaAttestation(orgName: string) {
  return `I am authorized to sign for ${orgName} and I agree to the Business Associate Agreement (version ${BAA_VERSION}).`;
}

export function baaPlainText(): string {
  return [
    BAA_TITLE,
    `Version: ${BAA_VERSION}`,
    BAA_DRAFT_BANNER,
    '',
    'This Business Associate Agreement ("BAA") is entered into between Altrixs ("Business Associate") and the Covered Entity registering for the Altrixs platform.',
    '',
    '1. Definitions. Terms used but not defined have the meaning in HIPAA and HITECH.',
    '2. Obligations of Business Associate. Altrixs will use and disclose PHI only as permitted by this BAA and applicable law; implement appropriate safeguards; report breaches to the Covered Entity within the timeframe stated below; and ensure subcontractors agree to equivalent restrictions.',
    `3. Breach notification. Altrixs will notify the Covered Entity of a Breach of Unsecured PHI without unreasonable delay and no later than ${BAA_BREACH_DAYS} business days after discovery (placeholder pending legal review).`,
    '4. Permitted uses. Altrixs may use PHI to provide the Services, for proper management and administration, and as required by law.',
    '5. Individual rights. Altrixs will make PHI available for access, amendment, and accounting of disclosures as directed by the Covered Entity.',
    '6. Termination. Upon termination, Altrixs will return or destroy PHI when feasible, or extend protections if return/destruction is infeasible.',
    '7. Open items pending legal review. Indemnity, insurance minimums, governing law, and final breach timelines.',
    '',
    'Open items: counsel review of indemnity, insurance, governing law, and breach-day placeholder.',
  ].join('\n');
}

export function baaTextSha256(text = baaPlainText()) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const BAA_REQUIRED_CODE = 'BAA_REQUIRED';
export const BAA_STALE_CODE = 'BAA_VERSION_STALE';
export const BAA_MISSING_SIGNER =
  'Signer name, title and email are required to accept the Business Associate Agreement.';
export const BAA_MUST_ACCEPT =
  'You must accept the Business Associate Agreement to create an account.';
export const BAA_STALE_MESSAGE =
  'This Business Associate Agreement version is out of date. Refresh the page and accept the current version.';

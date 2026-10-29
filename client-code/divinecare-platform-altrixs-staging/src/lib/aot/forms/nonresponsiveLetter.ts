/**
 * Non-Responsive Respondent certified letter — MDH#0002BHA-Revised 06/25/2026.
 *
 * Every fixed part of the letter (letterhead, "SENT VIA CERTIFIED MAIL", Re: line, body paragraphs and
 * headings, closing, enclosures, cc, MDH footer) is printed verbatim from the MDH#0002BHA template
 * (wording verified against the Revised 06/25/2026 form; see docs/source-forms/md-aot-forms-2026-06-25.md).
 * The body text is not editable: staff fill in only the form's blanks (regional office, date, addressee,
 * outreach table, response checkboxes, contact, director name). Certified-mail tracking number and mailed
 * date are recorded after signing (POST /api/aot/documents/[id]/mailed) and logged as an outreach attempt.
 */
import { REVISED, buildSchema, has, missingItems, opts, type FormData, type FormDefinition, type SectionSpec } from './engine';
import { PROGRAM_DIRECTOR_ROLES } from './roles';

export const LETTERHEAD = 'MARYLAND ASSISTED OUTPATIENT TREATMENT (AOT) PROGRAM';
export const CERTIFIED_MAIL = 'SENT VIA CERTIFIED MAIL';
export const LETTER_RE = 'AOT Program – Outreach and Opportunity to Participate in Treatment Plan Development';
export const LETTER_SIGNATURE_TITLE = 'AOT Regional Program Director';
export const LETTER_SIGNATURE_PROGRAM = 'Maryland Assisted Outpatient Treatment Program';

/** Verbatim MDH#0002BHA (Revised 06/25/2026) body text. Not editable. */
export const LETTER_TEXT = {
  intro:
    'The Maryland Assisted Outpatient Treatment (AOT) Program is writing to document our efforts to contact you regarding participation in the treatment plan development process associated with your AOT matter.',
  outreachHeading: 'Outreach Attempts / Participation Status',
  outreachIntro: 'The AOT Team attempted to contact you regarding an initial engagement meeting on the following dates:',
  orientationHeading: 'Orientation to the AOT Program',
  orientation1:
    'Assisted Outpatient Treatment (AOT) is a court-based outpatient treatment process intended to support individuals with behavioral health needs in remaining safely in the community while connected to treatment and services. Program goals include reducing crises, hospitalization, homelessness, and interruptions in care, while promoting recovery, stability, and access to community-based supports.',
  orientation2:
    'The AOT Regional Program Director helps oversee the local AOT program, coordinates communication, and assists with addressing barriers to services. The Care Coordination Team (CCT) may include clinical, case management, psychiatric, and peer support staff who assist with treatment planning, referrals, and coordination of care.',
  preferencesHeading: 'Opportunity to Share Your Preferences in Writing',
  preferencesIntro:
    'Even if you choose not to meet at this time, you may still share your treatment planning preferences in writing. You may provide information regarding:',
  preferencesBullets: [
    'Whether you would like to participate in future meetings',
    'Preferred method of contact (phone, mail, email, attorney, guardian, etc.)',
    'Preferred providers or services',
    'Individuals you would like involved in planning (family, support person, attorney, guardian, etc.)',
    'Any treatment goals, concerns, or accommodations you would like the team to know',
  ],
  preferencesReturn: 'Please return written preferences to the address above or contact our office directly.',
  contactHeading: 'Contact Information',
  contactIntro: 'If you have questions, concerns, or would like to speak with the AOT Team, please contact:',
  contactClosing: 'We remain available to answer questions and to work with you respectfully throughout this process.',
  sincerely: 'Sincerely,',
  enclosures: 'Enclosures: Optional Initial Engagement Meeting Form/ Return Envelope',
  cc: 'cc: Counsel for Respondent',
} as const;

export const MDH_FOOTER =
  'Maryland Department of Health · Behavioral Health Administration · 201 W. Preston Street · Baltimore, MD 21201 · maryland.gov/TryAOT · Toll Free: 1-877-463-3464 · Deaf and Hard of Hearing Use Relay · MDH#0002BHA-Revised 06/25/2026';

export const LETTER_METHODS = opts([
  ['phone', 'Phone'],
  ['mail', 'Mail'],
  ['in_person', 'In-Person'],
  ['other', 'Other'],
]);

export const LETTER_RESPONSES = opts([
  ['declined', 'You declined to participate at this time.'],
  ['no_response', 'We did not receive a response to our outreach attempts.'],
  ['other', 'Other'],
]);

const staticText = (key: string, text: string) => ({ key, label: '', type: 'static' as const, text });

export const LETTER_SECTIONS: SectionSpec[] = [
  {
    id: 'letterhead',
    title: 'Regional office (letterhead)',
    fields: [
      { key: 'regionalOfficeAddress', label: 'Regional office address', type: 'text', required: true },
      { key: 'regionalOfficeCity', label: 'City, State ZIP', type: 'text', required: true },
      { key: 'regionalOfficePhone', label: 'Phone', type: 'tel', required: true },
      { key: 'regionalOfficeEmail', label: 'Email', type: 'email', required: true },
    ],
  },
  {
    id: 'addressee',
    title: 'Date and addressee',
    fields: [
      { key: 'letterDate', label: 'Date', type: 'date', required: true },
      { key: 'respondentName', label: 'To (respondent name)', type: 'text', required: true },
      { key: 'mailingAddress', label: 'Mailing address', type: 'textarea', required: true },
      staticText('s_intro', LETTER_TEXT.intro),
    ],
  },
  {
    id: 'outreach',
    title: LETTER_TEXT.outreachHeading,
    fields: [
      staticText('s_outreachIntro', LETTER_TEXT.outreachIntro),
      {
        key: 'outreachAttempts',
        label: 'Outreach attempts',
        type: 'table',
        required: true,
        rowKey: 'date',
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'method', label: 'Method (Phone / Mail / In-Person / Other)', type: 'select', options: LETTER_METHODS },
          { key: 'result', label: 'Result', type: 'text' },
        ],
      },
      { key: 'responseStatus', label: 'Participation status', type: 'checkboxes', required: true, options: LETTER_RESPONSES },
      { key: 'responseOther', label: 'Other (specify)', type: 'text', showIf: (d) => has(d, 'responseStatus', 'other'), required: (d) => has(d, 'responseStatus', 'other') },
    ],
  },
  {
    id: 'orientation',
    title: LETTER_TEXT.orientationHeading,
    fields: [staticText('s_orientation1', LETTER_TEXT.orientation1), staticText('s_orientation2', LETTER_TEXT.orientation2)],
  },
  {
    id: 'preferences',
    title: LETTER_TEXT.preferencesHeading,
    fields: [
      staticText('s_preferencesIntro', LETTER_TEXT.preferencesIntro),
      ...LETTER_TEXT.preferencesBullets.map((b, i) => staticText(`s_preference${i + 1}`, `• ${b}`)),
      staticText('s_preferencesReturn', LETTER_TEXT.preferencesReturn),
    ],
  },
  {
    id: 'contact',
    title: LETTER_TEXT.contactHeading,
    fields: [
      staticText('s_contactIntro', LETTER_TEXT.contactIntro),
      { key: 'contactName', label: 'AOT Program Contact', type: 'text', required: true },
      { key: 'contactPhone', label: 'Phone', type: 'tel', required: true },
      { key: 'contactEmail', label: 'Email', type: 'email', required: true },
      staticText('s_contactClosing', LETTER_TEXT.contactClosing),
    ],
  },
  {
    id: 'closing',
    title: 'Signature',
    fields: [
      { key: 'directorName', label: 'AOT Regional Program Director (name)', type: 'text', required: true },
      staticText('s_enclosures', LETTER_TEXT.enclosures),
      staticText('s_cc', LETTER_TEXT.cc),
    ],
  },
];

export const NONRESPONSIVE_LETTER: FormDefinition = {
  type: 'nonresponsive_letter',
  title: 'Non-Responsive Respondent Letter',
  mdhNumber: 'MDH#0002BHA',
  revised: REVISED,
  purpose: 'Certified letter to a respondent who did not respond to outreach, offering the opportunity to participate in treatment plan development.',
  wordingVerified: 'Letter wording verified word for word against MDH#0002BHA (Revised 06/25/2026); only the blanks are editable.',
  sections: LETTER_SECTIONS,
  rules: [],
  signers: [{ id: 'director', label: LETTER_SIGNATURE_TITLE, roles: PROGRAM_DIRECTOR_ROLES, roleHint: 'Practice director / admin (to confirm)' }],
  attestation: 'I reviewed this letter, including the outreach attempts listed, and approve it for mailing. This electronic signature is my signature.',
  multiInstance: true,
};

export const nonresponsiveLetterSchema = buildSchema(LETTER_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(NONRESPONSIVE_LETTER, data);
}

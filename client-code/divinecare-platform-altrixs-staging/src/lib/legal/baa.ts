/**
 * Business Associate Agreement (BAA) accepted by click-through at registration
 * (src/app/get-started, /api/auth/register) and by admins of existing organizations
 * (/dashboard/admin/baa). Public copy at /legal/baa.
 *
 * Drafted from the HHS sample business associate agreement provisions (public domain;
 * 45 CFR 164.504(e), 164.314(a), 164.410), adapted for Altrixs as Business Associate, with a
 * 42 CFR Part 2 qualified service organization addendum (42 CFR 2.11, 2.12(c)(4)).
 *
 * Pure data (no Node imports) so client pages can render it. The SHA-256 of baaPlainText() is
 * stored with every acceptance (src/lib/legal/baaAcceptance.ts) so the exact text accepted can
 * be proven later. Changing ANY wording requires a new BAA_VERSION.
 *
 * BAA_LEGAL_REVIEWED: while false, /legal/baa shows "Draft — pending legal review" and the
 * marketing site must not claim that a BAA is accepted at sign-up
 * (tests/marketing-copy-standard.test.ts).
 */

export const BAA_VERSION = '2026-10-26-draft';
export const BAA_LEGAL_REVIEWED = false;
export const BAA_TITLE = 'Altrixs Business Associate Agreement';
export const BAA_DRAFT_BANNER = 'Draft — pending legal review';

/** Contractual notice period for breaches (Section 6). Owner / counsel to confirm. */
export const BAA_BREACH_NOTICE_BUSINESS_DAYS = 10;

/**
 * Items counsel or the owner must confirm before BAA_LEGAL_REVIEWED can become true.
 * Shown under the draft banner on /legal/baa; not part of the agreement text or its hash.
 */
export const BAA_OPEN_ITEMS: string[] = [
  'Legal entity name and notice address for Altrixs (the agreement says "Altrixs").',
  `Contractual breach notice period of ${BAA_BREACH_NOTICE_BUSINESS_DAYS} business days (the regulatory outer limit is 60 calendar days).`,
  'Subcontractor list in Addendum B (AWS confirmed; confirm whether DrFirst, Waystar and Stripe are listed as subcontractors or contract directly with the customer).',
  'Whether the Business Associate may de-identify PHI (Section 3.5) and the data aggregation scope (Section 3.4).',
  'Cure period for termination for cause (30 days) and governing law.',
  'Whether the click-through acceptance replaces or supplements a signed BAA for Enterprise customers.',
];

export type BaaSection = { id: string; heading: string; paragraphs: string[] };

export function baaAttestationLabel(organizationName: string): string {
  const org = organizationName.trim() || 'my organization';
  return `I am authorized to sign for ${org} and I agree to the Business Associate Agreement`;
}

export const BAA_PREAMBLE = [
  'This Business Associate Agreement ("Agreement") is entered into between the organization that registers for or subscribes to the Altrixs service ("Covered Entity") and Altrixs ("Business Associate"), and is effective on the date the Covered Entity\'s authorized representative accepts it electronically ("Effective Date").',
  'Business Associate provides a cloud-hosted electronic health record, practice management, billing and related services to Covered Entity under the Altrixs subscription terms (the "Services Agreement"). In providing those services Business Associate creates, receives, maintains or transmits protected health information on behalf of Covered Entity. The parties enter into this Agreement to meet the requirements of the HIPAA Rules and, where Covered Entity is a Part 2 program, 42 CFR Part 2.',
];

export const BAA_SECTIONS: BaaSection[] = [
  {
    id: 'definitions',
    heading: '1. Definitions',
    paragraphs: [
      '1.1 Catch-all definition. The following terms used in this Agreement have the same meaning as those terms in the HIPAA Rules: Breach, Data Aggregation, Designated Record Set, Disclosure, Health Care Operations, Individual, Minimum Necessary, Notice of Privacy Practices, Protected Health Information, Required By Law, Secretary, Security Incident, Subcontractor, Unsecured Protected Health Information, and Use.',
      '1.2 "Business Associate" has the same meaning as the term "business associate" at 45 CFR 160.103 and, in this Agreement, means Altrixs.',
      '1.3 "Covered Entity" has the same meaning as the term "covered entity" at 45 CFR 160.103 and, in this Agreement, means the organization that accepts this Agreement. Where that organization is itself a business associate of a covered entity, this Agreement operates as a subcontractor business associate agreement and "Covered Entity" refers to that organization.',
      '1.4 "HIPAA Rules" means the Privacy, Security, Breach Notification and Enforcement Rules at 45 CFR Part 160 and Part 164, as amended.',
      '1.5 "PHI" means Protected Health Information that Business Associate creates, receives, maintains or transmits on behalf of Covered Entity.',
      '1.6 "Part 2" means 42 CFR Part 2, Confidentiality of Substance Use Disorder Patient Records, as amended.',
    ],
  },
  {
    id: 'obligations',
    heading: '2. Obligations and Activities of Business Associate',
    paragraphs: [
      'Business Associate agrees to:',
      '(a) Not use or disclose PHI other than as permitted or required by this Agreement or as Required By Law.',
      '(b) Use appropriate safeguards, and comply with Subpart C of 45 CFR Part 164 with respect to electronic PHI, to prevent use or disclosure of PHI other than as provided for by this Agreement.',
      '(c) Report to Covered Entity any use or disclosure of PHI not provided for by this Agreement of which it becomes aware, including Breaches of Unsecured PHI as required at 45 CFR 164.410 (see Section 6), and any Security Incident of which it becomes aware. The parties agree that this Section is notice of, and no further report is required for, unsuccessful Security Incidents such as pings, port scans, denied sign-in attempts and denial-of-service attempts that do not result in unauthorized access, use or disclosure of PHI.',
      '(d) In accordance with 45 CFR 164.502(e)(1)(ii) and 164.308(b)(2), ensure that any Subcontractors that create, receive, maintain or transmit PHI on behalf of Business Associate agree in writing to the same restrictions, conditions and requirements that apply to Business Associate with respect to such information (see Section 7).',
      '(e) Make available PHI in a Designated Record Set to Covered Entity as necessary to satisfy Covered Entity\'s obligations under 45 CFR 164.524. The Services provide Covered Entity with the ability to view, print and export records for this purpose.',
      '(f) Make any amendment to PHI in a Designated Record Set as directed or agreed to by Covered Entity under 45 CFR 164.526, or take other measures as necessary to satisfy Covered Entity\'s obligations under 45 CFR 164.526.',
      '(g) Maintain and make available the information required for Covered Entity to provide an accounting of disclosures as necessary to satisfy Covered Entity\'s obligations under 45 CFR 164.528.',
      '(h) To the extent Business Associate is to carry out one or more of Covered Entity\'s obligations under Subpart E of 45 CFR Part 164, comply with the requirements of Subpart E that apply to Covered Entity in the performance of such obligations.',
      '(i) Make its internal practices, books and records relating to the use and disclosure of PHI available to the Secretary for purposes of determining compliance with the HIPAA Rules.',
      '(j) Respond to requests made directly to Business Associate by an Individual for access, amendment or an accounting by forwarding the request to Covered Entity within ten (10) business days.',
      '(k) Not use PHI to train artificial intelligence or machine learning models, and not permit any Subcontractor to do so.',
    ],
  },
  {
    id: 'permitted-uses',
    heading: '3. Permitted Uses and Disclosures by Business Associate',
    paragraphs: [
      '3.1 Business Associate may use or disclose PHI as necessary to perform the services set out in the Services Agreement, including hosting, storing, processing, transmitting, transcribing and summarizing PHI at the direction of Covered Entity\'s workforce, submitting claims and eligibility transactions, and transmitting prescriptions.',
      '3.2 Business Associate may use or disclose PHI as Required By Law.',
      '3.3 Business Associate agrees to make uses, disclosures and requests for PHI consistent with Covered Entity\'s minimum necessary policies and procedures.',
      '3.4 Business Associate may provide Data Aggregation services relating to the Health Care Operations of Covered Entity only as directed by Covered Entity, and will not aggregate PHI of Covered Entity with PHI of any other customer.',
      '3.5 Business Associate may de-identify PHI in accordance with 45 CFR 164.514(a) through (c) only to operate, secure and improve the Services, and will not attempt to re-identify such information.',
      '3.6 Business Associate may not use or disclose PHI in a manner that would violate Subpart E of 45 CFR Part 164 if done by Covered Entity, except for the specific uses and disclosures set out in Sections 3.7 and 3.8.',
      '3.7 Business Associate may use PHI for the proper management and administration of Business Associate or to carry out the legal responsibilities of Business Associate.',
      '3.8 Business Associate may disclose PHI for the proper management and administration of Business Associate or to carry out its legal responsibilities, provided the disclosures are Required By Law, or Business Associate obtains reasonable assurances from the person to whom the information is disclosed that the information will remain confidential and be used or further disclosed only as Required By Law or for the purposes for which it was disclosed to the person, and the person notifies Business Associate of any instances of which it is aware in which the confidentiality of the information has been breached.',
    ],
  },
  {
    id: 'covered-entity-notices',
    heading: '4. Provisions for Covered Entity to Inform Business Associate of Privacy Practices and Restrictions',
    paragraphs: [
      '4.1 Covered Entity shall notify Business Associate of any limitation in its Notice of Privacy Practices under 45 CFR 164.520, to the extent that such limitation may affect Business Associate\'s use or disclosure of PHI.',
      '4.2 Covered Entity shall notify Business Associate of any changes in, or revocation of, the permission by an Individual to use or disclose his or her PHI, to the extent that such changes may affect Business Associate\'s use or disclosure of PHI.',
      '4.3 Covered Entity shall notify Business Associate of any restriction on the use or disclosure of PHI that Covered Entity has agreed to or is required to abide by under 45 CFR 164.522, to the extent that such restriction may affect Business Associate\'s use or disclosure of PHI.',
      '4.4 Covered Entity is responsible for configuring the Services (including user roles, access, consents and record segmentation) consistent with its own policies and these restrictions.',
    ],
  },
  {
    id: 'permissible-requests',
    heading: '5. Permissible Requests by Covered Entity',
    paragraphs: [
      'Covered Entity shall not request Business Associate to use or disclose PHI in any manner that would not be permissible under Subpart E of 45 CFR Part 164 if done by Covered Entity, except as permitted in Sections 3.4, 3.7 and 3.8.',
    ],
  },
  {
    id: 'breach-notification',
    heading: '6. Breach Notification',
    paragraphs: [
      `6.1 Following discovery of a Breach of Unsecured PHI, Business Associate shall notify Covered Entity without unreasonable delay and in no case later than ${BAA_BREACH_NOTICE_BUSINESS_DAYS} business days after discovery, and in all cases no later than sixty (60) calendar days after discovery as required by 45 CFR 164.410. A Breach is treated as discovered as of the first day on which it is known, or by exercising reasonable diligence would have been known, to any workforce member or agent of Business Associate other than the person committing the Breach.`,
      '6.2 The notice shall include, to the extent possible, the identification of each Individual whose Unsecured PHI has been, or is reasonably believed by Business Associate to have been, accessed, acquired, used or disclosed during the Breach, and any other available information that Covered Entity is required to include in notification to the Individual under 45 CFR 164.404(c). Business Associate shall supplement the notice as information becomes available.',
      '6.3 Business Associate shall reasonably cooperate with Covered Entity\'s risk assessment and with any notification to Individuals, the Secretary and the media that Covered Entity is required to make. Covered Entity remains responsible for making those notifications unless the parties agree otherwise in writing.',
      '6.4 Business Associate shall mitigate, to the extent practicable, any harmful effect known to Business Associate of a use or disclosure of PHI in violation of this Agreement.',
    ],
  },
  {
    id: 'subcontractors',
    heading: '7. Subcontractors',
    paragraphs: [
      '7.1 Business Associate shall enter into a written business associate agreement with each Subcontractor that creates, receives, maintains or transmits PHI on behalf of Business Associate. Each such agreement shall impose restrictions, conditions and requirements at least as protective as those in this Agreement, including the obligation to implement the safeguards required by Subpart C of 45 CFR Part 164, to report Security Incidents and Breaches to Business Associate, and to return or destroy PHI at termination.',
      '7.2 Business Associate\'s current Subcontractors are listed in Addendum B. Business Associate hosts the Services, and runs artificial intelligence features, on Amazon Web Services under Amazon Web Services\' business associate addendum, and uses only services that Amazon Web Services designates as eligible for use with PHI.',
      '7.3 Business Associate remains responsible to Covered Entity for the performance of its Subcontractors under this Agreement.',
    ],
  },
  {
    id: 'term-termination',
    heading: '8. Term and Termination',
    paragraphs: [
      '8.1 Term. This Agreement is effective as of the Effective Date and shall terminate when the Services Agreement terminates and all PHI has been returned or destroyed under Section 8.3, or on the date Covered Entity terminates for cause under Section 8.2, whichever is sooner.',
      '8.2 Termination for cause. Business Associate authorizes termination of this Agreement and the Services Agreement by Covered Entity if Covered Entity determines that Business Associate has violated a material term of this Agreement and Business Associate has not cured the breach or ended the violation within thirty (30) days after written notice from Covered Entity.',
      '8.3 Obligations of Business Associate upon termination. Upon termination of this Agreement for any reason, Business Associate, with respect to PHI received from Covered Entity, or created, maintained or received by Business Associate on behalf of Covered Entity, shall: (a) retain only that PHI which is necessary for Business Associate to continue its proper management and administration or to carry out its legal responsibilities; (b) make the remaining PHI available to Covered Entity for export in a readable electronic format for the period stated in the Services Agreement, and then return to Covered Entity or, if agreed by Covered Entity, destroy the remaining PHI that Business Associate still maintains in any form; (c) continue to use appropriate safeguards and comply with Subpart C of 45 CFR Part 164 with respect to electronic PHI to prevent use or disclosure of the PHI, other than as provided for in this Section, for as long as Business Associate retains the PHI; (d) not use or disclose the PHI retained by Business Associate other than for the purposes for which such PHI was retained and subject to the same conditions set out in Sections 3.7 and 3.8 which applied prior to termination; and (e) return to Covered Entity or destroy the PHI retained by Business Associate when it is no longer needed by Business Associate for its proper management and administration or to carry out its legal responsibilities.',
      '8.4 Where return or destruction of PHI is infeasible (for example, PHI held in encrypted backups until they expire, or audit records Business Associate must keep under law), Business Associate shall extend the protections of this Agreement to that PHI and limit further uses and disclosures to those purposes that make return or destruction infeasible, for so long as Business Associate maintains the PHI.',
      '8.5 Survival. The obligations of Business Associate under this Section 8 and under Addendum A survive termination of this Agreement.',
    ],
  },
  {
    id: 'miscellaneous',
    heading: '9. Miscellaneous',
    paragraphs: [
      '9.1 Regulatory references. A reference in this Agreement to a section in the HIPAA Rules or Part 2 means the section as in effect or as amended.',
      '9.2 Amendment. The parties agree to take such action as is necessary to amend this Agreement from time to time as is necessary to comply with the requirements of the HIPAA Rules, Part 2 and any other applicable law. Business Associate will publish any amended version with a new version identifier and ask Covered Entity to accept it.',
      '9.3 Interpretation. Any ambiguity in this Agreement shall be interpreted to permit compliance with the HIPAA Rules and Part 2. If this Agreement conflicts with the Services Agreement, this Agreement controls with respect to PHI.',
      '9.4 No third-party beneficiaries. Nothing in this Agreement confers on any person other than the parties any rights, remedies, obligations or liabilities.',
      '9.5 Electronic acceptance. This Agreement is accepted electronically by an individual who represents that he or she is authorized to bind Covered Entity. Electronic acceptance has the same effect as a handwritten signature. Business Associate records the name, title and email address of the person accepting, the agreement version, a cryptographic fingerprint of the agreement text, the date and time, and the network address and browser used, and makes that record available to Covered Entity\'s administrators.',
    ],
  },
  {
    id: 'addendum-a-part2',
    heading: 'Addendum A. 42 CFR Part 2 Qualified Service Organization Agreement',
    paragraphs: [
      'A.1 This Addendum applies where Covered Entity is, or includes, a federally assisted program subject to 42 CFR Part 2 ("Program"). For the services described in the Services Agreement (data processing, hosting, billing, and other professional services), Business Associate is a qualified service organization ("QSO") of the Program as defined in 42 CFR 2.11, and this Addendum is a qualified service organization agreement under 42 CFR 2.11 and 2.12(c)(4).',
      'A.2 Business Associate acknowledges that in receiving, storing, processing or otherwise dealing with any patient records from the Program, it is fully bound by the provisions of 42 CFR Part 2.',
      'A.3 If necessary, Business Associate will resist in judicial proceedings any efforts to obtain access to patient identifying information related to substance use disorder diagnosis, treatment or referral for treatment except as permitted by 42 CFR Part 2.',
      'A.4 Business Associate will use and disclose Part 2 records only to provide services to the Program, will not redisclose Part 2 records except back to the Program or as permitted by 42 CFR Part 2 (including to a contract agent or Subcontractor that agrees in writing to be bound by Part 2 for the same services), and will not use Part 2 records in any civil, criminal, administrative or legislative proceeding against the patient.',
      'A.5 Business Associate will maintain the Part 2 records with the safeguards required by 42 CFR 2.16, will support the Program\'s consent requirements by honoring the consent and segmentation settings configured in the Services, and will notify the Program of any Breach of Part 2 records in the same manner and time as Section 6.',
      'A.6 Each disclosure of Part 2 records made with the patient\'s written consent that Business Associate transmits on the Program\'s instruction will carry the notice required by 42 CFR 2.32 where the Services support it.',
    ],
  },
  {
    id: 'addendum-b-subcontractors',
    heading: 'Addendum B. Subcontractors',
    paragraphs: [
      'Amazon Web Services, Inc.: cloud hosting, storage, backup, messaging, transcription and artificial intelligence services (including Amazon Bedrock), under the Amazon Web Services business associate addendum.',
      'Business Associate will keep this list current at the /legal/baa page and give Covered Entity notice of any new Subcontractor that will have access to PHI.',
    ],
  },
];

/** The agreement as plain text: what is hashed at acceptance and what admins download. */
export function baaPlainText(): string {
  const parts = [`${BAA_TITLE}`, `Version ${BAA_VERSION}`, '', ...BAA_PREAMBLE, ''];
  for (const s of BAA_SECTIONS) {
    parts.push(s.heading, ...s.paragraphs, '');
  }
  return parts.join('\n').trim() + '\n';
}

/**
 * AOT Complaint/Incident Report (MDH BHA complaint form, revised 06/25/2026).
 * Staff submit the signed report to bha.aotpetitions@maryland.gov themselves; Altrixs sends nothing.
 */
import {
  REVISED,
  YES_NO_UNKNOWN,
  buildSchema,
  has,
  is,
  missingItems,
  opts,
  rows,
  type CustomRule,
  type FormData,
  type FormDefinition,
  type SectionSpec,
} from './engine';
import { AOT_STAFF_SIGN_ROLES } from './roles';

export const COMPLAINT_SUBMIT_TO = 'bha.aotpetitions@maryland.gov';

export const COMPLAINT_ROUTING_NOTES = [
  'This form is for complaints and incidents related to the Maryland AOT program.',
  'It is not for grievances about programs licensed under COMAR 10.63: use the BHA COMAR 10.63 complaint form.',
  'Complaints about an individual clinician go to the appropriate licensing board.',
  'Complaints about a hospital, FQHC or residential facility go to the Office of Health Care Quality (OHCQ).',
  'This form does not replace mandatory reporting to law enforcement, Adult Protective Services (APS), Child Protective Services (CPS) or licensing boards.',
];

export const CONFIDENTIALITY_NOTICE =
  'CONFIDENTIALITY NOTICE: This document contains confidential information. Disclosure of any information therein could be a violation of Maryland Confidentiality of Medical Records Law. REDISCLOSURE IS STRICTLY PROHIBITED unless made pursuant to HG 4-302(d) of the Annotated Code of Maryland.';

export const CERTIFICATION_TEXT = 'I certify that the information contained in this report is true and complete to the best of my knowledge.';

export const MANDATORY_REPORTING_PROMPT = 'Mandatory reporting is separate from this report — confirm it was made.';

export const REPORTER_ROLES = opts([
  ['cct_staff', 'AOT CCT staff'],
  ['provider', 'Provider'],
  ['family', 'Family Member'],
  ['participant', 'Participant/Respondent'],
  ['attorney', 'Attorney'],
  ['court', 'Judge/Court Staff'],
  ['hospital', 'Hospital'],
  ['law_enforcement', 'Law Enforcement'],
  ['community', 'Community Member'],
  ['other', 'Other'],
]);

/**
 * Region list as printed on the MDH form. Prefilled from the participant's county when it maps to an MDH CCT
 * region (src/lib/aot/mdh.ts countyToCctRegion); otherwise staff pick it. Always editable.
 */
export const COMPLAINT_REGIONS = opts([
  ['anne_arundel', 'Anne Arundel'],
  ['baltimore_city', 'Baltimore City'],
  ['eastern_shore', 'Eastern Shore'],
  ['phase_ii', 'Phase II Region'],
  ['other', 'Other'],
]);

export const AOT_STATUS_OPTIONS = opts([
  ['pending_petition', 'Pending Petition'],
  ['active_order', 'Active AOT Order'],
  ['voluntary_agreement', 'Voluntary Agreement'],
  ['discharged', 'Discharged'],
]);

export const COMPLAINT_TYPES = opts([
  ['cct_issue', 'Care Coordination Team Issue'],
  ['plan_development', 'Development of Treatment Plan'],
  ['plan_implementation', 'Failure to Implement Treatment Plan'],
  ['service_access', 'Access to Recommended Services'],
  ['rights', 'Participant Rights Concern'],
  ['communication', 'Communication Concern'],
  ['conflict_of_interest', 'Conflict of Interest (including dual relationships)'],
]);

export const NOTIFICATION_PARTIES = [
  'MDH AOT Regional Coordinator',
  'MDH AOT Program Director',
  'CCT Program Director',
  'Treating Psychiatrist',
  'Case Manager',
  'CPRS',
  "Participant's Attorney",
  'Guardian',
  'Family Member',
  'Hospital',
  'Law Enforcement',
  'APS',
  'CPS',
  'Local Health Department',
  'Other',
];

/** Parties whose notification is a mandatory report in its own right */
export const MANDATORY_REPORT_PARTIES = ['Law Enforcement', 'APS', 'CPS'];

export const ATTACHMENT_OPTIONS = opts([
  ['incident_reports', 'Incident Reports'],
  ['medical', 'Medical Documentation'],
  ['police', 'Police Reports'],
  ['witness', 'Witness Statements'],
  ['treatment_plan', 'Treatment Plan'],
  ['court', 'Court Documents'],
  ['photographs', 'Photographs'],
  ['other', 'Other'],
]);

const yes = (k: string) => (d: FormData) => is(d, k, 'yes');

export const COMPLAINT_SECTIONS: SectionSpec[] = [
  {
    id: 'reporter',
    title: 'Section I. Reporter information',
    fields: [
      { key: 'trackingNumber', label: 'Internal tracking #', type: 'text', help: 'Altrixs incident number, e.g. INC-2026-004.' },
      { key: 'reportDate', label: 'Date of report', type: 'date', required: true },
      { key: 'reporterName', label: 'Name', type: 'text', required: true },
      { key: 'reporterOrg', label: 'Organization/agency', type: 'text', required: true },
      { key: 'reporterRole', label: 'Title/role', type: 'radio', options: REPORTER_ROLES, required: true },
      { key: 'reporterRoleOther', label: 'Other title/role', type: 'text', showIf: (d) => is(d, 'reporterRole', 'other'), required: (d) => is(d, 'reporterRole', 'other') },
      { key: 'phoneCell', label: 'Telephone (cell)', type: 'tel' },
      { key: 'phoneBusiness', label: 'Telephone (business)', type: 'tel' },
      { key: 'reporterEmail', label: 'Email', type: 'email' },
      { key: 'mayContact', label: 'May MDH contact you about this report?', type: 'yesno', required: true },
    ],
  },
  {
    id: 'participant',
    title: 'Section II. Participant information',
    fields: [
      { key: 'participantName', label: 'Name', type: 'text', required: true },
      { key: 'participantAlias', label: 'Alias', type: 'text' },
      { key: 'participantDob', label: 'Date of birth', type: 'date' },
      { key: 'region', label: 'Region', type: 'radio', options: COMPLAINT_REGIONS, required: true, help: "Prefilled from the participant's county when it is in an MDH CCT region (Baltimore City, Anne Arundel, Eastern Shore). Phase II / other: select manually." },
      { key: 'regionOther', label: 'Other region', type: 'text', showIf: (d) => is(d, 'region', 'other') },
      { key: 'county', label: 'County', type: 'text' },
      { key: 'aotStatus', label: 'Current AOT status', type: 'radio', options: AOT_STATUS_OPTIONS, required: true },
    ],
  },
  {
    id: 'type',
    title: 'Section III. Type of complaint/incident (check all that apply)',
    fields: [{ key: 'complaintTypes', label: 'Type', type: 'checkboxes', options: COMPLAINT_TYPES }],
  },
  {
    id: 'description',
    title: 'Section IV. Description of the complaint/incident',
    fields: [
      { key: 'incidentDate', label: 'Date of incident', type: 'date', required: true },
      { key: 'incidentTime', label: 'Time of incident', type: 'time' },
      { key: 'location', label: 'Location', type: 'text', required: true },
      { key: 'individualsInvolved', label: 'Individuals involved', type: 'textarea' },
      { key: 'whatOccurred', label: 'What occurred', type: 'textarea', required: true },
      { key: 'witnesses', label: 'Witnesses', type: 'textarea' },
      { key: 'lawEnforcement', label: 'Was law enforcement contacted?', type: 'yesno', required: true },
      { key: 'lawEnforcementAgency', label: 'Agency', type: 'text', showIf: yes('lawEnforcement'), required: yes('lawEnforcement') },
      { key: 'emergencyMedical', label: 'Was emergency medical assistance provided?', type: 'yesno', required: true },
      { key: 'sentToHospital', label: 'Was the participant sent to a hospital?', type: 'yesnounknown', options: YES_NO_UNKNOWN, required: true },
      { key: 'hospitalName', label: 'Hospital name', type: 'text', showIf: yes('sentToHospital') },
      { key: 'admitted', label: 'Was the participant admitted?', type: 'yesnounknown', options: YES_NO_UNKNOWN, showIf: yes('sentToHospital') },
      { key: 'admittedName', label: 'Admitting facility', type: 'text', showIf: yes('admitted') },
    ],
  },
  {
    id: 'actions',
    title: 'Section V. Actions',
    fields: [
      { key: 'immediateActions', label: 'Immediate actions taken', type: 'textarea', required: true },
      { key: 'lessonsLearned', label: 'Lessons learned and steps to improve / reduce the risk of a repeat', type: 'textarea' },
    ],
  },
  {
    id: 'notifications',
    title: 'Section VI. Notifications',
    fields: [
      {
        key: 'notifications',
        label: 'Parties notified',
        type: 'table',
        fixedRows: true,
        rowKey: 'notified',
        columns: [
          { key: 'party', label: 'Party', type: 'text', readonly: true },
          { key: 'notified', label: 'Notified', type: 'checkbox' },
          { key: 'date', label: 'Date', type: 'date' },
        ],
        defaultRows: NOTIFICATION_PARTIES.map((party) => ({ party, notified: false, date: '' })),
      },
      { key: 'notificationOther', label: 'Other party notified (specify)', type: 'text' },
      {
        key: 'mandatoryReportingConfirmed',
        label: `${MANDATORY_REPORTING_PROMPT} I confirm the required mandatory reports (law enforcement / APS / CPS) were made.`,
        type: 'checkbox',
        showIf: (d) => mandatoryReportingTriggered(d),
        required: (d) => mandatoryReportingTriggered(d),
      },
    ],
  },
  {
    id: 'attachments',
    title: 'Section VII. Attachments',
    fields: [
      { key: 'attachments', label: 'Attachments', type: 'checkboxes', options: ATTACHMENT_OPTIONS },
      { key: 'attachmentsOther', label: 'Other attachment (specify)', type: 'text', showIf: (d) => has(d, 'attachments', 'other') },
      { key: 'certificationText', label: '', type: 'static', text: CERTIFICATION_TEXT },
    ],
  },
];

/** APS, CPS or law enforcement checked anywhere on the report. */
export function mandatoryReportingTriggered(d: FormData): boolean {
  if (is(d, 'lawEnforcement', 'yes')) return true;
  return rows(d, 'notifications').some((r) => r.notified === true && MANDATORY_REPORT_PARTIES.includes(String(r.party)));
}

export const COMPLAINT_RULES: CustomRule[] = [
  {
    id: 'type_required',
    check: (d) => (Array.isArray(d?.complaintTypes) && (d.complaintTypes as unknown[]).length > 0 ? null : 'Section III: check at least one type of complaint/incident'),
  },
  {
    id: 'notification_dates',
    check: (d) => {
      const missing = rows(d, 'notifications').filter((r) => r.notified === true && !r.date).map((r) => String(r.party));
      return missing.length ? `Section VI: enter the notification date for ${missing.join(', ')}` : null;
    },
  },
];

export const COMPLAINT: FormDefinition = {
  type: 'complaint',
  title: 'AOT Complaint/Incident Report',
  mdhNumber: null,
  revised: REVISED,
  purpose: `Complaint or incident report for the MDH Behavioral Health Administration. Staff submit the signed report to ${COMPLAINT_SUBMIT_TO}.`,
  sections: COMPLAINT_SECTIONS,
  rules: COMPLAINT_RULES,
  signers: [{ id: 'reporter', label: 'Reporter certification', roles: AOT_STAFF_SIGN_ROLES, roleHint: 'AOT clinical staff' }],
  attestation: CERTIFICATION_TEXT,
  multiInstance: true,
};

export const complaintSchema = buildSchema(COMPLAINT_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(COMPLAINT, data);
}

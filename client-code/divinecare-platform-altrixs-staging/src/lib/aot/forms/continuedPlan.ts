/**
 * Plan for Continued Treatment — completed by the Care Coordination Team before the order expires
 * (due at least 30 days before the order end date; see deadlines.ts). Each CCT signer signs their own line.
 */
import { REVISED, buildSchema, is, missingItems, opts, type FormData, type FormDefinition, type SectionSpec } from './engine';
import { AOT_STAFF_SIGN_ROLES, CASE_MANAGER_ROLES, PSYCHIATRIST_ROLES } from './roles';

const no = (k: string) => (d: FormData) => is(d, k, 'no');

export const CONTINUED_PLAN_SECTIONS: SectionSpec[] = [
  {
    id: 'program',
    title: 'Program information',
    fields: [
      { key: 'originalReferralDate', label: 'Date of original referral', type: 'date', required: true },
      { key: 'planCompletionDate', label: 'Date of plan completion', type: 'date', required: true },
      { key: 'participantIdNumber', label: 'Participant ID', type: 'text', required: true, help: 'The ID assigned by the Regional AOT Program.' },
      { key: 'regionalProgram', label: 'Regional AOT Program', type: 'text', required: true },
      { key: 'cctContact', label: 'CCT contact information', type: 'textarea', required: true },
    ],
  },
  {
    id: 'participant',
    title: 'Participant information',
    fields: [
      { key: 'firstName', label: 'First name', type: 'text', required: true },
      { key: 'middleInitial', label: 'MI', type: 'text', max: 4 },
      { key: 'lastName', label: 'Last name', type: 'text', required: true },
      { key: 'aka', label: 'AKA', type: 'text' },
      { key: 'dob', label: 'Date of birth', type: 'date', required: true },
      { key: 'phone', label: 'Phone', type: 'tel' },
      {
        key: 'bestContact',
        label: 'Best way to contact',
        type: 'radio',
        options: opts([
          ['text', 'Text'],
          ['call', 'Call'],
          ['other', 'Other'],
        ]),
      },
      { key: 'bestContactOther', label: 'Other contact method', type: 'text', showIf: (d) => is(d, 'bestContact', 'other') },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Primary address / cross streets', type: 'text' },
      { key: 'apt', label: 'Apt', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'zip', label: 'ZIP', type: 'text' },
    ],
  },
  {
    id: 'diagnoses',
    title: 'Diagnoses',
    fields: [
      { key: 'diagnosesSame', label: 'Diagnoses are the same as in the treatment plan', type: 'yesno', required: true },
      { key: 'diagnosisChanges', label: 'Changes', type: 'textarea', showIf: no('diagnosesSame'), required: no('diagnosesSame') },
    ],
  },
  {
    id: 'hrsn',
    title: 'Health-related social needs (HRSN)',
    fields: [
      { key: 'hrsnSame', label: 'HRSN are the same as previously identified', type: 'yesno', required: true },
      { key: 'hrsnInterventions', label: 'Interventions', type: 'textarea', required: no('hrsnSame') },
      {
        key: 'hrsnTracker',
        label: 'HRSN tracker',
        type: 'table',
        rowKey: 'barrier',
        columns: [
          { key: 'barrier', label: 'Barrier', type: 'text' },
          { key: 'intervention', label: 'Intervention', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
    ],
  },
  {
    id: 'goals',
    title: 'Goals',
    fields: [{ key: 'goalChanges', label: 'Goal changes / updates', type: 'textarea', required: true }],
  },
  {
    id: 'services',
    title: 'Services and providers',
    fields: [
      { key: 'servicesSame', label: 'Services and providers are the same', type: 'yesno', required: true },
      { key: 'servicesChanges', label: 'Changes', type: 'textarea', showIf: no('servicesSame'), required: no('servicesSame') },
    ],
  },
];

export const CONTINUED_TREATMENT_PLAN: FormDefinition = {
  type: 'continued_treatment_plan',
  title: 'Plan for Continued Treatment',
  mdhNumber: null,
  revised: REVISED,
  purpose: 'Completed by the Care Coordination Team prior to the expiration of the AOT order.',
  sections: CONTINUED_PLAN_SECTIONS,
  rules: [],
  signers: [
    { id: 'psychiatrist', label: 'CCT psychiatrist', roles: PSYCHIATRIST_ROLES, allowMedicalDirector: true, askTitle: true, roleHint: 'Psychiatrist or the Medical Director' },
    { id: 'case_manager', label: 'CCT case manager', roles: CASE_MANAGER_ROLES, askTitle: true, roleHint: 'Case manager' },
    { id: 'staff', label: 'Staff', roles: AOT_STAFF_SIGN_ROLES, askTitle: true, roleHint: 'AOT clinical staff' },
  ],
  attestation: 'I reviewed this Plan for Continued Treatment and its contents are true and complete to the best of my knowledge. This electronic signature is my signature.',
  // One plan per order period (each renewal gets its own plan); corrections are amendments.
  multiInstance: true,
};

export const continuedPlanSchema = buildSchema(CONTINUED_PLAN_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(CONTINUED_TREATMENT_PLAN, data);
}

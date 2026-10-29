/**
 * Notification of Petition for Emergency Evaluation — MDH#0003BHA (revised 06/25/2026).
 * Signing it also records the emergency petition as an escalation event on the participant.
 */
import { REVISED, buildSchema, missingItems, type FormData, type FormDefinition, type SectionSpec } from './engine';
import { AOT_STAFF_SIGN_ROLES } from './roles';

export const EP_SECTIONS: SectionSpec[] = [
  {
    id: 'program',
    title: 'I. Regional AOT Program',
    fields: [
      { key: 'regionalProgram', label: 'Regional AOT Program', type: 'text', required: true },
      { key: 'cctContact', label: 'Care Coordination Team (CCT) contact information', type: 'textarea', required: true },
    ],
  },
  {
    id: 'participant',
    title: 'II. Participant and emergency petition',
    fields: [
      { key: 'participantName', label: 'Participant name', type: 'text', required: true },
      { key: 'participantDob', label: 'Date of birth', type: 'date', required: true },
      { key: 'epDate', label: 'Date of emergency petition', type: 'date', required: true },
      { key: 'reasons', label: 'Reasons for evaluation', type: 'textarea', required: true },
      { key: 'findings', label: 'Findings of evaluation', type: 'textarea', required: true },
      { key: 'staffTitle', label: 'Staff title', type: 'text', required: true, help: 'Staff name, signature and date are applied when you sign.' },
    ],
  },
];

export const EP_NOTIFICATION: FormDefinition = {
  type: 'ep_notification',
  title: 'Notification of Petition for Emergency Evaluation',
  mdhNumber: 'MDH#0003BHA',
  revised: REVISED,
  purpose: 'Notifies the Regional AOT Program that an emergency petition for evaluation was filed for an AOT participant.',
  sections: EP_SECTIONS,
  rules: [],
  signers: [{ id: 'staff', label: 'Staff signature', roles: AOT_STAFF_SIGN_ROLES, roleHint: 'AOT clinical staff' }],
  attestation: 'I reviewed this notification and its contents are true and complete to the best of my knowledge. This electronic signature is my signature.',
  multiInstance: true,
};

export const epNotificationSchema = buildSchema(EP_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(EP_NOTIFICATION, data);
}

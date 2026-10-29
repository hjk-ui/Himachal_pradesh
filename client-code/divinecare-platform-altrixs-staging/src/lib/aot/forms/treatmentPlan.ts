/**
 * AOT Treatment Plan — MDH#0001BHA (revised 06/25/2026). Field list: docs/source-forms/md-aot-forms-2026-06-25.md.
 */
import {
  REVISED,
  YES_NO_UNKNOWN,
  arr,
  buildSchema,
  has,
  is,
  isEmptyValue,
  missingItems,
  opts,
  rows,
  str,
  type CustomRule,
  type FormData,
  type FormDefinition,
  type SectionSpec,
} from './engine';
import { PSYCHIATRIST_ROLES } from './roles';

export const SPMI_DEFINITION =
  'a mental illness that is severe in degree and persistent in duration, that causes a substantially diminished level of functioning in the primary aspects of daily living and an inability to meet the ordinary demands of life, and that may lead to an inability to maintain independent functioning in the community without intensive treatment and support';

export const DISABILITY_OPTIONS = opts([
  ['none', 'None'],
  ['deaf_hoh', 'Deaf/Hard of Hearing'],
  ['blind_visual', 'Blind/Visual Impairment'],
  ['mobility', 'Mobility Disability'],
  ['add_adhd', 'ADD/ADHD'],
  ['autism', 'Autism Spectrum Disorder'],
  ['tbi', 'Traumatic Brain Injury'],
  ['idd', 'Intellectual/Developmental Disabilities'],
  ['neuro_cognitive', 'Neurological condition with cognitive impairment'],
  ['manual_dexterity', 'Manual Dexterity Disability'],
  ['learning_reading', 'Learning disabilities or below 8th grade reading level'],
  ['language', 'Non-native English speaker or other language barriers'],
  ['other', 'Other (specify)'],
]);

export const LIVING_SITUATION_OPTIONS = opts([
  ['homeless', 'Homeless'],
  ['correctional', 'Correctional facility'],
  ['psych_inpatient', 'Psychiatric inpatient facility'],
  ['residential_treatment', 'Residential treatment facility'],
  ['halfway_house', 'Halfway house/transitional housing'],
  ['recovery_residence', 'Recovery residence'],
  ['board_care_group', 'Board and care or group home'],
  ['permanent_supportive', 'Permanent supportive housing'],
  ['lease_based', 'Lease-based housing (incl. HUD/subsidized)'],
  ['relationship_no_lease', 'Relationship-based housing without lease'],
  ['homeowner', 'Homeowner'],
  ['other', 'Other (specify)'],
  ['unknown', 'Unknown'],
]);

export const HOMELESS_SETTING_OPTIONS = opts([
  ['street', 'Street/outdoors'],
  ['shelter', 'Shelter'],
  ['safe_haven', 'Safe havens'],
  ['transitional_center', 'Transitional living center'],
  ['low_demand', 'Low-demand facility'],
  ['reception_center', 'Reception center'],
  ['temp_day_evening', 'Other temporary day/evening facility'],
]);

const PROBLEMS_NONE_UNKNOWN = opts([
  ['problems', 'Problems identified (describe)'],
  ['none', 'None'],
  ['unknown', 'Unknown'],
]);

export const INCOME_OPTIONS = opts([
  ['ssi', 'SSI'],
  ['ssdi', 'SSDI'],
  ['tdap', 'TDAP'],
  ['va', 'VA benefits'],
  ['employment', 'Employment earnings'],
  ['hcv', 'Housing Choice Voucher'],
  ['other', 'Other income'],
  ['unknown', 'Unknown'],
]);

export const INSURANCE_OPTIONS = opts([
  ['medicare', 'Medicare'],
  ['medicaid', 'Medicaid'],
  ['private', 'Private/Employer'],
  ['tricare', 'TRICARE/military'],
  ['map', 'Assistance program (Medication Assistance Program)'],
  ['other', 'Other'],
  ['none', 'None'],
  ['unknown', 'Unknown'],
]);

export const GOAL_AREAS = [
  'Somatic Health',
  'Education',
  'Employment',
  'Housing/Living Arrangements',
  'Finances',
  'Benefits',
  'Family',
  'Relationships',
];

export const SERVICE_TYPE_OPTIONS = opts([
  ['act', 'Assertive Community Treatment (ACT)'],
  ['psychiatrist', 'Psychiatrist Services'],
  ['case_management', 'Case Management'],
  ['cprs', 'CPRS Services'],
  ['additional', 'Additional service type'],
]);

export const ACT_TEAM_OPTIONS = opts([
  ['psychiatrist', 'Psychiatrist'],
  ['case_manager', 'Case manager'],
  ['cprs', 'CPRS'],
]);

const PARTICIPATION = opts([
  ['yes', 'Yes'],
  ['none_identified', 'None identified'],
]);

const yes = (k: string) => (d: FormData) => is(d, k, 'yes');
const medsIncluded = yes('medicationIncluded');

export const TREATMENT_PLAN_SECTIONS: SectionSpec[] = [
  {
    id: 'plan',
    title: 'Plan information',
    fields: [
      { key: 'psychiatristName', label: 'Name of testifying psychiatrist', type: 'text', required: true },
      { key: 'planCompletionDate', label: 'Date of plan completion', type: 'date', required: true },
      { key: 'representedByCounsel', label: 'Respondent is represented by counsel', type: 'yesno', required: true },
      { key: 'counselName', label: 'Counsel name', type: 'text', showIf: yes('representedByCounsel'), required: yes('representedByCounsel') },
      { key: 'counselOffice', label: 'Counsel office', type: 'text', showIf: yes('representedByCounsel') },
      { key: 'hasHealthCareAgent', label: 'Respondent has a health care agent', type: 'yesno', required: true },
      { key: 'healthCareAgentName', label: 'Health care agent name', type: 'text', showIf: yes('hasHealthCareAgent'), required: yes('hasHealthCareAgent') },
      { key: 'hasLegalGuardian', label: 'Respondent has a legal guardian', type: 'yesno', required: true },
      { key: 'legalGuardianName', label: 'Legal guardian name', type: 'text', showIf: yes('hasLegalGuardian'), required: yes('hasLegalGuardian') },
      {
        key: 'currentProviders',
        label: 'Current behavioral health treatment providers',
        type: 'table',
        columns: [
          { key: 'organization', label: 'Organization name', type: 'text' },
          { key: 'type', label: 'Type', type: 'text' },
        ],
        rowKey: 'organization',
      },
    ],
  },
  {
    id: 'respondent',
    title: 'Respondent information',
    fields: [
      { key: 'firstName', label: 'First name', type: 'text', required: true },
      { key: 'lastName', label: 'Last name', type: 'text', required: true },
      { key: 'alias', label: 'Alias', type: 'text' },
      { key: 'dob', label: 'Date of birth', type: 'date', required: true },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'street', label: 'Street address', type: 'text' },
      { key: 'unit', label: 'Apt/Floor/Bldg', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'zip', label: 'ZIP', type: 'text' },
    ],
  },
  {
    id: 'diagnostic',
    title: 'Diagnostic information',
    fields: [
      {
        key: 'spmi',
        num: '1',
        label: 'Does the respondent have a "serious and persistent mental illness" as defined in Health-General §10-6A-01?',
        type: 'yesno',
        required: true,
        help: `"Serious and persistent mental illness" means ${SPMI_DEFINITION}.`,
      },
      { key: 'spmiHow', num: '1a', label: 'How the criteria are met', type: 'textarea', showIf: yes('spmi'), required: yes('spmi') },
      {
        key: 'diagnoses',
        num: '2',
        label: 'Diagnoses and how each was determined',
        type: 'table',
        required: true,
        rowKey: 'diagnosis',
        columns: [
          { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
          { key: 'code', label: 'ICD-10 code', type: 'text' },
          {
            key: 'determinedBy',
            label: 'How determined',
            type: 'select',
            options: opts([
              ['direct_evaluation', 'Direct evaluation'],
              ['records', 'Records'],
              ['both', 'Direct evaluation and records'],
            ]),
          },
        ],
      },
      { key: 'somaticConditions', num: '3', label: 'Other somatic conditions or disabilities', type: 'textarea' },
    ],
  },
  {
    id: 'engagement',
    title: 'Engagement',
    fields: [
      {
        key: 'engagementEfforts',
        num: '1',
        label: 'Describe all efforts made to engage the respondent, including feedback, concerns and barriers',
        type: 'textarea',
        required: true,
      },
      {
        key: 'educationProvided',
        num: '2',
        label: 'Was the respondent provided education and materials about the steps of the process and their rights under an AOT order?',
        type: 'yesno',
        required: true,
      },
      {
        key: 'educationMaterials',
        label: 'Materials provided and efforts to make them accessible',
        type: 'textarea',
        showIf: yes('educationProvided'),
        required: yes('educationProvided'),
      },
      { key: 'disabilities', num: '3', label: 'Disabilities', type: 'checkboxes', options: DISABILITY_OPTIONS, required: true },
      { key: 'disabilityOther', label: 'Other disability (specify)', type: 'text', showIf: (d) => has(d, 'disabilities', 'other'), required: (d) => has(d, 'disabilities', 'other') },
      {
        key: 'accommodations',
        label: 'Accommodations provided',
        type: 'textarea',
        showIf: (d) => arr(d, 'disabilities').some((x) => x !== 'none'),
        required: (d) => arr(d, 'disabilities').some((x) => x !== 'none'),
      },
      { key: 'cprsAvailable', num: '4', label: 'Was the respondent available and willing to meet with a CPRS?', type: 'yesno', required: true },
      { key: 'cprsDates', num: '4a', label: 'Dates of meetings with the CPRS', type: 'text', showIf: yes('cprsAvailable'), required: yes('cprsAvailable') },
      { key: 'caseManagerAvailable', num: '5', label: 'Was the respondent available and willing to meet with a case manager?', type: 'yesno', required: true },
      { key: 'caseManagerDates', num: '5a', label: 'Dates of meetings with the case manager', type: 'text', showIf: yes('caseManagerAvailable'), required: yes('caseManagerAvailable') },
      { key: 'psychiatristAvailable', num: '6', label: 'Was the respondent available and willing to meet with the psychiatrist?', type: 'yesno', required: true },
      { key: 'psychiatristExamDates', num: '6a', label: 'Examination dates', type: 'text', showIf: yes('psychiatristAvailable'), required: yes('psychiatristAvailable') },
      { key: 'static7', label: '', type: 'static', num: '7', text: 'Individuals given a reasonable opportunity to participate in the development of the plan:' },
      { key: 'guardianParticipation', label: 'Guardian', type: 'radio', options: PARTICIPATION, required: true },
      { key: 'healthCareAgentParticipation', label: 'Health care agent', type: 'radio', options: PARTICIPATION, required: true },
      { key: 'otherDesignatedParticipation', label: 'Other individual designated by the respondent', type: 'radio', options: PARTICIPATION, required: true },
      {
        key: 'participants',
        label: 'Names and relationships',
        type: 'table',
        rowKey: 'name',
        columns: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'relationship', label: 'Relationship', type: 'text' },
        ],
        showIf: (d) => ['guardianParticipation', 'healthCareAgentParticipation', 'otherDesignatedParticipation'].some((k) => is(d, k, 'yes')),
        required: (d) => ['guardianParticipation', 'healthCareAgentParticipation', 'otherDesignatedParticipation'].some((k) => is(d, k, 'yes')),
      },
      { key: 'supportEngagementMethods', num: '8', label: 'Methods used to engage these individuals', type: 'textarea' },
      { key: 'supportNetworkInput', num: '9', label: 'Input received from the support network', type: 'textarea' },
    ],
  },
  {
    id: 'hrsn',
    title: 'Health-related social needs (HRSN)',
    fields: [
      { key: 'livingSituation', num: '10', label: 'Current living situation', type: 'radio', options: LIVING_SITUATION_OPTIONS, required: true },
      {
        key: 'homelessSetting',
        label: 'Homeless setting',
        type: 'select',
        options: HOMELESS_SETTING_OPTIONS,
        showIf: (d) => is(d, 'livingSituation', 'homeless'),
      },
      { key: 'livingSituationOther', label: 'Other living situation (specify)', type: 'text', showIf: (d) => is(d, 'livingSituation', 'other'), required: (d) => is(d, 'livingSituation', 'other') },
      { key: 'exitForecast', num: '11', label: 'Is there a forecasted exit date?', type: 'yesno' },
      { key: 'exitDate', label: 'Forecasted exit date', type: 'date', showIf: yes('exitForecast'), required: yes('exitForecast') },
      { key: 'anticipatedHousing', label: 'Anticipated housing', type: 'text', showIf: yes('exitForecast') },
      { key: 'transportation', num: '12', label: 'Transportation (describe)', type: 'textarea' },
      { key: 'transportationProblems', label: 'Transportation problems', type: 'radio', options: PROBLEMS_NONE_UNKNOWN, required: true },
      { key: 'transportationProblemsDescribe', label: 'Describe the transportation problems', type: 'textarea', showIf: (d) => is(d, 'transportationProblems', 'problems'), required: (d) => is(d, 'transportationProblems', 'problems') },
      { key: 'foodProblems', num: '13', label: 'Food security', type: 'radio', options: PROBLEMS_NONE_UNKNOWN, required: true },
      { key: 'foodProblemsDescribe', label: 'Describe the food security problems', type: 'textarea', showIf: (d) => is(d, 'foodProblems', 'problems'), required: (d) => is(d, 'foodProblems', 'problems') },
      { key: 'snap', num: '13a', label: 'Receives SNAP', type: 'yesnounknown', options: YES_NO_UNKNOWN, required: true },
      { key: 'incomeSources', num: '14', label: 'Income and benefits', type: 'checkboxes', options: INCOME_OPTIONS, required: true },
      { key: 'incomeSsiAmount', label: 'SSI amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'ssi') },
      { key: 'incomeSsdiAmount', label: 'SSDI amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'ssdi') },
      { key: 'incomeTdapAmount', label: 'TDAP amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'tdap') },
      { key: 'incomeVaAmount', label: 'VA amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'va') },
      { key: 'incomeEmploymentAmount', label: 'Employment earnings amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'employment') },
      { key: 'incomeOtherAmount', label: 'Other income amount', type: 'amount', showIf: (d) => has(d, 'incomeSources', 'other') },
      { key: 'averageMonthlyIncome', num: '14b', label: 'Average monthly income', type: 'amount' },
      { key: 'insurance', num: '15', label: 'Insurance', type: 'checkboxes', options: INSURANCE_OPTIONS, required: true },
      { key: 'insuranceOther', label: 'Other insurance (specify)', type: 'text', showIf: (d) => has(d, 'insurance', 'other') },
      {
        key: 'hrsnPlan',
        num: '16',
        label: 'How each HRSN was reviewed and addressed, and the plan to maintain support (or why no action was taken)',
        type: 'textarea',
        required: true,
      },
    ],
  },
  {
    id: 'advance',
    title: 'Advance directives',
    fields: [
      { key: 'mhAdvanceDirective', num: '17', label: 'Does the respondent have a valid MENTAL health advance directive?', type: 'yesno', required: true },
      { key: 'mhAdvanceDirectiveHonored', label: 'How the directive will be honored', type: 'textarea', showIf: yes('mhAdvanceDirective'), required: yes('mhAdvanceDirective') },
      { key: 'mhAdvanceDirectiveConflicts', num: '17a', label: 'Conflicts with the proposed plan', type: 'textarea', showIf: yes('mhAdvanceDirective') },
      { key: 'medicalAdvanceDirective', num: '18', label: 'Does the respondent have a valid advance medical directive?', type: 'yesno', required: true },
      { key: 'medicalAdvanceDirectiveHonored', label: 'How the directive will be honored', type: 'textarea', showIf: yes('medicalAdvanceDirective'), required: yes('medicalAdvanceDirective') },
      {
        key: 'medicalAdvanceDirectiveAttachment',
        label: 'Attachment reference for the copy of the directive (a copy must be attached)',
        type: 'text',
        showIf: yes('medicalAdvanceDirective'),
        help: 'Document name / chart document ID of the attached copy.',
      },
    ],
  },
  {
    id: 'goals',
    title: 'Goals',
    intro: "Goal/Objective in the respondent's own words, in quotes, if the respondent participated.",
    fields: [
      { key: 'respondentParticipatedInGoals', label: 'Respondent participated in setting the goals', type: 'yesno' },
      {
        key: 'goals',
        label: 'Goals by area of need',
        type: 'table',
        required: true,
        rowKey: 'goal',
        columns: [
          { key: 'area', label: 'Area of need', type: 'text' },
          { key: 'goal', label: 'Goal/Objective', type: 'textarea' },
          { key: 'timeFrame', label: 'Time frame', type: 'text' },
        ],
        defaultRows: GOAL_AREAS.map((area) => ({ area, goal: '', timeFrame: '' })),
      },
    ],
  },
  {
    id: 'services',
    title: 'Recommended services',
    intro:
      'The plan must include, at a minimum, psychiatrist services, case management and CPRS services (through ACT or separately). Every listed service must identify a community-based provider that has agreed to provide it (Health-General §10-6A-06). Information sharing among the providers in the plan is required.',
    fields: [
      {
        key: 'services',
        label: 'Services and providers',
        type: 'table',
        required: true,
        rowKey: 'serviceType',
        columns: [
          { key: 'serviceType', label: 'Service', type: 'select', options: SERVICE_TYPE_OPTIONS },
          { key: 'actTeam', label: 'ACT team includes', type: 'checkboxes', options: ACT_TEAM_OPTIONS },
          { key: 'serviceDescription', label: 'Service type (if additional)', type: 'text' },
          { key: 'organization', label: 'Organization name', type: 'text' },
          { key: 'contactPerson', label: 'Contact person', type: 'text' },
          { key: 'phone', label: 'Tel', type: 'text' },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'barriers', label: 'Known/possible barriers', type: 'textarea' },
          { key: 'contingencyLevelOfCare', label: 'Contingency: alternative level of care', type: 'text' },
          { key: 'contingencyProvider', label: 'Contingency: recommended provider', type: 'text' },
          { key: 'providerAgreed', label: 'Provider agreed to provide the service', type: 'yesno' },
          { key: 'providerAgreedDate', label: 'Date agreed', type: 'date' },
        ],
      },
    ],
  },
  {
    id: 'medication',
    title: 'Medication worksheet',
    intro: 'Complete only if medication is determined to be essential.',
    fields: [
      { key: 'medicationIncluded', label: 'Medication determined essential (include the worksheet)', type: 'yesno', required: true },
      {
        key: 'medications',
        label: 'Medications',
        type: 'table',
        rowKey: 'medication',
        showIf: medsIncluded,
        required: medsIncluded,
        columns: [
          { key: 'medication', label: 'Medication', type: 'text' },
          { key: 'class', label: 'Class', type: 'text' },
          { key: 'dosageRange', label: 'Dosage range', type: 'text' },
          { key: 'route', label: 'Route', type: 'text' },
          {
            key: 'administration',
            label: 'Administration',
            type: 'select',
            options: opts([
              ['self', 'Self-administered'],
              ['authorized_personnel', 'Authorized personnel'],
            ]),
          },
          { key: 'indication', label: 'Reason/indication', type: 'text' },
          { key: 'contingency', label: 'Contingency/alternative (e.g. if X is ineffective after a trial period, Y)', type: 'textarea' },
        ],
      },
      { key: 'sideEffects', num: '1', label: 'Beneficial and detrimental physical, cognitive, emotional and behavioral side effects', type: 'textarea', showIf: medsIncluded, required: medsIncluded },
      { key: 'medsDiscussed', num: '2', label: 'Discussion with the respondent (and guardian / health care agent)', type: 'textarea', showIf: medsIncluded, required: medsIncluded },
      { key: 'alternativesConsidered', num: '3', label: 'Reasonable alternatives considered', type: 'textarea', showIf: medsIncluded, required: medsIncluded },
      { key: 'risksBenefits', num: '3a', label: 'Risks and benefits of the recommended medication versus the alternatives', type: 'textarea', showIf: medsIncluded },
      { key: 'alternativesAcceptable', num: '3b', label: 'Alternatives acceptable to both the respondent and the psychiatrist', type: 'textarea', showIf: medsIncluded },
      { key: 'refusalReason', num: '3c', label: "Respondent's reason for refusal", type: 'textarea', showIf: medsIncluded },
      { key: 'medsForMaintenance', num: '4', label: 'Is the medication recommended for the maintenance of health and safety?', type: 'yesno', showIf: medsIncluded, required: medsIncluded },
    ],
  },
  {
    id: 'closing',
    title: 'Closing statement',
    fields: [
      {
        key: 'closingText',
        label: '',
        type: 'static',
        text: 'The Care Coordination Team (CCT) shall provide a plan for continued treatment within 30 days before the expiration of the order.',
      },
    ],
  },
];

/** Which of the three minimum services are covered (ACT team members count). */
export function minimumServicesCovered(d: FormData): { psychiatrist: boolean; caseManagement: boolean; cprs: boolean } {
  const list = rows(d, 'services');
  const act = list.filter((r) => r.serviceType === 'act');
  const actHas = (m: string) => act.some((r) => Array.isArray(r.actTeam) && (r.actTeam as string[]).includes(m));
  const sep = (t: string) => list.some((r) => r.serviceType === t);
  return {
    psychiatrist: sep('psychiatrist') || actHas('psychiatrist'),
    caseManagement: sep('case_management') || actHas('case_manager'),
    cprs: sep('cprs') || actHas('cprs'),
  };
}

export const TREATMENT_PLAN_RULES: CustomRule[] = [
  {
    id: 'minimum_services',
    check: (d) => {
      const c = minimumServicesCovered(d);
      const lacking = [!c.psychiatrist && 'psychiatrist services', !c.caseManagement && 'case management', !c.cprs && 'CPRS services'].filter(Boolean);
      return lacking.length
        ? `Recommended services: the plan must include ${lacking.join(', ')} (through ACT or separately)`
        : null;
    },
  },
  {
    id: 'provider_agreed',
    check: (d) => {
      const bad = rows(d, 'services')
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !isEmptyValue(r.serviceType))
        .filter(({ r }) => isEmptyValue(r.organization) || r.providerAgreed !== 'yes' || isEmptyValue(r.providerAgreedDate));
      return bad.length
        ? `Recommended services: row ${bad.map((b) => b.i + 1).join(', ')} needs a community-based provider that agreed to provide the service, with the date agreed (HG §10-6A-06)`
        : null;
    },
  },
  {
    id: 'additional_service_named',
    check: (d) =>
      rows(d, 'services').some((r) => r.serviceType === 'additional' && isEmptyValue(r.serviceDescription))
        ? 'Recommended services: name each additional service type'
        : null,
  },
  {
    id: 'medical_directive_attachment',
    check: (d) =>
      is(d, 'medicalAdvanceDirective', 'yes') && !str(d, 'medicalAdvanceDirectiveAttachment').trim()
        ? 'Advance directives: 18. A copy of the advance medical directive must be attached (enter the attachment reference)'
        : null,
  },
  {
    id: 'medication_rows',
    check: (d) =>
      is(d, 'medicationIncluded', 'yes') &&
      rows(d, 'medications').some((r) => !isEmptyValue(r.medication) && (isEmptyValue(r.dosageRange) || isEmptyValue(r.route) || isEmptyValue(r.indication)))
        ? 'Medication worksheet: each medication needs a dosage range, route and reason/indication'
        : null,
  },
];

export const TREATMENT_PLAN: FormDefinition = {
  type: 'treatment_plan',
  title: 'AOT Treatment Plan',
  mdhNumber: 'MDH#0001BHA',
  revised: REVISED,
  purpose: 'Proposed treatment plan presented by the testifying psychiatrist at the AOT hearing.',
  sections: TREATMENT_PLAN_SECTIONS,
  rules: TREATMENT_PLAN_RULES,
  signers: [
    {
      id: 'psychiatrist',
      label: "Testifying psychiatrist's signature",
      roles: PSYCHIATRIST_ROLES,
      allowMedicalDirector: true,
      roleHint: 'Psychiatrist or the Medical Director',
    },
  ],
  attestation:
    'I am the testifying psychiatrist. I reviewed this AOT Treatment Plan and its contents are true and complete to the best of my knowledge. This electronic signature is my signature on the plan.',
  multiInstance: false,
};

export const treatmentPlanSchema = buildSchema(TREATMENT_PLAN_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(TREATMENT_PLAN, data);
}

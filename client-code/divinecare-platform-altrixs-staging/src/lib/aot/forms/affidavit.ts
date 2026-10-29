/**
 * Psychiatrist Affidavit — MDH#0004BHA (revised 06/25/2026). Criteria of Health-General §10-6A-05.
 */
import {
  REVISED,
  ageOn,
  buildSchema,
  is,
  missingItems,
  opts,
  str,
  type CustomRule,
  type FormData,
  type FormDefinition,
  type SectionSpec,
} from './engine';
import { PSYCHIATRIST_ROLES } from './roles';
import { MDH_AFFIDAVIT_TIMING_CAVEAT, MDH_AFFIDAVIT_TIMING_TEXT } from '../mdh';

/**
 * Exam-timing check. MDH's AOT Resource Center wording ("examined the individual atleast 30 days prior to the
 * petition filing") is ambiguous, so this is a WARNING only, never a block: counsel must confirm the window.
 */
export const EXAM_WINDOW_DAYS = 30;
export const EXAM_WINDOW_IS_PRACTICE_RULE = true;

const checked = (k: string) => (d: FormData) => d?.[k] === true;

export const AFFIDAVIT_SECTIONS: SectionSpec[] = [
  {
    id: 'affirmation',
    title: 'Affirmation',
    intro: 'I, the undersigned psychiatrist, hereby, under penalty of perjury, affirm that:',
    fields: [
      { key: 'psychiatristName', label: 'Psychiatrist name ("I ___")', type: 'text', required: true },
      { key: 'respondentName', num: '1', label: 'I personally examined (respondent name)', type: 'text', required: true },
      { key: 'examDate', label: 'on (date of examination)', type: 'date', required: true },
      { key: 'respondentDob', label: "Respondent's date of birth (used to confirm item 2a)", type: 'date', required: true },
    ],
  },
  {
    id: 'criteria',
    title: '2. The respondent meets the criteria of Health-General §10-6A-05',
    fields: [
      { key: 'c_adult', num: 'a', label: 'The respondent is at least 18 years old', type: 'checkbox', readonly: true, required: true, help: 'Set automatically from the date of birth; under 18 cannot be affirmed.' },
      { key: 'c_spmi', num: 'b', label: 'The respondent has a serious and persistent mental illness', type: 'checkbox', required: true },
      { key: 'c_spmiFacts', label: 'Supporting facts (optional)', type: 'textarea' },
      {
        key: 'c_static',
        num: 'c',
        label: '',
        type: 'static',
        text: 'The respondent has a history of lack of adherence to treatment for mental illness, as shown by at least one of the following:',
      },
      {
        key: 'c_hospitalization',
        num: 'c(i)',
        label:
          'At least twice within the past 36 months, the serious and persistent mental illness was a significant factor in necessitating inpatient psychiatric admission for more than 48 hours or the receipt of psychiatric services in a correctional facility',
        type: 'checkbox',
      },
      { key: 'c_hospitalizationDetails', label: 'Details (dates, facilities)', type: 'textarea', showIf: checked('c_hospitalization'), required: checked('c_hospitalization') },
      {
        key: 'c_violence',
        num: 'c(ii)',
        label:
          'At least once within the 36 months immediately preceding the filing of the petition, the serious and persistent mental illness resulted in serious violent behavior toward self or others, or patterns, threats or attempts of serious physical harm to self or others',
        type: 'checkbox',
      },
      { key: 'c_violenceDetails', label: 'Details (dates, behavior)', type: 'textarea', showIf: checked('c_violence'), required: checked('c_violence') },
      {
        key: 'c_needsAot',
        num: 'd',
        label:
          'The respondent needs AOT to prevent a relapse or deterioration that would likely result in a substantial risk of serious harm to the respondent or others',
        type: 'checkbox',
        required: true,
      },
      { key: 'c_needsAotFacts', label: 'Supporting facts (optional)', type: 'textarea' },
      {
        key: 'c_unlikelyAdhere',
        num: 'e',
        label:
          'The respondent is unlikely to adequately adhere to outpatient treatment voluntarily, as shown by non-adherence in the prior 36 months that was not due to financial, transportation or language access issues',
        type: 'checkbox',
        required: true,
      },
      { key: 'c_unlikelyAdhereFacts', label: 'Non-adherence in the prior 36 months (and why not financial, transportation or language access)', type: 'textarea', required: checked('c_unlikelyAdhere') },
    ],
  },
  {
    id: 'statements',
    title: 'Statements',
    fields: [
      { key: 'willingToTestify', num: '3', label: 'I am willing and able to testify', type: 'checkbox', required: true },
      { key: 'notRelatedToRespondent', num: '4', label: 'I am not related by blood or marriage to the respondent', type: 'checkbox', required: true },
      { key: 'petitionerName', num: '5', label: 'Petitioner name', type: 'text', required: true },
      { key: 'notRelatedToPetitioner', label: 'I am not related to the petitioner', type: 'checkbox', required: true },
      {
        key: 'financialInterest',
        num: '6',
        label: 'Financial interest',
        type: 'radio',
        required: true,
        options: opts([
          ['none', 'I have no financial interest'],
          ['disclosed', 'I have a financial interest, described below, which I disclosed to the respondent'],
        ]),
      },
      { key: 'financialInterestDescription', label: 'Description of the financial interest', type: 'textarea', showIf: (d) => is(d, 'financialInterest', 'disclosed'), required: (d) => is(d, 'financialInterest', 'disclosed') },
      { key: 'financialInterestDisclosed', label: 'The financial interest was disclosed to the respondent', type: 'checkbox', showIf: (d) => is(d, 'financialInterest', 'disclosed'), required: (d) => is(d, 'financialInterest', 'disclosed') },
    ],
  },
];

export const AFFIDAVIT_RULES: CustomRule[] = [
  {
    id: 'adult',
    check: (d) => {
      const dob = str(d, 'respondentDob');
      if (!dob) return null; // the required DOB field reports it
      const ref = str(d, 'examDate') ? new Date(`${str(d, 'examDate')}T12:00:00Z`) : new Date();
      const age = ageOn(dob, ref);
      if (age === null) return 'Affirmation: respondent date of birth is not a valid date';
      return age < 18 ? `Criteria 2a: the respondent is ${age} (under 18) and cannot be the subject of an AOT petition` : null;
    },
  },
  {
    id: 'prong_c',
    check: (d) =>
      d?.c_hospitalization === true || d?.c_violence === true
        ? null
        : 'Criteria 2c: select at least one lack-of-adherence criterion, (i) or (ii)',
  },
];

function examWindowWarnings(d: FormData, now: Date): string[] {
  const exam = str(d, 'examDate');
  if (!exam) return [];
  const days = Math.floor((now.getTime() - new Date(`${exam}T12:00:00Z`).getTime()) / 86400000);
  if (days < 0) return ['The examination date is in the future.'];
  return days > EXAM_WINDOW_DAYS
    ? [
        `Examination was ${days} days ago. MDH: "${MDH_AFFIDAVIT_TIMING_TEXT}" ${MDH_AFFIDAVIT_TIMING_CAVEAT}`,
      ]
    : [];
}

/** Item 2a is never typed: it follows the date of birth (checked only when 18 or older on the exam date). */
export function deriveAdult(d: FormData): FormData {
  const dob = str(d, 'respondentDob');
  const ref = str(d, 'examDate') ? new Date(`${str(d, 'examDate')}T12:00:00Z`) : new Date();
  const age = dob ? ageOn(dob, ref) : null;
  return { ...d, c_adult: age !== null && age >= 18 };
}

export const PSYCHIATRIST_AFFIDAVIT: FormDefinition = {
  type: 'psychiatrist_affidavit',
  title: 'Psychiatrist Affidavit',
  mdhNumber: 'MDH#0004BHA',
  revised: REVISED,
  purpose: "Psychiatrist's sworn affirmation that the respondent meets the criteria of Health-General §10-6A-05; filed with the petition.",
  sections: AFFIDAVIT_SECTIONS,
  rules: AFFIDAVIT_RULES,
  signers: [{ id: 'psychiatrist', label: 'Psychiatrist signature', roles: PSYCHIATRIST_ROLES, roleHint: 'Psychiatrist' }],
  attestation:
    'I am the examining psychiatrist named above. Under penalty of perjury, I affirm that the statements in this affidavit are true. This electronic signature is my signature on the affidavit.',
  multiInstance: false,
  warnings: examWindowWarnings,
  derive: deriveAdult,
};

export const affidavitSchema = buildSchema(AFFIDAVIT_SECTIONS);

export function completeness(data: FormData): string[] {
  return missingItems(PSYCHIATRIST_AFFIDAVIT, data);
}

import type { AhcAnswers, AhcDomain } from './ahcHrsn';
import { normalizeAnswers } from './ahcHrsn';

/**
 * ICD-10-CM Z codes (social determinants of health) suggested from an AHC HRSN screening.
 * Suggestions only: a clinician confirms each code before it goes on the chart.
 *
 * Code set: ICD-10-CM FY 2027 (effective October 1, 2026). Titles are the official tabular titles,
 * checked against the FY 2027 Z55-Z65 / Z69 / Z74 / Z91.4 listings. Z59.861 / Z59.868 replaced the
 * single code Z59.86 (Financial insecurity) in FY 2026. Confirm yearly against the CDC/NCHS release:
 * https://www.cdc.gov/nchs/icd/icd-10-cm/files.html
 * Coding basis: ICD-10-CM Official Guidelines for Coding and Reporting, Section I.B.14 (SDOH codes
 * may be assigned from documentation by clinicians other than the patient's provider, and from
 * information the patient self-reports when signed off by a clinician).
 */
export const ZCODE_SET = { fiscalYear: 'FY2027', effective: '2026-10-01' } as const;

export const SDOH_ZCODES = {
  'Z59.00': 'Homelessness unspecified',
  'Z59.01': 'Sheltered homelessness',
  'Z59.02': 'Unsheltered homelessness',
  'Z59.11': 'Inadequate housing environmental temperature',
  'Z59.12': 'Inadequate housing utilities',
  'Z59.19': 'Other inadequate housing',
  'Z59.41': 'Food insecurity',
  'Z59.811': 'Housing instability, housed, with risk of homelessness',
  'Z59.812': 'Housing instability, housed, homelessness in past 12 months',
  'Z59.82': 'Transportation insecurity',
  'Z59.861': 'Financial insecurity, difficulty paying for utilities',
  'Z59.868': 'Other specified financial insecurity',
  'Z59.87': 'Material hardship due to limited financial resources, not elsewhere classified',
  'Z56.0': 'Unemployment, unspecified',
  'Z56.89': 'Other problems related to employment',
  'Z55.5': 'Less than a high school diploma',
  'Z55.8': 'Other problems related to education and literacy',
  'Z74.1': 'Need for assistance with personal care',
  'Z74.2': 'Need for assistance at home and no other household member able to render care',
  'Z60.2': 'Problems related to living alone',
  'Z60.8': 'Other problems related to social environment',
  'Z91.410': 'Personal history of adult physical and sexual abuse',
  'Z91.411': 'Personal history of adult psychological abuse',
  'Z91.414': 'Personal history of adult intimate partner abuse',
  'Z91.419': 'Personal history of unspecified adult abuse',
  'Z69.11': 'Encounter for mental health services for victim of spousal or partner abuse',
  'Z69.81': 'Encounter for mental health services for victim of other abuse',
} as const;

export type SdohZCode = keyof typeof SDOH_ZCODES;
export const isSdohZCode = (code: string): code is SdohZCode => Object.prototype.hasOwnProperty.call(SDOH_ZCODES, code);

export interface ZCodeSuggestion {
  code: SdohZCode;
  title: string;
  domain: AhcDomain;
  /** Pre-ticked: the screening answer maps directly to the code title */
  preselected: boolean;
  /** When the clinician should pick this code (shown under the checkbox) */
  note?: string;
}

function s(code: SdohZCode, domain: AhcDomain, preselected: boolean, note?: string): ZCodeSuggestion {
  return { code, title: SDOH_ZCODES[code], domain, preselected, ...(note ? { note } : {}) };
}

/** Suggestions for the positive domains of one screening. Safety codes are never pre-ticked. */
export function suggestZCodes(raw: AhcAnswers, positiveDomains: AhcDomain[], includeSupplemental: boolean): ZCodeSuggestion[] {
  const a = normalizeAnswers(raw, includeSupplemental);
  const pos = new Set(positiveDomains);
  const out: ZCodeSuggestion[] = [];

  if (pos.has('housing_instability')) {
    if (a.q1 === 'worried') out.push(s('Z59.811', 'housing_instability', true));
    if (a.q1 === 'not_steady') {
      out.push(s('Z59.00', 'housing_instability', true, 'Pick a more specific code below when known'));
      out.push(s('Z59.01', 'housing_instability', false, 'Staying in a shelter, motel, or temporary/transitional housing'));
      out.push(s('Z59.02', 'housing_instability', false, 'Living on the street, in a car, park, or other place not meant for habitation'));
      out.push(s('Z59.812', 'housing_instability', false, 'Housed now (e.g. staying with others) but homeless in the past 12 months'));
    }
  }
  if (pos.has('housing_quality')) {
    const items = Array.isArray(a.q2) ? a.q2 : [];
    if (items.includes('no_heat')) out.push(s('Z59.11', 'housing_quality', true));
    if (items.some((x) => x !== 'none' && x !== 'no_heat')) out.push(s('Z59.19', 'housing_quality', true));
  }
  if (pos.has('food')) out.push(s('Z59.41', 'food', true));
  if (pos.has('transportation')) out.push(s('Z59.82', 'transportation', true));
  if (pos.has('utilities')) {
    out.push(s('Z59.861', 'utilities', true, 'Shut-off threatened or done because the bill could not be paid'));
    if (a.q6 === 'shut_off') out.push(s('Z59.12', 'utilities', false, 'Home currently has no working utility service'));
  }
  if (pos.has('safety')) {
    out.push(s('Z91.414', 'safety', false, 'Only after the clinician confirms intimate partner abuse'));
    out.push(s('Z91.410', 'safety', false, 'Only after the clinician confirms physical or sexual abuse'));
    out.push(s('Z91.411', 'safety', false, 'Only after the clinician confirms psychological abuse'));
    out.push(s('Z91.419', 'safety', false, 'Abuse confirmed, type not documented'));
    out.push(s('Z69.11', 'safety', false, 'Only when this encounter provides mental health services for partner abuse'));
    out.push(s('Z69.81', 'safety', false, 'Only when this encounter provides mental health services for other abuse'));
  }
  if (pos.has('financial_strain')) {
    out.push(s('Z59.868', 'financial_strain', true));
    out.push(s('Z59.87', 'financial_strain', false, 'Going without basic needs because of limited money'));
  }
  if (pos.has('employment')) {
    if (a.q12 === 'finding') out.push(s('Z56.0', 'employment', false, 'Only if the client is currently unemployed'));
    out.push(s('Z56.89', 'employment', a.q12 === 'keeping'));
  }
  if (pos.has('family_support')) {
    if (a.q13 === 'little_more' || a.q13 === 'lot_more') {
      out.push(s('Z74.1', 'family_support', false, 'Needs help with personal care such as bathing'));
      out.push(s('Z74.2', 'family_support', false, 'No one in the household can give the help needed'));
    }
    if (a.q14 === 'often' || a.q14 === 'always') {
      out.push(s('Z60.2', 'family_support', false, 'Only if the client lives alone'));
      out.push(s('Z60.8', 'family_support', false, 'Loneliness or social isolation documented by the clinician'));
    }
  }
  if (pos.has('education') && a.q16 === 'yes') {
    out.push(s('Z55.5', 'education', false, 'Only if the client has no high school diploma or equivalent'));
    out.push(s('Z55.8', 'education', false));
  }
  // One row per code (a code can only be suggested once)
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.code) ? false : (seen.add(x.code), true)));
}

/**
 * Appends confirmed codes to the client's comma-separated secondary diagnoses without duplicates.
 * Returns null when nothing would change.
 */
export function mergeSecondaryDiagnoses(existing: string | null | undefined, codes: string[]): string | null {
  const current = (existing || '').split(',').map((x) => x.trim()).filter(Boolean);
  const have = new Set(current.map((x) => x.split(/\s/)[0].toUpperCase()));
  const add = codes.filter((c) => !have.has(c.toUpperCase()));
  if (!add.length) return null;
  return [...current, ...add].join(', ');
}

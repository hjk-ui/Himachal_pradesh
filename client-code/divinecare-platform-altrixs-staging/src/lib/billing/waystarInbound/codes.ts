/**
 * Code lists used to explain inbound X12 to billing staff. Short descriptions only;
 * the authoritative lists are maintained by X12 / WPC:
 *   CARC  Claim Adjustment Reason Codes        (835 CAS02/05/08..., X221A1)
 *   RARC  Remittance Advice Remark Codes       (835 LQ*HE, MOA, MIA)
 *   CAS01 Claim Adjustment Group Codes         (CO, PR, OA, PI, CR)
 *   AAA03 Request Validation Reject Reasons    (271, X279A1)
 *   STC01 Health Care Claim Status Category    (277 / 277CA, X212 / X214)
 *   EB01  Eligibility or Benefit Information   (271, X279A1)
 *   EB03  Service Type Codes                   (270/271, X279A1)
 * Unknown codes are shown as the bare code.
 */

export const CAS_GROUP: Record<string, string> = {
  CO: 'Contractual obligation',
  PR: 'Patient responsibility',
  OA: 'Other adjustment',
  PI: 'Payer initiated reduction',
  CR: 'Correction and reversal',
};

export const CARC: Record<string, string> = {
  '1': 'Deductible amount',
  '2': 'Coinsurance amount',
  '3': 'Co-payment amount',
  '4': 'Procedure code inconsistent with modifier, or modifier missing',
  '5': 'Procedure code / bill type inconsistent with place of service',
  '6': 'Procedure / revenue code inconsistent with patient age',
  '11': 'Diagnosis inconsistent with procedure',
  '15': 'Authorization number missing, invalid, or does not apply',
  '16': 'Claim / service lacks information or has submission / billing error(s)',
  '18': 'Exact duplicate claim / service',
  '22': 'May be covered by another payer per coordination of benefits',
  '23': 'Impact of prior payer(s) adjudication',
  '24': 'Covered under capitation / managed care plan',
  '26': 'Expenses incurred prior to coverage',
  '27': 'Expenses incurred after coverage terminated',
  '29': 'Time limit for filing has expired',
  '31': 'Patient cannot be identified as our insured',
  '45': 'Charge exceeds fee schedule / maximum allowable',
  '50': 'Non-covered: not deemed a medical necessity',
  '58': 'Treatment rendered in inappropriate or invalid place of service',
  '59': 'Processed based on multiple or concurrent procedure rules',
  '96': 'Non-covered charge(s)',
  '97': 'Payment included in the allowance for another service',
  '109': 'Not covered by this payer / contractor',
  '119': 'Benefit maximum for this time period has been reached',
  '142': 'Monthly Medicaid patient liability amount',
  '151': 'Payer deems the information does not support this many / frequency of services',
  '167': 'Diagnosis is not covered',
  '170': 'Payment denied when performed / billed by this type of provider',
  '171': 'Payment denied when performed by this type of provider in this type of facility',
  '185': 'Rendering provider not eligible to perform the service billed',
  '197': 'Precertification / authorization / notification absent',
  '198': 'Precertification / notification / authorization exceeded',
  '204': 'Service / equipment / drug not covered under the patient’s current benefit plan',
  '226': 'Information requested from the billing / rendering provider was not provided',
  '242': 'Services not provided by network / primary care providers',
  '253': 'Sequestration - reduction in federal payment',
  '288': 'Referral absent',
  'A1': 'Claim / service denied',
  'B7': 'Provider not certified / eligible to be paid for this procedure on this date',
  'B11': 'Claim transferred to the proper payer / processor',
};

export const RARC: Record<string, string> = {
  M15: 'Separately billed services / tests bundled; payment included in another service',
  M51: 'Missing / incomplete / invalid procedure code(s)',
  M76: 'Missing / incomplete / invalid diagnosis or condition',
  M80: 'Not covered when performed during the same session / date as a previously processed service',
  MA04: 'Secondary payment cannot be considered without the identity of or payment information from the primary payer',
  MA18: 'Claim information also forwarded to the patient’s supplemental insurer',
  MA130: 'Claim contains incomplete / invalid information; no appeal rights; submit a new claim',
  N4: 'Missing / incomplete / invalid prior insurance carrier EOB',
  N20: 'Service not payable with other service rendered on the same date',
  N30: 'Patient ineligible for this service',
  N56: 'Procedure code billed is not correct / valid for the services billed or the date of service',
  N130: 'Consult plan benefit documents / guidelines for information about restrictions for this service',
  N290: 'Missing / incomplete / invalid rendering provider primary identifier',
  N362: 'The number of days or units of service exceeds the acceptable maximum',
  N386: 'Decision based on a National Coverage Determination',
  N479: 'Missing Explanation of Benefits (coordination of benefits or Medicare secondary payer)',
  N522: 'Duplicate of a claim processed, or to be processed, as a crossover claim',
  N657: 'Should be billed with the appropriate code for these services',
};

/** CLP02 claim status codes (835, X221A1 2100). */
export const CLP_STATUS: Record<string, string> = {
  '1': 'Processed as primary',
  '2': 'Processed as secondary',
  '3': 'Processed as tertiary',
  '4': 'Denied',
  '19': 'Processed as primary, forwarded to additional payer(s)',
  '20': 'Processed as secondary, forwarded to additional payer(s)',
  '21': 'Processed as tertiary, forwarded to additional payer(s)',
  '22': 'Reversal of previous payment',
  '23': 'Not our claim, forwarded to additional payer(s)',
  '25': 'Predetermination pricing only - no payment',
};

/** PLB03-1 provider adjustment reason codes (835 PLB). */
export const PLB_REASON: Record<string, string> = {
  '50': 'Late charge',
  '51': 'Interest penalty charge',
  '72': 'Authorized return',
  '90': 'Early payment allowance',
  AH: 'Origination fee',
  AM: 'Applied to borrower’s account',
  AP: 'Acceleration of benefits',
  B2: 'Rebate',
  B3: 'Recovery allowance',
  BD: 'Bad debt adjustment',
  BN: 'Bonus',
  C5: 'Temporary allowance',
  CR: 'Capitation interest',
  CS: 'Adjustment',
  CT: 'Capitation payment',
  CV: 'Capital passthru',
  CW: 'Certified registered nurse anesthetist passthru',
  DM: 'Direct medical education passthru',
  E3: 'Withholding',
  FB: 'Forwarding balance',
  FC: 'Fund allocation',
  GO: 'Graduate medical education passthru',
  HM: 'Hemophilia clotting factor supplement',
  IP: 'Incentive premium payment',
  IR: 'Internal Revenue Service withholding',
  IS: 'Interim settlement',
  J1: 'Nonreimbursable',
  L3: 'Penalty',
  L6: 'Interest owed',
  LE: 'Levy',
  LS: 'Lump sum',
  OA: 'Organ acquisition passthru',
  OB: 'Offset for affiliated providers',
  PI: 'Periodic interim payment',
  PL: 'Payment final',
  RA: 'Retro-activity adjustment',
  RE: 'Return on equity',
  SL: 'Student loan repayment',
  TL: 'Third party liability',
  WO: 'Overpayment recovery',
  WU: 'Unspecified recovery',
};

export const AAA_REASON: Record<string, string> = {
  '15': 'Required application data missing',
  '41': 'Authorization / access restrictions',
  '42': 'Unable to respond at current time',
  '43': 'Invalid / missing provider identification',
  '44': 'Invalid / missing provider name',
  '45': 'Invalid / missing provider specialty',
  '47': 'Invalid / missing provider state',
  '50': 'Provider ineligible for inquiries',
  '51': 'Provider not on file',
  '52': 'Service dates not within provider plan enrollment',
  '53': 'Inquired benefit inconsistent with provider type',
  '56': 'Inappropriate date',
  '57': 'Invalid / missing date(s) of service',
  '58': 'Invalid / missing date of birth',
  '60': 'Date of birth follows date(s) of service',
  '62': 'Date of service not within allowable inquiry period',
  '63': 'Date of service in future',
  '64': 'Invalid / missing patient ID',
  '65': 'Invalid / missing patient name',
  '66': 'Invalid / missing patient gender code',
  '67': 'Patient not found',
  '68': 'Duplicate patient ID number',
  '71': 'Patient birth date does not match the payer’s record',
  '72': 'Invalid / missing subscriber / insured ID',
  '73': 'Invalid / missing subscriber / insured name',
  '75': 'Subscriber / insured not found',
  '76': 'Duplicate subscriber / insured ID number',
  '77': 'Subscriber found, patient not found',
  '78': 'Subscriber / insured not in group / plan identified',
  '79': 'Invalid participant identification',
  '80': 'No response received - transaction terminated',
  '97': 'Invalid or missing provider address',
  T4: 'Payer name or identifier missing',
};

export const AAA_FOLLOWUP: Record<string, string> = {
  C: 'Please correct and resubmit',
  N: 'Resubmission not allowed',
  P: 'Please resubmit original transaction',
  R: 'Resubmission allowed',
  S: 'Do not resubmit; inquiry initiated to a third party',
  W: 'Please wait 30 days and resubmit',
  X: 'Please wait 10 days and resubmit',
  Y: 'Do not resubmit; we will hand over to a third party',
};

/** STC01-1 category codes (277 X212 / 277CA X214). */
export const STC_CATEGORY_TEXT: Record<string, string> = {
  A0: 'Acknowledgement: forwarded to another entity',
  A1: 'Acknowledgement: received',
  A2: 'Acknowledgement: accepted into adjudication',
  A3: 'Acknowledgement: returned as unprocessable',
  A4: 'Acknowledgement: not found',
  A5: 'Acknowledgement: split claim',
  A6: 'Acknowledgement: rejected for missing information',
  A7: 'Acknowledgement: rejected for invalid information',
  A8: 'Acknowledgement: rejected for relational field in error',
  P0: 'Pending: adjudication / details',
  P1: 'Pending: in process',
  P2: 'Pending: payer review',
  P3: 'Pending: provider requested information',
  P4: 'Pending: patient requested information',
  P5: 'Pending: payer administrative / system hold',
  F0: 'Finalized',
  F1: 'Finalized: payment',
  F2: 'Finalized: denial',
  F3: 'Finalized: revised',
  F3F: 'Finalized: forwarded',
  F3N: 'Finalized: not forwarded',
  F4: 'Finalized: adjudication complete, no payment forthcoming',
  R0: 'Requests for additional information: general',
  R1: 'Requests for additional information: entity requests',
  R3: 'Requests for additional information: claim / line',
  R4: 'Requests for additional information: documentation',
  R5: 'Requests for additional information: more specific detail',
  E0: 'Response not possible: error on submitted request data',
  E1: 'Response not possible: system status',
  E2: 'Information holder is not responding; resubmit at a later time',
  E3: 'Correction required: relational fields in error',
  E4: 'Trading partner agreement specific requirement not met',
  D0: 'Data search unsuccessful',
};

export const EB_INFO: Record<string, string> = {
  '1': 'Active coverage',
  '2': 'Active - full risk capitation',
  '3': 'Active - services capitated',
  '4': 'Active - services capitated to primary care physician',
  '5': 'Active - pending investigation',
  '6': 'Inactive',
  '7': 'Inactive - pending eligibility update',
  '8': 'Inactive - pending investigation',
  A: 'Co-insurance',
  B: 'Co-payment',
  C: 'Deductible',
  D: 'Benefit description',
  E: 'Exclusions',
  F: 'Limitations',
  G: 'Out of pocket (stop loss)',
  H: 'Unlimited',
  I: 'Non-covered',
  L: 'Primary care provider',
  N: 'Services restricted to following provider',
  P: 'Benefit disclaimer',
  R: 'Other or additional payor',
  U: 'Contact following entity for eligibility or benefit information',
  V: 'Cannot process',
  CB: 'Coverage basis',
  MC: 'Managed care coordinator',
};

/** EB03 service type codes relevant to an outpatient behavioral health practice. */
export const SERVICE_TYPE: Record<string, string> = {
  '1': 'Medical care',
  '30': 'Health benefit plan coverage',
  '98': 'Professional (physician) visit - office',
  '33': 'Chiropractic',
  '88': 'Pharmacy',
  BY: 'Physician visit - office: sick',
  MH: 'Mental health',
  A4: 'Psychiatric',
  A5: 'Psychiatric - room and board',
  A6: 'Psychotherapy',
  A7: 'Psychiatric - inpatient',
  A8: 'Psychiatric - outpatient',
  AI: 'Substance abuse',
  AJ: 'Alcoholism',
  AK: 'Drug addiction',
  CQ: 'Case management',
  UC: 'Urgent care',
};

/** Service types we may send in a 270 EQ01 (validated so a typo can't reach the payer). */
export const ELIGIBILITY_SERVICE_TYPES = ['30', 'MH', 'A4', 'A6', 'A8', 'AI', 'AJ', 'AK', '98'] as const;
export type EligibilityServiceType = (typeof ELIGIBILITY_SERVICE_TYPES)[number];

/** Mental-health service types used when reading benefits out of a 271. */
export const MH_SERVICE_TYPES = new Set(['MH', 'A4', 'A6', 'A8', 'AI', 'AJ', 'AK', 'A7']);

export function describe(map: Record<string, string>, code: string | undefined | null): string {
  if (!code) return '';
  return map[code] ? `${code} ${map[code]}` : code;
}

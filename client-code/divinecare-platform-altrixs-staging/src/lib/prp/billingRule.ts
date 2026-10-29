/**
 * Maryland adult PRP billing rule, as far as it can be cited. Altrixs does NOT compute billable
 * units or case-rate eligibility: it reports encounter counts per participant per month.
 *
 * What the sources say (checked 2026-10-17):
 *  - Optum Maryland, "Psychiatric Rehabilitation Program - Adult" Training Participant Guide
 *    (March 2023), slides 17 and 25-28: adult PRP bills a monthly case rate, H2018 with a level
 *    modifier (U2-U7), entered as 1 unit per month; each encounter goes on its own service line
 *    as H2016 at $1.00; encounter dates of service must come before the case-rate date of service.
 *    Its worked example ("invented scenario") gives a U3 maximum-payment threshold of 6 visits.
 *    https://mdbh.optum.com/content/dam/ops-maryland/documents/provider/Alerts/march-2023/BH_MD_Provider_PRPAdult_PG_March2023.pdf
 *  - Maryland ASO Provider FAQ (Oct 17 2024, Optum to Carelon transition, effective Jan 1 2025):
 *    Q "For PRP, do we still have to submit multiple claims for encounters H2016, and then one for
 *    H2018?" A "Yes, the required process for PRP billing has not changed." The same FAQ records
 *    adult on-site PRP authorizations as "a straight 90 units for six months".
 *    https://marylandbehavioralhealth.optum.com/content/dam/ops-maryland/documents/provider/transition/Maryland-Provider-FAQ-10.17.24.pdf
 *  - Not found in any source: H2017 for Maryland PRP. Elsewhere in Altrixs PRP is labelled H2017
 *    (the national HCPCS code for psychosocial rehabilitation, per 15 minutes). That conflicts with
 *    the Optum guidance above and needs confirming with billing before any claim is built.
 *  - The visit threshold for each modifier comes from the current PBHS fee schedule, which is not
 *    loaded in Altrixs, so case-rate eligibility is not computed.
 */
export const PRP_UNIT_RULE_CONFIRMED = false as const;

export const PRP_UNIT_RULE_LABEL = 'H2017 unit rule needs confirmation';

export const PRP_BILLING_RULE_NOTE =
  'Optum Maryland PRP Adult guidance (Mar 2023) bills H2018 once per month (1 unit, modifier U2-U7) ' +
  'plus one H2016 line per encounter. It does not mention H2017. Visit thresholds per modifier come ' +
  'from the PBHS fee schedule, which is not configured here, so units and case-rate eligibility are ' +
  'not calculated. These are encounter counts only.';

export const PRP_BILLING_SOURCES = [
  {
    label: 'Optum Maryland PRP Adult Training Participant Guide (Mar 2023), slides 17, 25-28',
    url: 'https://mdbh.optum.com/content/dam/ops-maryland/documents/provider/Alerts/march-2023/BH_MD_Provider_PRPAdult_PG_March2023.pdf',
  },
  {
    label: 'Maryland ASO Provider FAQ (Oct 17 2024): H2016 encounters + H2018, process unchanged under Carelon',
    url: 'https://marylandbehavioralhealth.optum.com/content/dam/ops-maryland/documents/provider/transition/Maryland-Provider-FAQ-10.17.24.pdf',
  },
] as const;

/** Milestones of Recovery Scale levels (Pilon & Ragins). */
export const MORS_LEVELS = [
  { rating: 1, label: 'Extreme risk' },
  { rating: 2, label: 'High risk / not engaged' },
  { rating: 3, label: 'High risk / engaged' },
  { rating: 4, label: 'Poorly coping / not engaged' },
  { rating: 5, label: 'Poorly coping / engaged' },
  { rating: 6, label: 'Coping / rehabilitating' },
  { rating: 7, label: 'Early recovery' },
  { rating: 8, label: 'Advanced recovery' },
] as const;

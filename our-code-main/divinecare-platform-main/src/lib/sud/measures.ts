/** SUD Referral Radar measures (Oct 23 exact labels). */

export const SUD_MEASURES = [
  {
    key: 'AUDIT',
    label: 'AUDIT (alcohol use assessment)',
    frequency: 'once' as const,
    scored: true,
    itemContentPending: false,
  },
  {
    key: 'CAGE-AID',
    label: 'CAGE-AID (alcohol and substance use)',
    frequency: 'once' as const,
    scored: true,
    positiveAt: 2,
    itemContentPending: false,
  },
  {
    key: 'NIDA-ASSIST',
    label: 'NIDA-Modified ASSIST (prescription and street substances)',
    frequency: 'once' as const,
    scored: false,
    itemContentPending: true,
  },
  {
    key: 'BAM',
    label: 'BAM — Brief Addiction Monitor (repeats every 30 days)',
    frequency: 'monthly' as const,
    scored: false,
    itemContentPending: true,
  },
] as const;

export type SudMeasureKey = (typeof SUD_MEASURES)[number]['key'];

export const SUD_PENDING_BANNER =
  'Item content pending licensed copy: administer the official form; no automatic scoring.';

export const ASSIGN_DIALOG_TITLE = 'Assign substance-use measures';
export const ASSIGN_DIALOG_CTA = 'Assign measures';
export const ASSIGN_DIALOG_HELP =
  'Added to the MBC outcome schedule (Measurement-based care > Outcomes) and given in session or from EHR > Assessments.';

export const AUTO_ASSIGN_LABEL =
  'Auto-assign substance-use measures when a patient appears on the SUD Referral Radar';

const SCHEDULE_PREFIX = 'sud-measure-schedule:';

export function scheduleModule(clientId: string, measure: string) {
  return `${SCHEDULE_PREFIX}${clientId}:${measure}`;
}

/**
 * Front Desk Huddle checklist labels — Oct 21 staging exact.
 * Minimum necessary: no notes / diagnoses / meds / risk detail.
 */

export const HUDDLE_TABS = ['today', 'tomorrow', 'end_of_day'] as const;
export type HuddleTab = (typeof HUDDLE_TABS)[number];

export const HUDDLE_TAB_LABELS: Record<HuddleTab, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  end_of_day: 'End of day',
};

/** Exact per-appointment checklist labels */
export const HUDDLE_CHECKLIST_LABELS = [
  'Appointment confirmed',
  'Eligibility verified',
  'Authorization on file',
  'Demographics complete',
  'Consents signed',
  'Intake packet completed',
  'Carelon attestation (Medicaid)',
  'Balance due',
  'Telehealth join link',
  'Portal account',
  'Reminder call (high no-show risk)',
  'Identity verified',
  'Photo ID and insurance card checked',
  'Copay collected',
  'Checked in',
  'Next appointment booked',
  'Visit documents given/sent',
  'Visit closed',
  'Rescheduled',
  'Outreach logged',
] as const;

export type HuddleChecklistLabel = (typeof HUDDLE_CHECKLIST_LABELS)[number];

export type HuddleReadiness = 'Ready' | 'N to do' | 'Resolve first' | 'Cancelled';

export type HuddleEodTileId =
  | 'seen'
  | 'no_shows'
  | 'not_closed'
  | 'notes_not_signed'
  | 'copays_posted'
  | 'copays_not_posted';

export const HUDDLE_EOD_TILES: Array<{ id: HuddleEodTileId; label: string }> = [
  { id: 'seen', label: 'Seen' },
  { id: 'no_shows', label: 'No-shows/late cancels' },
  { id: 'not_closed', label: 'Not closed' },
  { id: 'notes_not_signed', label: 'Notes not signed' },
  { id: 'copays_posted', label: 'Copays posted' },
  { id: 'copays_not_posted', label: 'Copays not posted' },
];

export function readinessFromDone(
  doneCount: number,
  total: number,
  cancelled: boolean
): HuddleReadiness {
  if (cancelled) return 'Cancelled';
  if (doneCount >= total) return 'Ready';
  if (doneCount === 0) return 'Resolve first';
  return 'N to do';
}

export function readinessBadgeText(ready: HuddleReadiness, remaining: number): string {
  if (ready === 'N to do') return `${remaining} to do`;
  return ready;
}

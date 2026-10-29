/** IOP/PHP hub tabs — Oct 21 staging exact labels */

export const INTENSIVE_HUB_TABS = [
  { id: 'roster', label: "Today's roster", leadershipOnly: false },
  { id: 'census', label: 'Census & weekly hours / My program clients', leadershipOnly: false },
  { id: 'referrals', label: 'Referrals & admissions', leadershipOnly: false },
  { id: 'outreach', label: 'Missed-day outreach', leadershipOnly: false },
  { id: 'discharges', label: 'Discharges', leadershipOnly: false },
  { id: 'director', label: 'Program director', leadershipOnly: true },
  { id: 'setup', label: 'Program setup', leadershipOnly: true },
] as const;

export type IntensiveHubTabId = (typeof INTENSIVE_HUB_TABS)[number]['id'];

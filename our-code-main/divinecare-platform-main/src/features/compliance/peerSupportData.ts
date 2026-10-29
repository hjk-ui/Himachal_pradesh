/** ClinicModuleState: `peer-contacts`, `peer-goals`, `peer-placements`, `peer-meta`. */

export type ContactType =
  | 'Individual phone call'
  | 'In-person meeting'
  | 'Group session'
  | 'Community outing'
  | 'Employment support'
  | 'Crisis support'
  | 'Peer check-in'
  | 'Family meeting';

export type GoalStatus = 'Active' | 'In Progress' | 'Completed' | 'On Hold';

export type PlacementType =
  | 'Volunteer'
  | 'Competitive Employment'
  | 'Social Club'
  | 'Housing Program'
  | 'Education'
  | 'Internship';

export type PlacementStatus = 'Active' | 'Pending' | 'Completed' | 'Ended';

export type ContactEntry = {
  id: string;
  date: string;
  client: string;
  contactType: ContactType;
  duration: number;
  topics: string[];
  goalsAddressed: string[];
  response: string;
  specialist: string;
};

export type RecoveryGoal = {
  id: string;
  client: string;
  title: string;
  status: GoalStatus;
  /** Days elapsed toward goal (for progress UI) */
  daysIn: number;
  /** Target days (e.g. 90 for sobriety) — 0 = non-day goal */
  goalDays: number;
  progress: number;
  notes: string;
  targetDate?: string;
};

export type CommunityPlacement = {
  id: string;
  client: string;
  activityType: PlacementType;
  organization: string;
  startDate: string | null;
  status: PlacementStatus;
  hoursPerWeek: number | null;
  notes: string;
};

export type PeerMeta = {
  version: 1;
  activePeerClients: number;
  newClientsThisMonth: number;
  contactsThisWeekLabel: number;
  contactsVsLastWeek: number;
  recoveryGoalsActive: number;
  goalsCompletedQuarter: number;
  communityPlacements: number;
  employmentCount: number;
  volunteerSocialCount: number;
  cprs: {
    name: string;
    certificationDate: string;
    renewalDue: string;
    renewalOverdue: boolean;
    clinicalSupervision: string;
    lastSupervision: string;
    nextSupervision: string;
  };
};

export const CONTACT_TYPES: ContactType[] = [
  'Individual phone call',
  'In-person meeting',
  'Group session',
  'Community outing',
  'Employment support',
  'Crisis support',
  'Peer check-in',
  'Family meeting',
];

export const DEFAULT_SPECIALIST = 'Faith Okafor, CPRS';

export const PEER_META_SEED: PeerMeta = {
  version: 1,
  activePeerClients: 18,
  newClientsThisMonth: 2,
  contactsThisWeekLabel: 24,
  contactsVsLastWeek: 4,
  recoveryGoalsActive: 47,
  goalsCompletedQuarter: 8,
  communityPlacements: 6,
  employmentCount: 2,
  volunteerSocialCount: 4,
  cprs: {
    name: 'Faith Okafor, CPRS',
    certificationDate: '2024-01-15',
    renewalDue: '2026-01-15',
    renewalOverdue: true,
    clinicalSupervision: 'Monthly with Marcus Williams, LCSW',
    lastSupervision: '2026-07-28',
    nextSupervision: '2026-08-25',
  },
};

/** Contact log — dates in week of Aug 20–26, 2026 so “This Week” filter matches. */
export const PEER_CONTACTS_SEED: ContactEntry[] = [
  {
    id: 'pc-01',
    date: '2026-08-26',
    client: 'Darnell P.',
    contactType: 'Individual phone call',
    duration: 25,
    topics: ['Relapse prevention', 'triggers discussion'],
    goalsAddressed: ['Recovery goal: 90-day sobriety'],
    response: 'Client engaged and motivated; reviewed coping plan for weekend.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-02',
    date: '2026-08-25',
    client: 'Marcus T.',
    contactType: 'In-person meeting',
    duration: 45,
    topics: ['Safety', 'coping with depression', 'housing stress'],
    goalsAddressed: ['Recovery goal: Community engagement'],
    response: 'Client opened up about isolation; safety plan reviewed.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-03',
    date: '2026-08-25',
    client: 'Group (6 members)',
    contactType: 'Group session',
    duration: 60,
    topics: ['Shared experiences', 'employment preparation'],
    goalsAddressed: ['Multiple goals'],
    response: 'Positive group energy; two members shared interview updates.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-04',
    date: '2026-08-24',
    client: 'Keena M.',
    contactType: 'Employment support',
    duration: 90,
    topics: ['Accompanied to job interview at Walmart'],
    goalsAddressed: ['Employment goal'],
    response: 'Client interviewed well; awaiting offer. Peer to assist onboarding.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-05',
    date: '2026-08-24',
    client: 'Tyrone B.',
    contactType: 'Peer check-in',
    duration: 15,
    topics: ['Medication adherence', 'daily routine'],
    goalsAddressed: ['Recovery goal: Stable housing'],
    response: 'Client reported doing well; enjoying new apartment unit.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-06',
    date: '2026-08-23',
    client: 'Leticia R.',
    contactType: 'In-person meeting',
    duration: 50,
    topics: ['Family reunification planning', 'parenting support'],
    goalsAddressed: ['Recovery goal: Reunite with children'],
    response: 'Emotional session; hope about upcoming custody hearing.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-07',
    date: '2026-08-23',
    client: 'Raymond G.',
    contactType: 'Community outing',
    duration: 120,
    topics: ['Attended community job fair at civic center'],
    goalsAddressed: ['Employment goal', 'Community engagement'],
    response: 'Collected 3 applications; expressed confidence.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-08',
    date: '2026-08-22',
    client: 'Darnell P.',
    contactType: 'Individual phone call',
    duration: 20,
    topics: ['Weekend check-in', 'sobriety milestone discussion'],
    goalsAddressed: ['Recovery goal: 90-day sobriety'],
    response: 'Reached 67-day mark; shared pride and set next milestone.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-09',
    date: '2026-08-21',
    client: 'Nadia C.',
    contactType: 'Crisis support',
    duration: 35,
    topics: ['Crisis call — severe anxiety, eviction notice'],
    goalsAddressed: ['Crisis stabilization', 'Housing goal'],
    response: 'De-escalated; coordinated emergency housing with case manager.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-10',
    date: '2026-08-15',
    client: 'Marcus T.',
    contactType: 'Community outing',
    duration: 75,
    topics: ['Library volunteer orientation'],
    goalsAddressed: ['Recovery goal: Volunteer at library'],
    response: 'Orientation completed; starts shelving Aug 10 schedule.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-11',
    date: '2026-08-10',
    client: 'Group (8 members)',
    contactType: 'Group session',
    duration: 60,
    topics: ['Recovery capital', 'building support networks'],
    goalsAddressed: ['Multiple goals'],
    response: 'New member joined; warm welcome from group.',
    specialist: DEFAULT_SPECIALIST,
  },
  {
    id: 'pc-12',
    date: '2026-08-05',
    client: 'Keena M.',
    contactType: 'Family meeting',
    duration: 55,
    topics: ['Mother attended; family support strategies, housing plan'],
    goalsAddressed: ['Own apartment goal', 'Family support'],
    response: 'Mother committed to deposit; client tearful and grateful.',
    specialist: DEFAULT_SPECIALIST,
  },
];

export const PEER_GOALS_SEED: RecoveryGoal[] = [
  {
    id: 'pg-01',
    client: 'Darnell P.',
    title: '90-day sobriety from alcohol',
    status: 'Active',
    daysIn: 67,
    goalDays: 90,
    progress: 74,
    notes: '67 days in',
    targetDate: '2026-09-10',
  },
  {
    id: 'pg-02',
    client: 'Darnell P.',
    title: 'Reconnect with son',
    status: 'Active',
    daysIn: 12,
    goalDays: 60,
    progress: 20,
    notes: '',
    targetDate: '2026-10-15',
  },
  {
    id: 'pg-03',
    client: 'Darnell P.',
    title: 'Return to work in food service',
    status: 'Active',
    daysIn: 8,
    goalDays: 90,
    progress: 15,
    notes: '',
    targetDate: '2026-11-01',
  },
  {
    id: 'pg-04',
    client: 'Marcus T.',
    title: 'Attend community events monthly',
    status: 'Active',
    daysIn: 22,
    goalDays: 30,
    progress: 73,
    notes: '22 days in',
    targetDate: '2026-09-20',
  },
  {
    id: 'pg-05',
    client: 'Marcus T.',
    title: 'Volunteer at library',
    status: 'In Progress',
    daysIn: 18,
    goalDays: 30,
    progress: 60,
    notes: 'Orientation completed Aug 3',
    targetDate: '2026-09-01',
  },
  {
    id: 'pg-06',
    client: 'Marcus T.',
    title: 'Reduce social isolation',
    status: 'Active',
    daysIn: 14,
    goalDays: 45,
    progress: 35,
    notes: '',
    targetDate: '2026-10-01',
  },
  {
    id: 'pg-07',
    client: 'Keena M.',
    title: 'Full-time employment',
    status: 'In Progress',
    daysIn: 28,
    goalDays: 60,
    progress: 55,
    notes: 'Job interview Aug 6 at Walmart',
    targetDate: '2026-09-30',
  },
  {
    id: 'pg-08',
    client: 'Keena M.',
    title: 'Own apartment by end of year',
    status: 'Active',
    daysIn: 40,
    goalDays: 120,
    progress: 33,
    notes: 'Family support secured for deposit',
    targetDate: '2026-12-31',
  },
  {
    id: 'pg-09',
    client: 'Tyrone B.',
    title: 'Maintain stable housing',
    status: 'Active',
    daysIn: 45,
    goalDays: 90,
    progress: 50,
    notes: '45 days in unit 14B',
    targetDate: '2026-12-01',
  },
  {
    id: 'pg-10',
    client: 'Tyrone B.',
    title: 'Build daily routine with medication adherence',
    status: 'Active',
    daysIn: 30,
    goalDays: 60,
    progress: 50,
    notes: '',
    targetDate: '2026-10-15',
  },
  {
    id: 'pg-11',
    client: 'Leticia R.',
    title: 'Reunite with children (custody hearing Sept 2026)',
    status: 'Active',
    daysIn: 12,
    goalDays: 60,
    progress: 20,
    notes: 'Day 12',
    targetDate: '2026-09-30',
  },
  {
    id: 'pg-12',
    client: 'Leticia R.',
    title: 'Complete parenting skills program',
    status: 'In Progress',
    daysIn: 25,
    goalDays: 50,
    progress: 50,
    notes: '',
    targetDate: '2026-11-15',
  },
  {
    id: 'pg-13',
    client: 'Raymond G.',
    title: 'Secure competitive employment',
    status: 'In Progress',
    daysIn: 20,
    goalDays: 45,
    progress: 45,
    notes: 'Job fair attended Aug 5',
    targetDate: '2026-10-01',
  },
  {
    id: 'pg-14',
    client: 'Raymond G.',
    title: 'Join a faith community',
    status: 'Active',
    daysIn: 10,
    goalDays: 60,
    progress: 17,
    notes: '',
    targetDate: '2026-11-01',
  },
];

export const PEER_PLACEMENTS_SEED: CommunityPlacement[] = [
  {
    id: 'pp-01',
    client: 'Marcus T.',
    activityType: 'Volunteer',
    organization: 'Baltimore Public Library',
    startDate: '2026-08-10',
    status: 'Active',
    hoursPerWeek: 8,
    notes: 'Shelving and patron assistance; supervisor contact: Dana Reeves.',
  },
  {
    id: 'pp-02',
    client: 'Keena M.',
    activityType: 'Competitive Employment',
    organization: 'Walmart Supercenter #4821',
    startDate: null,
    status: 'Pending',
    hoursPerWeek: 32,
    notes: 'Interviewed Aug 6; awaiting offer. Peer specialist to assist with onboarding.',
  },
  {
    id: 'pp-03',
    client: 'Raymond G.',
    activityType: 'Social Club',
    organization: "St. Matthew's Church",
    startDate: '2026-07-15',
    status: 'Active',
    hoursPerWeek: 4,
    notes: 'Attending weekly peer drop-in; building social connections.',
  },
  {
    id: 'pp-04',
    client: 'Tyrone B.',
    activityType: 'Housing Program',
    organization: 'Helping Up Mission — Transitional Housing',
    startDate: '2026-06-20',
    status: 'Active',
    hoursPerWeek: null,
    notes: 'Stable in unit 14B; rent subsidy through Dec 2026.',
  },
  {
    id: 'pp-05',
    client: 'Leticia R.',
    activityType: 'Education',
    organization: 'Baltimore City Community College — GED Prep',
    startDate: '2026-07-01',
    status: 'Active',
    hoursPerWeek: 6,
    notes: 'Evening GED class; peer accompanies to first session each month.',
  },
  {
    id: 'pp-06',
    client: 'Darnell P.',
    activityType: 'Volunteer',
    organization: 'Our Daily Bread Employment Center',
    startDate: '2026-08-01',
    status: 'Active',
    hoursPerWeek: 3,
    notes: 'Kitchen volunteer shift Saturdays; supports food service return goal.',
  },
];

export function formatPeerDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function startOfWeek(from = new Date()): string {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(from = new Date()): string {
  const d = new Date(from);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function normalizeGoal(raw: RecoveryGoal): RecoveryGoal {
  const progress = raw.progress ?? 0;
  return {
    ...raw,
    daysIn: raw.daysIn ?? Math.round((progress / 100) * 90),
    goalDays: raw.goalDays ?? 90,
    notes: raw.notes || '',
  };
}

/** ClinicModuleState keys: prp-meta, prp-groups, prp-participants, prp-domains, prp-reports */

export type SessionStatus = 'in_progress' | 'upcoming' | 'completed';
export type SessionType = 'Wellness' | 'Skills' | 'Vocational' | 'Community';
export type ParticipantStatus = 'active' | 'transitioning';
export type Phase = 'Phase 1' | 'Phase 2' | 'Phase 3';
export type ReportStatus = 'ready' | 'in_progress' | 'due' | 'draft';

export type PrpSession = {
  id: string;
  time: string;
  name: string;
  facilitator: string;
  room: string;
  enrolled: number;
  capacity: number;
  type: SessionType;
  status: SessionStatus;
  attendanceTaken?: boolean;
};

export type PrpParticipant = {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  specialist: string;
  enrolled: string;
  goalsTotal: number;
  goalsMet: number;
  attendance: number;
  status: ParticipantStatus;
  phase: Phase;
};

export type PrpDomain = {
  id: string;
  domain: string;
  active: number;
  completed: number;
  icon: 'home' | 'briefcase' | 'handshake' | 'globe';
  color: string;
  bg: string;
};

export type PrpReport = {
  id: string;
  title: string;
  desc: string;
  period: string;
  status: ReportStatus;
  icon: 'trend' | 'billing' | 'clipboard' | 'grad' | 'chart' | 'globe';
};

export type PrpMeta = {
  version: 1;
  programName: string;
  orgName: string;
  scheduleDate: string;
  activeParticipants: number;
  groupSessionsToday: number;
  goalsMetThisMonth: number;
  avgAttendanceRate: number;
  comarCode: string;
  billingCode: string;
  licensedBy: string;
};

export const PRP_META_SEED: PrpMeta = {
  version: 1,
  programName: 'PRP Program',
  orgName: 'MD Behavioral Health',
  scheduleDate: '',
  activeParticipants: 0,
  groupSessionsToday: 0,
  goalsMetThisMonth: 0,
  avgAttendanceRate: 0,
  comarCode: 'COMAR 10.21.20',
  billingCode: 'H2018 + H2016 (pending confirmation)',
  licensedBy: 'BEHAVIORAL HEALTH ADMINISTRATION',
};

export const PRP_GROUPS_SEED: PrpSession[] = [];

export const PRP_PARTICIPANTS_SEED: PrpParticipant[] = [];

export const PRP_DOMAINS_SEED: PrpDomain[] = [
  {
    id: 'pd-01',
    domain: 'Independent Living',
    icon: 'home',
    active: 0,
    completed: 0,
    color: '#7C3AED',
    bg: '#F3E8FF',
  },
  {
    id: 'pd-02',
    domain: 'Vocational Skills',
    icon: 'briefcase',
    active: 0,
    completed: 0,
    color: '#2563EB',
    bg: '#DBEAFE',
  },
  {
    id: 'pd-03',
    domain: 'Social Functioning',
    icon: 'handshake',
    active: 0,
    completed: 0,
    color: '#059669',
    bg: '#D1FAE5',
  },
  {
    id: 'pd-04',
    domain: 'Community Integration',
    icon: 'globe',
    active: 0,
    completed: 0,
    color: '#EA580C',
    bg: '#FFEDD5',
  },
];

export const PRP_REPORTS_SEED: PrpReport[] = [
  {
    id: 'pr-01',
    title: 'Monthly Progress Report',
    desc: 'Individual goal achievement, attendance, and phase transitions.',
    period: '',
    status: 'draft',
    icon: 'trend',
  },
  {
    id: 'pr-02',
    title: 'Medicaid PRP Billing Summary',
    desc: 'PRP encounters (H2016) and monthly case rate (H2018); billing pending confirmation.',
    period: '',
    status: 'draft',
    icon: 'billing',
  },
  {
    id: 'pr-03',
    title: 'Group Attendance Log',
    desc: 'Per-session attendance for all group activities.',
    period: '',
    status: 'draft',
    icon: 'clipboard',
  },
  {
    id: 'pr-04',
    title: 'Transition Planning Report',
    desc: 'Participants completing Phase 3 and readiness for discharge.',
    period: '',
    status: 'draft',
    icon: 'grad',
  },
  {
    id: 'pr-05',
    title: 'Outcome Measures (MORS)',
    desc: 'Maryland Outcomes Rating Scale quarterly assessment.',
    period: '',
    status: 'draft',
    icon: 'chart',
  },
  {
    id: 'pr-06',
    title: 'Stakeholder Report',
    desc: 'Program summary for community partners and funders.',
    period: '',
    status: 'draft',
    icon: 'globe',
  },
];

export function domainCompletionRate(d: PrpDomain): number {
  const total = d.active + d.completed;
  if (!total) return 0;
  return Math.round((d.completed / total) * 100);
}

export function formatScheduleDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

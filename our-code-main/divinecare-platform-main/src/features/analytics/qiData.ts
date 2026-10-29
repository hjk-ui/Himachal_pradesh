/** ClinicModuleState keys: `qi-indicators`, `qi-caps`, `qi-meetings`, `qi-meta`. */

export type Trend = 'up' | 'down' | 'stable';
export type IndicatorStatus = 'Meeting' | 'At Risk' | 'Below Target';
export type CapStatus = 'Open' | 'In Progress' | 'Completed' | 'Overdue';

export type PerformanceIndicator = {
  id: string;
  name: string;
  target: number;
  current: number;
  unit: string;
  /** Display for target column e.g. "<15%" when lower-is-better */
  targetDisplay?: string;
  trend: Trend;
  status: IndicatorStatus;
  period: string;
  monthlyData: number[];
  monthlyLabels: string[];
  higherIsBetter: boolean;
};

export type CAPRecord = {
  id: string;
  capNum: string;
  indicator: string;
  rootCause: string;
  actionSteps: string[];
  responsible: string;
  dueDate: string;
  status: CapStatus;
};

export type QIMeeting = {
  id: string;
  date: string;
  title?: string;
  attendees: string[];
  agendaItems: string[];
  decisions: string[];
  nextSteps: string[];
};

export type QIProgramMeta = {
  version: 1;
  period: string;
  periodRange: string;
  nextMeetingDate: string;
  lastSurveyScore: number;
  lastSurveyMax: number;
  lastSurveyLabel: string;
  resolvedCapsPriorYear: number;
  resolvedCapsYearLabel: string;
};

export const QI_META_SEED: QIProgramMeta = {
  version: 1,
  period: '',
  periodRange: '',
  nextMeetingDate: '',
  lastSurveyScore: 0,
  lastSurveyMax: 5,
  lastSurveyLabel: '',
  resolvedCapsPriorYear: 0,
  resolvedCapsYearLabel: '',
};

export const QI_INDICATORS_SEED: PerformanceIndicator[] = [];

export const QI_CAPS_SEED: CAPRecord[] = [
  {
    id: 'c01',
    capNum: 'CAP-2026-01',
    indicator: 'PHQ-9 re-administration rate',
    rootCause:
      'Reminder system not triggering at 85-day mark due to a configuration error in the EHR scheduling module.',
    actionSteps: [
      'Configured automated alert in EHR at 85-day mark',
      'Assigned follow-up accountability to clinical leads',
      'Added tracking dashboard',
    ],
    responsible: 'Dr. Patricia Moore',
    dueDate: '2026-09-30',
    status: 'In Progress',
  },
  {
    id: 'c02',
    capNum: 'CAP-2026-02',
    indicator: 'Treatment plan update rate',
    rootCause:
      'High caseload and clinicians not receiving the 80-day advance reminder for treatment plan reviews.',
    actionSteps: [
      'Added dashboard to-do alert at 80-day mark',
      'Practice director reviewing caseload balance',
      'Monthly compliance report distributed to supervisors',
    ],
    responsible: 'James Osei, LPC',
    dueDate: '2026-09-15',
    status: 'In Progress',
  },
  {
    id: 'c03',
    capNum: 'CAP-2026-03',
    indicator: 'HIPAA training compliance',
    rootCause:
      'Two new hires in June 2026 missed the initial onboarding training window due to scheduling conflicts.',
    actionSteps: [
      'Revised onboarding checklist to include mandatory HIPAA training within 7 days of start date',
      'HR tracking completion in personnel files',
    ],
    responsible: 'Alicia Thompson, HR',
    dueDate: '2026-08-31',
    status: 'In Progress',
  },
  {
    id: 'c04',
    capNum: 'CAP-2025-04',
    indicator: 'Safety plan completion rate',
    rootCause: 'No standardized process for identifying high-risk clients at intake.',
    actionSteps: [
      'Implemented Columbia Protocol screening',
      'Created safety plan template in EHR',
      'Required completion before second session',
    ],
    responsible: 'Dr. Patricia Moore',
    dueDate: '2025-10-31',
    status: 'Completed',
  },
  {
    id: 'c05',
    capNum: 'CAP-2025-03',
    indicator: 'Wait time to first appointment exceeded target',
    rootCause: 'Insufficient intake appointment slots; two therapists on leave simultaneously.',
    actionSteps: [
      'Added 4 weekly intake slots',
      'Established coverage protocol for extended leave',
      'Hired one additional clinician',
    ],
    responsible: 'Front Desk',
    dueDate: '2025-07-31',
    status: 'Completed',
  },
];

export const QI_MEETINGS_SEED: QIMeeting[] = [
  {
    id: 'm00',
    date: '2026-09-03',
    title: 'QI Committee — Q3 mid-cycle review',
    attendees: [
      'Dr. Patricia Moore',
      'Dr. Angela Chen',
      'James Osei, LPC',
      'Alicia Thompson',
      'Marcus Williams, NP',
    ],
    agendaItems: [
      'Q3 indicator dashboard review',
      'Open CAP status (CAP-2026-01 / 02 / 03)',
      'Documentation compliance bi-weekly audit results',
      'CARF readiness checkpoint',
    ],
    decisions: [],
    nextSteps: [
      'Confirm CAP owners bring updated evidence packets',
      'Distribute Q3 draft QI report 5 days before meeting',
    ],
  },
  {
    id: 'm01',
    date: '2026-08-05',
    title: 'QI Committee — August session',
    attendees: [
      'Dr. Patricia Moore',
      'Dr. Angela Chen',
      'James Osei, LPC',
      'Alicia Thompson',
      'Marcus Williams, NP',
    ],
    agendaItems: [
      'Q2 2026 outcome data review',
      'CAP-2026-01 and -02 status updates',
      'Client satisfaction survey Q2 results',
      'CARF preparation checklist review',
    ],
    decisions: [
      'Approved CAP-2026-02 action plan modification',
      'Reviewed PHQ-9 trend — improving trajectory noted',
      'Directed increased monitoring frequency for documentation compliance',
    ],
    nextSteps: [
      'Increase documentation compliance checks to bi-weekly through Q3',
      'Dr. Moore to present safety plan completion data at next meeting',
      'Schedule CARF readiness audit for Oct 2026',
    ],
  },
  {
    id: 'm02',
    date: '2026-05-12',
    title: 'QI Committee — May session',
    attendees: [
      'Dr. Patricia Moore',
      'Dr. Angela Chen',
      'James Osei, LPC',
      'Alicia Thompson',
      'Denise Parks, LCSW',
    ],
    agendaItems: [
      'Q1 2026 indicator review',
      'PHQ-9 re-administration trend analysis',
      'New CAP consideration for re-admin rate',
      'Staff satisfaction survey results',
    ],
    decisions: [
      'Opened CAP-2026-01 for PHQ-9 re-administration rate',
      'Approved revised onboarding checklist draft',
      'Accepted Q1 QI report',
    ],
    nextSteps: [
      'Dr. Moore to oversee CAP-2026-01 implementation',
      'IT to reconfigure EHR reminder',
      'Follow-up at Aug meeting',
    ],
  },
  {
    id: 'm03',
    date: '2026-02-10',
    title: 'QI Committee — Annual planning',
    attendees: ['Dr. Patricia Moore', 'Dr. Angela Chen', 'James Osei, LPC', 'Alicia Thompson'],
    agendaItems: [
      'Annual program evaluation review — FY 2025',
      'CARF self-study status',
      'Outcome data benchmarking vs national standards',
      'QI plan goals for 2026',
    ],
    decisions: [
      'Approved 2025 annual program evaluation report',
      'Endorsed 2026 QI plan with 12 performance indicators',
      'Directed director to submit CARF self-study by Apr 30, 2026',
    ],
    nextSteps: [
      'Distribute approved annual evaluation to all clinical staff',
      'Schedule mock CARF site visit',
      'QI coordinator to maintain monthly indicator tracking',
    ],
  },
  {
    id: 'm04',
    date: '2025-11-08',
    title: 'QI Committee — Q3 2025 closeout',
    attendees: ['Dr. Patricia Moore', 'James Osei, LPC', 'Alicia Thompson', 'Denise Parks, LCSW'],
    agendaItems: [
      'Q3 2025 indicator review',
      'CAP-2025-03 closure review',
      'CAP-2025-04 closure review',
      'Planning for 2026 QI indicators',
    ],
    decisions: [
      'Closed CAP-2025-03 (wait time) — target consistently met for 90 days',
      'Closed CAP-2025-04 (safety plans) — 100% compliance achieved',
      'Began drafting 2026 indicator set',
    ],
    nextSteps: [
      'QI coordinator to compile 2025 annual data for Feb 2026 review',
      'Finalize 2026 indicator list by Dec 2025',
    ],
  },
];

export function formatIndicatorValue(value: number, unit: string): string {
  if (unit === '%') return Number.isInteger(value) ? `${value}%` : `${value}%`;
  if (unit === '/5') return `${value} / 5.0`;
  if (unit === 'd') return `${value}d`;
  return `${value}${unit}`;
}

export function formatTarget(ind: PerformanceIndicator): string {
  if (ind.targetDisplay) return ind.targetDisplay;
  return formatIndicatorValue(ind.target, ind.unit);
}

export function daysUntil(dateIso: string, from = new Date()): number {
  const target = new Date(`${dateIso}T12:00:00`);
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatMeetingDate(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isQIMeta(data: unknown): data is QIProgramMeta {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.version === 1 && typeof m.period === 'string' && typeof m.nextMeetingDate === 'string';
}

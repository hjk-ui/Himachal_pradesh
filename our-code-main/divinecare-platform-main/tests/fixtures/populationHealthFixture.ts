/**
 * Mock fixtures for Population Health testing.
 * ISOLATED TO TESTS ONLY — never imported in production application code.
 */
import type {
  PopulationHealthPayload,
  PopulationClient,
  ActionItem,
  ClinicianCaseload,
} from '@/features/analytics/populationHealthData';

export const MOCK_CLINICIANS = [
  'James Osei, LPC',
  'Dr. Rachel Chen, NP',
  'Marcus Williams, LCSW',
  'Deyona Smith, LCSW-C',
  'Elena Vasquez, LGPC',
];

export const MOCK_POPULATION_HEALTH_FIXTURE: PopulationHealthPayload = {
  version: 1,
  updatedAt: '2026-08-26T12:00:00.000Z',
  activeCaseload: 87,
  highRiskCount: 12,
  moderateCount: 34,
  lowCount: 41,
  avgPhq9: 9.4,
  priorAvgPhq9: 11.2,
  engagementRate: 78,
  clients: [
    {
      id: 'pop-high-1',
      name: 'M.T.',
      phq9: 18,
      risk: 'High',
      lastContact: '2026-08-23',
      riskNotes: 'Suicidal ideation flagged.',
      clinician: 'Marcus Williams, LCSW',
      daysSinceContact: 3,
    },
    {
      id: 'pop-high-2',
      name: 'J.W.',
      phq9: 16,
      risk: 'High',
      lastContact: '2026-08-21',
      riskNotes: 'Self-harm history.',
      clinician: 'James Osei, LPC',
      daysSinceContact: 5,
    },
  ],
  actions: [
    {
      id: 'act-1',
      clientId: 'pop-high-1',
      clientName: 'M.T.',
      title: 'Suicide risk assessment overdue',
      urgency: 'critical',
      due: 'Today',
      done: false,
      primaryAction: 'Start C-SSRS',
      primaryHref: '/dashboard/ehr/assessments?client=pop-high-1&type=cssrs',
    },
  ],
  phq9Trend: [
    { month: 'Jan', value: 12.1 },
    { month: 'Feb', value: 11.8 },
    { month: 'Mar', value: 11.2 },
    { month: 'Apr', value: 10.8 },
    { month: 'May', value: 10.1 },
    { month: 'Jun', value: 9.4 },
  ],
  gad7Trend: [
    { month: 'Jan', value: 10.8 },
    { month: 'Feb', value: 10.2 },
    { month: 'Mar', value: 9.8 },
    { month: 'Apr', value: 9.1 },
    { month: 'May', value: 8.7 },
    { month: 'Jun', value: 8.2 },
  ],
  clinicians: [
    {
      id: 'pop-cl-jo',
      initials: 'JO',
      name: 'James Osei, LPC',
      activeClients: 22,
      highRisk: 4,
      avgPhq9: 10.2,
      docCurrent: 91,
      capacity: 'At capacity',
      color: '#6868D0',
    },
  ],
};

import type { SoloDayKey, SoloPracticeSetup } from './types';

export const SOLO_DAYS: SoloDayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const SOLO_LICENSE_TYPES = [
  'LCSW',
  'LCSW-C',
  'LGPC',
  'LCPC',
  'LMFT',
  'LPC',
  'LGMFT',
  'LPCC',
  'PhD',
  'PsyD',
  'MD',
  'NP',
  'PA',
] as const;

export const SOLO_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

export const SOLO_PAYERS = [
  'Maryland Medicaid',
  'Medicare Part B',
  'CareFirst BCBS',
  'Aetna',
  'United Healthcare',
  'Cigna',
  'Humana',
  'Tricare',
  'Magellan Health',
  'Optum',
];

export const SOLO_CANCELLATION_OPTIONS = [
  '24 hours',
  '48 hours',
  '72 hours',
  'No cancellation policy',
] as const;

export const EMPTY_PRACTICE_SETUP: SoloPracticeSetup = {
  practiceName: '',
  practiceTagline: '',
  practiceAddress: '',
  practiceCity: '',
  practiceState: 'MD',
  practiceZip: '',
  practicePhone: '',
  practiceWebsite: '',
  practiceBio: '',
  fullName: '',
  npi: '',
  caqhId: '',
  licenseNumber: '',
  licenseType: '',
  licenseState: 'MD',
  licenseExpiryDate: '',
  services: [
    {
      serviceId: 'svc-initial',
      name: 'Initial Consultation',
      duration: 60,
      fee: 180,
      description: 'First appointment: assessment and treatment planning',
      active: true,
    },
    {
      serviceId: 'svc-therapy',
      name: 'Individual Therapy',
      duration: 53,
      fee: 150,
      description: 'Standard individual therapy session',
      active: true,
    },
  ],
  acceptsInsurance: true,
  acceptedPayers: ['Maryland Medicaid', 'Medicare Part B'],
  selfPayRate: 150,
  slidingScalePolicy: '',
  availability: {
    Mon: { enabled: true, start: '09:00', end: '17:00' },
    Tue: { enabled: true, start: '09:00', end: '17:00' },
    Wed: { enabled: true, start: '09:00', end: '17:00' },
    Thu: { enabled: true, start: '09:00', end: '17:00' },
    Fri: { enabled: true, start: '09:00', end: '15:00' },
    Sat: { enabled: false, start: '09:00', end: '13:00' },
    Sun: { enabled: false, start: '09:00', end: '13:00' },
  },
  bufferMinutes: 10,
  leadTimeHours: 24,
  bookingWindowDays: 30,
  requireCreditCard: false,
  cancellationPolicy: '24 hours',
  remindersNote: 'Clients receive SMS/email reminders 24 hours before the appointment.',
};

/** Merge persisted JSON (may lack newer fields) onto defaults. */
export function normalizePracticeSetup(
  raw: Partial<SoloPracticeSetup> | null | undefined
): SoloPracticeSetup {
  if (!raw) return { ...EMPTY_PRACTICE_SETUP, services: [...EMPTY_PRACTICE_SETUP.services] };
  return {
    ...EMPTY_PRACTICE_SETUP,
    ...raw,
    practiceTagline: raw.practiceTagline ?? '',
    practiceCity: raw.practiceCity ?? '',
    practiceState: raw.practiceState || EMPTY_PRACTICE_SETUP.practiceState,
    practiceZip: raw.practiceZip ?? '',
    caqhId: raw.caqhId ?? '',
    leadTimeHours: typeof raw.leadTimeHours === 'number' ? raw.leadTimeHours : 24,
    remindersNote: raw.remindersNote ?? EMPTY_PRACTICE_SETUP.remindersNote,
    services: Array.isArray(raw.services) && raw.services.length
      ? raw.services
      : [...EMPTY_PRACTICE_SETUP.services],
    availability: {
      ...EMPTY_PRACTICE_SETUP.availability,
      ...(raw.availability || {}),
    },
    acceptedPayers: Array.isArray(raw.acceptedPayers) ? raw.acceptedPayers : [],
  };
}

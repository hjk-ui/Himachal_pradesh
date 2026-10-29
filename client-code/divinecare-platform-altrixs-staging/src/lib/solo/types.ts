export type SoloLicenseType =
  | 'LCSW'
  | 'LCSW-C'
  | 'LGPC'
  | 'LCPC'
  | 'LMFT'
  | 'LPC'
  | 'LGMFT'
  | 'LPCC'
  | 'PhD'
  | 'PsyD'
  | 'MD'
  | 'NP'
  | 'PA';

export type SoloDayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type SoloService = {
  serviceId: string;
  name: string;
  duration: number;
  fee: number;
  description: string;
  active?: boolean;
};

export type SoloPracticeSetup = {
  practiceName: string;
  practiceTagline: string;
  practiceAddress: string;
  practiceCity: string;
  practiceState: string;
  practiceZip: string;
  practicePhone: string;
  practiceWebsite: string;
  practiceBio: string;
  fullName: string;
  npi: string;
  caqhId: string;
  licenseNumber: string;
  licenseType: SoloLicenseType | '';
  licenseState: string;
  licenseExpiryDate: string;
  services: SoloService[];
  acceptsInsurance: boolean;
  acceptedPayers: string[];
  selfPayRate: number;
  acceptsSelfPay?: boolean;
  slidingScale?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  slidingScalePolicy: string;
  availability: Record<SoloDayKey, { enabled: boolean; start: string; end: string }>;
  bufferMinutes: number;
  leadTimeHours: number;
  bookingWindowDays: number;
  requireCreditCard: boolean;
  cancellationPolicy: '24 hours' | '48 hours' | '72 hours' | 'No cancellation policy';
  remindersNote: string;
  bookingSlug?: string;
  completedAt?: string;
};

export type SoloAuditEntry = {
  id: string;
  action: string;
  entityId: string;
  timestamp: string;
  note: string;
};

export type PublicBookingAppointment = {
  id: string;
  confirmationCode: string;
  serviceId: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  clientName: string;
  clientEmail: string;
  paymentType: 'Insurance' | 'Self-Pay' | 'Sliding Scale';
  createdAt: string;
};

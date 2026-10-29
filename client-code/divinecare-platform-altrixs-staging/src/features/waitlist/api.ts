import { apiJson } from '@/lib/api-client';

export type WaitlistStatus = 'waiting' | 'matched' | 'scheduled' | 'closed';
export type WaitlistUrgency = 'routine' | 'urgent' | 'crisis';
export type WaitlistStage = 'NEW' | 'CONTACTED' | 'INTAKE_SENT' | 'READY' | 'SCHEDULED' | 'CONVERTED' | 'CLOSED';
export type SafetyScreen = 'no' | 'yes' | 'not_asked';

export type WaitlistEntry = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  preferredContactMethod: string | null;
  bestTimeToContact: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  specialty: string;
  service: string;
  ageGroup: string | null;
  preferredLocationIds: string[];
  telehealthOk: boolean | null;
  availabilityDays: string[];
  availabilityTimes: string[];
  clinicianGenderPref: string | null;
  languagePref: string | null;
  urgency: WaitlistUrgency;
  status: WaitlistStatus;
  stage: WaitlistStage;
  closeReason: string | null;
  insurancePayer: string | null;
  payerRegistryId: string | null;
  insuranceMemberId: string | null;
  referralSource: string | null;
  referringProvider: string | null;
  presentingConcern: string | null;
  safetyScreen: SafetyScreen | null;
  safetyScreenAt: string | null;
  notes: string | null;
  preferredClinician: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  convertedClientId: string | null;
  convertedAppointmentId: string | null;
  matchedAt: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  noResponseCount: number;
  contactCount: number;
  promptNoResponseClose: boolean;
  createdById: string | null;
  source: string | null;
  createdAt: string;
  daysWaiting: number;
};

export type WaitlistClinician = {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
};

export type WaitlistInput = Partial<{
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  preferredContactMethod: string | null;
  bestTimeToContact: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelationship: string | null;
  specialty: string;
  ageGroup: string | null;
  preferredLocationIds: string[];
  telehealthOk: boolean | null;
  availabilityDays: string[];
  availabilityTimes: string[];
  clinicianGenderPref: string | null;
  languagePref: string | null;
  urgency: WaitlistUrgency;
  insurancePayer: string | null;
  payerRegistryId: string | null;
  insuranceMemberId: string | null;
  referralSource: string | null;
  referringProvider: string | null;
  presentingConcern: string | null;
  safetyScreen: SafetyScreen | null;
  notes: string | null;
  preferredClinician: string | null;
  stage: WaitlistStage;
}>;

export type WaitlistContact = {
  id: string;
  method: string;
  outcome: string;
  note: string | null;
  nextFollowUpAt: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type DuplicateMatch = { clientId: string; name: string; mrn: string | null; status: string | null; level: 'strong' | 'possible'; basis: string };

export type ClinicianSuggestion = {
  clinicianId: string;
  name: string;
  role: string;
  credentials: string | null;
  inNetwork: 'yes' | 'no' | 'unknown';
  location: 'yes' | 'no' | 'unknown' | 'telehealth';
  preferred: boolean;
  slots: { startsAt: string; endsAt: string }[];
};

export type SchedulePreview = {
  duplicates: DuplicateMatch[];
  linkedClientId: string | null;
  service: string;
  appointmentType: string;
  durationMin: number;
  timeZone: string;
  clinicians: ClinicianSuggestion[];
  eligibility: boolean;
};

export type ConversionBody = {
  linkClientId?: string | null;
  createDespiteMatches?: boolean;
  appointment?: { clinicianId: string; startsAt: string; endsAt: string; type: string; isVirtual: boolean } | null;
  assignedToId?: string | null;
  locationId?: string | null;
  sendIntake?: boolean;
  runEligibility?: boolean;
};

export type ConversionResponse = {
  success: true;
  clientId: string;
  linked: boolean;
  appointmentId: string | null;
  bookingError: string | null;
  intake: { token: string } | { error: string } | null;
  eligibility: { status: string } | { error: string } | null;
  stage: 'SCHEDULED' | 'CONVERTED' | 'READY';
  entry?: WaitlistEntry;
};

export async function fetchWaitlist() {
  return apiJson<{
    success: true;
    entries: WaitlistEntry[];
    clinicians: WaitlistClinician[];
    locations: { id: string; name: string }[];
    payers: { id: string; name: string }[];
    permissions: { canManage: boolean; canAdd: boolean; eligibility: boolean };
  }>('/api/waitlist');
}

export async function createWaitlistEntry(input: WaitlistInput) {
  return apiJson<{ success: true; entry: WaitlistEntry; crisisGuidance: boolean }>('/api/waitlist', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWaitlistEntry(id: string, input: WaitlistInput) {
  return apiJson<{ success: true; entry: WaitlistEntry; crisisGuidance?: boolean }>(`/api/waitlist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function fetchWaitlistEntry(id: string) {
  return apiJson<{ success: true; entry: WaitlistEntry; contacts: WaitlistContact[] }>(`/api/waitlist/${id}`);
}

export async function closeWaitlistEntry(id: string, closeReason: string, closeNote?: string | null) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>(`/api/waitlist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'close', closeReason, closeNote: closeNote || null }),
  });
  return data.entry;
}

export async function reopenWaitlistEntry(id: string) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>(`/api/waitlist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'reopen' }),
  });
  return data.entry;
}

export async function logWaitlistContact(id: string, input: { method: string; outcome: string; note?: string | null; nextFollowUpAt?: string | null }) {
  return apiJson<{ success: true; entry: WaitlistEntry; promptClose: 'no_response' | 'declined' | null }>(`/api/waitlist/${id}/contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function matchWaitlistEntry(id: string, clinicianId: string) {
  const data = await apiJson<{ success: true; entry: WaitlistEntry }>(`/api/waitlist/${id}/match`, {
    method: 'POST',
    body: JSON.stringify({ clinicianId }),
  });
  return data.entry;
}

export async function fetchSchedulePreview(id: string) {
  return apiJson<{ success: true } & SchedulePreview>(`/api/waitlist/${id}/schedule`);
}

/** Throws with `.status` 409 and `.data.code === 'POSSIBLE_DUPLICATE'` when a chart may already exist. */
export async function scheduleFromWaitlist(id: string, body: ConversionBody) {
  return apiJson<ConversionResponse>(`/api/waitlist/${id}/schedule`, { method: 'POST', body: JSON.stringify(body) });
}

export async function convertWaitlistEntry(id: string, body: Omit<ConversionBody, 'appointment' | 'runEligibility'> = {}) {
  return apiJson<ConversionResponse & { client: { id: string } }>(`/api/waitlist/${id}/convert`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function convertWaitlistToIntake(id: string) {
  return apiJson<{
    success: true;
    invite: { id: string; token: string; clientName: string; clientEmail: string; status: string };
    reused?: boolean;
  }>(`/api/waitlist/${id}/intake`, { method: 'POST' });
}

export async function bulkSendIntake(ids: string[]) {
  return apiJson<{ success: true; results: { id: string; ok: boolean; token?: string; reused?: boolean; error?: string }[] }>('/api/waitlist/bulk-intake', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

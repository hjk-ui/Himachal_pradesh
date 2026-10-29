import { apiJson } from '@/lib/api-client';

export type IntakeStatus = 'pending' | 'completed' | 'expired';

export type AppointmentType = 'In Office' | 'Telehealth';

export type IntakeInvite = {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  firstAppointment: string | null;
  status: IntakeStatus;
  sentCount: number;
  sentAt: string;
  completedAt: string | null;
  expiresAt: string;
  token: string;
  clientId: string | null;
  waitlistEntryId: string | null;
  hasFormData: boolean;
  insurancePayer?: string | null;
  assignedToId?: string | null;
  appointmentType?: AppointmentType | string | null;
  homeless?: boolean;
  formData?: unknown;
};

export type CreateIntakeInput = {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  firstAppointment?: string | null;
  assignedToId?: string | null;
  waitlistEntryId?: string | null;
  insurancePayer?: string | null;
  appointmentType?: AppointmentType | string | null;
  homeless?: boolean;
  sendVia?: 'Email' | 'SMS' | 'Both';
};

export async function fetchIntakeInvites() {
  const data = await apiJson<{ success: true; invites: IntakeInvite[] }>('/api/intake');
  return data.invites;
}

export async function createIntakeInvite(input: CreateIntakeInput) {
  const data = await apiJson<{ success: true; invite: IntakeInvite }>('/api/intake', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.invite;
}

export async function resendIntakeInvite(id: string) {
  const data = await apiJson<{ success: true; invite: IntakeInvite }>(
    `/api/intake/${id}/resend`,
    { method: 'POST' }
  );
  return data.invite;
}

export async function fetchIntakeInvite(id: string) {
  const data = await apiJson<{ success: true; invite: IntakeInvite }>(`/api/intake/${id}`);
  return data.invite;
}

export async function convertWaitlistToIntake(waitlistId: string) {
  return apiJson<{
    success: true;
    invite: IntakeInvite;
    reused?: boolean;
  }>(`/api/waitlist/${waitlistId}/intake`, { method: 'POST' });
}

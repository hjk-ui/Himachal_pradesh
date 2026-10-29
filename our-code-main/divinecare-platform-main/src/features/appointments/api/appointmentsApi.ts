import { apiJson } from '@/lib/api-client';
import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
  NoteStatus,
} from '../types';

export async function fetchAppointments(options?: {
  clientId?: string;
  isVirtual?: boolean;
  date?: string;
}): Promise<Appointment[]> {
  const params = new URLSearchParams();
  if (options?.clientId) params.set('clientId', options.clientId);
  if (options?.isVirtual) params.set('isVirtual', 'true');
  if (options?.date) params.set('date', options.date);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await apiJson<{ success: true; appointments: Appointment[] }>(
    `/api/appointments${qs}`
  );
  return data.appointments;
}

export async function createAppointment(
  input: CreateAppointmentInput
): Promise<Appointment> {
  const data = await apiJson<{ success: true; appointment: Appointment }>(
    '/api/appointments',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.appointment;
}

export async function updateAppointment(
  id: string,
  data: {
    status?: AppointmentStatus;
    visitStatus?: AppointmentStatus;
    noteStatus?: NoteStatus;
    notes?: string | null;
  }
): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(
    `/api/appointments/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        visitStatus: data.visitStatus ?? data.status,
        noteStatus: data.noteStatus,
        notes: data.notes,
        status: data.status,
      }),
    }
  );
  return res.appointment;
}

export async function generateAppointmentAiDraft(id: string): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(
    `/api/appointments/${id}/generate-ai-draft`,
    { method: 'POST' }
  );
  return res.appointment;
}

export async function confirmAppointment(id: string): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(
    `/api/appointments/${id}/confirm`,
    { method: 'POST' }
  );
  return res.appointment;
}

export async function declineAppointment(id: string, reason?: string): Promise<Appointment> {
  const res = await apiJson<{ success: true; appointment: Appointment }>(
    `/api/appointments/${id}/decline`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: reason?.trim() || 'Declined by clinician' }),
    }
  );
  return res.appointment;
}


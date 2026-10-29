import { apiJson } from '@/lib/api-client';
import type {
  CommunityEventDTO,
  CommunityPartnerDTO,
  CommunityVolunteerDTO,
} from '@/lib/community/manage';

export type { CommunityEventDTO, CommunityPartnerDTO, CommunityVolunteerDTO };

export async function fetchCommunity() {
  return apiJson<{
    success: true;
    events: CommunityEventDTO[];
    partners: CommunityPartnerDTO[];
    volunteers: CommunityVolunteerDTO[];
  }>('/api/community');
}

export async function createCommunityEvent(input: {
  title: string;
  eventType: string;
  date: string;
  startTime: string;
  endTime: string;
  locationName: string;
  description?: string;
  expectedAttendees?: number;
  volunteersNeeded?: number;
}) {
  const data = await apiJson<{ success: true; event: CommunityEventDTO }>('/api/community/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.event;
}

export async function updateCommunityEvent(
  id: string,
  input: Record<string, unknown>
) {
  const data = await apiJson<{ success: true; event: CommunityEventDTO }>(
    `/api/community/events/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  return data.event;
}

export async function signUpVolunteer(eventId: string, volunteerId?: string) {
  const data = await apiJson<{
    success: true;
    event: CommunityEventDTO;
    volunteer: CommunityVolunteerDTO | null;
  }>(`/api/community/events/${eventId}/volunteer-signup`, {
    method: 'POST',
    body: JSON.stringify({ volunteerId }),
  });
  return data;
}

export async function createCommunityPartner(input: { name: string; category: string }) {
  const data = await apiJson<{ success: true; partner: CommunityPartnerDTO }>(
    '/api/community/partners',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.partner;
}

export async function createCommunityVolunteer(input: { name: string; role: string }) {
  const data = await apiJson<{ success: true; volunteer: CommunityVolunteerDTO }>(
    '/api/community/volunteers',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.volunteer;
}

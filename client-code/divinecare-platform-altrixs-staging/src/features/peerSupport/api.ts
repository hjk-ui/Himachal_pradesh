import { apiJson } from '@/lib/api-client';
import type { PeerContactDto, PeerGoalDto, PeerPlacementDto } from '@/lib/peerSupport/manage';
import type { ContactMode, FollowUpState, GoalDomain, GoalStatus, LegacyEntry, LegacyKind, PlacementStatus, PlacementType } from '@/lib/peerSupport/workflow';

export type { PeerContactDto, PeerGoalDto, PeerPlacementDto };

export interface CaseloadClient {
  id: string;
  name: string;
  status: string;
  assignment: 'assigned' | 'care_team' | null;
  peerSpecialists: string[];
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  openGoals: number;
}

export interface FollowUpItem {
  contactId: string;
  clientId: string;
  clientName: string;
  followUpAt: string;
  state: FollowUpState;
  lastContactMode: string;
  peerName: string | null;
  mine: boolean;
}

export interface PeerSummary {
  caseloadSize: number;
  contactsThisMonth: number;
  clientsEngaged30d: number;
  openGoals: number;
  followUpsOverdue: number;
  followUpsDueToday: number;
}

export interface Caseload {
  clients: CaseloadClient[];
  followUps: FollowUpItem[];
  upcomingFollowUps: number;
  summary: PeerSummary;
  peers: { id: string; name: string }[];
  truncated: boolean;
}

export interface CommunityResource {
  id: string;
  name: string;
  domains: string[];
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  hours: string | null;
  cost: string | null;
  eligibilityNotes: string | null;
  lastVerifiedAt: string | null;
}

export type LegacyCounts = Record<LegacyKind, { pending: number; imported: number; sampleRows: number; unreadable: number }>;
export interface LegacyOverview {
  canImport: boolean;
  counts: LegacyCounts;
  entries: Omit<LegacyEntry, 'raw'>[];
  peers: { id: string; name: string }[];
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const q = (params: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const peerApi = {
  caseload: () => apiJson<Caseload>('/api/peer-support/caseload'),
  searchClients: (term: string) =>
    apiJson<{ clients: { id: string; name: string; status: string }[] }>(`/api/peer-support/clients${q({ q: term })}`),
  contacts: (opts: { clientId?: string | null; days?: number } = {}) =>
    apiJson<{ contacts: PeerContactDto[] }>(`/api/peer-support/contacts${q({ clientId: opts.clientId, days: opts.days ? String(opts.days) : null })}`),
  createContact: (body: {
    clientId: string;
    contactAt: string;
    mode: ContactMode;
    durationMinutes?: number | null;
    topics?: string[];
    goalIds?: string[];
    notes?: string | null;
    followUpAt?: string | null;
    completesFollowUpIds?: string[];
  }) => apiJson<{ contact: PeerContactDto; followUpsCompleted: number }>('/api/peer-support/contacts', { method: 'POST', ...json(body) }),
  updateContact: (id: string, body: { followUpDone?: boolean; followUpAt?: string | null }) =>
    apiJson<{ contact: PeerContactDto }>(`/api/peer-support/contacts/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  voidContact: (id: string, reason: string) =>
    apiJson<{ contact: PeerContactDto }>(`/api/peer-support/contacts/${encodeURIComponent(id)}`, { method: 'DELETE', ...json({ reason }) }),
  goals: (opts: { clientId?: string | null; includeClosed?: boolean } = {}) =>
    apiJson<{ goals: PeerGoalDto[] }>(`/api/peer-support/goals${q({ clientId: opts.clientId, includeClosed: opts.includeClosed ? '1' : null })}`),
  createGoal: (body: { clientId: string; goal: string; domain: GoalDomain; status?: GoalStatus; targetDate?: string | null; progressNote?: string | null }) =>
    apiJson<{ goal: PeerGoalDto }>('/api/peer-support/goals', { method: 'POST', ...json(body) }),
  updateGoal: (id: string, body: { status?: GoalStatus; progressNote?: string | null; targetDate?: string | null }) =>
    apiJson<{ goal: PeerGoalDto }>(`/api/peer-support/goals/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  placements: (opts: { includeClosed?: boolean } = {}) =>
    apiJson<{ placements: PeerPlacementDto[] }>(`/api/peer-support/placements${q({ includeClosed: opts.includeClosed ? '1' : null })}`),
  createPlacement: (body: {
    clientId: string;
    placementType: PlacementType;
    organizationName?: string | null;
    resourceId?: string | null;
    status?: PlacementStatus;
    startDate?: string | null;
    hoursPerWeek?: number | null;
    notes?: string | null;
  }) => apiJson<{ placement: PeerPlacementDto }>('/api/peer-support/placements', { method: 'POST', ...json(body) }),
  updatePlacement: (id: string, body: { status?: PlacementStatus; endDate?: string | null }) =>
    apiJson<{ placement: PeerPlacementDto }>(`/api/peer-support/placements/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
  resources: () => apiJson<{ resources: CommunityResource[] }>('/api/peer-support/resources'),
  legacy: () => apiJson<LegacyOverview>('/api/peer-support/legacy'),
  importLegacy: (body: {
    kind: LegacyKind;
    legacyId: string;
    clientId: string;
    peerUserId: string;
    contactAt?: string | null;
    mode?: ContactMode;
    domain?: GoalDomain;
    placementType?: PlacementType;
  }) => apiJson<{ id: string; clientId: string }>('/api/peer-support/legacy', { method: 'POST', ...json(body) }),
  /** Existing care-team API: adds a peer specialist to the client's treatment team. */
  assignPeer: (clientId: string, providerId: string) =>
    apiJson<{ member: unknown }>(`/api/clients/${encodeURIComponent(clientId)}/care-team`, {
      method: 'POST',
      ...json({ providerId, role: 'Peer Support Specialist' }),
    }),
};

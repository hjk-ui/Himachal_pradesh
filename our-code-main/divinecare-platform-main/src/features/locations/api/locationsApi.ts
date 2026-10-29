import { apiJson } from '@/lib/api-client';
import type {
  CreateLocationInput,
  LocationRecord,
  OrganizationRecord,
  UpdateLocationInput,
} from '../types';

export async function fetchOrganization() {
  const data = await apiJson<{ success: true; organization: OrganizationRecord }>('/api/org', {
    cache: 'no-store',
  });
  return data.organization;
}

export async function fetchLocations(activeOnly = false) {
  const q = activeOnly ? '?active=1' : '';
  const data = await apiJson<{ success: true; locations: LocationRecord[] }>(
    `/api/locations${q}`,
    { cache: 'no-store' }
  );
  return data.locations;
}

export async function createLocation(input: CreateLocationInput) {
  const data = await apiJson<{ success: true; location: LocationRecord }>('/api/locations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.location;
}

export async function updateLocation(id: string, input: UpdateLocationInput) {
  const data = await apiJson<{ success: true; location: LocationRecord }>(
    `/api/locations/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
  return data.location;
}

export async function deactivateLocation(id: string) {
  const data = await apiJson<{ success: true; location: LocationRecord }>(
    `/api/locations/${id}`,
    {
      method: 'DELETE',
    }
  );
  return data.location;
}

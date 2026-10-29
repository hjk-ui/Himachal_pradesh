import { apiJson } from '@/lib/api-client';
import type { HrCornerPayload } from './hrCornerTypes';

export async function fetchHrCorner() {
  return apiJson<HrCornerPayload>('/api/hr/corner');
}

export async function hrCornerAction(body: Record<string, unknown>) {
  return apiJson<{ success: true } & Record<string, unknown>>('/api/hr/corner', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

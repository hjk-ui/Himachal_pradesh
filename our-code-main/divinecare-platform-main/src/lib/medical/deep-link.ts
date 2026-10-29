/**
 * Primary-care schedule → medical visit deep-links.
 * Query keys are stable: appointmentId + clientId.
 */

export type MedicalDeepLinkQuery = {
  appointmentId: string | null;
  clientId: string | null;
  clientName: string | null;
};

export function parseMedicalDeepLink(
  search: string | URLSearchParams | Record<string, string | string[] | undefined> | null | undefined
): MedicalDeepLinkQuery {
  let params: URLSearchParams;
  if (!search) {
    params = new URLSearchParams();
  } else if (typeof search === 'string') {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } else if (search instanceof URLSearchParams) {
    params = search;
  } else {
    params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === 'string') params.set(key, value);
      else if (Array.isArray(value) && typeof value[0] === 'string') params.set(key, value[0]);
    }
  }

  const appointmentId = (params.get('appointmentId') || '').trim() || null;
  const clientId = (params.get('clientId') || '').trim() || null;
  const clientName = (params.get('clientName') || '').trim() || null;

  return { appointmentId, clientId, clientName };
}

export function medicalRoomingHref(input: {
  appointmentId: string;
  clientId: string;
  clientName?: string | null;
}): string {
  const qs = new URLSearchParams({
    appointmentId: input.appointmentId,
    clientId: input.clientId,
  });
  if (input.clientName) qs.set('clientName', input.clientName);
  return `/dashboard/medical?${qs.toString()}`;
}

export function medicalProviderVisitHref(input: {
  appointmentId: string;
  clientId: string;
  clientName?: string | null;
}): string {
  const qs = new URLSearchParams({
    appointmentId: input.appointmentId,
    clientId: input.clientId,
  });
  if (input.clientName) qs.set('clientName', input.clientName);
  return `/dashboard/medical/visits?${qs.toString()}`;
}

export function deepLinkIsComplete(q: MedicalDeepLinkQuery): boolean {
  return Boolean(q.appointmentId && q.clientId);
}

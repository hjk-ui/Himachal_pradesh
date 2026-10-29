export type AppointmentCreatedVia = 'staff' | 'group' | 'online' | 'portal' | 'import';

export function formatBookedByLabel(input: {
  createdVia?: string | null;
  createdByName?: string | null;
  createdAt?: Date | string | null;
  patientBooked?: boolean;
}): string {
  const via = (input.createdVia || (input.patientBooked ? 'online' : null)) as
    | AppointmentCreatedVia
    | null;
  const name = (input.createdByName || '').trim();
  const stamp = input.createdAt
    ? new Date(input.createdAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  if (!via) {
    return input.createdAt
      ? 'Not recorded (booked before tracking started)'
      : 'Not recorded';
  }
  if (via === 'online') return 'Client, online booking page';
  if (via === 'portal') return 'Client, patient portal';
  if (via === 'import') return 'Imported from Valant';
  if (via === 'group') {
    return name ? `${name} (group session)${stamp ? ` · ${stamp}` : ''}` : `Group session${stamp ? ` · ${stamp}` : ''}`;
  }
  // staff
  return name ? `${name}${stamp ? ` · ${stamp}` : ''}` : stamp || 'Not recorded';
}

export function formatLastChangedBy(input: {
  lastChangedByName?: string | null;
  lastChangedAt?: Date | string | null;
}): string | null {
  if (!input.lastChangedByName) return null;
  const stamp = input.lastChangedAt
    ? new Date(input.lastChangedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  return `Last changed by ${input.lastChangedByName}${stamp ? ` · ${stamp}` : ''}`;
}

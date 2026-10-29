/**
 * Effective location of an appointment. Pure: no prisma.
 *
 * Appointments are NOT backfilled with a location. The location of a visit is:
 *   1. the appointment's own location (Appointment.location_id, raw SQL column) when it resolves to a
 *      Location of the organization, else
 *   2. the client's home location (Client.locationId), labeled "inferred", else
 *   3. none.
 * Appointment.location_id was added by prisma/migrations/20261015_practice_locations.sql, which keyed it to
 * the legacy practice_locations table ('bowie' | 'ss' | 'lex' | 'balt'). Those ids are resolved to the
 * organization's Location of the same name; anything else that is not a Location id is ignored.
 */

export type EffectiveLocationSource = 'appointment' | 'client_home' | 'none';

export type EffectiveLocation = {
  locationId: string | null;
  source: EffectiveLocationSource;
  /** true when the location is not recorded on the appointment itself */
  inferred: boolean;
};

/** Legacy practice_locations ids (20261015_practice_locations.sql) -> the location name they stand for */
export const LEGACY_PRACTICE_LOCATION_NAMES: Record<string, string> = {
  bowie: 'Bowie',
  ss: 'Silver Spring',
  lex: 'Lexington Park',
  balt: 'Baltimore',
};

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Raw appointment location value -> Location id of the organization, or null.
 * Accepts a Location id, a legacy practice_locations id, or a location name.
 */
export function buildAppointmentLocationResolver(
  locations: { id: string; name: string }[]
): (raw: string | null | undefined) => string | null {
  const ids = new Set(locations.map((l) => l.id));
  const byName = new Map(locations.map((l) => [norm(l.name), l.id]));
  return (raw) => {
    const v = (raw ?? '').trim();
    if (!v) return null;
    if (ids.has(v)) return v;
    const legacy = LEGACY_PRACTICE_LOCATION_NAMES[v.toLowerCase()];
    if (legacy) return byName.get(norm(legacy)) ?? null;
    return byName.get(norm(v)) ?? null;
  };
}

export function effectiveLocation(
  input: { appointmentLocation?: string | null; clientLocationId?: string | null },
  resolveAppointmentLocation: (raw: string | null | undefined) => string | null
): EffectiveLocation {
  const own = resolveAppointmentLocation(input.appointmentLocation);
  if (own) return { locationId: own, source: 'appointment', inferred: false };
  if (input.clientLocationId) return { locationId: input.clientLocationId, source: 'client_home', inferred: true };
  return { locationId: null, source: 'none', inferred: true };
}

export const EFFECTIVE_SOURCE_LABELS: Record<EffectiveLocationSource, string> = {
  appointment: 'Location on the appointment',
  client_home: "Inferred from the client's home location",
  none: 'No location',
};

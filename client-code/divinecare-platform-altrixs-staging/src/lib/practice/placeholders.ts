/**
 * Identifiers and addresses that were invented by early seed migrations
 * (prisma/migrations/20261015_practice_locations.sql and 20261015_oct10_14_pillars.sql).
 * They are not the practice's real values: never default to them, never bill with them,
 * and flag them as "Unverified — imported placeholder" wherever they still appear.
 * Cleared from the database by prisma/migrations/20261018_clear_placeholder_location_npis.sql.
 */
export const PLACEHOLDER_NPIS: readonly string[] = ['1457893210', '1457893211', '1457893212', '1457893213', '1457893214'];

/** Exact street lines seeded for the legacy practice_locations rows (matched with their ZIP). */
export const PLACEHOLDER_ADDRESSES: ReadonlyArray<{ addressLine1: string; zip: string }> = [
  { addressLine1: '15500 Annapolis Rd', zip: '20715' },
  { addressLine1: '13870 Georgia Ave', zip: '20906' },
  { addressLine1: '21600 Great Mills Rd', zip: '20653' },
  { addressLine1: '2801 Smith Ave', zip: '21209' },
  { addressLine1: '14300 Gallant Fox Ln', zip: '20715' },
  { addressLine1: '8401 Colesville Rd', zip: '20910' },
  { addressLine1: '201 E Pratt St', zip: '21202' },
  { addressLine1: '21770 FDR Blvd', zip: '20653' },
];

export const PLACEHOLDER_LABEL = 'Unverified — imported placeholder, please confirm';

export function isPlaceholderNpi(npi: string | null | undefined): boolean {
  return PLACEHOLDER_NPIS.includes((npi || '').trim());
}

export function isPlaceholderAddress(addressLine1: string | null | undefined, zip?: string | null): boolean {
  const line = (addressLine1 || '').trim().toLowerCase();
  if (!line) return false;
  const z = (zip || '').replace(/\D/g, '').slice(0, 5);
  return PLACEHOLDER_ADDRESSES.some((a) => a.addressLine1.toLowerCase() === line && (!z || a.zip === z));
}

/** Field names on a location whose current value is a known placeholder. */
export function placeholderLocationFields(l: { npi?: string | null; addressLine1?: string | null; postalCode?: string | null }): string[] {
  const out: string[] = [];
  if (isPlaceholderNpi(l.npi)) out.push('npi');
  if (isPlaceholderAddress(l.addressLine1, l.postalCode)) out.push('addressLine1');
  return out;
}

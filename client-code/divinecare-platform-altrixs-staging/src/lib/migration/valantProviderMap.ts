/**
 * Valant provider code -> staff user mapping (ValantProviderMap). Pure: no prisma, safe for tests and
 * client components. The table is filled by a person in Admin > Data import > Valant provider codes.
 *
 * - Codes are compared by codeKey: trimmed, inner spaces collapsed, lowercased. "K.Daniel" and
 *   "k.daniel " are the same code; "K.Daniel" and "Daniel K" are DIFFERENT codes (they may be the
 *   same person, but only a person can say so by mapping both to one user).
 * - Nothing here matches a code to a staff member by name. The import's stored match
 *   (ValantTransaction.providerUserId, matchProviderCode: initial + last name, unique hit) is shown
 *   on the mapping page as a suggestion to confirm; it never counts as a mapping.
 */

export const VALANT_PROVIDER_MAP_PATH = '/dashboard/admin/migration?tab=provider-codes';

export function providerCodeKey(code: string | null | undefined): string {
  return String(code ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** codeKey -> userId */
export type ProviderCodeMap = ReadonlyMap<string, string>;

export function buildProviderCodeMap(rows: readonly { codeKey: string; userId: string }[]): ProviderCodeMap {
  return new Map(rows.filter((r) => r.codeKey && r.userId).map((r) => [r.codeKey, r.userId]));
}

/** Mapped staff user for a code, or null (never guessed) */
export function mappedUserId(code: string | null | undefined, map: ProviderCodeMap): string | null {
  const key = providerCodeKey(code);
  return key ? map.get(key) ?? null : null;
}

/**
 * Provider Collections: a mapped code wins; an unmapped code keeps the import's stored match
 * (the report's long-standing behavior) and says so through `basis`.
 */
export function collectionsProviderUserId(
  code: string | null | undefined,
  storedUserId: string | null,
  map: ProviderCodeMap
): { userId: string | null; basis: 'map' | 'import_match' | null } {
  const mapped = mappedUserId(code, map);
  if (mapped) return { userId: mapped, basis: 'map' };
  if (storedUserId) return { userId: storedUserId, basis: 'import_match' };
  return { userId: null, basis: null };
}

/** One row of the mapping page: a code seen in imported Valant transactions */
export type ProviderCodeRow = {
  providerCode: string;
  codeKey: string;
  /** rows in imported transactions (all facilities) */
  rows: number;
  /** charge rows with facility "Family Practice" (primary care encounters before de-duplication) */
  primaryCareCharges: number;
  lastServiceDate: string | null;
  mappedUserId: string | null;
  /** the import's name match, shown as a suggestion only */
  importMatchUserId: string | null;
};

/**
 * Merge raw (code, stored match) groups into one row per codeKey. A code whose rows carry different
 * stored matches gets no suggestion (conflicting evidence is not a suggestion).
 */
export function providerCodeRows(
  groups: readonly {
    providerCode: string | null;
    providerUserId: string | null;
    rows: number;
    primaryCareCharges: number;
    lastServiceDate: Date | null;
  }[],
  map: ProviderCodeMap
): ProviderCodeRow[] {
  const byKey = new Map<string, ProviderCodeRow & { matches: Set<string> }>();
  for (const g of groups) {
    const key = providerCodeKey(g.providerCode);
    if (!key) continue;
    const row = byKey.get(key) ?? {
      providerCode: String(g.providerCode).trim().replace(/\s+/g, ' '),
      codeKey: key,
      rows: 0,
      primaryCareCharges: 0,
      lastServiceDate: null,
      mappedUserId: map.get(key) ?? null,
      importMatchUserId: null,
      matches: new Set<string>(),
    };
    row.rows += g.rows;
    row.primaryCareCharges += g.primaryCareCharges;
    const d = g.lastServiceDate ? g.lastServiceDate.toISOString().slice(0, 10) : null;
    if (d && (!row.lastServiceDate || d > row.lastServiceDate)) row.lastServiceDate = d;
    if (g.providerUserId) row.matches.add(g.providerUserId);
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .map(({ matches, ...r }) => ({ ...r, importMatchUserId: matches.size === 1 ? [...matches][0] : null }))
    .sort((a, b) => b.primaryCareCharges - a.primaryCareCharges || b.rows - a.rows || a.codeKey.localeCompare(b.codeKey));
}

/**
 * 42 CFR Part 2 / VIP (SensitiveRecord) lock for list feeds and one-client reads.
 *
 * Lists: rows of clients the actor may not open (no PD / ADMIN bypass, not whitelisted, no live
 * break-glass grant) are dropped. Lookup failure fails closed (every client-linked row dropped).
 * One-client reads: assertClientPhiAccess (logs the access / denial) mapped to a 403 body with the
 * break-glass path.
 */
import type { Role } from '@prisma/client';
import { assertClientPhiAccess, lockedSensitiveClientIds, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';

export type LockActor = { organizationId: string; userId: string; role: Role | string };

/** Pure: keep rows whose client is not locked. Rows with no clientId are kept. */
export function filterLockedRows<T>(rows: T[], locked: Set<string>, clientIdOf: (row: T) => string | null | undefined): T[] {
  if (!locked.size) return rows;
  return rows.filter((r) => {
    const id = clientIdOf(r);
    return !id || !locked.has(id);
  });
}

/** Client ids this actor may not open, or null when the lookup failed (callers fail closed). */
export async function lockedIdsOrNull(actor: LockActor, clientIds: (string | null | undefined)[]): Promise<Set<string> | null> {
  try {
    return await lockedSensitiveClientIds({
      organizationId: actor.organizationId,
      userId: actor.userId,
      role: actor.role,
      clientIds: clientIds.filter((v): v is string => Boolean(v)),
    });
  } catch (err) {
    console.error('[lockedRows] sensitive lookup failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** Drop rows of locked Part 2 / VIP clients (fail closed: drop every client-linked row on error). */
export async function withoutLockedClients<T>(
  actor: LockActor,
  rows: T[],
  clientIdOf: (row: T) => string | null | undefined = (r) => (r as { clientId?: string | null }).clientId,
): Promise<T[]> {
  if (!rows.length) return rows;
  const locked = await lockedIdsOrNull(actor, rows.map(clientIdOf));
  if (!locked) return rows.filter((r) => !clientIdOf(r));
  return filterLockedRows(rows, locked, clientIdOf);
}

export type PhiBlock = { status: 403; body: { error: string; canRequestBreakGlass: true } };

/** One-client read: null when allowed, else the 403 response body (break-glass path). Other errors rethrow. */
export async function clientPhiBlock(actor: LockActor, clientId: string, path?: string): Promise<PhiBlock | null> {
  try {
    await assertClientPhiAccess({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientId, path });
    return null;
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return { status: 403, body: { error: err.body.error, canRequestBreakGlass: true } };
    }
    throw err;
  }
}

export const PROTECTED_RECORD_LABEL = 'Protected record';

/**
 * Pure: keep every row but replace locked clients' rows with `mask(row)` (e.g. blank body /
 * description, alias name). A null `locked` (lookup failed) masks every client-linked row.
 */
export function maskLockedRows<T>(
  rows: T[],
  locked: Set<string> | null,
  clientIdOf: (row: T) => string | null | undefined,
  mask: (row: T) => T,
): T[] {
  return rows.map((r) => {
    const id = clientIdOf(r);
    if (!id) return r;
    return locked === null || locked.has(id) ? mask(r) : r;
  });
}

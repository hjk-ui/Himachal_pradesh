/**
 * Shared gate for /api/notes/[id]/* routes: signed-in org member with notes access, and the note
 * is in the org and on the actor's caseload (findAccessibleNote — same rule as chart notes).
 */
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientChartNotes } from '@/lib/clients/orgScope';
import { findAccessibleNote } from '@/lib/clients/notes';

/**
 * Admin elevation (Role Preview): the ADMIN / PRACTICE_DIRECTOR base role re-read from the DB
 * (verifiedAdminBaseRole), never the JWT's session.user.baseRole claim (stale after a demotion).
 */
export async function verifiedNoteBaseRole(gate: { userId: string }): Promise<Role | null> {
  return ((await verifiedAdminBaseRole(gate.userId)) as Role | null) ?? null;
}

export type NoteGate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

export async function requireNotesGate(): Promise<{ ok: true; gate: NoteGate; baseRole: Role | null } | { ok: false; status: number; error: string }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };
  const baseRole = await verifiedNoteBaseRole(gate);
  const allowed =
    canAccessPath(gate.role, '/dashboard/ehr/notes') ||
    canAccessClientChartNotes(gate.role) ||
    baseRole === 'ADMIN' ||
    baseRole === 'PRACTICE_DIRECTOR';
  if (!allowed) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, gate, baseRole };
}

export async function requireAccessibleNote(noteId: string) {
  const g = await requireNotesGate();
  if (g.ok === false) return g;
  const found = await findAccessibleNote({
    noteId,
    organizationId: g.gate.organizationId,
    actorUserId: g.gate.userId,
    actorRole: g.gate.role,
    actorBaseRole: g.baseRole,
  });
  if (found.ok === false) return { ok: false as const, status: found.status, error: found.error };
  return { ok: true as const, gate: g.gate, baseRole: g.baseRole, note: found.note };
}

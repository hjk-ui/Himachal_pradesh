import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listLockedProgressNoteSnapshots } from '@/lib/notes/workflow-store';
import { withNoteMeta } from '@/lib/clients/notes';

export const runtime = 'nodejs';

/** Drops the note body; every other snapshot / metadata field is kept. */
function lockedNoteMetadata<T extends { body?: unknown }>(note: T): Omit<T, 'body'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { body, ...meta } = note;
  return meta;
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/claims')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  // Metadata only (type, DOS, CPT, POS, Part 2 flag): the claims queue never reads the note
  // body, so the narrative (including 42 CFR Part 2 notes) is not sent to billing.
  const notes = (
    await withNoteMeta(
      await listLockedProgressNoteSnapshots({
        organizationId: gate.organizationId,
      })
    )
  ).map(lockedNoteMetadata);

  return NextResponse.json({ success: true, notes });
}

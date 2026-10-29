import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadPrintableNote } from '@/lib/notes/print';
import { requireAccessibleNote } from '@/lib/notes/routeAccess';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/print — the signed note as printed / saved to PDF / released: signature
 * block, credentials, times, co-signature, late-entry label, addenda, Part 2 notice.
 * Psychotherapy notes are never included. Audited as NOTE_PRINT.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireAccessibleNote(id);
  if (access.ok === false) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  const result = await loadPrintableNote(access.note.id);
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  const purpose = new URL(req.url).searchParams.get('purpose') === 'release' ? 'release' : 'print';
  await auditPhiAccess({
    gate: access.gate,
    req,
    action: 'NOTE_PRINT',
    resourceType: 'progressNote',
    resourceId: access.note.id,
    patientId: result.clientId,
    metadata: { purpose, status: result.status, part2: access.note.part2 },
  });
  return NextResponse.json({ success: true, printable: result.printable });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findAccessibleClient, findCapture, loadLines } from '@/lib/scribe/store';
import { speakerLabelsInferred } from '@/lib/scribe/diarization';
import { captureView, jsonError, scribeGate } from '../../_lib/gate';

export const runtime = 'nodejs';

/** GET /api/scribe/captures/[id] — capture, diarized transcript lines and the latest draft. Audited READ. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  const cap = await findCapture(g.actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  const { lines, speakerMap, labels } = await loadLines(cap);
  // Review header: "Right client?" (name + date of birth) before "Create draft note"
  const client = await findAccessibleClient(g.actor, cap.clientId).catch(() => null);
  const draft = await prisma.scribeDraft.findFirst({ where: { sessionId: cap.id }, orderBy: { createdAt: 'desc' } });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'READ',
    resourceType: 'scribeCapture',
    resourceId: cap.id,
    patientId: cap.clientId,
    metadata: { lines: lines.length, draft: Boolean(draft) },
  });
  return NextResponse.json(
    {
      success: true,
      capture: captureView(cap),
      lines,
      speakerMap,
      /** Speaker labels are a guess and not yet confirmed: drafting is refused until they are */
      speakersInferred: speakerLabelsInferred(labels) && !cap.speakersConfirmedAt,
      client: client ? { name: client.name, dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null } : null,
      purged: Boolean(cap.transcriptPurgedAt),
      draft: draft ? { id: draft.id, format: draft.format, createdAt: draft.createdAt.toISOString(), content: draft.content } : null,
      clientSummary: cap.clientSummary ? { text: cap.clientSummary, status: cap.clientSummaryStatus, sharedAt: cap.clientSummarySharedAt?.toISOString() ?? null } : null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

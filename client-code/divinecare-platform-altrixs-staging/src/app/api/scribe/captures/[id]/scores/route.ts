import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findCapture } from '@/lib/scribe/store';
import { VERBAL_SOURCE, verbalInstrument, verbalSeverity } from '@/lib/scribe/verbalScores';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  instrument: z.string().trim().min(2).max(20),
  score: z.number().int().min(0).max(100),
  /** The clinician confirmed the score was stated in this session */
  confirmed: z.literal(true),
});

/**
 * POST /api/scribe/captures/[id]/scores — "Save as PHQ-9 = 14 (verbal)": a screening total stated in
 * session and found in the grounded draft (instrument + number in the cited transcript lines) is
 * saved as a ClinicalAssessmentRecord, source 'verbal_in_session', administration 'Verbal', no item
 * answers. The clinician confirms first; only the capturing clinician; audited WRITE.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Confirm the instrument and score first.');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician can save session scores');
  const inst = verbalInstrument(body.instrument);
  if (!inst || body.score > inst.max) return jsonError(400, 'Unknown instrument or score out of range.');
  // Only a score the grounded draft found in the transcript (never a number typed here)
  const draft = await prisma.scribeDraft.findFirst({ where: { sessionId: cap.id }, orderBy: { createdAt: 'desc' }, select: { id: true, content: true } });
  const scores = ((draft?.content as { scores?: { instrumentId?: string; score?: number }[] } | null)?.scores ?? []).filter((s) => s.instrumentId === inst.id && s.score === body.score);
  if (!scores.length) return jsonError(409, 'That score is not in the reviewed draft. Enter it in Assessments instead.');
  const severity = verbalSeverity(inst, body.score);
  const rec = await prisma.clinicalAssessmentRecord.create({
    data: {
      organizationId: actor.organizationId,
      clientId: cap.clientId,
      instrumentId: inst.id,
      instrumentName: inst.name,
      category: inst.category,
      administrationType: 'Verbal',
      respondentType: 'Self',
      totalScore: body.score,
      severity,
      interpretation: severity,
      notes: 'Total stated in session (AI Scribe, verbal); confirmed by the clinician. No item responses recorded.',
      administeredById: actor.userId,
      source: VERBAL_SOURCE,
    },
    select: { id: true },
  });
  await auditPhiAccess({
    gate,
    req,
    action: 'WRITE',
    resourceType: 'clinicalAssessment',
    resourceId: rec.id,
    patientId: cap.clientId,
    metadata: { source: VERBAL_SOURCE, captureId: cap.id, draftId: draft?.id ?? null, instrument: inst.id },
  });
  return NextResponse.json({ success: true, id: rec.id, instrument: inst.name, score: body.score, severity }, { status: 201 });
}

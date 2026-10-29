import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { sendStaffMessage } from '@/lib/messages/manage';
import { composeSummary, SUD_TERMS } from '@/lib/scribe/clientSummary';
import type { CheckedSentence } from '@/lib/scribe/grounding';
import { findCapture, loadLines, loadScribeSettings, part2PortalConsent } from '@/lib/scribe/store';
import { jsonError, scribeGate } from '../../../_lib/gate';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { SUD_TERMS_ES, SUMMARY_CRISIS_LINE, summaryLanguageFor, summaryTranslationPrompt } from '@/lib/scribe/language';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate') }),
  z.object({ action: z.literal('approve'), text: z.string().trim().min(10).max(3500) }),
  z.object({ action: z.literal('share') }),
]);

/**
 * POST /api/scribe/captures/[id]/summary
 *   generate: plain-language summary from the latest draft's grounded summary + homework sentences
 *             (no extra model call). SUD content is removed for a Part 2 session without a signed
 *             Part 2 consent that covers the portal.
 *   approve:  the clinician's edited text becomes the approved summary.
 *   share:    sends the approved summary to the client's portal inbox (secure message), only when
 *             the practice allows sharing. Audited as SCRIBE_SUMMARY_SHARE (no text in the audit).
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
    return jsonError(400, 'Invalid request');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician can prepare the client summary');
  const part2Allowed = cap.part2 ? await part2PortalConsent(actor.organizationId, cap.clientId) : true;

  if (body.action === 'generate') {
    const draft = await prisma.scribeDraft.findFirst({ where: { sessionId: cap.id }, orderBy: { createdAt: 'desc' }, select: { content: true } });
    if (!draft) return jsonError(409, 'Create the AI draft first.');
    const content = draft.content as { summarySentences?: CheckedSentence[]; homework?: CheckedSentence[] };
    const { lines } = await loadLines(cap);
    const result = composeSummary({
      sentences: content.summarySentences ?? [],
      homework: content.homework ?? [],
      lineText: new Map(lines.map((l) => [l.id, l.text])),
      part2Session: cap.part2,
      part2ConsentAllowsPortal: part2Allowed,
    });
    // The client's preferred language: Spanish → the (already Part 2-filtered) summary is translated.
    // The note itself stays in English.
    const client = await prisma.client.findFirst({ where: { id: cap.clientId, organizationId: actor.organizationId }, select: { preferredLanguage: true } });
    const lang = summaryLanguageFor(client?.preferredLanguage);
    let text = result.text;
    if (lang === 'es') {
      if (!isBedrockConfigured()) return jsonError(503, 'The Spanish summary needs AWS Bedrock, which is not configured on this server. Nothing was generated.');
      await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'scribeClientSummary', resourceId: cap.id, patientId: cap.clientId, metadata: { feature: 'scribe-summary-translate', language: 'es', model: BEDROCK_MODELS.HAIKU } });
      try {
        const english = result.text.replace(SUMMARY_CRISIS_LINE.en, '').trim();
        const translated = (await invokeBedrock({ model: 'HAIKU', system: summaryTranslationPrompt(), userPrompt: english, maxTokens: 1500, temperature: 0 })).trim();
        if (!translated) throw new Error('empty');
        text = `${translated}\n\n${SUMMARY_CRISIS_LINE.es}`;
      } catch {
        return jsonError(503, 'The Spanish translation is unavailable right now. Nothing was generated; try again.');
      }
    }
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { clientSummary: text, clientSummaryStatus: 'draft' } });
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'scribeClientSummary', resourceId: cap.id, patientId: cap.clientId, metadata: { removedForPart2: result.removedForPart2, withheld: result.withheld, language: lang } });
    return NextResponse.json({ success: true, summary: { text, status: 'draft', grade: lang === 'en' ? result.grade : null, language: lang, removedForPart2: result.removedForPart2, withheld: result.withheld } });
  }

  if (body.action === 'approve') {
    if (cap.part2 && !part2Allowed && (SUD_TERMS.test(body.text) || SUD_TERMS_ES.test(body.text))) {
      return jsonError(422, 'This is a 42 CFR Part 2 session and the client has no Part 2 consent covering the portal: remove substance-use content before approving.');
    }
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { clientSummary: body.text, clientSummaryStatus: 'approved', clientSummaryApprovedById: actor.userId } });
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'scribeClientSummary', resourceId: cap.id, patientId: cap.clientId, metadata: { step: 'approved' } });
    return NextResponse.json({ success: true, summary: { text: body.text, status: 'approved' } });
  }

  // share
  const settings = await loadScribeSettings(actor.organizationId);
  if (!settings.clientSummarySharing) return jsonError(403, 'Client summary sharing is turned off in practice settings.');
  if (cap.clientSummaryStatus !== 'approved' || !cap.clientSummary) return jsonError(409, 'Approve the summary before sharing it.');
  if (cap.part2 && !part2Allowed && (SUD_TERMS.test(cap.clientSummary) || SUD_TERMS_ES.test(cap.clientSummary))) return jsonError(422, 'Part 2 content without consent: edit and approve again.');
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const sent = await sendStaffMessage({
    clientId: cap.clientId,
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRole: actor.role as Role,
    actorName: user?.name ?? null,
    content: `${cap.clientSummary.includes(SUMMARY_CRISIS_LINE.es) ? 'Resumen de la sesión de hoy' : "Summary of today's session"}\n\n${cap.clientSummary}`,
  });
  if (sent.ok === false) {
    await auditPhiAccess({ gate, req, action: 'SCRIBE_SUMMARY_SHARE', resourceType: 'scribeClientSummary', resourceId: cap.id, patientId: cap.clientId, outcome: 'FAILURE', metadata: { status: sent.status } });
    return jsonError(sent.status, sent.error);
  }
  await prisma.scribeCapture.update({ where: { id: cap.id }, data: { clientSummaryStatus: 'shared', clientSummarySharedAt: new Date() } });
  await auditPhiAccess({ gate, req, action: 'SCRIBE_SUMMARY_SHARE', resourceType: 'scribeClientSummary', resourceId: cap.id, patientId: cap.clientId, metadata: { channel: 'portal_message', part2: cap.part2 } });
  return NextResponse.json({ success: true, summary: { text: cap.clientSummary, status: 'shared' } });
}

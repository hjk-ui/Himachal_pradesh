import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { canAccessClientForAi } from '@/lib/ai/noteDraftSafety';
import { aiConsentFor, practiceAiConsentRequired } from '@/lib/scribe/store';
import {
  SECTION_INPUT_MAX,
  buildSectionDraftSystemPrompt,
  buildSectionDraftUserPrompt,
  groundSectionReply,
  sectionSources,
} from '@/lib/scribe/sectionDraft';
import { jsonError } from '../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  heading: z.string().trim().min(1).max(120),
  noteLabel: z.string().trim().min(1).max(120),
  scope: z.enum(['history', 'narrative']).default('narrative'),
  input: z.string().trim().min(10).max(SECTION_INPUT_MAX),
});

/**
 * POST /api/scribe/section-draft — grounded AI draft of ONE note section from the clinician's own
 * dictation / bullet points (note editors). Every sentence cites a dictation line; unsupported
 * sentences are withheld (grounding.ts), never inserted. Nothing is stored server-side (the
 * clinician's points stay in the editor). Not configured → 503, nothing generated. Declined AI
 * consent → 403; missing consent → 403 when the practice requires it (same rule as AI Scribe).
 * The AI_ACCESS audit row is written before PHI goes to Bedrock. Nothing here signs a note.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return jsonError(gate.status, gate.error);
  if (
    (!canAccessPath(gate.role, '/dashboard/scribe') && !canAccessPath(gate.role, '/dashboard/ehr/notes')) ||
    !canWriteClientChartNotes(gate.role)
  ) {
    return jsonError(403, 'Forbidden');
  }
  const plan = await requireFeatureWrite(gate.organizationId, 'ai_scribe');
  if (plan.ok === false) return jsonError(plan.status, plan.error, { code: plan.code });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, 'Dictate or type at least a few words (10+ characters). Nothing was sent.');
  }
  const audit = (outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', metadata: Record<string, unknown>) =>
    auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'clinicalNote',
      resourceId: 'section-draft',
      patientId: body.clientId,
      outcome,
      metadata: { feature: 'scribe-section-draft', heading: body.heading, ...metadata },
    });

  if (!(await canAccessClientForAi({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientId: body.clientId }))) {
    await audit('DENIED', { reason: 'client-not-accessible' });
    return jsonError(404, 'Client not found');
  }
  const [consent, required] = await Promise.all([aiConsentFor(gate.organizationId, body.clientId), practiceAiConsentRequired(gate.organizationId)]);
  if (consent === 'declined') {
    await audit('DENIED', { reason: 'ai_consent_declined' });
    return jsonError(403, 'This client declined AI use. Nothing was sent to the AI model; write the section yourself.', { code: 'CONSENT_DECLINED' });
  }
  if (consent === 'missing' && required) {
    await audit('DENIED', { reason: 'ai_consent_missing' });
    return jsonError(403, "No AI consent is on file for this client and the practice requires it. Record the client's AI Note Drafting consent first.", {
      code: 'CONSENT_MISSING',
    });
  }
  const sources = sectionSources(body.input);
  if (!sources.length) return jsonError(422, 'There is nothing to draft from. Nothing was sent to the AI.');
  if (!isBedrockConfigured()) {
    return jsonError(503, 'AI drafting is not configured on this server (AWS Bedrock). Nothing was generated; write the section yourself.', {
      provider: 'bedrock-unconfigured',
    });
  }

  await audit('SUCCESS', { model: BEDROCK_MODELS.SONNET, lines: sources.length, consent, inputChars: body.input.length });
  let reply: string;
  try {
    reply = await invokeBedrock({
      model: 'SONNET',
      system: buildSectionDraftSystemPrompt({ heading: body.heading, noteLabel: body.noteLabel, scope: body.scope }),
      userPrompt: buildSectionDraftUserPrompt(sources),
      maxTokens: 1500,
      temperature: 0,
      jsonMode: true,
    });
  } catch (err) {
    await audit('FAILURE', { reason: 'model_error', error: err instanceof Error ? err.name : 'unknown' });
    return jsonError(503, 'AI drafting is unavailable right now. Nothing was generated; write the section yourself or try again.', { provider: 'bedrock-error' });
  }
  const grounded = groundSectionReply(reply, sources);
  if (!grounded) {
    await audit('FAILURE', { reason: 'unreadable_reply' });
    return jsonError(502, 'The AI reply could not be read. Nothing was generated; try again or write the section yourself.');
  }
  await audit('SUCCESS', { step: 'grounded', sentences: grounded.sentences.length, withheld: grounded.withheld.length, weak: grounded.weak });
  return NextResponse.json(
    {
      success: true,
      provider: 'bedrock-live',
      modelId: BEDROCK_MODELS.SONNET,
      text: grounded.text,
      sentences: grounded.sentences,
      withheld: grounded.withheld.map((w) => ({ text: w.text, reason: w.reason ?? null })),
      weak: grounded.weak,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

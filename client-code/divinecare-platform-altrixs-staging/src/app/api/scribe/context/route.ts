import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { isBedrockConfigured } from '@/lib/ai/bedrockService';
import { hasFeature } from '@/lib/billing/entitlements';
import { getOrgAccess } from '@/lib/billing/entitlementsServer';
import { loadScribeContext } from '@/lib/scribe/context';
import {
  aiConsentFor,
  findAccessibleClient,
  isChimeTranscriptionConfigured,
  isPart2Client,
  isStreamingConfigured,
  loadPreferences,
  loadScribeSettings,
  practiceAiConsentRequired,
} from '@/lib/scribe/store';
import { jsonError, scribeGate } from '../_lib/gate';
import { prisma } from '@/lib/db/prisma';
import { recordingConsentRevoked } from '@/lib/consents/library/store2';
import { defaultCaptureLanguage } from '@/lib/scribe/language';
import { isUploadConfigured } from '@/lib/scribe/uploadAws';

export const runtime = 'nodejs';

/**
 * GET /api/scribe/context?clientId= — pre-session panel: plan goals, last plan / homework, scores,
 * measures due, consent status, Part 2 flag, practice settings, the clinician's preferences and
 * what is configured on this server (so the page says honestly when capture or AI is unavailable).
 */
export async function GET(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const clientId = new URL(req.url).searchParams.get('clientId')?.trim() || '';
  if (!clientId || clientId.length > 128) return jsonError(400, 'clientId is required');
  const client = await findAccessibleClient(g.actor, clientId);
  if (!client) return jsonError(404, 'Client not found');
  try {
    await assertClientPhiAccess({ ...g.actor, clientId, path: '/api/scribe/context' });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }
  const [context, settings, prefs, aiConsent, requiresAiConsent, part2, access, lang, revoked] = await Promise.all([
    loadScribeContext({ organizationId: g.actor.organizationId, userId: g.actor.userId, role: g.actor.role, clientId }),
    loadScribeSettings(g.actor.organizationId),
    loadPreferences(g.actor.organizationId, g.actor.userId),
    aiConsentFor(g.actor.organizationId, clientId),
    practiceAiConsentRequired(g.actor.organizationId),
    isPart2Client(g.actor.organizationId, clientId),
    getOrgAccess(g.actor.organizationId),
    prisma.client.findFirst({ where: { id: clientId, organizationId: g.actor.organizationId }, select: { preferredLanguage: true } }).catch(() => null),
    recordingConsentRevoked(g.actor.organizationId, clientId).catch(() => false),
  ]);
  await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'scribeContext', patientId: clientId, metadata: { goals: context.goals.length, measuresDue: context.measuresDue.length } });
  return NextResponse.json(
    {
      success: true,
      context,
      settings,
      preferences: prefs,
      consent: { ai: aiConsent, practiceRequiresAiConsent: requiresAiConsent, recordingRevoked: revoked },
      /** Capture language preselected from the client's preferred language (es → Spanish) */
      language: defaultCaptureLanguage(lang?.preferredLanguage),
      part2,
      configured: {
        streaming: isStreamingConfigured(),
        chimeTranscription: isChimeTranscriptionConfigured(),
        bedrock: isBedrockConfigured(),
        upload: isUploadConfigured(),
        entitled: hasFeature(access, 'ai_scribe'),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

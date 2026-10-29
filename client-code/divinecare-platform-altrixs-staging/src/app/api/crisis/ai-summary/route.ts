import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { validateClientBelongsToOrg } from '@/lib/crisis/tenantIsolation';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();
    const episode = body.episode || body;

    const rawEpisodeId = body.episodeId || body.id || (typeof body.episode === 'object' ? body.episode?.id : null);
    if (rawEpisodeId) {
      const crossOrgEp = await prisma.crisisEpisode.findFirst({
        where: {
          OR: [{ id: rawEpisodeId }, { episodeNumber: rawEpisodeId }],
        },
        select: { organizationId: true },
      });
      if (crossOrgEp && crossOrgEp.organizationId !== gate.organizationId) {
        await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'crisisEpisode', resourceId: String(rawEpisodeId), outcome: 'DENIED', metadata: { feature: 'crisis-summary', reason: 'episode_other_org' } });
        return NextResponse.json(
          { success: false, error: 'Episode not found in this organization' },
          { status: 404 }
        );
      }
    }

    const clientId = body.clientId || (typeof body.episode === 'object' ? body.episode?.clientId : null);
    if (clientId) {
      const isValid = await validateClientBelongsToOrg(clientId, gate.organizationId);
      if (!isValid) {
        await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'crisisEpisode', resourceId: rawEpisodeId ? String(rawEpisodeId) : null, patientId: String(clientId), outcome: 'DENIED', metadata: { feature: 'crisis-summary', reason: 'client_not_in_org' } });
        return NextResponse.json(
          { success: false, error: 'Client not found in this organization' },
          { status: 400 }
        );
      }
    }

    const systemPrompt = `You are an expert Mobile Crisis Clinical Scribe on AWS Bedrock (Claude 3.5 Sonnet v2).
You adhere to CARF Behavioral Health Crisis Program standards and Maryland COMAR crisis documentation regulations.
Draft a comprehensive, professional Crisis Episode Discharge & Clinical Chart Summary based on the provided episode record.

Structure the summary cleanly with:
1. EPISODE HEADER & CASE OVERVIEW (Episode ID, Client Name, Priority, Crisis Team assigned)
2. COURSE OF EPISODE & TIMELINE SYNTHESIS (Chronological progression from dispatch to resolution)
3. MENTAL STATUS EXAMINATION (MSE) (Appearance, Mood/Affect, Thought Process, Orientation)
4. CLINICAL INTERVENTIONS DELIVERED ON SCENE (e.g. Verbal de-escalation, distress tolerance, peer support, safety planning)
5. LEAST RESTRICTIVE ALTERNATIVE (LRA) JUSTIFICATION
6. PERSON-SERVED VOICE & COLLABORATIVE GOALS
7. FINAL DISPOSITION & 24/72-HOUR POST-CRISIS CARE PLAN

Only use facts present in the episode record. Where a field is "not recorded", write "not recorded" for it;
never infer or invent mental status findings, quotes, interventions, dispositions or follow-up plans.

At the end, append:
"AI-drafted by AWS Bedrock from the episode record. Not reviewed — the responding clinician must verify and sign."`;

    const nr = 'not recorded';
    const userPrompt = `Episode Data:
- ID: ${episode.id || episode.episodeNumber || nr}
- Client: ${episode.client || episode.clientName || nr}
- Priority: ${episode.priority || nr}
- Team: ${episode.team || nr}
- Mental Status Exam:
  - Appearance: ${episode.mse?.appearance || episode.mseAppearance || nr}
  - Mood: ${episode.mse?.mood || episode.mseMood || nr}
  - Thought Process: ${episode.mse?.thought || episode.mseThought || nr}
  - Orientation: ${episode.mse?.orientation || episode.mseOrientation || nr}
- Interventions: ${Array.isArray(episode.interventions) && episode.interventions.length ? episode.interventions.join(', ') : (typeof episode.interventions === 'string' && episode.interventions) || nr}
- Timeline Events: ${Array.isArray(episode.timeline) && episode.timeline.length ? episode.timeline.map((t: { time?: string; label?: string }) => `${t.time || ''} - ${t.label || ''}`).join('; ') : nr}
- Disposition: ${episode.disposition || nr}
- LRA Narrative: ${episode.lraNarrative || nr}
- Person Served Voice: ${episode.clientVoice || nr}`;

    // No canned fallback: a summary that was not drafted by the model must not
    // be returned as one. The UI assembles a plainly-labelled record extract.
    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI summary unavailable: AWS Bedrock is not configured' },
        { status: 503 }
      );
    }

    // Episode PHI is about to go to the model (under the AWS BAA): audit the access first.
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'crisisEpisode',
      resourceId: rawEpisodeId ? String(rawEpisodeId) : null,
      patientId: clientId ? String(clientId) : null,
      metadata: { feature: 'crisis-summary', model: BEDROCK_MODELS.SONNET },
    });

    try {
      const output = await invokeBedrock({
        model: 'SONNET',
        system: systemPrompt,
        userPrompt,
        maxTokens: 2500,
        temperature: 0.2,
      });

      if (output && output.trim().length > 50) {
        return NextResponse.json({
          success: true,
          modelId: BEDROCK_MODELS.SONNET,
          provider: 'aws-bedrock',
          summary: output.trim(),
          disclaimer: 'AI-drafted via AWS Bedrock under HIPAA BAA. Clinician review and signature required.',
        });
      }
    } catch (err: unknown) {
      console.warn('[crisis ai-summary] Bedrock error:', err instanceof Error ? err.message : 'unknown');
    }

    return NextResponse.json(
      { success: false, error: 'AI summary unavailable: AWS Bedrock did not return a usable draft' },
      { status: 503 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Crisis summary failed' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
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
    if (body.clientId) {
      const isValid = await validateClientBelongsToOrg(body.clientId, gate.organizationId);
      if (!isValid) {
        await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'crisisTriage', patientId: String(body.clientId), outcome: 'DENIED', metadata: { feature: 'crisis-triage-ai', reason: 'client_not_in_org' } });
        return NextResponse.json(
          { success: false, error: 'Client not found in this organization' },
          { status: 400 }
        );
      }
    }

    const {
      symptoms = '',
      callerType = 'Hotline',
      weapons = false,
      violence = false,
      location = '',
      answers = {},
    } = body;

    const systemPrompt = `You are Aria Triage Copilot for Mobile Crisis Intervention on AWS Bedrock (Claude 3 Haiku).
Adhere strictly to CARF Behavioral Health Crisis Program standards, least-restrictive alternative principles, and C-SSRS triage.
Analyze presenting distress, risk factors, weapons/violence flags, and environmental context.
Determine:
1. priority: 1 (Immediate <30 min target), 2 (Standard mobile dispatch <60 min), or 3 (Scheduled engagement <4 hours)
2. recommendation: Target dispatch action
3. safetyNotice: Staging and protective instructions for the two-person clinical pairing (e.g. LCSW-C + Peer Specialist)
4. clinicalRationale: Multi-sentence documented justification for the dispatch decision and medical necessity
5. recommendedInterventions: Array of on-scene clinical strategies (e.g. Stanley-Brown Safety Plan, lethal means counseling, psychological first aid)

Output strictly JSON:
{
  "priority": 1 | 2 | 3,
  "recommendation": "string",
  "safetyNotice": "string",
  "clinicalRationale": "string",
  "recommendedInterventions": ["string"]
}`;

    const userPrompt = `Caller Type: ${callerType}
Reported Symptoms / Presentation: ${symptoms || 'Acute behavioral distress'}
Location: ${location || 'Community residence'}
Weapons Present: ${weapons ? 'YES' : 'NO'}
Violence History / In Progress: ${violence ? 'YES' : 'NO'}
Structured Triage Answers: ${JSON.stringify(answers)}`;

    // No rule-based stand-in: text that did not come from the model must not be
    // returned as an AI rationale. The UI assembles a plainly-labelled one.
    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Triage AI unavailable: AWS Bedrock is not configured' },
        { status: 503 }
      );
    }

    // Triage details are about to go to the model (under the AWS BAA): audit the access first.
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'crisisTriage',
      patientId: body.clientId ? String(body.clientId) : null,
      metadata: { feature: 'crisis-triage-ai', model: BEDROCK_MODELS.HAIKU, weapons: Boolean(weapons), violence: Boolean(violence) },
    });

    try {
      const output = await invokeBedrock({
        model: 'HAIKU',
        system: systemPrompt,
        userPrompt,
        maxTokens: 1200,
        temperature: 0.2,
        jsonMode: true,
      });

      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        const match = output.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }

      if (parsed && parsed.clinicalRationale) {
        return NextResponse.json({
          success: true,
          copilot: 'Aria Clinical Triage AI (AWS Bedrock Claude 3 Haiku)',
          modelId: BEDROCK_MODELS.HAIKU,
          provider: 'aws-bedrock',
          priority: parsed.priority || (weapons || violence ? 1 : 2),
          recommendation: parsed.recommendation,
          safetyNotice: parsed.safetyNotice,
          clinicalRationale: parsed.clinicalRationale,
          recommendedInterventions: parsed.recommendedInterventions || [],
          disclaimer:
            'AI-drafted via AWS Bedrock (Claude 3 Haiku) under HIPAA BAA. Clinician confirms dispatch level.',
        });
      }
    } catch (err: unknown) {
      console.warn('[crisis triage-ai] Bedrock error:', err instanceof Error ? err.message : 'unknown');
    }

    return NextResponse.json(
      { success: false, error: 'Triage AI unavailable: AWS Bedrock did not return a usable rationale' },
      { status: 503 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Triage AI failed' },
      { status: 500 }
    );
  }
}

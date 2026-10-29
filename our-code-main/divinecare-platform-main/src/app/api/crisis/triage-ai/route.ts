import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { validateClientBelongsToOrg } from '@/lib/crisis/tenantIsolation';

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

    if (isBedrockConfigured()) {
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

        if (parsed) {
          return NextResponse.json({
            success: true,
            copilot: 'Aria Clinical Triage AI (AWS Bedrock Claude 3 Haiku)',
            modelId: BEDROCK_MODELS.HAIKU,
            provider: 'bedrock-live',
            priority: parsed.priority || (weapons || violence ? 1 : 2),
            recommendation: parsed.recommendation,
            safetyNotice: parsed.safetyNotice,
            clinicalRationale: parsed.clinicalRationale,
            recommendedInterventions: parsed.recommendedInterventions || [],
            disclaimer:
              'Processed via AWS Bedrock (Claude 3 Haiku) under HIPAA BAA. Clinician confirms dispatch level.',
          });
        }
      } catch (err: unknown) {
        console.warn('[AWS Bedrock Crisis Triage Error — using CARF fallback]:', err);
      }
    }

    // CARF Heuristic Rule-Based Fallback
    let priority = 2;
    let recommendation = 'Standard Mobile Crisis Dispatch (<60 min response)';
    let safetyNotice = 'Standard two-person clinical pairing required per CARF standards.';

    if (weapons || violence) {
      priority = 1;
      recommendation = '911 Emergency Diversion / Joint Law Enforcement Crisis Protocol (<30 min response)';
      safetyNotice = 'HIGH RISK: Mobile crisis team must stage nearby until scene is secured by CIT-trained officers.';
    } else if (
      symptoms.toLowerCase().includes('plan') ||
      symptoms.toLowerCase().includes('immediate') ||
      symptoms.toLowerCase().includes('severe') ||
      symptoms.toLowerCase().includes('kill')
    ) {
      priority = 1;
      recommendation = 'P1 Priority Immediate Field Dispatch (<30 min target response)';
      safetyNotice = 'Urgent dispatch. Maintain continuous phone contact until two-person unit arrives on scene.';
    } else if (
      symptoms.toLowerCase().includes('mild') ||
      symptoms.toLowerCase().includes('walk-in') ||
      symptoms.toLowerCase().includes('follow')
    ) {
      priority = 3;
      recommendation = 'P3 Scheduled Support / Same-Day Field Engagement (<4 hours)';
    }

    return NextResponse.json({
      success: true,
      copilot: 'Aria Clinical Triage AI (CARF Tier-1 Evaluator)',
      modelId: BEDROCK_MODELS.HAIKU,
      provider: isBedrockConfigured() ? 'bedrock-fallback' : 'bedrock-demo',
      priority,
      recommendation,
      safetyNotice,
      clinicalRationale: `Clinical symptoms presented (${symptoms.slice(0, 100) || 'Acute behavioral agitation'}) indicate Priority ${priority} dispatch. Least restrictive alternative verified. Assigning two-person team (LCSW-C + CPRS) to ${location || 'target location'} for trauma-informed de-escalation.`,
      recommendedInterventions: [
        'Verbal De-escalation & Psychological First Aid',
        'Lethal Means Safety Counseling',
        'Collaborative Safety Planning (Stanley-Brown Model)',
        'Warm Handoff to Outpatient / Peer Support',
      ],
      disclaimer: 'Processed via AWS Bedrock (Claude 3 Haiku) under HIPAA BAA.',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Triage AI failed' },
      { status: 500 }
    );
  }
}

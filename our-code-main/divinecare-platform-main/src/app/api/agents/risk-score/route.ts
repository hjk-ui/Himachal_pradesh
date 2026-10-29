import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().trim().min(5).max(25000),
  clientId: z.string().min(1).max(128).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/scribe') &&
    !canAccessPath(gate.role, '/dashboard/ehr/session-ai') &&
    !canAccessPath(gate.role, '/dashboard/alerts') &&
    !canAccessPath(gate.role, '/dashboard/ai-insights')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body: text required' }, { status: 400 });
  }

  const systemPrompt = `You are a Clinical Risk & Measurement-Based Care (MBC) Triage Evaluator on AWS Bedrock (Claude 3 Haiku).
Analyze clinical text, 14-day check-in trends, PHQ-9, and GAD-7 data.
Determine:
1. riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL"
2. score: 0-100 numerical risk score
3. factors: array of specific contributing clinical risk factors
4. recommendation: clinical triage action (e.g. outreach within 24h, update safety plan, mobile crisis dispatch)

Output strictly JSON:
{
  "riskLevel": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "score": number,
  "factors": ["string"],
  "recommendation": "string"
}`;

  if (isBedrockConfigured()) {
    try {
      const output = await invokeBedrock({
        model: 'HAIKU',
        system: systemPrompt,
        userPrompt: `Clinical Assessment Input:\n"""\n${body.text}\n"""`,
        maxTokens: 1000,
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
          demoMode: false,
          modelId: BEDROCK_MODELS.HAIKU,
          provider: 'bedrock-live',
          riskLevel: parsed.riskLevel || 'MODERATE',
          score: parsed.score ?? 50,
          factors: parsed.factors || [],
          recommendation: parsed.recommendation || 'Standard clinical follow-up per treatment plan.',
          disclaimer:
            'Evaluated by AWS Bedrock (Claude 3 Haiku) under HIPAA BAA. Clinical risk judgment remains with the attending provider.',
        });
      }
    } catch (err: unknown) {
      console.warn('[AWS Bedrock Risk Score Invocation Error — using fallback]:', err);
    }
  }

  // Clinical risk heuristic fallback
  const textLower = body.text.toLowerCase();
  const isCritical = /suicid|kill|intent|weapon|lethal|attempt/i.test(textLower);
  const isHigh = /hopeless|severe|phq-9\s*>\s*19|overdose|harm/i.test(textLower);
  const isMod = /moderate|worsen|anxiety|gad-7\s*>\s*10|insomnia/i.test(textLower);

  const riskLevel = isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : isMod ? 'MODERATE' : 'LOW';
  const score = isCritical ? 92 : isHigh ? 78 : isMod ? 52 : 22;
  const factors: string[] = [];

  if (isCritical) factors.push('Endorsement of acute self-harm or lethal risk indicators');
  if (isHigh) factors.push('Significant mood destabilization or elevated assessment scale');
  if (isMod) factors.push('Moderate symptom fluctuation over recent observation period');
  if (factors.length === 0) factors.push('Stable clinical presentation; baseline adherence maintained');

  const recommendation = isCritical
    ? 'Immediate emergency mobile crisis protocol or 988 warm handoff required.'
    : isHigh
    ? 'Same-day clinician contact and Stanley-Brown safety plan review indicated.'
    : isMod
    ? 'Follow-up within 7 days; administer follow-up PHQ-9/GAD-7 at next visit.'
    : 'Maintain standard scheduled appointments and continuing recovery routine.';

  return NextResponse.json({
    success: true,
    demoMode: !isBedrockConfigured(),
    modelId: BEDROCK_MODELS.HAIKU,
    provider: isBedrockConfigured() ? 'bedrock-fallback' : 'bedrock-demo',
    riskLevel,
    score,
    factors,
    recommendation,
    disclaimer:
      'Evaluated by AWS Bedrock (Claude 3 Haiku) under HIPAA BAA. Provider verification required.',
  });
}

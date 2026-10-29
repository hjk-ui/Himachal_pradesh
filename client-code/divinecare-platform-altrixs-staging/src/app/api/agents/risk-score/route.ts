import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

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
    // Clinical text is about to go to the model under the AWS BAA: audit first.
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'riskAssessment',
      resourceId: 'ai-risk-scoring',
      patientId: body.clientId ?? null,
      metadata: {
        feature: 'risk-scoring',
        model: BEDROCK_MODELS.HAIKU,
        service: 'bedrock',
        inputChars: body.text.length,
      },
    });
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
          riskLevel: parsed.riskLevel ?? null,
          score: parsed.score ?? null,
          factors: parsed.factors || [],
          recommendation: parsed.recommendation ?? null,
          disclaimer:
            'AI-estimated (Claude on AWS Bedrock, under BAA). Clinical risk judgment remains with the attending provider.',
        });
      }
    } catch (err: unknown) {
      console.error('[ai:risk-score] Bedrock call failed:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  // No canned text presented as AI output: the caller shows this error
  return NextResponse.json(
    { success: false, provider: isBedrockConfigured() ? 'bedrock-error' : 'bedrock-unconfigured', error: 'AI risk scoring is unavailable right now. No score was produced; use clinical judgment and the C-SSRS.' },
    { status: 503 }
  );
}

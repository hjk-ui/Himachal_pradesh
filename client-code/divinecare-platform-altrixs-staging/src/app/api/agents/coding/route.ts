import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().trim().min(10).max(25000),
  clientId: z.string().min(1).max(128).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/coding') && !canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body: text required' }, { status: 400 });
  }

  const systemPrompt = `You are a certified Medical Coding & Billing AI Auditor (CPC, CPB) specialized in behavioral health, Maryland Medicaid (Optum/Incedo), and commercial payers.
Analyze the provided clinical note and generate:
1. Recommended CPT codes (e.g., 90837, 90834, 90791, 99214; never H2017 — Maryland PRP billing is pending confirmation) with modifiers if needed, description, estimated rate ($), and clinical justification.
2. Recommended ICD-10 diagnosis codes (e.g. F33.1, F41.1, F43.10) with description, confidence %, and justification.
3. Medical necessity score (0-100) reflecting documentation completeness.
4. Correct Coding Initiative (CCI) bundling alerts if any.

Output strictly JSON:
{
  "cpt": [
    { "code": "string", "modifier": "string | null", "description": "string", "confidence": number, "rate": number, "rationale": "string" }
  ],
  "icd10": [
    { "code": "string", "description": "string", "confidence": number, "rationale": "string" }
  ],
  "medicalNecessityScore": number,
  "bundlingAlerts": ["string"],
  "documentationTips": "string"
}`;

  if (isBedrockConfigured()) {
    // Clinical text is about to go to the model under the AWS BAA: audit first.
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'clinicalNote',
      resourceId: 'ai-coding-suggestions',
      patientId: body.clientId ?? null,
      metadata: {
        feature: 'coding-suggestions',
        model: BEDROCK_MODELS.SONNET,
        service: 'bedrock',
        inputChars: body.text.length,
      },
    });
    try {
      const output = await invokeBedrock({
        model: 'SONNET',
        system: systemPrompt,
        userPrompt: `Clinical Note:\n"""\n${body.text}\n"""`,
        maxTokens: 2000,
        temperature: 0.1,
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
          modelId: BEDROCK_MODELS.SONNET,
          provider: 'bedrock-live',
          suggestions: parsed,
          cpt: parsed.cpt || [],
          icd10: parsed.icd10 || [],
          medicalNecessityScore: parsed.medicalNecessityScore ?? null,
          bundlingAlerts: parsed.bundlingAlerts || [],
          documentationTips: parsed.documentationTips,
          disclaimer:
            'AI-suggested (Claude on AWS Bedrock, under BAA). Final code assignment must be validated by certified billing personnel.',
        });
      }
    } catch (err: unknown) {
      console.error('[ai:coding] Bedrock call failed:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  // No canned text presented as AI output: the caller shows this error
  return NextResponse.json(
    { success: false, provider: isBedrockConfigured() ? 'bedrock-error' : 'bedrock-unconfigured', error: 'AI coding suggestions are unavailable right now. Nothing was generated; code manually or try again.' },
    { status: 503 }
  );
}

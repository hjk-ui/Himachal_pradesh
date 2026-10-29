import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';

export const runtime = 'nodejs';

const schema = z.object({
  rawNote: z.string().min(1),
  patientName: z.string().optional(),
  visitType: z.string().optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/ai')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { rawNote, patientName, visitType } = schema.parse(await req.json());

    const systemPrompt = `You are an expert Primary Care and Internal Medicine Clinical Documentation Specialist on AWS Bedrock (Claude 3.5 Sonnet v2).
Transform raw dictations/notes into structured, compliant Medical SOAP progress notes, ICD-10 diagnostic codes, and CPT encounter codes.
Use only facts stated in the notes. Never invent vitals, exam findings, diagnoses, or medications; write "[Not documented]" for anything missing.
Output strictly JSON:
{
  "soap": {
    "subjective": "string",
    "objective": "string",
    "assessment": "string",
    "plan": "string"
  },
  "suggestedCpt": [
    { "code": "string", "description": "string", "modifier": "string | null" }
  ],
  "suggestedIcd10": [
    { "code": "string", "description": "string" }
  ]
}`;

    const userPrompt = `Patient: ${patientName || 'Established Patient'}
Visit Type: ${visitType || 'Comprehensive Office Visit'}
Raw Physician Dictation / Notes:
"""
${rawNote}
"""`;

    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI Scribe is not available: AWS Bedrock is not configured on this server.' },
        { status: 503 }
      );
    }

    let output: string;
    try {
      output = await invokeBedrock({
        model: 'SONNET',
        system: systemPrompt,
        userPrompt,
        maxTokens: 2500,
        temperature: 0.1,
        jsonMode: true,
      });
    } catch (err: unknown) {
      // Never log the prompt or output (PHI); the error message only.
      console.error('[medical/ai/bedrock-soap] Bedrock call failed:', err instanceof Error ? err.message : 'error');
      return NextResponse.json(
        { success: false, error: 'AWS Bedrock request failed; nothing was generated. Document the note manually.' },
        { status: 502 }
      );
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(output);
    } catch {
      const match = output.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || !parsed.soap) {
      return NextResponse.json(
        { success: false, error: 'AWS Bedrock returned an unreadable draft; nothing was inserted.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      soap: parsed.soap,
      suggestedCpt: Array.isArray(parsed.suggestedCpt) ? parsed.suggestedCpt : [],
      suggestedIcd10: Array.isArray(parsed.suggestedIcd10) ? parsed.suggestedIcd10 : [],
      providerModel: BEDROCK_MODELS.SONNET,
      provider: 'bedrock-live',
      disclaimer: 'Processed via AWS Bedrock under HIPAA BAA. AI draft: review before signing.',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? err.issues[0]?.message || 'Invalid request' : 'Could not generate SOAP note' },
      { status: 400 }
    );
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientChartNotes, clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';

/** Aria (free text, possibly PHI, to Bedrock): clinical roles only, chart-note readers or the AI Insights (PROVIDERS) page. */
function canUseAria(role: string | null | undefined): boolean {
  return canAccessClientChartNotes(role) || canAccessPath(role, '/dashboard/ai-insights');
}

export const runtime = 'nodejs';

const bodySchema = z.object({
  prompt: z.string().trim().min(2).max(8000),
  clientId: z.string().min(1).max(128).optional().nullable(),
});

const CRISIS_KEYWORDS = [
  'suicide',
  'kill myself',
  'end my life',
  'want to die',
  'harm myself',
  'self-harm',
  'cut myself',
  'take all my pills',
  'overdose',
  'shoot myself',
  'jump off',
  'hanging',
];

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body: prompt required' }, { status: 400 });
  }

  if (!canUseAria(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'aiCompanion', resourceId: 'aria', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // A client id goes into the audit log only once it is verified to be on the caller's caseload / org
  let patientId: string | null = null;
  if (body.clientId) {
    const client = await prisma.client.findFirst({
      where: {
        AND: [
          clientByIdWhere(body.clientId, gate.organizationId),
          clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
        ],
      },
      select: { id: true },
    });
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'aiCompanion', resourceId: 'aria', outcome: 'DENIED', metadata: { reason: 'patient_not_found' } });
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }
    patientId = client.id;
  }

  const promptLower = body.prompt.toLowerCase();
  const crisisDetected = CRISIS_KEYWORDS.some((kw) => promptLower.includes(kw));

  const systemPrompt = `You are Aria, a trauma-informed, compassionate patient wellness companion built on AWS Bedrock (Claude 3 Haiku).
Provide empathetic, non-judgmental guidance, validation, and practical coping exercises (such as 4-7-8 breathing, 5-4-3-2-1 sensory grounding, or cognitive reframing).
CRITICAL: You are NOT a doctor or a substitute for medical or psychiatric crisis care.
Output ONLY a strict JSON object with these keys:
{
  "summary": "Brief empathetic reflection of what was shared",
  "encouragement": "Warm, trauma-informed supportive statement",
  "suggested_exercise": {
    "title": "Exercise name (e.g. 5-4-3-2-1 Grounding or Box Breathing)",
    "steps": ["Step 1 description", "Step 2 description", "Step 3 description"]
  },
  "safety_note": "A gentle reminder of support resources and clinical boundaries"
}`;

  if (crisisDetected) {
    return NextResponse.json({
      success: true,
      crisisDetected: true,
      modelId: BEDROCK_MODELS.HAIKU,
      // Keyword safety check on the server; no model was called for this reply
      provider: 'safety-keyword-check',
      escalation: {
        hotline: '988 Suicide & Crisis Lifeline (Call or Text 24/7)',
        message:
          'If you are experiencing thoughts of harming yourself or need immediate support, please connect with someone who can help right now. Call or text 988, available 24/7, free and confidential.',
      },
      reply: {
        summary: 'I hear how overwhelming things feel right now, and your safety is the most important thing.',
        encouragement: 'You are not alone, and there is help available right this second. Please connect with the 988 Lifeline or a trusted care team member.',
        suggested_exercise: {
          title: 'Immediate Safety Grounding',
          steps: [
            'Place both feet flat on the floor and take a slow breath in.',
            'Reach out immediately to 988 (call or text 988).',
            'Stay with a support person or contact emergency services if you are in immediate danger.',
          ],
        },
        safety_note: 'If you are in immediate danger, call 911. Call or text 988 any time.',
      },
      disclaimer: 'Automatic safety message (no AI model was used).',
    });
  }

  if (isBedrockConfigured()) {
    // Free text (possibly PHI) is about to go to the model under the AWS BAA: audit first.
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'aiCompanion',
      resourceId: 'aria',
      patientId,
      metadata: {
        feature: 'aria-companion',
        model: BEDROCK_MODELS.HAIKU,
        service: 'bedrock',
        inputChars: body.prompt.length,
      },
    });
    try {
      const bedrockOutput = await invokeBedrock({
        model: 'HAIKU',
        system: systemPrompt,
        userPrompt: body.prompt,
        maxTokens: 1000,
        temperature: 0.3,
        jsonMode: true,
      });

      let parsed;
      try {
        parsed = JSON.parse(bedrockOutput);
      } catch {
        const jsonMatch = bedrockOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      if (parsed) {
        return NextResponse.json({
          success: true,
          crisisDetected: false,
          modelId: BEDROCK_MODELS.HAIKU,
          provider: 'bedrock-live',
          reply: parsed,
          disclaimer: 'Processed via AWS Bedrock (Claude 3 Haiku) under HIPAA BAA.',
        });
      }
    } catch (err: unknown) {
      console.warn('[aria] Bedrock invocation failed:', err instanceof Error ? err.name : 'error');
      return NextResponse.json(
        { success: false, error: 'Aria could not answer right now. If you are in crisis, call or text 988.' },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Aria returned an unreadable answer. If you are in crisis, call or text 988.' },
      { status: 502 }
    );
  }

  // No canned reply: Aria is not available when Bedrock is not configured
  return NextResponse.json(
    {
      success: false,
      error: 'Aria is not configured on this server. If you are in crisis, call or text 988.',
      code: 'AI_NOT_CONFIGURED',
    },
    { status: 503 }
  );
}

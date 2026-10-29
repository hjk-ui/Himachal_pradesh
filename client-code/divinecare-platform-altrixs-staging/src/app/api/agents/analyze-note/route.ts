import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().trim().min(20).max(20000),
  noteType: z.string().max(80).optional().nullable(),
  clientId: z.string().min(1).max(128).optional().nullable(),
});

/** POST /api/agents/analyze-note — Bedrock chart analysis; fail-closed without AWS. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/notes') &&
    !canAccessPath(gate.role, '/dashboard/ehr/session-ai') &&
    !canAccessPath(gate.role, '/dashboard/scribe')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body: text required' }, { status: 400 });
  }

  const hasCreds = Boolean(process.env.AWS_ACCESS_KEY_ID?.trim());
  const modelId =
    process.env.BEDROCK_CLAUDE_SONNET_MODEL_ID?.trim() ||
    process.env.BEDROCK_MODEL_ID?.trim() ||
    null;

  if (!hasCreds || !modelId) {
    return NextResponse.json(
      {
        success: false,
        demoMode: true,
        error: 'Note analysis unavailable — Bedrock not configured (fail-closed).',
        insights: [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      demoMode: false,
      error: 'Note analysis is not available right now. Nothing was generated.',
      insights: [],
      modelId,
    },
    { status: 503 }
  );
}

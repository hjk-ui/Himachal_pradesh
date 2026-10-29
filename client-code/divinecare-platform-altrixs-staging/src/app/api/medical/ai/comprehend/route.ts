import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { analyzeClinicalText } from '@/lib/aws/comprehend';

export const runtime = 'nodejs';

const schema = z.object({
  text: z.string().trim().min(10, 'Enter at least 10 characters of clinical text').max(10000),
});

/**
 * Amazon Comprehend Medical (DetectEntitiesV2 + InferICD10CM + InferRxNorm) over clinician text.
 * Returns 503 instead of fixture data when AWS credentials are not configured.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/ai')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let text: string;
  try {
    ({ text } = schema.parse(await req.json()));
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : 'Invalid request body';
    return NextResponse.json({ success: false, error: message || 'Invalid request body' }, { status: 400 });
  }

  const analysis = await analyzeClinicalText(text);
  if (analysis.ok === false) {
    console.error('[medical/ai/comprehend]', analysis.status, analysis.error);
    return NextResponse.json(
      { success: false, error: 'Amazon Comprehend Medical request failed; no suggestions were generated.' },
      { status: 502 }
    );
  }
  if (analysis.result.demoMode) {
    return NextResponse.json(
      { success: false, error: 'Amazon Comprehend Medical is not configured on this server.' },
      { status: 503 }
    );
  }

  const { entities, icd10, medications } = analysis.result;
  return NextResponse.json({
    success: true,
    service: 'Amazon Comprehend Medical',
    icd10,
    medications,
    // Legacy flat shape used by the Medical AI page.
    entities: [
      ...icd10.map((c) => ({ text: c.description, category: 'MEDICAL_CONDITION', icd10: c.code, confidence: c.score })),
      ...medications.map((m) => ({ text: m.description, category: 'MEDICATION', rxNorm: m.code, confidence: m.score })),
      ...entities
        .filter((e) => e.category === 'ANATOMY')
        .map((e) => ({ text: e.text, category: 'ANATOMY', confidence: e.score })),
    ],
  });
}

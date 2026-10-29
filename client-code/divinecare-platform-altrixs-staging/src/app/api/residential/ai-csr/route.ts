import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { findResidentInOrg } from '../_scope';

export const runtime = 'nodejs';

const bodySchema = z.object({ residentId: z.string().min(1).max(64) });

/**
 * POST /api/residential/ai-csr — Bedrock draft of a continued-stay review built
 * only from the resident record and its signed shift notes. No template fallback:
 * if Bedrock is unavailable the caller gets an error, never canned clinical text.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'residentId is required' }, { status: 400 });
    }
    const resident = await findResidentInOrg(parsed.data.residentId, gate.organizationId);
    if (!resident) {
      return NextResponse.json({ success: false, error: 'Resident not found' }, { status: 404 });
    }

    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI drafting is not configured on this server (Bedrock credentials missing). Write the review manually.' },
        { status: 503 }
      );
    }

    const notes = await prisma.residentialShiftNote.findMany({
      where: { residentId: resident.id },
      orderBy: { shiftDate: 'desc' },
      take: 20,
      select: { shift: true, shiftDate: true, milieu: true, adherence: true, sleep: true, notes: true },
    });

    const program = resident.program;
    const losDays = Math.max(0, Math.floor((Date.now() - resident.admitDate.getTime()) / 86_400_000));

    const systemPrompt = `You are a clinical utilization review assistant drafting an ASAM Continued-Stay Review (CSR) for Maryland Medicaid (Optum/Incedo).
Use ONLY the facts supplied. Never invent attendance figures, vitals, scores, incidents, medications or progress.
Where the record does not contain what a section needs, write "[Clinician to complete: ...]" naming what is missing.

Cover:
1. MEDICAL NECESSITY & ASAM CONTINUATION CRITERIA (Dimensions 1 through 6)
2. TREATMENT PLAN STATUS & RECENT CLINICAL PROGRESS
3. DISCHARGE / STEP-DOWN READINESS & BARRIERS
4. CONTINUED STAY REQUEST (${program === '3.5' ? '7 days' : '30 days'})

End with: "AI-generated draft — clinician review, edits, and signature required before filing."`;

    const noteLines = notes.length
      ? notes
          .map(
            (n) =>
              `- ${n.shiftDate.toISOString().slice(0, 10)} ${n.shift}: milieu ${n.milieu}; adherence ${n.adherence}${n.sleep ? `; sleep ${n.sleep}` : ''}. ${n.notes}`
          )
          .join('\n')
      : 'No shift notes on file.';

    const userPrompt = `Patient: ${resident.name}
Level of Care: ASAM Level ${program} (Residential)
Current Length of Stay: ${losDays} days
Primary Counselor: ${resident.counselor}
Phase: ${resident.phase}
Treatment plan status: ${resident.txPlanStatus}
ASAM dimension scores on admission: ${resident.asamScores ? JSON.stringify(resident.asamScores) : 'not recorded'}
Recent shift notes:
${noteLines}`;

    let output: string;
    try {
      output = await invokeBedrock({
        model: 'SONNET',
        system: systemPrompt,
        userPrompt,
        maxTokens: 2500,
        temperature: 0.2,
      });
    } catch (err: unknown) {
      console.error('[residential/ai-csr] Bedrock error:', err instanceof Error ? err.message : 'unknown');
      return NextResponse.json(
        { success: false, error: 'AI draft failed — Bedrock did not respond. Try again or write the review manually.' },
        { status: 502 }
      );
    }

    if (!output || !output.trim()) {
      return NextResponse.json({ success: false, error: 'AI returned an empty draft' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      modelId: BEDROCK_MODELS.SONNET,
      provider: 'bedrock-live',
      program,
      justification: output.trim(),
      disclaimer: 'AI-generated draft via AWS Bedrock. Clinician review and signature required.',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'CSR AI drafter failed' },
      { status: 500 }
    );
  }
}

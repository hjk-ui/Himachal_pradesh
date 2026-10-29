import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canUpdateDenialStatus } from '@/lib/billing/billingAccess';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';

export const runtime = 'nodejs';

const schema = z.object({
  claimId: z.string().min(1),
  patientName: z.string().min(1),
  payer: z.string().min(1),
  cptCode: z.string().min(1),
  serviceDate: z.string().min(1),
  billedAmount: z.number().optional(),
  deniedAmount: z.number().optional(),
  carcCode: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  appealNotes: z.string().optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing') && !canAccessPath(gate.role, '/dashboard/billing/denials')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // Appeal drafting is denial work (it sends the claim to Bedrock): billing core only, like the
  // status change it leads to. Office Manager reads the denials queue.
  if (!canUpdateDenialStatus(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing staff can draft denial appeals' }, { status: 403 });
  }

  try {
    const body = schema.parse(await req.json());

    const systemPrompt = `You are a certified healthcare reimbursement specialist and legal advocate on AWS Bedrock (Claude 3.5 Sonnet v2).
Your task is to draft an assertive, clinically and statutorily robust insurance denial appeal letter.
Incorporate references to:
1. Maryland Insurance Code & COMAR 10.21 Behavioral Health Regulations
2. The Mental Health Parity and Addiction Equity Act (MHPAEA)
3. Specific rebuttal of Claim Adjustment Reason Code (CARC) ${body.carcCode} (${body.description || 'Payer denial'})
4. Formal demand for overturn of denial and immediate reprocessing with interest if applicable.

Output the complete, professionally formatted letter with:
- Date, Certified Mail / Electronic Appeals Submission Header
- Payer Appeals Department Address block
- Clear Claim Reference block (Claim ID, Patient Name, DOS, CPT, Amount)
- Clinical & Legal Medical Necessity arguments
- Enclosures list (Signed EHR note, active treatment plan, authorization copy)
- Provider signature block`;

    const userPrompt = `Claim Information:
- Claim ID: ${body.claimId}
- Patient: ${body.patientName}
- Payer: ${body.payer}
- Procedure Code: ${body.cptCode}
- Date of Service: ${body.serviceDate}
- Denied Amount: ${typeof body.deniedAmount === 'number' && Number.isFinite(body.deniedAmount) ? `$${body.deniedAmount.toFixed(2)}` : '[denied amount not on file: leave blank for staff to fill]'}
- CARC Code: ${body.carcCode}
- Denial Category: ${body.category || 'not stated'}
- Denial Explanation: ${body.description || 'not stated'}
- Internal Clinical/Billing Notes: ${body.appealNotes || 'none provided (do not invent clinical facts; leave placeholders for staff)'}`;

    if (isBedrockConfigured()) {
      try {
        const output = await invokeBedrock({
          model: 'SONNET',
          system: systemPrompt,
          userPrompt,
          maxTokens: 2500,
          temperature: 0.1,
        });

        if (output && output.trim().length > 100) {
          return NextResponse.json({
            success: true,
            modelId: BEDROCK_MODELS.SONNET,
            provider: 'bedrock-live',
            appealLetter: output.trim(),
            disclaimer:
              'AI-drafted (Claude on AWS Bedrock, under BAA). Billing specialist review required.',
          });
        }
      } catch (err: unknown) {
        console.error('[ai:appeal] Bedrock call failed:', err instanceof Error ? err.message : 'unknown error');
      }
    }

    // No canned letter presented as AI output: the caller shows this error
    return NextResponse.json(
      {
        success: false,
        provider: isBedrockConfigured() ? 'bedrock-error' : 'bedrock-unconfigured',
        error: 'AI appeal drafting is unavailable right now. Nothing was generated; write the appeal manually or try again.',
      },
      { status: 503 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Appeal drafting failed' },
      { status: 400 }
    );
  }
}

import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { generateAppealLetter, type AppealLetterInput } from '@/lib/aiAssists';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing/denials')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();

    const appealInput: AppealLetterInput = {
      clientName: body.clientName || 'Patient Candidate',
      payer: body.payer || 'Behavioral Health Insurer',
      dos: body.dos || new Date().toISOString().split('T')[0],
      cptCode: body.cptCode || 'H0018',
      reasonCode: body.reasonCode || 'CO-16',
      reasonText: body.reasonText || 'Claim lacks information or has billing submission error',
      amountCents: body.amountCents ? Number(body.amountCents) : 38500,
      mbcScores: body.mbcScores,
    };

    const result = await generateAppealLetter(appealInput);

    return NextResponse.json({
      success: true,
      drafter: result.drafter,
      letter: result.letter,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'AI appeal generation error' },
      { status: 500 }
    );
  }
}

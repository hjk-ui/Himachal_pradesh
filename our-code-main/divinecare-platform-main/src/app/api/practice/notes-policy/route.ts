import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  DIAGNOSIS_REVIEW_DAYS_MAX,
  DIAGNOSIS_REVIEW_DAYS_MIN,
  canEditNotesPolicy,
  getNotesPolicy,
  requiredNoteSectionsNotice,
  saveNotesPolicy,
} from '@/lib/notes/notes-policy';

export const runtime = 'nodejs';

const putSchema = z.object({
  requireDiagnosisToSign: z.boolean(),
  diagnosisReviewDays: z.number().int().min(DIAGNOSIS_REVIEW_DAYS_MIN).max(DIAGNOSIS_REVIEW_DAYS_MAX),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  return NextResponse.json({
    success: true,
    policy: await getNotesPolicy(gate.organizationId),
    sectionsNotice: requiredNoteSectionsNotice(),
    canEdit: canEditNotesPolicy(gate.role),
  });
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditNotesPolicy(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Review days must be a whole number from ${DIAGNOSIS_REVIEW_DAYS_MIN} to ${DIAGNOSIS_REVIEW_DAYS_MAX}.`,
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ success: true, policy: await saveNotesPolicy(gate.organizationId, parsed.data) });
}

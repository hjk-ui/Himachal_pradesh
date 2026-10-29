import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { assessmentSubmissionSchema } from '@/lib/ehr/assessmentScoring';
import { listAssessments, submitAssessment } from '@/lib/ehr/assessments';
import { AssessmentError } from '@/lib/ehr/assessmentErrors';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/assessments')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const result = await listAssessments({ organizationId: gate.organizationId, actorRole: gate.role, actorUserId: gate.userId });
  return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/assessments')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const parsed = assessmentSubmissionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Complete all required assessment responses and verification fields' }, { status: 400 });
    const result = await submitAssessment({ organizationId: gate.organizationId, actorRole: gate.role, actorUserId: gate.userId }, parsed.data);
    return NextResponse.json({ success: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const status = error instanceof AssessmentError ? error.status : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ success: false, error: error instanceof AssessmentError ? error.message : 'Assessment could not be saved. Please retry.' }, { status });
  }
}

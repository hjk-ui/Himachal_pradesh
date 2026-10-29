import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { startHealthLakeExport } from '@/lib/aws/healthlake';

export const runtime = 'nodejs';

const schema = z.object({
  jobName: z.string().trim().min(1).max(200),
  s3Uri: z.string().trim().min(1).max(1024),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/healthlake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: 'jobName and s3Uri are required' },
      { status: 400 }
    );
  }

  const result = await startHealthLakeExport({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    jobName: body.jobName,
    s3Uri: body.s3Uri,
  });
  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ success: true, job: result.job, demoMode: result.job.demoMode });
}

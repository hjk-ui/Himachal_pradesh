import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createComplianceRecord } from '@/lib/hr/compliance';
import { COMPLIANCE_KIND_KEYS } from '@/lib/hr/standard';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const complianceSchema = z.object({
  userId: z.string().min(1).max(128),
  kind: z.enum(COMPLIANCE_KIND_KEYS as unknown as [string, ...string[]]),
  label: z.string().trim().max(120).optional().nullable(),
  completedOn: z.string().trim().max(10).optional().nullable(),
  expiresOn: z.string().trim().max(10).optional().nullable(),
  status: z.enum(['complete', 'pending', 'declined', 'exempt', 'not_applicable']).optional(),
  result: z.string().trim().max(60).optional().nullable(),
  identifier: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/hr/compliance: TB / immunization / background / fingerprint / I-9 / CAQH / Medicaid record. */
export async function POST(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof complianceSchema>;
  try {
    body = complianceSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the record details', 400);
  }
  try {
    const result = await createComplianceRecord(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'staffComplianceRecord', result.id, { staffUserId: result.userId, kind: body.kind });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('compliance create', err);
  }
}

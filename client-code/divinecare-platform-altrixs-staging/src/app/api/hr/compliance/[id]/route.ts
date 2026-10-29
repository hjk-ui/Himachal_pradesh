import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteComplianceRecord, updateComplianceRecord } from '@/lib/hr/compliance';
import { auditHr, hrGate, hrJsonError, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

const patchSchema = z.object({
  label: z.string().trim().max(120).optional().nullable(),
  completedOn: z.string().trim().max(10).optional().nullable(),
  expiresOn: z.string().trim().max(10).optional().nullable(),
  status: z.enum(['complete', 'pending', 'declined', 'exempt', 'not_applicable']).optional(),
  result: z.string().trim().max(60).optional().nullable(),
  identifier: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid update', 400);
  }
  try {
    const result = await updateComplianceRecord(g.ctx, id, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'staffComplianceRecord', id, { staffUserId: result.userId, fields: Object.keys(body) });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('compliance update', err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { id } = await ctx.params;
  try {
    const result = await deleteComplianceRecord(g.ctx, id);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'DELETE', 'staffComplianceRecord', id, { staffUserId: result.userId, kind: result.kind });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('compliance delete', err);
  }
}

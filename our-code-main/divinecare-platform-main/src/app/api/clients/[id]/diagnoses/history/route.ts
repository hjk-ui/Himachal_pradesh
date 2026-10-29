import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDiagnosisAccess } from '@/lib/diagnoses/route-gate';
import { listDiagnosisHistory } from '@/lib/diagnoses/list';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await ctx.params);
  const gate = await requireDiagnosisAccess(id, 'read');
  if (gate.ok === false) return gate.response;
  const history = await listDiagnosisHistory(gate.actor.organizationId, id);
  return NextResponse.json({ success: true, history });
}

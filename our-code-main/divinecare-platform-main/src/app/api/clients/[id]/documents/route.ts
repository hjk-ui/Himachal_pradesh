import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const client = await prisma.client.findFirst({
    where: {
      AND: [
        { id },
        clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
      ],
    },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: `chart-doc:${id}:` } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({
    success: true,
    documents: rows.map((row) => {
      const data = row.data as { name?: string; bytes?: number; path?: string };
      return {
        id: row.module,
        name: data.name || 'Imported file',
        category: 'Imported chart file',
        size: `${data.bytes || 0} B`,
        uploadedAt: row.createdAt.toISOString().slice(0, 10),
      };
    }),
  });
}
